import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './AmendementPanel.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'
import { supabase } from '../lib/supabase'
import { SORT_LABEL, anUrl, amendNum, texteNum, texteUrl, formatDate, excerptAround, highlight as _highlight, fetchTexteMeta } from '../lib/panelUtils'
import { exportParlementaire } from '../lib/exportExcel'

function highlight(text, keywords) {
  return _highlight(text, keywords, styles.highlight)
}

function makeGroups(items, keyFn, nullKey) {
  const map = new Map()
  for (const item of items) {
    const k = keyFn(item) ?? nullKey
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(item)
  }
  return [...map.entries()]
    .map(([key, groupItems]) => ({ key, items: groupItems }))
    .sort((a, b) => {
      if (a.key === nullKey) return 1
      if (b.key === nullKey) return -1
      return b.items.length - a.items.length
    })
}

export default function AmendementPanel({ parlementaire, amendements, questionsEcrites, interventions, dossiers, keywords, loading, onClose }) {
  const [activeTab, setActiveTab] = useState('amendements')
  const [texteMetas, setTexteMetas] = useState({})
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  const [modal, setModal] = useState(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalItems, setModalItems] = useState([])
  const [modalError, setModalError] = useState(null)
  const highlightRef = useRef(null)
  const modalRef = useRef(null)
  const modalStateRef = useRef(null)
  useEffect(() => { modalStateRef.current = modal }, [modal])

  useEffect(() => {
    setActiveTab('amendements')
    setModal(null)
    setCollapsedGroups(new Set())
  }, [parlementaire?.id])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (modalStateRef.current) { closeModal(); return }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!modalLoading && modalItems.length && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }, [modalLoading, modalItems])

  useEffect(() => {
    if (!amendements.length) return
    const refs = [...new Set(amendements.map(a => a.texte_legis_ref).filter(Boolean))]
    let cancelled = false
    Promise.all(refs.map(async ref => [ref, await fetchTexteMeta(ref)]))
      .then(entries => { if (!cancelled) setTexteMetas(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [amendements])

  function toggleGroup(tabKey, groupKey) {
    const id = `${tabKey}:${groupKey}`
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function isCollapsed(tabKey, groupKey) {
    return collapsedGroups.has(`${tabKey}:${groupKey}`)
  }

  const groupesAmendements = useMemo(() => {
    const groups = makeGroups(amendements, a => a.texte_legis_ref, '__sans_ref__')
    return groups.map(g => ({
      ...g,
      meta: g.key !== '__sans_ref__' ? texteMetas[g.key] : null,
      url: g.key !== '__sans_ref__' ? texteUrl(g.key) : null,
    }))
  }, [amendements, texteMetas])

  const groupesQuestions = useMemo(() =>
    makeGroups(questionsEcrites ?? [], q => q.rubrique || null, '__sans_rubrique__'),
  [questionsEcrites])

  const groupesInterventions = useMemo(() =>
    makeGroups(interventions ?? [], i => i.point_titre || null, '__sans_point__'),
  [interventions])

  const groupesDossiers = useMemo(() =>
    makeGroups(dossiers ?? [], d => d.procedure_libelle || null, '__sans_procedure__'),
  [dossiers])

  async function openSeanceModal(intervention) {
    const seanceUid = intervention.id.split('__')[0]
    setModal({ type: 'seance', interventionId: intervention.id, seanceUid, date_seance: intervention.date_seance, point_titre: intervention.point_titre })
    setModalLoading(true)
    setModalError(null)
    setModalItems([])

    const { data, error } = await supabase
      .from('interventions')
      .select('id, texte, point_titre')
      .gte('id', `${seanceUid}__`)
      .lt('id', `${seanceUid}~`)
      .order('id')

    setModalLoading(false)
    if (error || !data?.length) {
      setModalError('Aucun compte rendu trouvé pour cette séance.')
    } else {
      setModalItems(data)
    }
  }

  function openQuestionModal(question) {
    setModal({ type: 'question', question })
  }

  function closeModal() {
    setModal(null)
    setModalItems([])
    setModalError(null)
  }

  if (!parlementaire) return null

  const { prenom, nom, groupe_sigle, groupe_libelle, couleur_groupe } = parlementaire
  const groupeLogo = getGroupeLogo(groupe_sigle)
  const qe = questionsEcrites ?? []
  const iv = interventions ?? []
  const doss = dossiers ?? []

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.deputeNom}>{prenom} {nom}</span>
            {groupeLogo ? (
              <img src={groupeLogo} alt={groupe_sigle} className={styles.badgeLogo} title={groupe_libelle} />
            ) : (
              <span className={styles.badge} style={{ background: couleur_groupe ?? '#888' }} title={groupe_libelle}>
                {groupe_sigle}
              </span>
            )}
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.btnExport}
              onClick={() => exportParlementaire(parlementaire, amendements, questionsEcrites, interventions)}
              disabled={loading}
              title="Exporter en Excel"
            >
              Exporter Excel
            </button>
            <button className={styles.close} onClick={onClose} aria-label="Fermer">×</button>
          </div>
        </div>

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${activeTab === 'amendements' ? styles.tabActive : ''}`} onClick={() => setActiveTab('amendements')}>
            Amendements
            {!loading && <span className={styles.tabCount}>{amendements.length}</span>}
          </button>
          <button className={`${styles.tab} ${activeTab === 'questions' ? styles.tabActive : ''}`} onClick={() => setActiveTab('questions')}>
            Questions écrites
            {!loading && <span className={styles.tabCount}>{qe.length}</span>}
          </button>
          <button className={`${styles.tab} ${activeTab === 'interventions' ? styles.tabActive : ''}`} onClick={() => setActiveTab('interventions')}>
            Séance
            {!loading && <span className={styles.tabCount}>{iv.length}</span>}
          </button>
          <button className={`${styles.tab} ${activeTab === 'dossiers' ? styles.tabActive : ''}`} onClick={() => setActiveTab('dossiers')}>
            Dossiers
            {!loading && <span className={styles.tabCount}>{doss.length}</span>}
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
              {groupesAmendements.map(group => {
                const collapsed = isCollapsed('amendements', group.key)
                const adoptes = group.items.filter(a => SORT_LABEL[a.sort]?.cls === 'adopte').length
                const rejetes = group.items.filter(a => SORT_LABEL[a.sort]?.cls === 'rejete').length
                const retiresOuTombes = group.items.filter(a => ['retire', 'tombe'].includes(SORT_LABEL[a.sort]?.cls)).length
                const titre = group.key === '__sans_ref__'
                  ? 'Sans texte identifié'
                  : group.meta?.denomination && group.meta?.titre
                    ? `${group.meta.denomination} — ${group.meta.titre}`
                    : group.meta?.titre ?? group.meta?.denomination ?? `Texte n°${texteNum(group.key)}`
                const stats = [
                  adoptes > 0 && `${adoptes} adopté${adoptes !== 1 ? 's' : ''}`,
                  rejetes > 0 && `${rejetes} rejeté${rejetes !== 1 ? 's' : ''}`,
                  retiresOuTombes > 0 && `${retiresOuTombes} retiré${retiresOuTombes !== 1 ? 's' : ''}/tombé${retiresOuTombes !== 1 ? 's' : ''}`,
                ].filter(Boolean).join(' · ')
                return (
                  <li key={group.key}>
                    <div
                      className={styles.groupHeader}
                      onClick={() => toggleGroup('amendements', group.key)}
                      role="button"
                      aria-expanded={!collapsed}
                    >
                      <div className={styles.groupHeaderRow}>
                        <span className={styles.groupChevron}>{collapsed ? '▸' : '▾'}</span>
                        <div>
                          {group.url ? (
                            <a href={group.url} target="_blank" rel="noopener noreferrer" className={styles.texteLink} onClick={e => e.stopPropagation()}>{titre}</a>
                          ) : (
                            <span>{titre}</span>
                          )}
                          {' · '}
                          {group.items.length} amendement{group.items.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {stats && <div className={styles.groupStats}>{stats}</div>}
                    </div>
                    {!collapsed && (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {group.items.map(a => {
                          const sortInfo = SORT_LABEL[a.sort] ?? null
                          return (
                            <li key={a.id} className={styles.item}>
                              <div className={styles.itemHeader}>
                                <span className={styles.titre}>{amendNum(a.id)}</span>
                                <div className={styles.itemMeta}>
                                  {sortInfo && <span className={`${styles.sort} ${styles[sortInfo.cls]}`}>{sortInfo.label}</span>}
                                  {a.date_depot && <span className={styles.date}>{formatDate(a.date_depot)}</span>}
                                  <a href={anUrl(a.id)} target="_blank" rel="noopener noreferrer" className={styles.link} title="Voir sur assemblee-nationale.fr">
                                    AN ↗
                                  </a>
                                </div>
                              </div>
                              {a.division_titre && (
                                <div className={styles.texteRef}>
                                  <span className={styles.divisionTitre}>{a.division_titre}</span>
                                </div>
                              )}
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
              {groupesQuestions.map(group => {
                const collapsed = isCollapsed('questions', group.key)
                const label = group.key === '__sans_rubrique__' ? 'Sans rubrique' : group.key
                return (
                  <li key={group.key}>
                    <div
                      className={styles.groupHeader}
                      onClick={() => toggleGroup('questions', group.key)}
                      role="button"
                      aria-expanded={!collapsed}
                    >
                      <div className={styles.groupHeaderRow}>
                        <span className={styles.groupChevron}>{collapsed ? '▸' : '▾'}</span>
                        <span>{label} · {group.items.length} question{group.items.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    {!collapsed && (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {group.items.map(q => (
                          <li key={q.id} className={styles.item}>
                            <div className={styles.itemHeader}>
                              <div className={styles.questionMeta}>
                                {q.ministere && <span className={styles.ministere}>→ {q.ministere}</span>}
                              </div>
                              <div className={styles.itemMeta}>
                                {q.date_depot && <span className={styles.date}>{formatDate(q.date_depot)}</span>}
                                <button className={styles.btnCR} onClick={() => openQuestionModal(q)}>
                                  Lire
                                </button>
                                <a
                                  href={`https://www.assemblee-nationale.fr/dyn/17/questions/${q.id}`}
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
                                <p className={styles.objet}>{highlight(excerptAround(q.texte_question, keywords), keywords)}</p>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </>

        ) : activeTab === 'interventions' ? (
          <>
            <div className={styles.count}>
              {iv.length} intervention{iv.length !== 1 ? 's' : ''} en séance sur cette thématique
            </div>
            <ul className={styles.list}>
              {groupesInterventions.map(group => {
                const collapsed = isCollapsed('interventions', group.key)
                const label = group.key === '__sans_point__' ? 'Sans point à l\'ordre du jour' : group.key
                return (
                  <li key={group.key}>
                    <div
                      className={styles.groupHeader}
                      onClick={() => toggleGroup('interventions', group.key)}
                      role="button"
                      aria-expanded={!collapsed}
                    >
                      <div className={styles.groupHeaderRow}>
                        <span className={styles.groupChevron}>{collapsed ? '▸' : '▾'}</span>
                        <span>{label} · {group.items.length} intervention{group.items.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    {!collapsed && (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {group.items.map(i => (
                          <li key={i.id} className={styles.item}>
                            <div className={styles.itemHeader}>
                              <span className={styles.titre}>{prenom} {nom}</span>
                              <div className={styles.itemMeta}>
                                {i.date_seance && <span className={styles.date}>{formatDate(i.date_seance)}</span>}
                                <button className={styles.btnCR} onClick={() => openSeanceModal(i)}>
                                  Compte rendu
                                </button>
                              </div>
                            </div>
                            {i.texte && (
                              <div className={styles.section}>
                                <p className={styles.objet}>{highlight(excerptAround(i.texte, keywords), keywords)}</p>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </>

        ) : (
          <>
            <div className={styles.count}>
              {doss.length} dossier{doss.length !== 1 ? 's' : ''} législatif{doss.length !== 1 ? 's' : ''} sur cette thématique
            </div>
            <ul className={styles.list}>
              {groupesDossiers.map(group => {
                const collapsed = isCollapsed('dossiers', group.key)
                const label = group.key === '__sans_procedure__' ? 'Sans procédure identifiée' : group.key
                return (
                  <li key={group.key}>
                    <div
                      className={styles.groupHeader}
                      onClick={() => toggleGroup('dossiers', group.key)}
                      role="button"
                      aria-expanded={!collapsed}
                    >
                      <div className={styles.groupHeaderRow}>
                        <span className={styles.groupChevron}>{collapsed ? '▸' : '▾'}</span>
                        <span>{label} · {group.items.length} dossier{group.items.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    {!collapsed && (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {group.items.map(d => {
                          const dossierUrl = d.titre_chemin
                            ? `https://www.assemblee-nationale.fr/dyn/17/dossiers/${d.titre_chemin}`
                            : null
                          return (
                            <li key={d.id} className={styles.item}>
                              <div className={styles.itemHeader}>
                                <span className={styles.dossierTitre}>{highlight(d.titre, keywords)}</span>
                                <div className={styles.itemMeta}>
                                  {d.date_depot && <span className={styles.date}>{formatDate(d.date_depot)}</span>}
                                  {dossierUrl && (
                                    <a href={dossierUrl} target="_blank" rel="noopener noreferrer" className={styles.link} title="Voir sur assemblee-nationale.fr">
                                      AN ↗
                                    </a>
                                  )}
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </aside>

      {modal && (
        <>
          <div className={styles.modalBackdrop} onClick={closeModal} />
          <div className={styles.modal} ref={modalRef} role="dialog" aria-modal="true">
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleGroup}>
                <span className={styles.modalKind}>
                  {modal.type === 'seance' ? 'Compte rendu de séance' : 'Question écrite'}
                </span>
                <span className={styles.modalTitle}>
                  {modal.type === 'seance'
                    ? modal.point_titre || 'Séance plénière'
                    : modal.question.tete_analyse || modal.question.rubrique || 'Question'}
                </span>
                {modal.type === 'seance' && modal.date_seance && (
                  <span className={styles.modalDate}>{formatDate(modal.date_seance)}</span>
                )}
                {modal.type === 'question' && modal.question.date_depot && (
                  <span className={styles.modalDate}>{formatDate(modal.question.date_depot)}</span>
                )}
              </div>
              <button className={styles.close} onClick={closeModal} aria-label="Fermer">×</button>
            </div>

            <div className={styles.modalBody}>
              {modal.type === 'seance' ? (
                modalLoading ? (
                  <div className={styles.modalEmpty}>Chargement du compte rendu…</div>
                ) : modalError ? (
                  <div className={styles.modalError}>{modalError}</div>
                ) : (
                  modalItems.map(item => {
                    const isTarget = item.id === modal.interventionId
                    return (
                      <div
                        key={item.id}
                        ref={isTarget ? highlightRef : null}
                        className={`${styles.seanceItem} ${isTarget ? styles.seanceItemTarget : ''}`}
                      >
                        {isTarget && (
                          <span className={styles.seanceItemLabel}>Intervention de {prenom} {nom}</span>
                        )}
                        <p className={styles.seanceTexte}>
                          {isTarget ? highlight(item.texte, keywords) : item.texte}
                        </p>
                      </div>
                    )
                  })
                )
              ) : (
                <div className={styles.seanceItem}>
                  {modal.question.rubrique && (
                    <div className={styles.section}>
                      <span className={styles.sectionLabel}>Rubrique</span>
                      <p className={styles.objet}>{modal.question.rubrique}</p>
                    </div>
                  )}
                  {modal.question.ministere && (
                    <div className={styles.section}>
                      <span className={styles.sectionLabel}>Ministère</span>
                      <p className={styles.objet}>{modal.question.ministere}</p>
                    </div>
                  )}
                  {modal.question.texte_question && (
                    <div className={styles.section}>
                      <span className={styles.sectionLabel}>Question</span>
                      <p className={styles.objet}>{highlight(modal.question.texte_question, keywords)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
