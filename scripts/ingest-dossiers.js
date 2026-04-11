/**
 * Plébis — Script d'ingestion des Dossiers Législatifs AN 17e législature
 *
 * Source : https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers/Dossiers_Legislatifs.json.zip
 *
 * Usage :
 *   npm run ingest:dossiers
 *
 * Pré-requis :
 *   .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { existsSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = 500
const TMP = process.platform === 'win32' ? process.env.TEMP || process.env.TMP || 'C:\\Temp' : '/tmp'
const DOSSIERS_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers/Dossiers_Legislatifs.json.zip'
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(' Variables manquantes : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env')
  process.exit(1)
}

// ─── Client Supabase ─────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toArray(val) {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

function findFirstDate(actes) {
  const arr = Array.isArray(actes) ? actes : (actes ? [actes] : [])
  for (const a of arr) {
    if (a?.dateActe) {
      const d = new Date(a.dateActe)
      if (!isNaN(d)) return d.toISOString().slice(0, 10)
    }
    const nested = a?.actesLegislatifs?.acteLegislatif
    if (nested) {
      const found = findFirstDate(nested)
      if (found) return found
    }
  }
  return null
}

async function upsertBatch(rows) {
  const { error } = await supabase
    .from('dossiers_legislatifs')
    .upsert(rows, { onConflict: 'id' })
  if (error) {
    console.warn(' Erreur upsert batch :', error.message)
  }
}

// ─── Téléchargement ──────────────────────────────────────────────────────────

function downloadZip(url, tmpName) {
  const tmpPath = join(TMP, tmpName)
  if (existsSync(tmpPath)) unlinkSync(tmpPath)
  console.log(`  Téléchargement : ${url.split('/').pop()}`)
  execFileSync(CURL, [
    '-L', '--fail',
    '-A', 'Mozilla/5.0',
    '--retry', '5',
    '--retry-delay', '3',
    '--retry-connrefused',
    '--max-time', '300',
    '--write-out', '\n  HTTP %{http_code} — %{size_download} octets',
    '-o', tmpPath,
    url,
  ], { stdio: 'inherit' })
  const size = statSync(tmpPath).size
  console.log(`  ${(size / 1024 / 1024).toFixed(1)} Mo téléchargés`)
  if (size < 1024) {
    throw new Error(`Fichier trop petit (${size} octets) — le serveur a probablement renvoyé une erreur. Vérifiez l'URL : ${url}`)
  }
  return tmpPath
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

async function main() {
  // Pré-charger les IDs de parlementaires valides pour éviter les violations FK
  console.log(' Chargement des parlementaires valides...')
  const { data: parls, error: parlError } = await supabase
    .from('parlementaires')
    .select('id')
  if (parlError) {
    console.error(' Erreur chargement parlementaires :', parlError.message)
    process.exit(1)
  }
  const validIds = new Set(parls.map(p => p.id))
  console.log(`   ${validIds.size} parlementaires en base`)

  const ZIP_PATH = downloadZip(DOSSIERS_URL, 'Dossiers_Legislatifs.json.zip')
  console.log(' Lecture du ZIP :', ZIP_PATH)
  const zip = new AdmZip(ZIP_PATH)
  const entries = zip.getEntries().filter(e => e.entryName.endsWith('.json'))
  console.log(` ${entries.length} fichiers JSON trouvés`)

  let batch = []
  const seenIds = new Set()  // déduplication intra-batch
  let totalRows = 0
  let skipped = 0

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    let dp
    try {
      const raw = JSON.parse(entry.getData().toString('utf8'))
      dp = raw.dossierParlementaire
    } catch {
      skipped++
      continue
    }

    const uid = dp?.uid
    const titre = dp?.titreDossier?.titre
    const titre_chemin = dp?.titreDossier?.titreChemin ?? null
    const procedure_libelle = dp?.procedureParlementaire?.libelle

    if (!uid || !titre) {
      skipped++
      continue
    }

    // Extrait la première date de dépôt depuis actesLegislatifs
    const date_depot = findFirstDate(dp?.actesLegislatifs?.acteLegislatif)

    // Normalise initiateur : peut être un objet ou un tableau
    const acteurs = toArray(dp?.initiateur?.acteurs?.acteur)

    for (const acteur of acteurs) {
      const acteurRef = acteur?.acteurRef
      if (!acteurRef || !acteurRef.startsWith('PA')) continue
      if (!validIds.has(acteurRef)) continue  // ignore ministres / anciens députés

      const rowId = `${uid}_${acteurRef}`
      if (seenIds.has(rowId)) continue  // déduplique dans le batch courant
      seenIds.add(rowId)

      batch.push({
        id: rowId,
        dossier_uid: uid,
        parlementaire_id: acteurRef,
        titre,
        titre_chemin,
        procedure_libelle,
        date_depot,
        legislature: 17,
      })
    }

    if (batch.length >= BATCH_SIZE) {
      await upsertBatch(batch)
      totalRows += batch.length
      seenIds.clear()
      process.stdout.write(`\r  → ${totalRows} lignes insérées (${i + 1}/${entries.length} dossiers)`)
      batch = []
    }
  }

  if (batch.length > 0) {
    await upsertBatch(batch)
    totalRows += batch.length
  }

  console.log(`\n Ingestion terminée : ${totalRows} lignes insérées (${skipped} dossiers ignorés)`)
}

main().catch(err => {
  console.error(' Erreur fatale :', err)
  process.exit(1)
})
