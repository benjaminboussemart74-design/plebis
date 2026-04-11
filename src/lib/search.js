import { supabase } from './supabase.js'
import { expandQuery } from './anthropic.js'

function buildTsQuery(keywords) {
  return keywords
    .map(k => k.split(/\s+/).map(w => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, '')).filter(Boolean).join(' & '))
    .filter(Boolean)
    .join(' | ')
}

export async function fetchAllParlementaires() {
  const { data, error } = await supabase
    .from('parlementaires')
    .select('id, nom, prenom, groupe_sigle, couleur_groupe')
  if (error) throw new Error('Erreur chargement parlementaires')
  return data ?? []
}

/**
 * Top députés par nombre d'amendements déposés.
 */
export async function fetchTopAmendeurs(limit = 3) {
  const { data, error } = await supabase.rpc('get_top_amendeurs', { lim: limit })
  if (error) throw new Error('Erreur chargement top amendeurs')
  return data ?? []
}

/**
 * Top députés par nombre de questions écrites déposées.
 */
export async function fetchTopQuestionneurs(limit = 3) {
  const { data, error } = await supabase.rpc('get_top_questionneurs', { lim: limit })
  if (error) throw new Error('Erreur chargement top questionneurs')
  return data ?? []
}

/**
 * Top députés par taux d'adoption de leurs amendements (min 10 amendements).
 */
export async function fetchTopEfficaces(limit = 3) {
  const { data, error } = await supabase.rpc('get_top_efficaces', { lim: limit })
  if (error) throw new Error('Erreur chargement top efficaces')
  return data ?? []
}

/**
 * Charge les interventions en séance d'un parlementaire matchant les keywords courants.
 */
export async function fetchInterventions(parlementaireId, keywords) {
  const tsQuery = buildTsQuery(keywords)

  let query = supabase
    .from('interventions')
    .select('id, parlementaire_id, date_seance, texte, point_titre')
    .order('date_seance', { ascending: false })
    .limit(500)

  if (parlementaireId) {
    query = query.eq('parlementaire_id', parlementaireId)
  }

  if (tsQuery) {
    query = query.textSearch('texte_recherche', tsQuery, { config: 'french' })
  }

  const { data, error } = await query
  if (error) throw new Error('Erreur chargement interventions')
  return data ?? []
}

/**
 * Charge les questions écrites d'un parlementaire matchant les keywords courants.
 */
export async function fetchQuestionsEcrites(parlementaireId, keywords) {
  const tsQuery = buildTsQuery(keywords)

  let query = supabase
    .from('questions_ecrites')
    .select('id, parlementaire_id, rubrique, tete_analyse, texte_question, ministere, date_depot')
    .order('date_depot', { ascending: false })
    .limit(500)

  if (parlementaireId) {
    query = query.eq('parlementaire_id', parlementaireId)
  }

  if (tsQuery) {
    query = query.textSearch('texte_recherche', tsQuery, { config: 'french' })
  }

  const { data, error } = await query
  if (error) throw new Error('Erreur chargement questions écrites')
  return data ?? []
}

/**
 * Charge les dossiers législatifs d'un parlementaire matchant les keywords courants.
 */
export async function fetchDossiers(parlementaireId, keywords) {
  const tsQuery = buildTsQuery(keywords)

  let query = supabase
    .from('dossiers_legislatifs')
    .select('id, dossier_uid, parlementaire_id, titre, titre_chemin, procedure_libelle, date_depot')
    .order('id', { ascending: true })
    .limit(200)

  if (parlementaireId) {
    query = query.eq('parlementaire_id', parlementaireId)
  }

  if (tsQuery) {
    query = query.textSearch('texte_recherche', tsQuery, { config: 'french' })
  }

  const { data, error } = await query
  if (error) throw new Error('Erreur chargement dossiers législatifs')
  return data ?? []
}

/**
 * Charge les amendements d'un parlementaire matchant les keywords courants.
 */
export async function fetchAmendements(parlementaireId, keywords) {
  const tsQuery = buildTsQuery(keywords)

  let query = supabase
    .from('amendements')
    .select('id, parlementaire_id, objet, expose_motifs, sort, date_depot, texte_legis_ref, division_titre')
    .order('date_depot', { ascending: false })
    .limit(500)

  if (parlementaireId) {
    query = query.eq('parlementaire_id', parlementaireId)
  }

  if (tsQuery) {
    query = query.textSearch('texte_recherche', tsQuery, { config: 'french' })
  }

  const { data, error } = await query
  if (error) throw new Error('Erreur chargement amendements')
  return data ?? []
}

/**
 * Recherche principale.
 * 1. Expansion IA de la requête → keywords[] (sautée si useAI === false)
 * 2. Appel RPC Supabase search_parlementaires
 * 3. Normalisation des scores (max = 100%)
 *
 * @param {Object} params
 * @param {string} params.query
 * @param {string|null} params.orientation — 'gauche' | 'centre' | 'droite' | null
 * @param {string|null} params.chambre — 'AN' | 'Senat' | null
 * @param {boolean} [params.useAI=true] — si false, recherche avec la requête brute uniquement
 * @returns {Promise<{ keywords: string[], results: Array }>}
 */
export async function searchParlementaires({ query, orientation, chambre, useAI = true, keywords: preExpanded }) {
  // 1. Expansion IA (optionnelle) — si des keywords pré-calculés sont fournis, on les réutilise
  const keywords = preExpanded ?? (useAI ? await expandQuery(query) : [query])

  // 2. Recherche Supabase
  const { data, error } = await supabase.rpc('search_parlementaires', {
    keywords,
    orientation_filter: orientation || null,
    chambre_filter: chambre || null,
  })

  if (error) {
    console.error('Erreur RPC search_parlementaires:', error)
    throw new Error('Erreur lors de la recherche. Veuillez réessayer.')
  }

  const results = data ?? []

  // 3. Normalisation : le score max = 100%
  const maxScore = results.length > 0 ? Math.max(...results.map((r) => Number(r.score))) : 1

  return {
    keywords,
    results: results.map((r) => ({
      ...r,
      score: Number(r.score),
      amendements_count: Number(r.amendements_count ?? 0),
      questions_count: Number(r.questions_count ?? 0),
      interventions_count: Number(r.interventions_count ?? 0),
      dossiers_count: Number(r.dossiers_count ?? 0),
      scorePct: maxScore > 0 ? Math.round((Number(r.score) / maxScore) * 100) : 0,
    })),
  }
}
