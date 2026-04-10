import { useEffect, useRef, useState } from 'react'
import styles from './AmendementPanel.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'
import { supabase } from '../lib/supabase'
import { SORT_LABEL, anUrl, amendNum, texteNum, texteUrl, formatDate, excerptAround, highlight as _highlight, fetchTexteMeta } from '../lib/panelUtils'

function highlight(text, keywords) {
  return _highlight(text, keywords, styles.highlight)
}

export default function AmendementPanel({ parlementaire, amendements, questionsEcrites, interventions, dossiers, keywords, loading, onClose }) {
  const [activeTab, setActiveTab] = useState('amendements')
  const [texteMetas, setTexteMetas] = useState({})

  // État de la modale compte rendu / question
  // null | { type: 'seance', interventionId, seanceUid, date_seance, point_titre }
  //       | { type: 'question', question }
  const [modal, setModal] = useState(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalItems, setModalItems] = useState([])
  const [modalError, setModalError] = useState(null)
  const highlightRef = useRef(null)
  const modalRef = useRef(null) // pour le scroll auto après chargement

  // Ref synchronisé pour l'état modal (utilisé dans le handler Escape)
  const modalStateRef = useRef(null)
  useEffect(() => { modalStateRef.current = modal }, [modal])

  useEffect(() => {
    setActiveTab('amendements')
    setModal(null)
  }, [parlementaire?.id])

  // Fermeture par Échap : modale d'abord, puis panneau
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
          <button className={styles.close} onClick={onClose} aria-label="Fermer">×</button>
        </div>

        {/* Onglets */}
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
                      {a.division_titre && <span className={styles.divisionTitre}> · {a.division_titre}</span>}
                    </div>
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
          </>
        ) : activeTab === 'interventions' ? (
          <>
            <div className={styles.count}>
              {iv.length} intervention{iv.length !== 1 ? 's' : ''} en séance sur cette thématique
            </div>
            <ul className={styles.list}>
              {iv.map(i => (
                <li key={i.id} className={styles.item}>
                  {i.point_titre && (
                    <div className={styles.texteRef}>
                      <span className={styles.texteNom}>{i.point_titre}</span>
                    </div>
                  )}
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
          </>
        ) : (
          <>
            <div className={styles.count}>
              {doss.length} dossier{doss.length !== 1 ? 's' : ''} législatif{doss.length !== 1 ? 's' : ''} sur cette thématique
            </div>
            <ul className={styles.list}>
              {doss.map(d => {
                const anUrl = d.titre_chemin
                  ? `https://www.assemblee-nationale.fr/dyn/17/dossiers/${d.titre_chemin}`
                  : null
                return (
                  <li key={d.id} className={styles.item}>
                    {d.procedure_libelle && (
                      <div className={styles.texteRef}>
                        <span className={styles.procedureBadge}>{d.procedure_libelle}</span>
                      </div>
                    )}
                    <div className={styles.itemHeader}>
                      <span className={styles.dossierTitre}>{highlight(d.titre, keywords)}</span>
                      <div className={styles.itemMeta}>
                        {d.date_depot && <span className={styles.date}>{formatDate(d.date_depot)}</span>}
                        {anUrl && (
                          <a href={anUrl} target="_blank" rel="noopener noreferrer" className={styles.link} title="Voir sur assemblee-nationale.fr">
                            AN ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </aside>

      {/* ── Modale compte rendu / question complète ──────── */}
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
                /* Question écrite complète */
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
