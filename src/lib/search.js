import { supabase } from './supabase.js'
import { expandQuery } from './anthropic.js'

/**
 * Charge les amendements d'un parlementaire matchant les keywords courants.
 */
export async function fetchAmendements(parlementaireId, keywords) {
  const tsQuery = keywords
    .map(k =>
      k.split(/\s+/)
        .map(w => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, ''))
        .filter(Boolean)
        .join(' & ')
    )
    .filter(Boolean)
    .join(' | ')

  let query = supabase
    .from('amendements')
    .select('id, objet, expose_motifs, sort, date_depot, texte_legis_ref, division_titre')
    .eq('parlementaire_id', parlementaireId)
    .order('date_depot', { ascending: false })
    .limit(100)

  if (tsQuery) {
    query = query.textSearch('texte_recherche', tsQuery, { config: 'french' })
  }

  const { data, error } = await query
  if (error) throw new Error('Erreur chargement amendements')
  return data ?? []
}

/**
 * Recherche principale.
 * 1. Expansion IA de la requête → keywords[]
 * 2. Appel RPC Supabase search_parlementaires
 * 3. Normalisation des scores (max = 100%)
 *
 * @param {Object} params
 * @param {string} params.query
 * @param {string|null} params.orientation — 'gauche' | 'centre' | 'droite' | null
 * @param {string|null} params.chambre — 'AN' | 'Senat' | null
 * @returns {Promise<{ keywords: string[], results: Array }>}
 */
export async function searchParlementaires({ query, orientation, chambre }) {
  // 1. Expansion IA
  const keywords = await expandQuery(query)

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
      scorePct: maxScore > 0 ? Math.round((Number(r.score) / maxScore) * 100) : 0,
    })),
  }
}
