/**
 * Plébis — Script d'ingestion Sénat (17e législature)
 *
 * Sources :
 *   Phase 1 — Sénateurs actifs
 *     URL  : https://www.senat.fr/api-senat/senateurs.json
 *     Format : JSON, tableau d'objets
 *     Clés confirmées : matricule, nom, prenom, groupe.libelle, groupe.sigle, circonscription
 *     Note : groupe.libelle est préfixé "Groupe " → normalisé avant lookup
 *
 *   Phase 2 — Questions écrites (depuis un an)
 *     URL  : https://data.senat.fr/data/questions/questions-depuis-un-an.csv
 *     Format : CSV encodage ISO-8859-1, délimiteur |
 *     Colonnes confirmées : Sort, Nature, Numéro, Référence, Titre, Nom, Prénom, Civilité,
 *       Circonscription, Groupe, Type Appartenance, Date de publication JO,
 *       Ministère de dépôt, Date de transmission, Ministère de transmission,
 *       Ministère de réponse, Date de réponse JO, Référence de la question rappelée,
 *       Thème(s), Thème QC, URL Question
 *     Pas de colonne matricule → matching par Nom+Prénom sur les sénateurs ingérés
 *     Filtre : Date de publication JO >= 2024-07-01
 *
 *   Phase 3 — Comptes rendus de séance (verbatim intégraux)
 *     URL  : https://data.senat.fr/data/debats/cri.zip
 *     Format : ZIP de fichiers XML individuels (un par séance), ~511 Mo
 *     Structure à inspecter : logguer le nom et les 500 premiers caractères du premier XML.
 *     Nécessite INGEST_TMP pointant vers un disque avec > 600 Mo libres (ex: D:\Temp sur Windows).
 *
 * Usage :
 *   npm run ingest:senat
 *   INGEST_TMP=D:\Temp npm run ingest:senat   ← si disque système plein
 *
 * Pré-requis :
 *   .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createReadStream, existsSync, statSync, unlinkSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import unzipper from 'unzipper'
import { XMLParser } from 'fast-xml-parser'

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = 500

// INGEST_TMP permet de pointer vers un autre disque quand le disque système est plein
const TMP = process.env.INGEST_TMP
  || (process.platform === 'win32' ? process.env.TEMP || process.env.TMP || 'C:\\Temp' : '/tmp')

const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'

const SENATEURS_URL = 'https://www.senat.fr/api-senat/senateurs.json'
const QUESTIONS_URL = 'https://data.senat.fr/data/questions/questions-depuis-un-an.csv'
const CRI_URL       = 'https://data.senat.fr/data/debats/cri.zip'

// Date de début de la 17e législature Sénat
const LEGISLATURE_START = '2024-07-01'

// ─── Mapping groupes politiques sénatoriaux (17e législature, 2024) ──────────
// Les libellés bruts de l'API ont un préfixe "Groupe " → normaliseGroupeLibelle() le retire.

const ORIENTATION_MAP_SENAT = {
  'Les Républicains':                                                'droite',
  'Rassemblement des démocrates, progressistes et indépendants':    'centre',
  'Rassemblement Démocratique et Social Européen':                  'centre',
  'Socialiste, Écologiste et Républicain':                          'gauche',
  'Union Centriste':                                                 'centre',
  'Les Indépendants - République et Territoires':                   'centre',
  'Communiste Républicain Citoyen et Écologiste - Kanaky':          'gauche',
  'Écologiste - Solidarité et Territoires':                         'gauche',
  'Rassemblement National':                                          'droite',
  'Non-inscrit':                                                     null,
}

const COULEUR_MAP_SENAT = {
  'Les Républicains':                                                '#1B3A6B',
  'Rassemblement des démocrates, progressistes et indépendants':    '#FFBE00',
  'Rassemblement Démocratique et Social Européen':                  '#E07020',
  'Socialiste, Écologiste et Républicain':                          '#E75480',
  'Union Centriste':                                                 '#FF8C42',
  'Les Indépendants - République et Territoires':                   '#888888',
  'Communiste Républicain Citoyen et Écologiste - Kanaky':          '#CC0000',
  'Écologiste - Solidarité et Territoires':                         '#2ECC40',
  'Rassemblement National':                                          '#0A1833',
  'Non-inscrit':                                                     '#888888',
}

// ─── Client Supabase ─────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(' Variables manquantes : VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ─── Parser XML ──────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['seance', 'intervention', 'paragraphe', 'point'].includes(name),
  allowBooleanAttributes: true,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function senId(matricule) {
  return `SEN_${matricule}`
}

function parseDate(dateStr) {
  if (!dateStr) return null
  // Formats attendus : "DD/MM/YYYY" (CSV Sénat) ou "YYYY-MM-DD"
  const fr = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

// Normalise le libellé de groupe retourné par l'API :
//   "Groupe Les Républicains"                           → "Les Républicains"
//   "Groupe du Rassemblement Démocratique…"             → "Rassemblement Démocratique…"
//   "Réunion administrative des Sénateurs ne figurant…" → "Non-inscrit"
function normaliseGroupeLibelle(raw) {
  if (!raw) return null
  const s = raw.trim()
  if (/^Réunion administrative/i.test(s)) return 'Non-inscrit'
  return s.replace(/^Groupe\s+(?:du\s+|des\s+|de\s+|d')?/i, '').trim()
}

function getOrientation(libelle) {
  if (!libelle) return null
  if (libelle in ORIENTATION_MAP_SENAT) return ORIENTATION_MAP_SENAT[libelle]
  // Partial fallback
  for (const [key, val] of Object.entries(ORIENTATION_MAP_SENAT)) {
    if (libelle.includes(key) || key.includes(libelle)) return val
  }
  return null
}

function getCouleur(libelle) {
  if (!libelle) return '#888888'
  if (libelle in COULEUR_MAP_SENAT) return COULEUR_MAP_SENAT[libelle]
  for (const [key, val] of Object.entries(COULEUR_MAP_SENAT)) {
    if (libelle.includes(key) || key.includes(libelle)) return val
  }
  return '#888888'
}

function extractText(node) {
  if (!node) return ''
  if (typeof node === 'string') return node.trim()
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).filter(Boolean).join(' ')
  if (typeof node === 'object') {
    const parts = []
    if (node['#text']) parts.push(String(node['#text']).trim())
    for (const [key, val] of Object.entries(node)) {
      if (key.startsWith('@_') || key === '#text') continue
      parts.push(extractText(val))
    }
    return parts.filter(Boolean).join(' ')
  }
  return ''
}

// ─── Téléchargement ──────────────────────────────────────────────────────────

function downloadFile(url, tmpName, { skipIfExists = false } = {}) {
  const tmpPath = join(TMP, tmpName)
  if (skipIfExists && existsSync(tmpPath)) {
    const size = statSync(tmpPath).size
    console.log(`  Fichier existant réutilisé : ${tmpPath} (${(size / 1024 / 1024).toFixed(1)} Mo)`)
    return tmpPath
  }
  if (existsSync(tmpPath)) unlinkSync(tmpPath)
  console.log(`  Téléchargement : ${url.split('/').pop()} → ${tmpPath}`)
  try {
    execFileSync(CURL, [
      '-L', '--fail',
      '-A', 'Mozilla/5.0',
      '--retry', '5',
      '--retry-delay', '3',
      '--retry-connrefused',
      '--max-time', '600',
      '--write-out', '\n  HTTP %{http_code} — %{size_download} octets',
      '-o', tmpPath,
      url,
    ], { stdio: 'inherit' })
  } catch (err) {
    throw new Error(
      `Téléchargement échoué pour ${url.split('/').pop()}.\n` +
      `  Si le disque est plein, définir INGEST_TMP vers un autre disque :\n` +
      `    INGEST_TMP=D:\\Temp npm run ingest:senat\n` +
      `  Erreur curl : ${err.message}`
    )
  }
  const size = statSync(tmpPath).size
  console.log(`  ${(size / 1024 / 1024).toFixed(1)} Mo téléchargés`)
  if (size < 512) {
    throw new Error(`Fichier trop petit (${size} octets) — le serveur a renvoyé une erreur. URL : ${url}`)
  }
  return tmpPath
}

// ─── Batch upsert ────────────────────────────────────────────────────────────

async function batchUpsert(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' })
    if (error) {
      console.error(`   Erreur batch ${i}–${i + batch.length}:`, error.message)
    } else {
      process.stdout.write(`\r   ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`)
    }
  }
  if (rows.length > 0) console.log()
}

// ─── Phase 1 — Sénateurs ─────────────────────────────────────────────────────

async function ingestSenateurs() {
  console.log('\n  Phase 1 — Sénateurs actifs')

  console.log(`  Fetch : ${SENATEURS_URL}`)
  const res = await fetch(SENATEURS_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status} en fetching ${SENATEURS_URL}`)
  const data = await res.json()

  const list = Array.isArray(data) ? data : (data.senateurs || data.data || Object.values(data)[0])
  if (!Array.isArray(list)) throw new Error("Format inattendu de l'API sénateurs")

  console.log(`  ${list.length} sénateurs reçus`)
  if (list.length > 0) {
    console.log('  Clés :', Object.keys(list[0]).join(', '))
    if (list[0].groupe) console.log('  groupe :', JSON.stringify(list[0].groupe))
    console.log('  circonscription :', list[0].circonscription)
  }

  const unknownGroupes = new Set()
  const rows = []
  // nameMap : "NOM|PRENOM" → parlementaire_id (pour matching CSV Phase 2)
  const nameMap = new Map()

  for (const sen of list) {
    const matricule = sen.matricule || sen.id || sen.Matricule
    if (!matricule) continue

    const nom    = sen.nom    || sen.Nom    || ''
    const prenom = sen.prenom || sen.Prenom || ''

    const groupe       = typeof sen.groupe === 'object' ? sen.groupe : {}
    // L'API retourne groupe.code (sigle) et groupe.libelle (nom complet avec préfixe "Groupe ")
    const sigleRaw0    = groupe.code    || groupe.sigle   || sen.groupe_sigle   || ''
    // L'API Sénat retourne 'UMP' pour Les Républicains — normaliser en 'LR'
    const SIGLE_NORM   = { 'UMP': 'LR' }
    const sigleRaw     = SIGLE_NORM[sigleRaw0] ?? sigleRaw0
    const libelleRaw   = groupe.libelle || sen.groupe_libelle || sen.libelle || ''
    const libelle      = normaliseGroupeLibelle(libelleRaw)

    if (libelle && !(libelle in ORIENTATION_MAP_SENAT)) {
      unknownGroupes.add(`"${libelle}" (brut: "${libelleRaw}")`)
    }

    // circonscription est un objet {code, libelle} ou une chaîne directe
    const circ = sen.circonscription
    const departement = circ
      ? (typeof circ === 'object' ? (circ.libelle || circ.nom || '') : String(circ))
      : (sen.departement || '')

    const row = {
      id:              senId(matricule),
      nom,
      prenom,
      chambre:         'Senat',
      groupe_sigle:    sigleRaw,
      groupe_libelle:  libelle || libelleRaw,
      orientation:     getOrientation(libelle),
      couleur_groupe:  getCouleur(libelle),
      circonscription: departement,
      photo_url:       `https://www.senat.fr/img/photos/${matricule}.jpg`,
    }
    rows.push(row)

    // Index nom+prénom (majuscules, sans accents pour robustesse)
    const key = `${nom.toUpperCase()}|${prenom.toUpperCase()}`
    nameMap.set(key, row.id)
  }

  if (unknownGroupes.size > 0) {
    console.log('  Groupes non reconnus (fallback null/#888888) :')
    for (const g of unknownGroupes) console.log(`    ${g}`)
  }

  console.log(`  Upsert de ${rows.length} sénateurs…`)
  await batchUpsert('parlementaires', rows)
  console.log(`  Phase 1 — ${rows.length} sénateurs insérés`)

  const senateurIds = new Set(rows.map(r => r.id))
  // Index mat (insensible à la casse) → parlementaire_id pour Phase 3
  const matIndex = new Map(rows.map(r => [r.id.replace('SEN_', '').toUpperCase(), r.id]))

  return { senateurIds, nameMap, matIndex }
}

// ─── Phase 2 — Questions écrites ─────────────────────────────────────────────

async function ingestQuestionsEcrites(senateurIds, nameMap) {
  console.log('\n  Phase 2 — Questions écrites Sénat (depuis un an)')

  const csvPath = downloadFile(QUESTIONS_URL, 'senat_questions.csv')

  // Le CSV est encodé ISO-8859-1 — lire en binaire et décoder
  const rawBuf = readFileSync(csvPath)
  const content = new TextDecoder('iso-8859-1').decode(rawBuf)
  const lines = content.split(/\r?\n/)

  if (lines.length === 0) throw new Error('CSV vide')

  // Détecter le délimiteur
  const firstLine = lines[0]
  const delim = (firstLine.match(/\|/g) || []).length >= (firstLine.match(/;/g) || []).length
    ? '|' : ';'

  const headers = parseCsvLine(firstLine, delim)
  console.log('  Colonnes CSV :', headers.join(' | '))
  console.log('  Délimiteur :', JSON.stringify(delim))

  // Indices des colonnes utiles (par nom exact après décodage)
  const idx = {}
  headers.forEach((h, i) => { idx[h.trim()] = i })

  // Afficher les colonnes de date disponibles pour débogage
  const dateCols = headers.filter(h => /date|Date/i.test(h))
  console.log('  Colonnes de date :', dateCols.join(' | '))

  const rows = []
  let skippedDate = 0
  let skippedParl = 0
  let lineCount = 0

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]
    if (!line.trim()) continue
    lineCount++

    const cols = parseCsvLine(line, delim)
    const get = (name) => (cols[idx[name]] || '').trim()

    // Filtrer uniquement les questions écrites (QE) — exclure QG, QOSD, etc.
    if (get('Nature') !== 'QE') continue

    // Date : "Date de publication JO" (format JJ/MM/AAAA attendu)
    const dateRaw = get('Date de publication JO') || get('Date de transmission') || ''
    const dateDepot = parseDate(dateRaw)
    if (!dateDepot || dateDepot < LEGISLATURE_START) {
      skippedDate++
      continue
    }

    // Matching sénateur par Nom + Prénom
    const nom    = get('Nom').toUpperCase()
    const prenom = get('Prénom').toUpperCase()
    const parlId = nameMap.get(`${nom}|${prenom}`)
    if (!parlId || !senateurIds.has(parlId)) {
      skippedParl++
      continue
    }

    // ID unique : "SEN_" + numéro de question
    const numero = get('Numéro') || get('Référence') || String(li)
    const id = `SEN_Q${numero}`

    rows.push({
      id,
      parlementaire_id: parlId,
      rubrique:         get('Thème(s)') || get('Thème QC') || null,
      tete_analyse:     get('Titre') || null,
      // texte_question : non inclus → l'upsert ne doit pas écraser le texte enrichi
      ministere:        get('Ministère de dépôt') || get('Ministère de transmission') || null,
      date_depot:       dateDepot,
      legislature:      17,
    })

    if (rows.length % 500 === 0) {
      process.stdout.write(`\r  ${rows.length} questions filtrées…`)
    }
  }

  console.log(`\n  ${lineCount} lignes lues, ${skippedDate} hors période, ${skippedParl} auteur inconnu`)
  console.log(`  Upsert de ${rows.length} questions…`)
  if (rows.length > 0) await batchUpsert('questions_ecrites', rows)
  console.log(`  Phase 2 — ${rows.length} questions insérées`)
}

// Parser CSV minimal gérant les champs entre guillemets
function parseCsvLine(line, delim = '|') {
  const result = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      result.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  result.push(field)
  return result
}

// ─── Phase 3 — Comptes rendus de séance ──────────────────────────────────────
//
// Structure XML confirmée (inspection du 2026-04-11) :
//   Fichier : cri/d{YYYYMMDD}.xml  (la date est dans le nom de fichier)
//   Encoding : ISO-8859-1, contenu en entités HTML (&amp; &#233; etc.)
//   Balise : <cri:intervenant mat="{matricule}" nom="..." analyse="..." ...>
//     [contenu HTML de l'intervention]
//   </cri:intervenant>
//   Attribut sénateur : mat (ex: "04086Q", "86034E")
//
// Approche : regex sur le contenu brut (plus fiable que fast-xml-parser sur ce HTML/XML mixte).

// Regex pour extraire les blocs <cri:intervenant> avec leur attribut mat
const INTERV_RE   = /<cri:intervenant\b([^>]*)>([\s\S]*?)<\/cri:intervenant>/g
const MAT_RE      = /\bmat="([^"]+)"/
const TITRE_S1_RE = /<cri:titreS1\b([^>]*)>/g
const TITRE_S2_RE = /<cri:titreS2\b([^>]*)>/g
const LIBELLE_RE  = /\blibelle="([^"]*)"/

// Construit une carte position → titre de section à partir des <cri:titreS1/S2>
// Retourne [{pos, titre}] trié par position
function buildTitreMap(content) {
  const entries = []
  let m
  // S1 : titre principal (ex: "Gouvernance de la sécurité sociale")
  TITRE_S1_RE.lastIndex = 0
  while ((m = TITRE_S1_RE.exec(content)) !== null) {
    const lib = LIBELLE_RE.exec(m[1])
    if (lib) {
      const titre = stripHtml(lib[1]).trim()
      if (titre && titre.length > 3) entries.push({ pos: m.index, level: 1, titre })
    }
  }
  // S2 : sous-titre (ex: "Discussion en procédure accélérée…")
  TITRE_S2_RE.lastIndex = 0
  while ((m = TITRE_S2_RE.exec(content)) !== null) {
    const lib = LIBELLE_RE.exec(m[1])
    if (lib) {
      const titre = stripHtml(lib[1]).trim()
      if (titre && titre.length > 3) entries.push({ pos: m.index, level: 2, titre })
    }
  }
  return entries.sort((a, b) => a.pos - b.pos)
}

// Retourne le titre de section le plus proche avant `pos`
// Si un S2 suit un S1 (même section), les combine.
function getTitreAt(map, pos) {
  let s1 = null, s2 = null
  for (const e of map) {
    if (e.pos > pos) break
    if (e.level === 1) { s1 = e.titre; s2 = null }
    else if (e.level === 2) { s2 = e.titre }
  }
  if (!s1) return null
  return s2 ? `${s1} — ${s2}` : s1
}

// Extrait la date d'une séance depuis le nom de fichier : "cri/d20241001.xml" → "2024-10-01"
function dateFromFilename(path) {
  const m = path.match(/d(\d{4})(\d{2})(\d{2})\.xml$/i)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Filtre les fichiers à partir de la 17e législature Sénat (2024-07-01)
function isLegislature17(path) {
  const d = dateFromFilename(path)
  return d && d >= LEGISLATURE_START
}

// Dépouille le HTML et décode les entités numérisées
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function ingestComptesRendus(senateurIds, matIndex) {
  console.log('\n  Phase 3 — Comptes rendus de séance Sénat (cri.zip)')
  console.log(`  Répertoire temp : ${TMP}`)
  console.log('  (Pour changer : INGEST_TMP=D:\\Temp npm run ingest:senat)')

  let zipPath
  try {
    zipPath = downloadFile(CRI_URL, 'senat_cri.zip', { skipIfExists: true })
  } catch (err) {
    console.log('\n  Phase 3 — Ignorée :', err.message)
    return
  }

  const stream = createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }))
  const interventions = []
  let fileCount = 0
  let skippedFiles = 0

  for await (const entry of stream) {
    if (!entry.path.endsWith('.xml')) { entry.autodrain(); continue }

    // Ne traiter que les séances de la 17e législature (>= 2024-07-01)
    if (!isLegislature17(entry.path)) {
      entry.autodrain()
      skippedFiles++
      continue
    }

    const dateSeance = dateFromFilename(entry.path)
    // Identifiant de séance pour regroupement (sans extension, sans dossier)
    const seanceUid = 'SEN_' + entry.path.replace(/^cri\//, '').replace(/\.xml$/i, '')

    const buf = await entry.buffer()
    // Le fichier est ISO-8859-1 mais le contenu textuel utilise des entités HTML (&amp; &#233;...)
    // → lire en latin1 pour préserver les entités, puis elles seront décodées par stripHtml
    const content = buf.toString('latin1')
    fileCount++

    const titreMap = buildTitreMap(content)
    let idx = 0
    let match
    INTERV_RE.lastIndex = 0
    while ((match = INTERV_RE.exec(content)) !== null) {
      const attrs  = match[1]
      const inner  = match[2]
      const matM   = MAT_RE.exec(attrs)
      if (!matM) continue

      const matRaw = matM[1]
      const parlId = matIndex.get(matRaw.toUpperCase())
      if (!parlId) continue

      const texte = stripHtml(inner).substring(0, 10000)
      if (!texte || texte.length < 10) continue

      interventions.push({
        id:               `${seanceUid}__${parlId.replace('SEN_', '')}___${idx++}`,
        parlementaire_id: parlId,
        date_seance:      dateSeance,
        texte,
        point_titre:      getTitreAt(titreMap, match.index),
      })
    }

    if (fileCount % 20 === 0) {
      process.stdout.write(`\r  ${fileCount} séances, ${interventions.length} interventions…`)
    }

    // Flush par lots pour éviter d'exploser la mémoire
    if (interventions.length >= 5000) {
      process.stdout.write(`\r  Flush ${interventions.length} interventions…          `)
      await batchUpsert('interventions', interventions.splice(0))
    }
  }

  if (interventions.length > 0) {
    process.stdout.write(`\r  Flush final ${interventions.length} interventions…\n`)
    await batchUpsert('interventions', interventions)
  }

  console.log(`\n  ${fileCount} séances traitées (${skippedFiles} antérieures à ${LEGISLATURE_START} ignorées)`)
  console.log(`  Phase 3 — terminée`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Ingestion Sénat — sénateurs + questions + comptes rendus\n')
  console.log(`  Répertoire temp : ${TMP}`)

  const { senateurIds, nameMap, matIndex } = await ingestSenateurs()
  await ingestQuestionsEcrites(senateurIds, nameMap)
  await ingestComptesRendus(senateurIds, matIndex)

  console.log('\n  Ingestion Sénat terminée.\n')
}

main().catch(err => {
  console.error('\n  ERREUR FATALE :', err.message)
  process.exit(1)
})
