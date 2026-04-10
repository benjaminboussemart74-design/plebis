/**
 * Plébis — Script d'ingestion AN 17e législature
 *
 * Sources :
 *   - Députés : AMO10_deputes_actifs_mandats_actifs_organes.json.zip
 *   - Amendements : Amendements.json.zip
 *   - Questions écrites : QuestionsEcritesDeputes.json.zip
 *
 * Usage :
 *   npm run ingest
 *
 * Pré-requis :
 *   .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createReadStream, createWriteStream, unlinkSync, statSync, existsSync } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { execFileSync } from 'child_process'
import unzipper from 'unzipper'
import he from 'he'

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = 500
const TMP = process.env.TEMP || process.env.TMP || '/tmp'

const DEPUTES_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip'

const AMENDEMENTS_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip'

const QUESTIONS_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_ecrites/Questions_ecrites.json.zip'

// Mapping sigle → orientation
const ORIENTATION_MAP = {
  'LFI-NFP': 'gauche', 'SOC': 'gauche', 'GDR': 'gauche', 'EcoS': 'gauche',
  'LIOT': 'centre', 'EPR': 'centre', 'MoDem': 'centre', 'HOR': 'centre', 'Dem': 'centre', 'DEM': 'centre',
  'DR': 'droite', 'LR': 'droite', 'RN': 'droite', 'UDR': 'droite',
  'NI': null,
}

// Mapping sigle → couleur
const COULEUR_MAP = {
  'LFI-NFP': '#CC2A00', 'SOC': '#E75480', 'GDR': '#CC0000', 'EcoS': '#2ECC40',
  'LIOT': '#888888', 'EPR': '#FFBE00', 'MoDem': '#FF6600', 'HOR': '#3B82F6', 'Dem': '#FF6600', 'DEM': '#FF6600',
  'DR': '#1B3A6B', 'LR': '#1B3A6B', 'RN': '#0A1833', 'UDR': '#2C3E50',
  'NI': '#888888',
}

// ─── Client Supabase ─────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(' Variables manquantes : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env')
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

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function stripHtml(s) {
  return s ? he.decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : null
}

// ─── Téléchargement ──────────────────────────────────────────────────────────

// Télécharge avec curl.exe (reprise automatique si coupure, --retry 5 -C -)
function downloadZip(url, tmpName) {
  const tmpPath = `${TMP}\\${tmpName}`.replace(/\//g, '\\')
  // Supprimer tout fichier partiel d'une tentative précédente
  if (existsSync(tmpPath)) unlinkSync(tmpPath)
  console.log(`  Téléchargement : ${url.split('/').pop()}`)
  execFileSync('curl.exe', [
    '-L', '-A', 'Mozilla/5.0',
    '--retry', '5',
    '--retry-delay', '3',
    '--retry-connrefused',
    '-o', tmpPath,
    url,
  ], { stdio: 'inherit' })
  const size = statSync(tmpPath).size
  console.log(`    ${(size / 1024 / 1024).toFixed(1)} Mo téléchargés`)
  return tmpPath
}

// Itère sur les entrées JSON d'un ZIP sur disque — une entrée en mémoire à la fois
async function* zipJsonEntries(tmpPath) {
  const stream = createReadStream(tmpPath).pipe(unzipper.Parse({ forceStream: true }))
  for await (const entry of stream) {
    if (entry.path.endsWith('.json')) {
      const buf = await entry.buffer()
      yield { path: entry.path, data: JSON.parse(buf.toString('utf8')) }
    } else {
      entry.autodrain()
    }
  }
}

async function batchUpsert(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' })
    if (error) {
      console.error(`\n Erreur upsert ${table} (batch ${i / BATCH_SIZE + 1}):`, error.message)
    } else {
      process.stdout.write(`   ${table} : ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`)
    }
  }
  console.log(`   ${table} : ${rows.length}/${rows.length} — OK`)
}

// ─── Phase 1 : Députés ───────────────────────────────────────────────────────

async function parseDeputes(tmpPath) {
  // Passe 1 : groupes politiques (ZIP petit, ~250 organes)
  const gpMap = new Map()
  for await (const { path, data } of zipJsonEntries(tmpPath)) {
    if (!path.includes('/organe/')) continue
    const org = data.organe
    if (org?.codeType === 'GP') {
      const uid = org.uid?.['#text'] ?? org.uid
      gpMap.set(uid, { libelle: org.libelle, abrege: org.libelleAbrege })
    }
  }
  console.log(`    ${gpMap.size} groupes politiques chargés`)

  // Passe 2 : acteurs
  const deputes = []
  for await (const { path, data } of zipJsonEntries(tmpPath)) {
    if (!path.includes('/acteur/')) continue
    const a = data.acteur
    if (!a) continue

    const id = a.uid?.['#text'] ?? a.uid
    if (!id) continue

    const ident = a.etatCivil?.ident ?? {}
    const nom = ident.nom ?? ''
    const prenom = ident.prenom ?? ''

    const mandatsRaw = a.mandats?.mandat ?? []
    const mandats = Array.isArray(mandatsRaw) ? mandatsRaw : [mandatsRaw]

    const gpMandat = mandats.find(m => m?.typeOrgane === 'GP' && !m?.dateFin)
      ?? mandats.find(m => m?.typeOrgane === 'GP')
    const gpRef = gpMandat?.organes?.organeRef
    const gp = gpRef ? gpMap.get(gpRef) : null

    const groupeSigle = gp?.abrege ?? ''
    const groupeLibelle = gp?.libelle ?? ''

    const mandatAN = mandats.find(m => m?.typeOrgane === 'ASSEMBLEE')
    const lieu = mandatAN?.election?.lieu ?? {}
    const circo = lieu.departement ? `${lieu.departement} (${lieu.numCirco ?? ''})` : null

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
      photo_url: `https://mncyqaovonldvfzqmric.supabase.co/functions/v1/an-proxy?type=photo&id=${id}`,
    })
  }

  return deputes
}

// ─── Phase 2 : Amendements ───────────────────────────────────────────────────

async function parseAmendements(tmpPath, deputesSet) {
  const amendements = []
  let skipped = 0
  let count = 0

  for await (const { data } of zipJsonEntries(tmpPath)) {
    const a = data.amendement ?? data

    const uid = a.uid
    if (!uid) continue

    const signataires = a.signataires?.auteur
    const auteurArr = Array.isArray(signataires) ? signataires : [signataires]
    const auteur = auteurArr.find(s => s?.typeAuteur === 'Député') ?? auteurArr[0]
    const acteurRef = auteur?.acteurRef

    if (!acteurRef || !deputesSet.has(acteurRef)) {
      skipped++
      continue
    }

    const corps = a.corps?.contenuAuteur ?? {}
    const objet = stripHtml(corps.dispositif ?? null)
    const expose = stripHtml(corps.exposeSommaire ?? null)

    const cdv = a.cycleDeVie ?? {}
    const sortVal = cdv.sort?.['#text'] ?? cdv.sort?.value ?? cdv.sort ?? null
    const dateDepot = parseDate(cdv.dateDepot)

    amendements.push({
      id: uid,
      parlementaire_id: acteurRef,
      objet,
      expose_motifs: expose,
      sort: typeof sortVal === 'string' ? sortVal : null,
      date_depot: dateDepot,
      legislature: 17,
      texte_legis_ref: a.texteLegislatifRef ?? null,
      division_titre: a.pointeurFragmentTexte?.division?.titre ?? null,
    })

    count++
    if (count % 5000 === 0) process.stdout.write(`    parsing… ${count} amendements\r`)
  }

  return { amendements, skipped }
}

// ─── Phase 3 : Questions écrites ─────────────────────────────────────────────

async function parseQuestionsEcrites(tmpPath, deputesSet) {
  const questions = []
  let skipped = 0

  for await (const { data } of zipJsonEntries(tmpPath)) {
    const q = data.question ?? data

    const uid = q.uid
    if (!uid) continue

    const acteurRef = q.auteur?.identite?.acteurRef
    if (!acteurRef || !deputesSet.has(acteurRef)) {
      skipped++
      continue
    }

    // Texte principal (peut être tableau ou objet)
    const tq = q.textesQuestion?.texteQuestion
    const tqObj = Array.isArray(tq) ? tq[0] : tq
    const texteQuestion = stripHtml(tqObj?.texte ?? null)
    const dateDepot = parseDate(tqObj?.infoJO?.dateJO ?? null)

    // Indexation : teteAnalyse souvent null, utiliser analyses.analyse à la place
    const indexation = q.indexationAN ?? {}
    const teteAnalyse = indexation.teteAnalyse
      ?? (typeof indexation.analyses?.analyse === 'string' ? indexation.analyses.analyse : null)

    questions.push({
      id: uid,
      parlementaire_id: acteurRef,
      rubrique: indexation.rubrique ?? null,
      tete_analyse: teteAnalyse,
      texte_question: texteQuestion,
      ministere: q.minInt?.abrege ?? null,
      date_depot: dateDepot,
      legislature: 17,
    })
  }

  return { questions, skipped }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('  Plébis — Ingestion AN 17e législature\n')

  // ── 1. Vider les tables ──
  console.log('  Nettoyage des tables existantes…')
  const { error: truncateError } = await supabase.rpc('truncate_all')
  if (truncateError) {
    console.error(' Erreur TRUNCATE :', truncateError.message)
    process.exit(1)
  }
  console.log('    Tables vidées.\n')

  // ── 2. Députés ──
  console.log(' Téléchargement des députés…')
  let deputesTmp
  try {
    deputesTmp = downloadZip(DEPUTES_URL, 'deputes.zip')
  } catch (err) {
    console.error(' Erreur députés :', err.message); process.exit(1)
  }
  console.log(' Parsing des députés…')
  const deputes = await parseDeputes(deputesTmp)
  unlinkSync(deputesTmp)
  console.log(`    ${deputes.length} députés parsés\n`)

  const deputesSet = new Set(deputes.map(d => d.id))

  // ── 3. Amendements ──
  console.log(' Téléchargement des amendements…')
  let amendTmp
  try {
    amendTmp = downloadZip(AMENDEMENTS_URL, 'amendements.zip')
  } catch (err) {
    console.error(' Erreur amendements :', err.message); process.exit(1)
  }
  console.log(' Parsing des amendements…')
  const { amendements, skipped } = await parseAmendements(amendTmp, deputesSet)
  unlinkSync(amendTmp)
  console.log(`    ${amendements.length} amendements parsés (${skipped} ignorés)\n`)

  // ── 4. Questions écrites ──
  console.log(' Téléchargement des questions écrites…')
  let questionsTmp
  try {
    questionsTmp = downloadZip(QUESTIONS_URL, 'questions.zip')
  } catch (err) {
    console.error(' Erreur questions écrites :', err.message); process.exit(1)
  }
  console.log(' Parsing des questions écrites…')
  const { questions, skipped: skippedQ } = await parseQuestionsEcrites(questionsTmp, deputesSet)
  unlinkSync(questionsTmp)
  console.log(`    ${questions.length} questions parsées (${skippedQ} ignorées)\n`)

  // ── 5. Insertion ──
  console.log('  Insertion dans Supabase…')
  await batchUpsert('parlementaires', deputes)
  await batchUpsert('amendements', amendements)
  await batchUpsert('questions_ecrites', questions)

  console.log('\n Ingestion terminée.')
  console.log(`   ${deputes.length} députés | ${amendements.length} amendements | ${questions.length} questions écrites`)
}

main().catch((err) => {
  console.error(' Erreur fatale :', err)
  process.exit(1)
})
