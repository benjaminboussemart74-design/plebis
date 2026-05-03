/**
 * Plébis — Enrichissement des questions écrites Sénat avec le texte intégral
 *
 * Récupère le texte de chaque question depuis senat.fr et met à jour
 * le champ `texte_question` en base.
 *
 * URL source : https://www.senat.fr/questions/base/{year}/q{SEQ…}.html
 * Structure HTML : <section id="question"> … <p>texte…</p> …
 *
 * Usage :
 *   node scripts/enrich-senat-questions.js
 *
 * Variables d'environnement :
 *   VITE_SUPABASE_URL         (depuis .env)
 *   SUPABASE_SERVICE_ROLE_KEY (depuis .env)
 *   CONCURRENCY               nombre de fetches simultanés (défaut: 8)
 *
 * Durée estimée : ~20 min pour 5 000 questions (8 req/s, rate-limitée)
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '8', 10)
const DELAY_MS = 120  // délai entre requêtes pour ne pas surcharger senat.fr

// ─── Construction de l'URL senat.fr ──────────────────────────────────────────
// ID en base : SEN_Q04208 → numéro "04208"
// date_depot : "2025-04-17" → year=2025, yy="25", mm="04"
// Référence : SEQ{yy}{mm}{num} → SEQ250404208
// URL : https://www.senat.fr/questions/base/2025/qSEQ250404208.html

function buildSenatUrl(id, dateDepot) {
  const num = id?.match(/^SEN_Q(\d+)$/)?.[1]
  if (!num || !dateDepot) return null
  const d = new Date(dateDepot)
  const year = d.getFullYear()
  const yy = String(year).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `https://www.senat.fr/questions/base/${year}/qSEQ${yy}${mm}${num}.html`
}

// ─── Parsing du texte depuis le HTML ─────────────────────────────────────────
// Structure : <section id="question"><h2>…</h2><p>texte…</p>

const HTML_ENTITIES = {
  '&eacute;':'é','&egrave;':'è','&agrave;':'à','&ecirc;':'ê','&ocirc;':'ô',
  '&ucirc;':'û','&acirc;':'â','&iuml;':'ï','&euml;':'ë','&ccedil;':'ç',
  '&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"',
  '&#039;':"'",'&laquo;':'«','&raquo;':'»','&hellip;':'…',
}

function decodeEntities(s) {
  return s.replace(/&[a-z#0-9]+;/gi, e => HTML_ENTITIES[e] ?? e)
}

function extractQuestionText(html) {
  const sectionIdx = html.indexOf('id="question"')
  if (sectionIdx === -1) return null

  const afterSection = html.substring(sectionIdx)

  // Sauter le <h2>
  const h2End = afterSection.indexOf('</h2>')
  if (h2End === -1) return null
  const afterH2 = afterSection.substring(h2End + 5)

  // Extraire le premier <p>…</p>
  const pStart = afterH2.indexOf('<p>')
  const pEnd = afterH2.indexOf('</p>')
  if (pStart === -1 || pEnd === -1 || pEnd <= pStart) return null

  const raw = afterH2.substring(pStart + 3, pEnd)
  const text = decodeEntities(
    raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
  ).trim()

  return text.length > 20 ? text : null
}

// ─── Fetch avec retry ─────────────────────────────────────────────────────────
async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Plebis/1.0 (data.gouv.fr open-data enrichment)' },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status === 404) return { status: 404, text: null }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      return { status: res.status, text }
    } catch (e) {
      if (attempt === retries) return { status: 0, text: null, error: e.message }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

// ─── Traitement en parallèle limité ──────────────────────────────────────────
async function runConcurrent(items, fn, concurrency) {
  const results = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Enrichissement questions écrites Sénat — texte intégral\n')

  // 1. Charger toutes les questions sénat sans texte (pagination 1000 par page)
  console.log('  Chargement des questions sans texte…')
  const questions = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('questions_ecrites')
      .select('id, date_depot')
      .like('id', 'SEN_Q%')
      .is('texte_question', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error('Erreur chargement questions : ' + error.message)
    if (!data?.length) break
    questions.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`  ${questions.length} questions à enrichir\n`)

  if (questions.length === 0) {
    console.log('  Rien à faire.')
    return
  }

  let ok = 0, notFound = 0, failed = 0, empty = 0
  const BATCH_SIZE = 50

  // 2. Fetch + parse en parallèle
  await runConcurrent(questions, async (q, idx) => {
    const url = buildSenatUrl(q.id, q.date_depot)
    if (!url) { failed++; return }

    const { status, text, error: fetchErr } = await fetchWithRetry(url)

    if (status === 404 || !text) {
      if (status === 404) notFound++
      else failed++
      return
    }

    const texte = extractQuestionText(text)
    if (!texte) { empty++; return }

    // Upsert immédiat (1 par 1, mais on est concurrents donc ~CONCURRENCY en parallèle)
    const { error: upsertErr } = await supabase
      .from('questions_ecrites')
      .update({ texte_question: texte })
      .eq('id', q.id)

    if (upsertErr) { failed++; return }
    ok++

    if ((ok + notFound + failed + empty) % 100 === 0 || idx === questions.length - 1) {
      process.stdout.write(`\r  ${ok} enrichies | ${notFound} introuvables | ${empty} texte vide | ${failed} erreurs — ${idx + 1}/${questions.length}`)
    }
  }, CONCURRENCY)

  console.log(`\n\n  Terminé : ${ok} questions enrichies, ${notFound} introuvables (404), ${empty} texte vide, ${failed} erreurs`)
}

main().catch(e => { console.error(e); process.exit(1) })
