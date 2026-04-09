import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { query } = await req.json()

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Paramètre query manquant ou invalide.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Clé Anthropic non configurée.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: `Tu es un expert en terminologie législative française. Pour le terme fourni, retourne UNIQUEMENT ses équivalents directs : acronymes et sigles officiels EN PRIORITÉ, puis synonymes stricts et dénominations législatives exactes. NE fais PAS d'expansion thématique. NE liste PAS de sujets connexes. Maximum 5 termes, ceux qui apparaissent littéralement dans les textes parlementaires.\n\nExemples :\n- "rénovation énergétique" → ["DPE", "MaPrimeRénov", "rénovation thermique", "BBC rénovation", "CEE"]\n- "intelligence artificielle" → ["IA", "algorithme", "système d'IA"]\n- "revenu universel" → ["RSA", "revenu de base", "allocation universelle"]\n\nRéponds UNIQUEMENT avec un tableau JSON de chaînes de caractères, sans preamble ni balises markdown.`,
        messages: [{ role: 'user', content: query.trim() }],
      }),
    })

    const rawBody = await response.text()

    if (!response.ok) {
      console.error('Anthropic error', response.status, rawBody)
      return new Response(
        JSON.stringify({ error: 'Erreur Anthropic', detail: rawBody }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = JSON.parse(rawBody)
    const text = data.content?.[0]?.text ?? '[]'

    let keywords: string[]
    try {
      keywords = JSON.parse(text)
      if (!Array.isArray(keywords)) throw new Error('Not an array')
    } catch {
      // Fallback : extraire le JSON du texte si Claude a quand même ajouté du texte
      const match = text.match(/\[[\s\S]*\]/)
      keywords = match ? JSON.parse(match[0]) : [query]
    }

    return new Response(
      JSON.stringify({ keywords }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(
      JSON.stringify({ error: 'Erreur interne.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
