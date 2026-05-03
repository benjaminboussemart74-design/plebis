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

export function senatUrl(id) {
  const matricule = id?.replace(/^SEN_/, '')
  return matricule ? `https://www.senat.fr/senateur/${matricule}.html` : null
}

// URL d'un amendement Sénat depuis son id : SEN_AMN_2024-2025_399_1
export function senatAmendUrl(id) {
  const m = id?.match(/^SEN_AMN_(\d{4}-\d{4})_(\d+)_(\d+)$/)
  if (!m) return null
  return `https://www.senat.fr/amendements/${m[1]}/${m[2]}/Amdt_${m[3]}.html`
}

// URL de la liste des amendements d'un texte Sénat : SEN_2024-2025_399
export function senatTexteAmendUrl(ref) {
  const m = ref?.match(/^SEN_(\d{4}-\d{4})_(\d+)$/)
  if (!m) return null
  return `https://www.senat.fr/amendements/${m[1]}/${m[2]}/`
}

// Numéro d'un texte Sénat depuis sa ref : SEN_2024-2025_399 → "399"
export function senatTexteNum(ref) {
  const m = ref?.match(/^SEN_(\d{4}-\d{4})_(\d+)$/)
  return m ? m[2] : null
}

// URL d'une question écrite Sénat : https://www.senat.fr/questions/base/{year}/q{yy}-{num}.html
export function senatQuestionUrl(id, dateDepot) {
  const num = id?.match(/^SEN_Q(\d+)$/)?.[1]
  if (!num || !dateDepot) return null
  const year = new Date(dateDepot).getFullYear()
  const yy = String(year).slice(-2)
  return `https://www.senat.fr/questions/base/${year}/q${yy}-${num}.html`
}

// Retourne l'URL de la fiche parlementaire selon la chambre
export function parlUrl(id, chambre) {
  if (chambre === 'Senat') return senatUrl(id)
  return anUrl(id)
}

export function amendNum(id) {
  // Amendements Sénat : SEN_AMN_2024-2025_399_1
  const senM = id?.match(/^SEN_AMN_[\d-]+_\d+_(\d+)$/)
  if (senM) return `n°${senM[1]}`
  // Amendements AN : ...N001852
  const anM = id?.match(/N(\d+)$/)
  return anM ? `n°${parseInt(anM[1], 10)}` : id
}

export function texteNum(ref) {
  const m = ref?.match(/B(?:TC)?(\d+)/)
  return m ? parseInt(m[1], 10).toString() : null
}

export function texteUrl(ref) {
  const num = texteNum(ref)
  return num ? `https://www.assemblee-nationale.fr/dyn/17/textes/${num}` : null
}

const FR_DAYS        = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
// Mois sans accents — requis par le slugify du site AN
const FR_MONTHS_SLUG = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

// seanceUid AN : CRSANR5L17S2026O1N200
//   O = ordinaire, E = extraordinaire, D = session de droit (constitutionnelle)
export function seanceAnUrl(dateSeance, seanceUid) {
  if (!dateSeance) return null
  const m = dateSeance.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const year  = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1  // 0-indexed
  const day   = parseInt(m[3], 10)
  const d = new Date(Date.UTC(year, month, day))

  const typeCode = seanceUid?.match(/L\d+S\d+([OED])/)?.[1]
  const sessionStart = month >= 9 ? year : year - 1
  let sessionSlug
  if (typeCode === 'D') {
    sessionSlug = `session-de-droit-de-${year}`
  } else if (typeCode === 'E') {
    sessionSlug = `session-extraordinaire-de-${sessionStart}-${sessionStart + 1}`
  } else {
    sessionSlug = `session-ordinaire-de-${sessionStart}-${sessionStart + 1}`
  }

  const dayStr = String(day).padStart(2, '0')
  return `https://www.assemblee-nationale.fr/dyn/17/comptes-rendus/seance/${sessionSlug}/premiere-seance-du-${FR_DAYS[d.getUTCDay()]}-${dayStr}-${FR_MONTHS_SLUG[month]}-${year}`
}

// seanceUid Sénat : SEN_d20241001 → https://www.senat.fr/cra/s20241001/s20241001_som.html
export function seanceSenatUrl(seanceUid) {
  if (!seanceUid) return null
  const m = seanceUid.match(/SEN_d(\d{8})/)
  if (!m) return null
  return `https://www.senat.fr/cra/s${m[1]}/s${m[1]}_som.html`
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
      .filter(k => k && k.trim().length > 1)
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
    .filter(k => k && k.trim().length > 1)
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
