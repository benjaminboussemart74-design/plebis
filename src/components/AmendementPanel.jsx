import { useEffect, useState } from 'react'
import styles from './AmendementPanel.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'

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

function questionUrl(id) {
  return id ? `https://www.assemblee-nationale.fr/dyn/17/questions/${id}` : null
}

function seanceUrl(interventionId) {
  const seanceUid = interventionId?.split('__')[0]
  return seanceUid ? `https://www.assemblee-nationale.fr/dyn/opendata/${seanceUid}.html` : null
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function highlight(text, keywords) {
  if (!text || !keywords?.length) return text
  const escaped = keywords
    .filter(k => k && k.trim().length > 2)
    .map(k => k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return text
  const splitPattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  const matchPattern = new RegExp(`^(${escaped.join('|')})$`, 'i')
  return text.split(splitPattern).map((part, i) =>
    matchPattern.test(part)
      ? <mark key={i} className={styles.highlight}>{part}</mark>
      : part
  )
}

function excerptAround(text, keywords, maxLen = 400) {
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

export default function AmendementPanel({ parlementaire, amendements, questionsEcrites, interventions, keywords, loading, onClose }) {
  const [activeTab, setActiveTab] = useState('amendements')
  const [texteMetas, setTexteMetas] = useState({}) // ref → { titre, denomination }

  // Reset tab when parlementaire changes
  useEffect(() => {
    setActiveTab('amendements')
  }, [parlementaire?.id])

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
  const groupeLogo = getGroupeLogo(groupe_sigle)
  const qe = questionsEcrites ?? []
  const iv = interventions ?? []

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.deputeNom}>{prenom} {nom}</span>
            {groupeLogo ? (
              <img
                src={groupeLogo}
                alt={groupe_sigle}
                className={styles.badgeLogo}
                title={groupe_libelle}
              />
            ) : (
              <span
                className={styles.badge}
                style={{ background: couleur_groupe ?? '#888' }}
                title={groupe_libelle}
              >
                {groupe_sigle}
              </span>
            )}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {/* Onglets */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'amendements' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('amendements')}
          >
            📜 Amendements
            {!loading && <span className={styles.tabCount}>{amendements.length}</span>}
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'questions' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('questions')}
          >
            ❓ Questions écrites
            {!loading && <span className={styles.tabCount}>{qe.length}</span>}
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'interventions' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('interventions')}
          >
            🎙 Séance
            {!loading && <span className={styles.tabCount}>{iv.length}</span>}
          </button>
        </div>

        {loading ? (
          <div className={styles.count}>Chargement…</div>
        ) : activeTab === 'amendements' ? (
          <>
            <div className={styles.count}>
              {amendements.length} amendement{amendements.length !== 1 ? 's' : ''} sur cette thématique
            </div>
            <ul className={styles.list}>
              {amendements.map(a => {
                const sortInfo = SORT_LABEL[a.sort] ?? null
                const meta = a.texte_legis_ref ? texteMetas[a.texte_legis_ref] : null
                const url = texteUrl(a.texte_legis_ref)

                return (
                  <li key={a.id} className={styles.item}>
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
                        <p className={styles.objet}>{highlight(a.objet, keywords)}</p>
                      </div>
                    )}
                    {a.expose_motifs && (
                      <div className={styles.section}>
                        <span className={styles.sectionLabel}>Exposé des motifs</span>
                        <p className={styles.objet}>{highlight(a.expose_motifs, keywords)}</p>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        ) : activeTab === 'questions' ? (
          <>
            <div className={styles.count}>
              {qe.length} question{qe.length !== 1 ? 's' : ''} écrite{qe.length !== 1 ? 's' : ''} sur cette thématique
            </div>
            <ul className={styles.list}>
              {qe.map(q => (
                <li key={q.id} className={styles.item}>
                  <div className={styles.itemHeader}>
                    <div className={styles.questionMeta}>
                      {q.rubrique && <span className={styles.rubrique}>{q.rubrique}</span>}
                      {q.ministere && <span className={styles.ministere}>→ {q.ministere}</span>}
                    </div>
                    <div className={styles.itemMeta}>
                      {q.date_depot && (
                        <span className={styles.date}>{formatDate(q.date_depot)}</span>
                      )}
                      <a
                        href={questionUrl(q.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.link}
                        title="Voir sur assemblee-nationale.fr"
                      >
                        AN ↗
                      </a>
                    </div>
                  </div>
                  {q.tete_analyse && (
                    <div className={styles.section}>
                      <span className={styles.sectionLabel}>Sujet</span>
                      <p className={styles.objet}>{highlight(q.tete_analyse, keywords)}</p>
                    </div>
                  )}
                  {q.texte_question && (
                    <div className={styles.section}>
                      <span className={styles.sectionLabel}>Question</span>
                      <p className={styles.objet}>{highlight(q.texte_question, keywords)}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className={styles.count}>
              {iv.length} intervention{iv.length !== 1 ? 's' : ''} en séance sur cette thématique
            </div>
            <ul className={styles.list}>
              {iv.map(i => (
                <li key={i.id} className={styles.item}>
                  {i.point_titre && (
                    <div className={styles.texteRef}>
                      <a href={seanceUrl(i.id)} target="_blank" rel="noopener noreferrer" className={styles.texteLink}>
                        {i.point_titre}
                      </a>
                    </div>
                  )}
                  <div className={styles.itemHeader}>
                    <span className={styles.titre}>{prenom} {nom}</span>
                    <div className={styles.itemMeta}>
                      {i.date_seance && (
                        <span className={styles.date}>{formatDate(i.date_seance)}</span>
                      )}
                      <a
                        href={seanceUrl(i.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.link}
                        title="Voir le compte rendu sur assemblee-nationale.fr"
                      >
                        AN ↗
                      </a>
                    </div>
                  </div>
                  {i.texte && (
                    <div className={styles.section}>
                      <p className={styles.objet}>
                        {highlight(excerptAround(i.texte, keywords), keywords)}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </>
  )
}
