/**
 * Plébis — Script d'ingestion des comptes rendus de séance (AN 17e législature)
 *
 * Source :
 *   https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip
 *   Format : ZIP de fichiers XML individuels (un par séance), mis à jour quotidiennement
 *
 * Structure XML (par fichier) :
 *   compteRendu
 *     uid
 *     metadonnees
 *       dateSeance  (timestamp "20241106140000000" → "2024-11-06")
 *     contenu
 *       point[]
 *         paragraphe[]  (attribut id_acteur="PA…")
 *           texte
 *
 * Usage :
 *   npm run ingest:cr
 *
 * Pré-requis :
 *   .env avec VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createReadStream, unlinkSync, statSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import unzipper from 'unzipper'
import { XMLParser } from 'fast-xml-parser'

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = 500
const TMP = process.platform === 'win32' ? process.env.TEMP || process.env.TMP || 'C:\\Temp' : '/tmp'

const CR_URL =
  'https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip'

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
  isArray: (name) => ['point', 'paragraphe', 'alinea', 'texte'].includes(name),
  allowBooleanAttributes: true,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Convertit le timestamp Syceron "20241106140000000" → "2024-11-06"
function parseSyceronDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (s.length >= 8) {
    const y = s.slice(0, 4)
    const m = s.slice(4, 6)
    const d = s.slice(6, 8)
    const date = new Date(`${y}-${m}-${d}`)
    return isNaN(date.getTime()) ? null : `${y}-${m}-${d}`
  }
  return null
}

// Extrait tout le texte d'un nœud XML récursivement
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

// Construit un Map { valeur_pts_odj → titre } depuis le sommaire des métadonnées
function buildSommaireMap(metadonnees) {
  const map = new Map()
  const s1 = metadonnees?.sommaire?.sommaire1
  if (!s1) return map
  const arr = Array.isArray(s1) ? s1 : [s1]
  for (const item of arr) {
    const key = String(item['@_valeur_pts_odj'] ?? '')
    if (!key) continue
    const titre = extractText(item.titreStruct?.intitule).trim().slice(0, 200)
    if (titre) map.set(key, titre)
  }
  return map
}

// Aplatit les points en liste de { paragraphe, pointTitre }
// Le titre vient du sommaire via l'attribut @_valeur_ptsodj du point
function collectParagraphes(points, sommaireMap, inheritedTitre = null) {
  const result = []
  if (!points) return result
  const arr = Array.isArray(points) ? points : [points]
  for (const point of arr) {
    if (!point || typeof point !== 'object') continue
    const ptsOdj = String(point['@_valeur_ptsodj'] ?? '')
    const pointTitre = (ptsOdj && sommaireMap.get(ptsOdj)) || inheritedTitre || null
    // Paragraphes directs
    if (point.paragraphe) {
      const paras = Array.isArray(point.paragraphe) ? point.paragraphe : [point.paragraphe]
      result.push(...paras.map(p => ({ paragraphe: p, pointTitre })))
    }
    // Sous-points récursifs
    if (point.point) result.push(...collectParagraphes(point.point, sommaireMap, pointTitre))
    if (point.sousPoint) result.push(...collectParagraphes(point.sousPoint, sommaireMap, pointTitre))
  }
  return result
}

// ─── Téléchargement ──────────────────────────────────────────────────────────

const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'

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

// Itère sur les entrées XML d'un ZIP — une entrée en mémoire à la fois
async function* zipXmlEntries(tmpPath) {
  const stream = createReadStream(tmpPath).pipe(unzipper.Parse({ forceStream: true }))
  for await (const entry of stream) {
    if (entry.path.endsWith('.xml')) {
      const buf = await entry.buffer()
      yield { path: entry.path, xml: buf.toString('utf8') }
    } else {
      entry.autodrain()
    }
  }
}

// ─── Chargement parlementaires ────────────────────────────────────────────────

async function loadParlementaireIds() {
  const ids = new Set()
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('parlementaires')
      .select('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data.length) break
    data.forEach(r => ids.add(r.id))
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(` ${ids.size} parlementaires chargés depuis la base`)
  return ids
}

// ─── Extraction interventions depuis un XML ───────────────────────────────────

function extractInterventions(xmlContent, parlementaireIds, dateSeance, seanceUid) {
  const root = parser.parse(xmlContent)

  // Naviguer vers le nœud racine compteRendu
  const cr = root.compteRendu || root.CompteRendu || Object.values(root)[0]
  if (!cr) return []

  // Métadonnées : date + sommaire
  const meta = cr.metadonnees || cr.Metadonnees
  if (!dateSeance) {
    const rawDate = meta?.dateSeance || meta?.DateSeance
    dateSeance = parseSyceronDate(rawDate)
  }
  const sommaireMap = buildSommaireMap(meta)

  // Récupérer tous les paragraphes depuis contenu/point
  const contenu = cr.contenu || cr.Contenu
  if (!contenu) return []

  const points = contenu.point || contenu.Point
  const items = collectParagraphes(points, sommaireMap)

  const interventions = []
  let idx = 0

  for (const { paragraphe: para, pointTitre } of items) {
    if (!para || typeof para !== 'object') continue

    // L'id_acteur est un attribut XML → @_id_acteur
    const idActeur = para['@_id_acteur'] || para['@_id_orateur'] || para['@_acteurRef']
    if (!idActeur || !idActeur.startsWith('PA') || !parlementaireIds.has(idActeur)) continue

    const texte = extractText(para.texte || para.alinea || para).substring(0, 10000)
    if (!texte || texte.length < 10) continue

    interventions.push({
      id: `${seanceUid}__${idActeur}__${idx++}`,
      parlementaire_id: idActeur,
      date_seance: dateSeance,
      texte,
      point_titre: pointTitre || null,
    })
  }

  return interventions
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Ingestion des comptes rendus de séance (AN 17e législature)\n')

  let zipPath
  try {
    // 1. Téléchargement — toujours re-télécharger en CI pour avoir les données fraîches
    zipPath = downloadZip(CR_URL, 'syseron.xml.zip')

    if (!existsSync(zipPath)) {
      throw new Error(`Fichier introuvable après téléchargement : ${zipPath}`)
    }
    console.log(` ZIP prêt : ${zipPath}`)

    // 2. Chargement des parlementaires existants
    const parlementaireIds = await loadParlementaireIds()

    // 3. Nettoyage de la table
    console.log('  Suppression des interventions existantes…')
    const { error: delErr } = await supabase
      .from('interventions')
      .delete()
      .gte('date_seance', '2000-01-01')
    if (delErr) console.warn('  Avertissement DELETE:', delErr.message)

    // 4. Itération sur les fichiers XML du ZIP
    console.log(' Extraction des interventions…')
    let totalSeances = 0
    let totalInterventions = 0
    let buffer = []

    for await (const { path, xml } of zipXmlEntries(zipPath)) {
      // Extraire l'UID et la date depuis le nom de fichier (CRSANR5L17S2024O1N001.xml)
      const filename = path.split('/').pop().replace('.xml', '')
      // Extraire l'année depuis le nom : S2024 → 2024
      const yearMatch = filename.match(/S(\d{4})/)
      const year = yearMatch ? yearMatch[1] : null

      const interventions = extractInterventions(xml, parlementaireIds, null, filename)
      totalSeances++
      totalInterventions += interventions.length
      buffer.push(...interventions)

      process.stdout.write(`\r  Séances : ${totalSeances} | Interventions : ${totalInterventions}`)

      // Upsert par batch pour éviter d'accumuler trop en mémoire
      if (buffer.length >= 2000) {
        process.stdout.write('\n')
        await batchUpsert('interventions', buffer)
        buffer = []
      }
    }

    // Upsert du reste
    if (buffer.length > 0) {
      process.stdout.write('\n')
      await batchUpsert('interventions', buffer)
    }

    console.log(`\n Ingestion terminée : ${totalSeances} séances, ${totalInterventions} interventions`)

  } finally {
    if (existsSync(zipPath)) unlinkSync(zipPath)
  }
}

main().catch(err => {
  console.error(' Erreur fatale:', err)
  process.exit(1)
})
