import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const id = url.searchParams.get('id')
  const ref = url.searchParams.get('ref')

  try {
    if (type === 'photo' && id) {
      const nom = url.searchParams.get('nom') ?? ''
      const prenom = url.searchParams.get('prenom') ?? ''
      const slugSenat = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
      const photoUrl = id.startsWith('SEN_')
        ? `https://www.senat.fr/senimg/${slugSenat(nom)}_${slugSenat(prenom)}${id.replace('SEN_', '').toLowerCase()}_carre.jpg`
        : `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${id.replace('PA', '')}.jpg`
      const upstream = await fetch(photoUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*' },
        redirect: 'follow',
      })
      if (!upstream.ok) {
        return new Response(null, { status: upstream.status, headers: CORS })
      }
      const contentType = upstream.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        return new Response(null, { status: 404, headers: CORS })
      }
      const body = await upstream.arrayBuffer()
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      })
    }

    if (type === 'opendata' && ref) {
      const upstream = await fetch(
        `https://www.assemblee-nationale.fr/dyn/opendata/${ref}.json`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!upstream.ok) {
        return new Response(null, { status: upstream.status, headers: CORS })
      }
      const body = await upstream.text()
      return new Response(body, {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      })
    }

    return new Response(JSON.stringify({ error: 'Paramètres invalides. Utiliser ?type=photo&id=PA... (ou SEN_...) ou ?type=opendata&ref=...' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
