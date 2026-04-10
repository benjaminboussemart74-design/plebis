const texteCache = new Map()
const PROXY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/an-proxy`

export async function fetchTexteMeta(ref) {
  if (texteCache.has(ref)) return texteCache.get(ref)
  try {
    const res = await fetch(`${PROXY}?type=opendata&ref=${encodeURIComponent(ref)}`)
    if (!res.ok) { texteCache.set(ref, null); return null }
    const d = await res.json()
    const meta = {
      titre: d.titres?.titrePrincipal ?? null,
      denomination: d.denominationStructurelle ?? null,
    }
    texteCache.set(ref, meta)
    return meta
  } catch {
    texteCache.set(ref, null)
    return null
  }
}

export const SORT_LABEL = {
  'Adopté':      { label: 'Adopté',       cls: 'adopte' },
  'Rejeté':      { label: 'Rejeté',       cls: 'rejete' },
  'Retiré':      { label: 'Retiré',       cls: 'retire' },
  'Tombé':       { label: 'Tombé',        cls: 'tombe'  },
  'Non soutenu': { label: 'Non soutenu',  cls: 'tombe'  },
}

export function anUrl(id) {
  return `https://www.assemblee-nationale.fr/dyn/17/amendements/${id}`
}

export function amendNum(id) {
  const m = id?.match(/N(\d+)$/)
  return m ? `n°${parseInt(m[1], 10)}` : id
}

export function texteNum(ref) {
  const m = ref?.match(/B(?:TC)?(\d+)/)
  return m ? parseInt(m[1], 10).toString() : null
}

export function texteUrl(ref) {
  const num = texteNum(ref)
  return num ? `https://www.assemblee-nationale.fr/dyn/17/textes/${num}` : null
}

export function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function excerptAround(text, keywords, maxLen = 400) {
  if (!text) return ''
  if (!keywords?.length) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
  const pattern = new RegExp(
    keywords
      .filter(k => k && k.trim().length > 2)
      .map(k => k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'i'
  )
  const idx = text.search(pattern)
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
  const start = Math.max(0, idx - 120)
  const end = Math.min(text.length, idx + maxLen - 120)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export function highlight(text, keywords, highlightClass) {
  if (!text || !keywords?.length) return text
  const escaped = keywords
    .filter(k => k && k.trim().length > 2)
    .map(k => k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return text
  const splitPattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  const matchPattern = new RegExp(`^(${escaped.join('|')})$`, 'i')
  return text.split(splitPattern).map((part, i) =>
    matchPattern.test(part)
      ? <mark key={i} className={highlightClass}>{part}</mark>
      : part
  )
}
