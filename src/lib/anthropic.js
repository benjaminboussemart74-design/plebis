import { supabase } from './supabase.js'

/**
 * Appelle l'Edge Function Supabase `expand-query` pour obtenir
 * une liste de mots-clés sémantiquement proches de la requête.
 *
 * La clé Anthropic reste côté serveur dans l'Edge Function.
 *
 * @param {string} query — La thématique saisie par l'utilisateur
 * @returns {Promise<string[]>} — Tableau de mots-clés (10-15 items)
 */
export async function expandQuery(query) {
  const { data, error } = await supabase.functions.invoke('expand-query', {
    body: { query },
  })

  if (error) {
    console.error('Erreur expand-query:', error)
    // Fallback : on recherche juste avec la requête originale
    return [query]
  }

  if (!Array.isArray(data?.keywords) || data.keywords.length === 0) {
    return [query]
  }

  // On inclut toujours la requête originale dans la liste
  const keywords = [query, ...data.keywords]
  return [...new Set(keywords)] // déduplique
}
