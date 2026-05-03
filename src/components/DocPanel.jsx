import { useState, useEffect } from 'react'
import styles from './DocPanel.module.css'
import { SORT_LABEL, anUrl, amendNum, texteNum, texteUrl, formatDate, excerptAround, highlight as _highlight, fetchTexteMeta } from '../lib/panelUtils'

function hl(text, keywords) {
  return _highlight(text, keywords, styles.highlight)
}

function DocAuteur({ parlementaireId, parlIndex }) {
  const p = parlIndex?.[parlementaireId]
  if (!p) return null
  return (
    <span className={styles.auteur} style={{ '--auteur-color': p.couleur_groupe || '#9A9A92' }}>
      {p.prenom} {p.nom}
      {p.groupe_sigle && <span className={styles.auteurGroupe}>{p.groupe_sigle}</span>}
    </span>
  )
}

const PAGE_SIZE = 50

const TYPE_LABEL = {
  amendements: 'Amendements',
  questions: 'Questions écrites',
  interventions: 'Interventions en séance',
  dossiers: 'Dossiers législatifs',
}

export default function DocPanel({ activeDocView, parlIndex, keywords, onClose }) {
  const [texteMetas, setTexteMetas] = useState({})
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => {
    if (!activeDocView) return
    setLimit(PAGE_SIZE)
  }, [activeDocView?.type])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!activeDocView || activeDocView.type !== 'amendements' || !activeDocView.data?.length) return
    const refs = [...new Set(activeDocView.data.map(a => a.texte_legis_ref).filter(Boolean))]
    let cancelled = false
    Promise.all(refs.map(async ref => [ref, await fetchTexteMeta(ref)]))
      .then(entries => { if (!cancelled) setTexteMetas(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [activeDocView?.type, activeDocView?.data])

  if (!activeDocView) return null

  const { type, data, loading } = activeDocView
  const visible = data.slice(0, limit)
  const remaining = data.length - limit

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.typeLabel}>{TYPE_LABEL[type]}</span>
            {!loading && <span className={styles.count}>{data.length}</span>}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>Chargement…</div>
          ) : data.length === 0 ? (
            <div className={styles.empty}>Aucun document trouvé.</div>
          ) : (
            <>
              <ul className={styles.docList}>
                {type === 'amendements' && visible.map(a => {
                  const sortInfo = SORT_LABEL[a.sort] ?? null
                  const url = texteUrl(a.texte_legis_ref)
                  const meta = a.texte_legis_ref ? texteMetas[a.texte_legis_ref] : null
                  const texteLabel = meta?.titre || meta?.denomination || (texteNum(a.texte_legis_ref) ? `Texte n°${texteNum(a.texte_legis_ref)}` : null)
                  return (
                    <li key={a.id} className={styles.docItem}>
                      <DocAuteur parlementaireId={a.parlementaire_id} parlIndex={parlIndex} />
                      {texteLabel && (
                        <div className={styles.docRef}>
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className={styles.docRefLink}>
                              {texteLabel}
                            </a>
                          ) : (
                            <span className={styles.docRefLabel}>{texteLabel}</span>
                          )}
                          {a.division_titre && <span className={styles.docRefSub}> · {a.division_titre}</span>}
                        </div>
                      )}
                      <div className={styles.docMeta}>
                        <span className={styles.docTitre}>{amendNum(a.id)}</span>
                        <div className={styles.docMetaRight}>
                          {sortInfo && <span className={`${styles.sort} ${styles[sortInfo.cls]}`}>{sortInfo.label}</span>}
                          {a.date_depot && <span className={styles.docDate}>{formatDate(a.date_depot)}</span>}
                          <a href={anUrl(a.id)} target="_blank" rel="noopener noreferrer" className={styles.docLink}>AN ↗</a>
                        </div>
                      </div>
                      {a.objet && <p className={styles.docText}>{hl(a.objet, keywords)}</p>}
                    </li>
                  )
                })}

                {type === 'questions' && visible.map(q => (
                  <li key={q.id} className={styles.docItem}>
                    <DocAuteur parlementaireId={q.parlementaire_id} parlIndex={parlIndex} />
                    <div className={styles.docMeta}>
                      <div className={styles.docQuestionMeta}>
                        {q.rubrique && <span className={styles.docRubrique}>{q.rubrique}</span>}
                        {q.ministere && <span className={styles.docMinistere}>→ {q.ministere}</span>}
                      </div>
                      <div className={styles.docMetaRight}>
                        {q.date_depot && <span className={styles.docDate}>{formatDate(q.date_depot)}</span>}
                        <a href={`https://www.assemblee-nationale.fr/dyn/17/questions/${q.id}`} target="_blank" rel="noopener noreferrer" className={styles.docLink}>AN ↗</a>
                      </div>
                    </div>
                    {q.tete_analyse && <p className={styles.docText}>{hl(q.tete_analyse, keywords)}</p>}
                    {q.texte_question && (
                      <p className={styles.docTextMuted}>{hl(excerptAround(q.texte_question, keywords), keywords)}</p>
                    )}
                  </li>
                ))}

                {type === 'interventions' && visible.map(i => (
                  <li key={i.id} className={styles.docItem}>
                    <DocAuteur parlementaireId={i.parlementaire_id} parlIndex={parlIndex} />
                    <div className={styles.docMeta}>
                      {i.point_titre && <span className={styles.docRefLabel}>{i.point_titre}</span>}
                      <div className={styles.docMetaRight}>
                        {i.date_seance && <span className={styles.docDate}>{formatDate(i.date_seance)}</span>}
                      </div>
                    </div>
                    {i.texte && <p className={styles.docText}>{hl(excerptAround(i.texte, keywords), keywords)}</p>}
                  </li>
                ))}

                {type === 'dossiers' && visible.map(d => {
                  const anDossUrl = d.titre_chemin
                    ? `https://www.assemblee-nationale.fr/dyn/17/dossiers/${d.titre_chemin}`
                    : null
                  return (
                    <li key={d.id} className={styles.docItem}>
                      <DocAuteur parlementaireId={d.parlementaire_id} parlIndex={parlIndex} />
                      {d.procedure_libelle && (
                        <div className={styles.docRef}>
                          <span className={styles.docProcedure}>{d.procedure_libelle}</span>
                        </div>
                      )}
                      <div className={styles.docMeta}>
                        <span className={styles.docTitreWrap}>{hl(d.titre, keywords)}</span>
                        <div className={styles.docMetaRight}>
                          {d.date_depot && <span className={styles.docDate}>{formatDate(d.date_depot)}</span>}
                          {anDossUrl && (
                            <a href={anDossUrl} target="_blank" rel="noopener noreferrer" className={styles.docLink}>AN ↗</a>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {remaining > 0 && (
                <button className={styles.loadMore} onClick={() => setLimit(l => l + PAGE_SIZE)}>
                  Voir {Math.min(remaining, PAGE_SIZE)} de plus <span className={styles.loadMoreCount}>({remaining} restants)</span>
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
