import { useEffect, useState } from 'react'
import styles from './AmendementPanel.module.css'

const SORT_LABEL = {
  'Adopté':      { label: 'Adopté',       cls: 'adopte' },
  'Rejeté':      { label: 'Rejeté',       cls: 'rejete' },
  'Retiré':      { label: 'Retiré',       cls: 'retire' },
  'Tombé':       { label: 'Tombé',        cls: 'tombe'  },
  'Non soutenu': { label: 'Non soutenu',  cls: 'tombe'  },
}

// Cache global pour éviter les appels dupliqués entre ouvertures de panneau
const texteCache = new Map()

const PROXY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/an-proxy`

async function fetchTexteMeta(ref) {
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

function anUrl(id) {
  return `https://www.assemblee-nationale.fr/dyn/17/amendements/${id}`
}

function amendNum(id) {
  const m = id?.match(/N(\d+)$/)
  return m ? `n°${parseInt(m[1], 10)}` : id
}

function texteNum(ref) {
  const m = ref?.match(/B(?:TC)?(\d+)/)
  return m ? parseInt(m[1], 10).toString() : null
}

function texteUrl(ref) {
  const num = texteNum(ref)
  return num ? `https://www.assemblee-nationale.fr/dyn/17/textes/${num}` : null
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AmendementPanel({ parlementaire, amendements, loading, onClose }) {
  const [texteMetas, setTexteMetas] = useState({}) // ref → { titre, denomination }

  // Fermeture par Échap
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch les titres des textes législatifs uniques
  useEffect(() => {
    if (!amendements.length) return
    const refs = [...new Set(amendements.map(a => a.texte_legis_ref).filter(Boolean))]
    let cancelled = false

    Promise.all(
      refs.map(async ref => {
        const meta = await fetchTexteMeta(ref)
        return [ref, meta]
      })
    ).then(entries => {
      if (!cancelled) {
        setTexteMetas(Object.fromEntries(entries))
      }
    })

    return () => { cancelled = true }
  }, [amendements])

  if (!parlementaire) return null

  const { prenom, nom, groupe_sigle, groupe_libelle, couleur_groupe } = parlementaire

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.deputeNom}>{prenom} {nom}</span>
            <span
              className={styles.badge}
              style={{ background: couleur_groupe ?? '#888' }}
              title={groupe_libelle}
            >
              {groupe_sigle}
            </span>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className={styles.count}>
          {loading
            ? 'Chargement…'
            : `${amendements.length} amendement${amendements.length > 1 ? 's' : ''} sur cette thématique`}
        </div>

        <ul className={styles.list}>
          {amendements.map(a => {
            const sortInfo = SORT_LABEL[a.sort] ?? null
            const meta = a.texte_legis_ref ? texteMetas[a.texte_legis_ref] : null
            const url = texteUrl(a.texte_legis_ref)

            return (
              <li key={a.id} className={styles.item}>

                {/* Texte législatif visé */}
                <div className={styles.texteRef}>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className={styles.texteLink}>
                      {meta?.denomination && `${meta.denomination} — `}
                      {meta?.titre ?? `Texte n°${texteNum(a.texte_legis_ref)}`}
                    </a>
                  ) : (
                    <span className={styles.texteNom}>{a.texte_legis_ref}</span>
                  )}
                  {a.division_titre && (
                    <span className={styles.divisionTitre}> · {a.division_titre}</span>
                  )}
                </div>

                {/* En-tête amendement */}
                <div className={styles.itemHeader}>
                  <span className={styles.titre}>{amendNum(a.id)}</span>
                  <div className={styles.itemMeta}>
                    {sortInfo && (
                      <span className={`${styles.sort} ${styles[sortInfo.cls]}`}>
                        {sortInfo.label}
                      </span>
                    )}
                    {a.date_depot && (
                      <span className={styles.date}>{formatDate(a.date_depot)}</span>
                    )}
                    <a
                      href={anUrl(a.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.link}
                      title="Voir sur assemblee-nationale.fr"
                    >
                      AN ↗
                    </a>
                  </div>
                </div>

                {a.objet && (
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>Texte amendé</span>
                    <p className={styles.objet}>{a.objet}</p>
                  </div>
                )}
                {a.expose_motifs && (
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>Exposé des motifs</span>
                    <p className={styles.objet}>{a.expose_motifs}</p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </aside>
    </>
  )
}
