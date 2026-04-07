/**
 * Plébis — Script d'ingestion des amendements AN 17e législature
 *
 * Sources :
 *   - Députés : AMO10_deputes_actifs_mandats_actifs_organes.json.zip
 *   - Amendements : Amendements.json.zip
 *
 * Usage :
 *   node scripts/ingest.js
 *
 * Pré-requis :
 *   npm install @supabase/supabase-js adm-zip dotenv
 *   Fichier .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import AdmZip from 'adm-zip'
import { writeFileSync, unlinkSync } from 'fs'
import he from 'he'

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = 500
const TMP = process.env.TEMP || process.env.TMP || '.'

const DEPUTES_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip'

const AMENDEMENTS_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip'

// Mapping sigle → orientation
const ORIENTATION_MAP = {
  'LFI-NFP': 'gauche',
  'SOC': 'gauche',
  'GDR': 'gauche',
  'EcoS': 'gauche',
  'LIOT': 'centre',
  'EPR': 'centre',
  'MoDem': 'centre',
  'HOR': 'centre',
  'Dem': 'centre',
  'DEM': 'centre',
  'DR': 'droite',
  'LR': 'droite',
  'RN': 'droite',
  'UDR': 'droite',
  'NI': null,
}

// Mapping sigle → couleur
const COULEUR_MAP = {
  'LFI-NFP': '#CC2A00',
  'SOC': '#E75480',
  'GDR': '#CC0000',
  'EcoS': '#2ECC40',
  'LIOT': '#888888',
  'EPR': '#FFBE00',
  'MoDem': '#FF6600',
  'HOR': '#3B82F6',
  'Dem': '#FF6600',
  'DEM': '#FF6600',
  'DR': '#1B3A6B',
  'LR': '#1B3A6B',
  'RN': '#0A1833',
  'UDR': '#2C3E50',
  'NI': '#888888',
}

// ─── Client Supabase ─────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Variables manquantes : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

function getOrientation(sigle) {
  if (!sigle) return null
  for (const [key, val] of Object.entries(ORIENTATION_MAP)) {
    if (sigle === key || sigle.startsWith(key)) return val
  }
  return null
}

function getCouleur(sigle) {
  if (!sigle) return '#888888'
  for (const [key, val] of Object.entries(COULEUR_MAP)) {
    if (sigle === key || sigle.startsWith(key)) return val
  }
  return '#888888'
}

async function downloadZip(url, tmpName) {
  console.log(`⬇️  Téléchargement : ${url.split('/').pop()}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const buffer = await response.arrayBuffer()
  const tmpPath = `${TMP}/${tmpName}`
  writeFileSync(tmpPath, Buffer.from(buffer))
  console.log(`    ${(buffer.byteLength / 1024 / 1024).toFixed(1)} Mo téléchargés`)
  const zip = new AdmZip(tmpPath)
  unlinkSync(tmpPath)
  return zip
}

async function batchUpsert(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' })
    if (error) {
      console.error(`\n❌ Erreur upsert ${table} (batch ${i / BATCH_SIZE + 1}):`, error.message)
    } else {
      process.stdout.write(`  ✓ ${table} : ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`)
    }
  }
  console.log(`  ✓ ${table} : ${rows.length}/${rows.length} — OK`)
}

// ─── Phase 1 : Députés ───────────────────────────────────────────────────────

async function parseDeputes(zip) {
  const entries = zip.getEntries()
  const acteurEntries = entries.filter(e => e.entryName.includes('/acteur/') && e.entryName.endsWith('.json'))
  const organeEntries = entries.filter(e => e.entryName.includes('/organe/') && e.entryName.endsWith('.json'))

  // Charger les groupes politiques (GP)
  const gpMap = new Map() // uid → { libelle, abrege }
  for (const e of organeEntries) {
    const d = JSON.parse(e.getData().toString('utf8'))
    const org = d.organe
    if (org?.codeType === 'GP') {
      const uid = org.uid?.['#text'] ?? org.uid
      gpMap.set(uid, { libelle: org.libelle, abrege: org.libelleAbrege })
    }
  }
  console.log(`    ${gpMap.size} groupes politiques chargés`)

  const deputes = []
  for (const e of acteurEntries) {
    const d = JSON.parse(e.getData().toString('utf8'))
    const a = d.acteur
    if (!a) continue

    const id = a.uid?.['#text'] ?? a.uid
    if (!id) continue

    const ident = a.etatCivil?.ident ?? {}
    const nom = ident.nom ?? ''
    const prenom = ident.prenom ?? ''

    // Mandats
    const mandatsRaw = a.mandats?.mandat ?? []
    const mandats = Array.isArray(mandatsRaw) ? mandatsRaw : [mandatsRaw]

    // Groupe politique (mandat GP actif = dateFin null)
    const gpMandat = mandats.find(m => m?.typeOrgane === 'GP' && !m?.dateFin)
      ?? mandats.find(m => m?.typeOrgane === 'GP')
    const gpRef = gpMandat?.organes?.organeRef
    const gp = gpRef ? gpMap.get(gpRef) : null

    const groupeSigle = gp?.abrege ?? ''
    const groupeLibelle = gp?.libelle ?? ''

    // Circonscription (mandat ASSEMBLEE)
    const mandatAN = mandats.find(m => m?.typeOrgane === 'ASSEMBLEE')
    const lieu = mandatAN?.election?.lieu ?? {}
    const circo = lieu.departement
      ? `${lieu.departement} (${lieu.numCirco ?? ''})`
      : null

    deputes.push({
      id,
      nom,
      prenom,
      chambre: 'AN',
      groupe_sigle: groupeSigle,
      groupe_libelle: groupeLibelle,
      orientation: getOrientation(groupeSigle),
      couleur_groupe: getCouleur(groupeSigle),
      circonscription: circo,
      photo_url: `https://www.assemblee-nationale.fr/dyn/static/tribun/${id}/photo`,
    })
  }

  return deputes
}

// ─── Phase 2 : Amendements ───────────────────────────────────────────────────

async function parseAmendements(zip, deputesSet) {
  const entries = zip.getEntries().filter(e => e.entryName.endsWith('.json'))
  const amendements = []
  let skipped = 0

  for (const e of entries) {
    const data = JSON.parse(e.getData().toString('utf8'))
    const a = data.amendement ?? data

    const uid = a.uid
    if (!uid) continue

    // Auteur : signataires.auteur (peut être tableau ou objet)
    const signataires = a.signataires?.auteur
    const auteurArr = Array.isArray(signataires) ? signataires : [signataires]
    // Premier auteur de type Député
    const auteur = auteurArr.find(s => s?.typeAuteur === 'Député') ?? auteurArr[0]
    const acteurRef = auteur?.acteurRef

    if (!acteurRef || !deputesSet.has(acteurRef)) {
      skipped++
      continue
    }

    // Corps
    const corps = a.corps?.contenuAuteur ?? {}
    const titre = corps.titre ?? null
    // Nettoie les balises HTML basiques
    const stripHtml = (s) => s ? he.decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null
    const objet = stripHtml(corps.dispositif ?? null)
    const expose = stripHtml(corps.exposeSommaire ?? null)

    // Cycle de vie
    const cdv = a.cycleDeVie ?? {}
    const sortVal = cdv.sort?.['#text'] ?? cdv.sort?.value ?? cdv.sort ?? null
    const dateDepot = parseDate(cdv.dateDepot)

    const texteRef = a.texteLegislatifRef ?? null
    const divisionTitre = a.pointeurFragmentTexte?.division?.titre ?? null

    amendements.push({
      id: uid,
      parlementaire_id: acteurRef,
      objet,
      expose_motifs: expose,
      sort: typeof sortVal === 'string' ? sortVal : null,
      date_depot: dateDepot,
      legislature: 17,
      texte_legis_ref: texteRef,
      division_titre: divisionTitre,
    })
  }

  return { amendements, skipped }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏛️  Plébis — Ingestion AN 17e législature\n')

  // ── 1. Vider les tables ──
  console.log('🗑️  Nettoyage des tables existantes…')
  const { error: truncateError } = await supabase.rpc('truncate_all')
  if (truncateError) {
    console.error('❌ Erreur TRUNCATE :', truncateError.message)
    process.exit(1)
  }
  console.log('    Tables vidées.\n')

  // ── 2. Députés ──
  console.log('👤 Téléchargement des députés…')
  let deputesZip
  try {
    deputesZip = await downloadZip(DEPUTES_URL, 'deputes.zip')
  } catch (err) {
    console.error('❌ Erreur députés :', err.message)
    process.exit(1)
  }
  console.log('📦 Parsing des députés…')
  const deputes = await parseDeputes(deputesZip)
  console.log(`    ${deputes.length} députés parsés\n`)

  // ── 3. Amendements ──
  console.log('📜 Téléchargement des amendements…')
  let amendZip
  try {
    amendZip = await downloadZip(AMENDEMENTS_URL, 'amendements.zip')
  } catch (err) {
    console.error('❌ Erreur amendements :', err.message)
    process.exit(1)
  }
  console.log('📦 Parsing des amendements…')
  const deputesSet = new Set(deputes.map(d => d.id))
  const { amendements, skipped } = await parseAmendements(amendZip, deputesSet)
  console.log(`    ${amendements.length} amendements parsés (${skipped} ignorés — auteur non député actif)\n`)

  // ── 4. Insertion ──
  console.log('⬆️  Insertion dans Supabase…')
  await batchUpsert('parlementaires', deputes)
  await batchUpsert('amendements', amendements)

  console.log('\n✅ Ingestion terminée.')
  console.log(`   ${deputes.length} députés | ${amendements.length} amendements`)
}

main().catch((err) => {
  console.error('❌ Erreur fatale :', err)
  process.exit(1)
})
