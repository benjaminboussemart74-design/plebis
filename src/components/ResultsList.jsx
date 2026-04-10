import { useState, useMemo, useEffect } from 'react'
import ParlementaireCard from './ParlementaireCard'
import styles from './ResultsList.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'
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

function DocView({ activeDocView, parlIndex, keywords, onClose }) {
  const { type, data, loading } = activeDocView
  const [texteMetas, setTexteMetas] = useState({})
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [type])

  useEffect(() => {
    if (type !== 'amendements' || !data.length) return
    const refs = [...new Set(data.map(a => a.texte_legis_ref).filter(Boolean))]
    let cancelled = false
    Promise.all(refs.map(async ref => [ref, await fetchTexteMeta(ref)]))
      .then(entries => { if (!cancelled) setTexteMetas(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [type, data])

  const TYPE_LABEL = {
    amendements: 'Amendements',
    questions: 'Questions écrites',
    interventions: 'Interventions en séance',
    dossiers: 'Dossiers législatifs',
  }

  const visible = data.slice(0, limit)
  const remaining = data.length - limit

  return (
    <div className={styles.docView}>
      <div className={styles.docViewHeader}>
        <div className={styles.docViewTitle}>
          <span className={styles.docViewType}>{TYPE_LABEL[type]}</span>
          {!loading && <span className={styles.docViewCount}>{data.length}</span>}
        </div>
        <button className={styles.docViewBack} onClick={onClose}>
          ← Retour aux parlementaires
        </button>
      </div>

      {loading ? (
        <div className={styles.docViewLoading}>Chargement…</div>
      ) : data.length === 0 ? (
        <div className={styles.docViewEmpty}>Aucun document trouvé.</div>
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
  )
}

function GroupSummary({ groupStats, activeGroup, onFilter }) {
  if (!groupStats || groupStats.length === 0) return null

  return (
    <div className={styles.groupStrip}>
      {groupStats.map(g => {
        const logo = getGroupeLogo(g.sigle)
        return (
        <div
          key={g.sigle}
          className={`${styles.groupBlock} ${activeGroup === g.sigle ? styles.groupBlockActive : ''}`}
          style={{ '--group-color': g.couleur || '#9A9A92' }}
        >
          <div className={styles.groupColorBar} />
          {logo
            ? <img src={logo} alt={g.sigle} className={styles.groupLogo} />
            : <div className={styles.groupSigle}>{g.sigle}</div>
          }
          <div className={styles.groupStat}>{g.count} député{g.count > 1 ? 's' : ''}</div>
          <div className={styles.groupStat}>{g.totalScore} action{g.totalScore > 1 ? 's' : ''}</div>
          <div className={styles.groupStat}>{g.pct} % de l'activité</div>
          <button
            className={styles.groupFilterBtn}
            onClick={() => onFilter(activeGroup === g.sigle ? null : g.sigle)}
          >
            {activeGroup === g.sigle ? 'Tous les groupes' : 'Explorer ce groupe'}
          </button>
        </div>
        )
      })}
    </div>
  )
}

export default function ResultsList({ results, groupStats, loading, searched, onSelectParlementaire, activeDocView, onTotalClick, onCloseDocView, parlIndex, keywords }) {
  const [activeGroup, setActiveGroup] = useState(null)

  const totals = useMemo(() => results.reduce((acc, p) => ({
    amendements: acc.amendements + (p.amendements_count ?? 0),
    questions: acc.questions + (p.questions_count ?? 0),
    interventions: acc.interventions + (p.interventions_count ?? 0),
    dossiers: acc.dossiers + (p.dossiers_count ?? 0),
  }), { amendements: 0, questions: 0, interventions: 0, dossiers: 0 }), [results])

  if (loading) {
    return (
      <div className={styles.stateWrapper}>
        <div className={styles.loadingGrid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
        <p className={styles.loadingText}>Analyse en cours…</p>
      </div>
    )
  }

  if (!searched) {
    return (
      <div className={styles.stateWrapper}>
        <div className={styles.emptyIcon}></div>
        <p className={styles.emptyTitle}>Cherchez une thématique parlementaire</p>
        <p className={styles.emptyText}>
          Ex : rénovation énergétique, intelligence artificielle, santé mentale, immigration…
        </p>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className={styles.stateWrapper}>
        <div className={styles.emptyIcon}></div>
        <p className={styles.emptyTitle}>Aucun résultat</p>
        <p className={styles.emptyText}>
          Aucun parlementaire trouvé pour cette thématique. Essayez avec d&apos;autres mots-clés.
        </p>
      </div>
    )
  }

  const displayed = activeGroup ? results.filter(p => p.groupe_sigle === activeGroup) : results

  return (
    <div className={styles.wrapper}>
      <GroupSummary groupStats={groupStats} activeGroup={activeGroup} onFilter={setActiveGroup} />
      <div className={styles.totalsBar}>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'amendements' ? styles.totalItemActive : ''}`}
          onClick={() => activeDocView?.type === 'amendements' ? onCloseDocView() : onTotalClick('amendements')}
        >
          <strong>{totals.amendements}</strong> amendements
        </button>
        <span className={styles.totalSep}>·</span>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'questions' ? styles.totalItemActive : ''}`}
          onClick={() => activeDocView?.type === 'questions' ? onCloseDocView() : onTotalClick('questions')}
        >
          <strong>{totals.questions}</strong> questions écrites
        </button>
        <span className={styles.totalSep}>·</span>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'interventions' ? styles.totalItemActive : ''}`}
          onClick={() => activeDocView?.type === 'interventions' ? onCloseDocView() : onTotalClick('interventions')}
        >
          <strong>{totals.interventions}</strong> interventions
        </button>
        <span className={styles.totalSep}>·</span>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'dossiers' ? styles.totalItemActive : ''}`}
          onClick={() => activeDocView?.type === 'dossiers' ? onCloseDocView() : onTotalClick('dossiers')}
        >
          <strong>{totals.dossiers}</strong> dossiers
        </button>
      </div>

      {activeDocView ? (
        <DocView
          activeDocView={activeDocView}
          parlIndex={parlIndex}
          keywords={keywords}
          onClose={onCloseDocView}
        />
      ) : (
        <>
          <p className={styles.count}>
            {displayed.length} parlementaire{displayed.length > 1 ? 's' : ''} trouvé{displayed.length > 1 ? 's' : ''}
            {activeGroup && <span className={styles.filterTag}> — {activeGroup} <button className={styles.filterReset} onClick={() => setActiveGroup(null)}>×</button></span>}
          </p>
          <div className={styles.list}>
            {displayed.map((p, i) => (
              <ParlementaireCard key={p.id} parlementaire={p} rank={i + 1} onClick={() => onSelectParlementaire(p)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
