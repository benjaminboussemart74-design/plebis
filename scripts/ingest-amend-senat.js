/**
 * Plébis — Script d'ingestion des amendements Sénat
 *
 * Sources :
 *   - Liste des textes : dosleg.zip (data.senat.fr/data/dosleg/dosleg.zip)
 *     → table `texte`, colonnes sesann + texnum pour les sessions 2023 et 2024
 *   - Amendements par texte :
 *     https://www.senat.fr/amendements/{session}/{num}/jeu_complet_{session}_{num}.csv
 *     → TSV, encodage latin1, colonnes : Nature, Numéro, Subdivision, Alinéa,
 *       Auteur, Au nom de, Date de dépôt, Dispositif (HTML), Objet (HTML),
 *       Sort, Date de saisie du sort, Url amendement, Fiche Sénateur
 *
 * Usage :
 *   node scripts/ingest-amend-senat.js
 *   INGEST_TMP=D:\Temp node scripts/ingest-amend-senat.js
 *
 * Pré-requis :
 *   .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { createClient }           from '@supabase/supabase-js'
import { createReadStream, existsSync, statSync } from 'fs'
import { execFileSync }           from 'child_process'
import { join }                   from 'path'
import unzipper                   from 'unzipper'
import he                         from 'he'

// ─── Configuration ───────────────────────────────────────────────────────────

const SUPABASE_URL        = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE          = 500
const DELAY_MS            = 150   // délai entre requêtes CSV pour ne pas surcharger senat.fr

const TMP = process.env.INGEST_TMP
  || (process.platform === 'win32' ? process.env.TEMP || process.env.TMP || 'C:\\Temp' : '/tmp')

const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'

const DOSLEG_URL = 'https://data.senat.fr/data/dosleg/dosleg.zip'

// Sessions à couvrir : sesann → slug URL
const SESSIONS = [
  { sesann: '2024', slug: '2024-2025' },
  { sesann: '2023', slug: '2023-2024' },
]

// ─── Client Supabase ─────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Variables manquantes : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function parseDate(str) {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

/** Supprime les balises HTML et décode les entités HTML */
function stripHtml(html) {
  if (!html) return null
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return he.decode(stripped) || null
}

/** Extrait le matricule depuis une URL senfic :
 *  "//www.senat.fr/senfic/roiron_pierre_alain21056g.html" → "21056G"
 */
function extractMatricule(ficheUrl) {
  if (!ficheUrl) return null
  const m = ficheUrl.match(/([0-9]+[a-zA-Z])\.html?$/i)
  return m ? m[1].toUpperCase() : null
}

/** Construit l'ID de l'amendement depuis son URL :
 *  "//www.senat.fr/amendements/2024-2025/399/Amdt_1.html" → "SEN_AMN_2024-2025_399_1"
 *  En fallback : session + texnum + numéro sanitisé
 */
function buildAmendId(urlAmend, session, texnum, numero) {
  const m = urlAmend?.match(/Amdt_(\d+)\.html?$/i)
  if (m) return `SEN_AMN_${session}_${texnum}_${m[1]}`
  // fallback : sanitiser "1 rect. bis" → "1-rect-bis"
  const slug = numero.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '')
  return `SEN_AMN_${session}_${texnum}_${slug}`
}

/** Normalise le sort vers les valeurs standards */
function normalizeSort(raw) {
  if (!raw) return null
  const lower = raw.toLowerCase().trim()
  if (lower.startsWith('adopt'))        return 'Adopté'
  if (lower.startsWith('rejet'))        return 'Rejeté'
  if (lower.startsWith('retir'))        return 'Retiré'
  if (lower.startsWith('tomb'))         return 'Tombé'
  if (lower.startsWith('non soutenu'))  return 'Non soutenu'
  if (lower.startsWith('irrecevable'))  return 'Rejeté'
  return raw.trim() || null
}

// ─── Téléchargement dosleg ───────────────────────────────────────────────────

function downloadDosleg() {
  const path = join(TMP, 'dosleg.zip')
  if (existsSync(path)) {
    const size = statSync(path).size
    console.log(`  Fichier existant réutilisé : ${path} (${(size / 1024 / 1024).toFixed(1)} Mo)`)
    return path
  }
  console.log(`  Téléchargement dosleg.zip → ${path}`)
  execFileSync(CURL, ['-L', '-o', path, '--progress-bar', DOSLEG_URL], { stdio: 'inherit' })
  return path
}

/** Extrait depuis dosleg.sql les numéros de textes par session */
async function getTexteNums(doslegPath) {
  return new Promise((resolve, reject) => {
    let content = ''
    createReadStream(doslegPath)
      .pipe(unzipper.Parse())
      .on('entry', e => {
        e.on('data', c => { content += c.toString('utf8') })
        e.on('end', () => {
          const result = {}
          for (const { sesann } of SESSIONS) result[sesann] = []

          const copyIdx = content.indexOf('\nCOPY texte (')
          if (copyIdx < 0) { resolve(result); return }
          const headerEnd = content.indexOf('\n', copyIdx + 1)
          const endIdx    = content.indexOf('\n\\.', headerEnd)
          const rows      = content.slice(headerEnd + 1, endIdx).split('\n')

          // cols: texcod, oritxtcod, typtxtcod, typurl, lecassidt, sesann, orgcod, texnum, ...
          for (const row of rows) {
            const cols   = row.split('\t')
            const sesann = cols[5]?.trim()
            const texnum = parseInt(cols[7]?.trim())
            if (!sesann || isNaN(texnum) || texnum <= 0) continue
            if (result[sesann]) result[sesann].push(texnum)
          }

          for (const s of SESSIONS) {
            result[s.sesann] = [...new Set(result[s.sesann])].sort((a, b) => a - b)
          }
          resolve(result)
        })
      })
      .on('error', reject)
  })
}

// ─── Chargement sénateurs ────────────────────────────────────────────────────

async function loadSenateurs() {
  const { data, error } = await supabase
    .from('parlementaires')
    .select('id, nom, prenom')
    .eq('chambre', 'Senat')
  if (error) throw error
  // Index par matricule (ex: SEN_21056G → id) ET par nom uppercase (fallback)
  const byMatricule = new Map()
  const byNom       = new Map()
  for (const p of data) {
    const mat = p.id.replace(/^SEN_/, '')
    byMatricule.set(mat, p.id)
    byNom.set(p.nom.toUpperCase(), p.id)
  }
  console.log(`  ${data.length} sénateurs chargés`)
  return { byMatricule, byNom }
}

// ─── Fetch + parse CSV ───────────────────────────────────────────────────────

async function fetchAmendCsv(session, num) {
  const url = `https://www.senat.fr/amendements/${session}/${num}/jeu_complet_${session}_${num}.csv`
  let res
  try {
    res = await fetch(url)
  } catch {
    return null
  }
  if (!res.ok) return null
  const buf  = await res.arrayBuffer()
  const text = Buffer.from(buf).toString('latin1')
  const lines = text.split(/\r?\n/)

  // Ligne 0 : "sep=", Ligne 1 : entêtes, Ligne 2+ : données
  const rows = []
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cols = line.split('\t')
    if (cols.length < 12) continue
    const nature = cols[0].trim()
    // Garder Amt (amendement) et Ats (amendement de séance)
    if (nature !== 'Amt' && nature !== 'Ats') continue
    rows.push({
      numero:    cols[1].trim(),
      subdiv:    cols[2].trim(),
      auteur:    cols[4].trim(),
      dateDepot: cols[6].trim(),
      dispositif:cols[7].trim(),
      objet:     cols[8].trim(),
      sort:      cols[9].trim(),
      urlAmend:  cols[11].trim(),
      ficheUrl:  cols[12]?.trim() || '',
    })
  }
  return rows
}

// ─── Upsert par batch ────────────────────────────────────────────────────────

async function upsertBatch(batch) {
  if (!batch.length) return
  const { error } = await supabase
    .from('amendements')
    .upsert(batch, { onConflict: 'id' })
  if (error) console.error(`  Erreur upsert batch: ${error.message}`)
}

// ─── Phase principale ─────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Ingestion amendements Sénat\n')
  console.log(`  Répertoire temp : ${TMP}\n`)

  // 1. Dosleg → liste des textes
  console.log('  Étape 1 — Récupération de la liste des textes (Dosleg)')
  const doslegPath = downloadDosleg()
  const texteNums  = await getTexteNums(doslegPath)
  for (const { sesann, slug } of SESSIONS) {
    console.log(`  Session ${slug} : ${texteNums[sesann].length} textes`)
  }

  // 2. Chargement sénateurs
  console.log('\n  Étape 2 — Chargement des sénateurs')
  const { byMatricule, byNom } = await loadSenateurs()

  // 3. Téléchargement + parse des CSV
  console.log('\n  Étape 3 — Téléchargement des CSV d\'amendements')
  let totalTextes = 0, totalAmend = 0, notFound = 0, noMatch = 0
  const buffer = []

  async function flushBuffer(force = false) {
    while (buffer.length >= BATCH_SIZE || (force && buffer.length > 0)) {
      const batch = buffer.splice(0, BATCH_SIZE)
      process.stdout.write(`\r    Upsert ${totalAmend} amendements insérés…`)
      await upsertBatch(batch)
    }
  }

  for (const { sesann, slug } of SESSIONS) {
    const nums = texteNums[sesann]
    console.log(`\n  Session ${slug} — ${nums.length} textes à tester`)
    let sesAmend = 0

    for (let i = 0; i < nums.length; i++) {
      const num = nums[i]
      const rows = await fetchAmendCsv(slug, num)

      if (rows === null) { notFound++; await sleep(DELAY_MS); continue }
      if (rows.length === 0) { await sleep(DELAY_MS); continue }

      totalTextes++
      sesAmend += rows.length

      for (const row of rows) {
        // Résolution du sénateur : d'abord par matricule (fiable), puis par nom (fallback)
        const matricule = extractMatricule(row.ficheUrl)
        let parlId = matricule ? byMatricule.get(matricule) : null

        if (!parlId && row.auteur) {
          // Extraire le nom de famille : dernier mot en majuscules
          const parts = row.auteur.replace(/^(M\.|Mme|M\.me)\s*/i, '').trim().split(/\s+/)
          const nomMaj = parts.find(p => p === p.toUpperCase() && p.length > 1)
            || parts[parts.length - 1].toUpperCase()
          parlId = byNom.get(nomMaj.toUpperCase())
        }

        if (!parlId) { noMatch++; continue }

        const id = buildAmendId(row.urlAmend, slug, num, row.numero)

        buffer.push({
          id,
          parlementaire_id: parlId,
          objet:        stripHtml(row.objet),
          expose_motifs: stripHtml(row.dispositif),
          sort:         normalizeSort(row.sort),
          date_depot:   parseDate(row.dateDepot),
          legislature:  17,
          texte_legis_ref: `SEN_${slug}_${num}`,
          division_titre:  row.subdiv || null,
        })
        totalAmend++
      }

      await flushBuffer()
      await sleep(DELAY_MS)

      if ((i + 1) % 50 === 0) {
        process.stdout.write(`\r    ${i + 1}/${nums.length} textes — ${sesAmend} amendements trouvés`)
      }
    }
    console.log(`\n  Session ${slug} — ${sesAmend} amendements`)
  }

  await flushBuffer(true)
  process.stdout.write('\n')

  console.log(`\n  ── Résumé ──────────────────────────`)
  console.log(`  Textes avec amendements : ${totalTextes}`)
  console.log(`  Textes sans CSV (404)   : ${notFound}`)
  console.log(`  Amendements insérés     : ${totalAmend}`)
  console.log(`  Auteurs non matchés     : ${noMatch}`)
  console.log(`  ─────────────────────────────────────`)
  console.log(`\n  Ingestion amendements Sénat terminée.\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
