/**
 * Plébis — Script d'ingestion Sénat (Phase 4)
 *
 * Sources :
 *   - Sénateurs : ODSEN_GENERAL.json + ODSEN_HISTOGROUPES.json (data.senat.fr)
 *   - Amendements : CSV par texte (www.senat.fr/amendements/{session}/{n}/…)
 *
 * Usage :
 *   npm run ingest:senat
 *
 * Pré-requis :
 *   .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 *
 * Stratégie :
 *   - Ne touche pas aux données AN (pas de TRUNCATE global)
 *   - Upsert additif : ajoute/met à jour sénateurs + amendements Sénat
 *   - 3 sessions couvertes : 2023-2024, 2024-2025, 2025-2026
 *   - Textes 1→MAX_TEXT par session, CONCURRENCY requêtes en parallèle
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import he from 'he'

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE    = 500
const CONCURRENCY   = 15   // requêtes CSV parallèles
const MAX_TEXT      = 400  // numéros de texte 1…MAX_TEXT par session
const SESSIONS      = ['2023-2024', '2024-2025', '2025-2026']

const SENATEURS_URL  = 'https://data.senat.fr/data/senateurs/ODSEN_GENERAL.json'
const GROUPES_URL    = 'https://data.senat.fr/data/senateurs/ODSEN_HISTOGROUPES.json'

// Groupes → orientation (codes courants Sénat)
const ORIENTATION_MAP = {
  'Les Républicains': 'droite', 'LR': 'droite',
  'UC': 'droite', 'Union Centriste': 'droite',
  'ESN': 'droite', 'Droite Souveraine et Nationale': 'droite',
  'RN': 'droite',
  'SER': 'gauche', 'Socialiste, Écologiste et Républicain': 'gauche',
  'CRCE': 'gauche', 'CRCE-K': 'gauche',
  'GEST': 'gauche', 'Écologiste - Solidarité et Territoires': 'gauche',
  'RDPI': 'centre', 'Rassemblement des démocrates, progressistes et indépendants': 'centre',
  'RDSE': 'centre', 'Rassemblement Démocratique et Social Européen': 'centre',
  'LIRT': 'centre', 'Les Indépendants': 'centre', 'Ind.': 'centre',
  'NI': null,
}

// Groupes → couleur hex (stockée en BDD, pas en CSS)
const COULEUR_MAP = {
  'Les Républicains': '#1B3A6B', 'LR': '#1B3A6B',
  'UC': '#0057A8', 'Union Centriste': '#0057A8',
  'ESN': '#1C2B3A', 'Droite Souveraine et Nationale': '#1C2B3A',
  'RN': '#0A1833',
  'SER': '#E75480', 'Socialiste, Écologiste et Républicain': '#E75480',
  'CRCE': '#CC0000', 'CRCE-K': '#CC0000',
  'GEST': '#2ECC40', 'Écologiste - Solidarité et Territoires': '#2ECC40',
  'RDPI': '#FFBE00',
  'RDSE': '#6B8E23',
  'LIRT': '#888888', 'Les Indépendants': '#888888',
  'NI': '#888888',
}

// ─── Client Supabase ─────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('  Variables manquantes : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(s) {
  if (!s) return null
  return he.decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || null
}

function parseDate(s) {
  if (!s) return null
  // Format "2024-01-15" ou "2024-01-15 16:50:54.0"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
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

/**
 * Extrait le matricule depuis l'URL de la fiche sénateur.
 * Exemple : "//www.senat.fr/senfic/dupont_jean12345a.html" → "12345A"
 */
function extractMatricule(ficheUrl) {
  if (!ficheUrl) return null
  const m = ficheUrl.match(/(\d{5}[a-zA-Z])\.html/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * Parser CSV robuste gérant les champs quotés avec virgules/sauts de ligne.
 */
function parseCsv(text) {
  const rows = []
  let i = 0
  let inQuote = false
  let field = ''
  let row = []
  const n = text.length

  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuote && i + 1 < n && text[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      inQuote = !inQuote
      i++
    } else if (ch === ',' && !inQuote) {
      row.push(field)
      field = ''
      i++
    } else if ((ch === '\r' || ch === '\n') && !inQuote) {
      if (ch === '\r' && i + 1 < n && text[i + 1] === '\n') i++
      if (row.length > 0 || field) {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      }
      i++
    } else {
      field += ch
      i++
    }
  }
  if (row.length > 0 || field) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

async function batchUpsert(table, rows, onConflict = 'id') {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).upsert(batch, { onConflict })
    if (error) {
      console.error(`\n  Erreur upsert ${table} (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, error.message)
    } else {
      process.stdout.write(`  ${table} : ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`)
    }
  }
  console.log(`  ${table} : ${rows.length}/${rows.length} — OK`)
}

// ─── Sénateurs ───────────────────────────────────────────────────────────────

async function fetchSenateurs() {
  console.log('  Téléchargement ODSEN_GENERAL.json…')
  const [resGen, resGrp] = await Promise.all([
    fetch(SENATEURS_URL).then(r => r.json()),
    fetch(GROUPES_URL).then(r => r.json()),
  ])

  // Groupes courants : entrées sans date de fin
  const groupeCourant = new Map() // matricule → code groupe
  const groupeLibelle = new Map() // matricule → libellé groupe
  for (const g of resGrp) {
    const fin = g['Date_de_fin_d_appartenance']
    if (!fin) {
      const mat = g['Matricule']?.trim().toUpperCase()
      if (mat) {
        groupeCourant.set(mat, g['Code_du_groupe_politique'] ?? '')
        groupeLibelle.set(mat, g['Nom_court_du_groupe_politique'] ?? '')
      }
    }
  }
  console.log(`  ${groupeCourant.size} memberships de groupe courants`)

  // Sénateurs en exercice
  const senateurs = []
  for (const s of resGen) {
    const etat = (s['Etat'] ?? '').toLowerCase()
    if (!etat.includes('exercice') && !etat.includes('exercise')) continue

    const mat = s['Matricule']?.trim().toUpperCase()
    if (!mat) continue

    const nom    = (s['Nom_usuel'] ?? s['Nom'] ?? '').trim()
    const prenom = (s['Prenom_usuel'] ?? s['Prenom'] ?? '').trim()
    const circo  = (s['Circonscription'] ?? '').trim() || null

    // Groupe depuis HISTOGROUPES ; fallback sur ODSEN_GENERAL
    const grpCode = groupeCourant.get(mat) ?? (s['Groupe_politique'] ?? '').trim()
    const grpLib  = groupeLibelle.get(mat) ?? grpCode

    senateurs.push({
      id: mat,
      nom,
      prenom,
      chambre: 'Senat',
      groupe_sigle: grpCode || null,
      groupe_libelle: grpLib || null,
      orientation: getOrientation(grpCode),
      couleur_groupe: getCouleur(grpCode),
      circonscription: circo,
      photo_url: null, // pas de source photo Sénat simple disponible
    })
  }

  console.log(`  ${senateurs.length} sénateurs en exercice trouvés`)
  return senateurs
}

// ─── Amendements (CSV par texte) ──────────────────────────────────────────────

/**
 * Télécharge et parse le CSV d'amendements pour un texte.
 * Retourne null si le texte n'existe pas (404).
 */
async function fetchTexteAmendements(session, textNum, senateursSet) {
  const url = `https://www.senat.fr/amendements/${session}/${textNum}/jeu_complet_${session}_${textNum}.csv`
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    return null
  }
  if (!res.ok) return null

  const text = await res.text()
  const rows = parseCsv(text)
  if (rows.length < 2) return null

  // En-tête
  // Colonnes : Nature,Numéro,Subdivision,Alinéa,Auteur,Au nom de,Date de dépôt,
  //            Dispositif,Objet,Sort,Date de saisie du sort,Url amendement,Fiche Sénateur
  const header = rows[0].map(h => h.trim())
  const idx = {}
  header.forEach((h, i) => { idx[h] = i })

  const amendements = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length < 3) continue

    const ficheUrl = row[idx['Fiche Sénateur']] ?? ''
    const matricule = extractMatricule(ficheUrl)
    if (!matricule || !senateursSet.has(matricule)) continue

    const numAmdt = (row[idx['Numéro']] ?? '').trim()
    if (!numAmdt) continue

    // ID unique : SENAT_{session}_{textNum}_{numAmdt}
    const id = `SENAT_${session}_${textNum}_${numAmdt}`

    const dispositif = stripHtml(row[idx['Dispositif']] ?? null)
    const objet      = stripHtml(row[idx['Objet']] ?? null)
    const sort       = (row[idx['Sort']] ?? '').trim() || null
    const dateDepot  = parseDate(row[idx['Date de dépôt']] ?? null)
    const subdiv     = (row[idx['Subdivision']] ?? '').trim() || null

    amendements.push({
      id,
      parlementaire_id: matricule,
      objet: dispositif,        // "Dispositif" = le texte opérationnel = objet
      expose_motifs: objet,     // "Objet" = la justification = exposé des motifs
      sort,
      date_depot: dateDepot,
      legislature: null,        // pas de législature numérotée au Sénat
      texte_legis_ref: `senat_${session}_${textNum}`,
      division_titre: subdiv,
    })
  }

  return amendements
}

/**
 * Pour une session, tente les textes 1…MAX_TEXT en parallèle (CONCURRENCY à la fois).
 */
async function ingestSessionAmendements(session, senateursSet) {
  const allAmendements = []
  let textesTrouves = 0

  for (let start = 1; start <= MAX_TEXT; start += CONCURRENCY) {
    const nums = []
    for (let n = start; n < start + CONCURRENCY && n <= MAX_TEXT; n++) nums.push(n)

    const results = await Promise.all(
      nums.map(n => fetchTexteAmendements(session, n, senateursSet))
    )

    for (let i = 0; i < results.length; i++) {
      const amds = results[i]
      if (amds && amds.length > 0) {
        allAmendements.push(...amds)
        textesTrouves++
        process.stdout.write(
          `  Session ${session} : texte ${nums[i]} — ${amds.length} amendements (total : ${allAmendements.length})\r`
        )
      }
    }
  }

  console.log(
    `  Session ${session} : ${textesTrouves} textes trouvés, ${allAmendements.length} amendements`
  )
  return allAmendements
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('  Plébis — Ingestion Sénat\n')

  // ── 1. Sénateurs ──
  console.log('  Chargement des sénateurs…')
  const senateurs = await fetchSenateurs()
  const senateursSet = new Set(senateurs.map(s => s.id))

  console.log('  Insertion des sénateurs…')
  await batchUpsert('parlementaires', senateurs)
  console.log()

  // ── 2. Amendements par session ──
  const allAmendements = []

  for (const session of SESSIONS) {
    console.log(`  Session ${session} — exploration des textes 1…${MAX_TEXT}…`)
    const amds = await ingestSessionAmendements(session, senateursSet)
    allAmendements.push(...amds)
    console.log()
  }

  console.log(`  Total amendements à insérer : ${allAmendements.length}`)
  if (allAmendements.length > 0) {
    console.log('  Insertion des amendements Sénat…')
    await batchUpsert('amendements', allAmendements)
  }

  console.log('\n  Ingestion Sénat terminée.')
  console.log(`  ${senateurs.length} sénateurs | ${allAmendements.length} amendements`)
}

main().catch(err => {
  console.error('  Erreur fatale :', err)
  process.exit(1)
})
