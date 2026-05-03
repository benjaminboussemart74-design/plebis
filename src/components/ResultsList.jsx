import { useState, useMemo } from 'react'
import ParlementaireCard from './ParlementaireCard'
import styles from './ResultsList.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'

function GroupSummary({ groupStats, activeGroup, onFilter }) {
  if (!groupStats || groupStats.length === 0) return null

  return (
    <>
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
      <p className={styles.groupMethodNote}>
        Une <strong>action</strong> = un document parlementaire (amendement, question écrite, intervention en séance ou dossier législatif) lié aux mots-clés de la recherche. Le <strong>% de l'activité</strong> représente la part du groupe dans le total des actions trouvées. Données : AN 17e législature.
      </p>
    </>
  )
}

export default function ResultsList({ results, loading, searched, onSelectParlementaire, activeDocView, onTotalClick, parlIndex, keywords, docCounts }) {
  const [activeGroup, setActiveGroup] = useState(null)
  const activeDocType = activeDocView?.type ?? null

  const groupStats = useMemo(() => {
    const totalScore = results.reduce((sum, p) => sum + (p.score ?? 0), 0)
    const grouped = results.reduce((acc, p) => {
      const key = p.groupe_sigle
      if (!acc[key]) {
        acc[key] = { sigle: p.groupe_sigle, libelle: p.groupe_libelle, couleur: p.couleur_groupe, totalScore: 0, count: 0 }
      }
      acc[key].totalScore += p.score ?? 0
      acc[key].count += 1
      return acc
    }, {})
    return Object.values(grouped)
      .map(g => ({
        ...g,
        avgScore: Math.round(g.totalScore / g.count),
        pct: totalScore > 0 ? Math.round((g.totalScore / totalScore) * 100) : 0,
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
  }, [results])

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
  const counts = docCounts ?? { amendements: 0, questions: 0, interventions: 0, dossiers: 0 }

  return (
    <div className={styles.wrapper}>
      <GroupSummary groupStats={groupStats} activeGroup={activeGroup} onFilter={setActiveGroup} />
      <div className={styles.totalsBar}>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'amendements' ? styles.totalItemActive : ''}`}
          onClick={() => onTotalClick('amendements')}
        >
          <strong>{counts.amendements}</strong> amendements
        </button>
        <span className={styles.totalSep}>·</span>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'questions' ? styles.totalItemActive : ''}`}
          onClick={() => onTotalClick('questions')}
        >
          <strong>{counts.questions}</strong> questions écrites
        </button>
        <span className={styles.totalSep}>·</span>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'interventions' ? styles.totalItemActive : ''}`}
          onClick={() => onTotalClick('interventions')}
        >
          <strong>{counts.interventions}</strong> interventions
        </button>
        <span className={styles.totalSep}>·</span>
        <button
          className={`${styles.totalItem} ${activeDocView?.type === 'dossiers' ? styles.totalItemActive : ''}`}
          onClick={() => onTotalClick('dossiers')}
        >
          <strong>{counts.dossiers}</strong> dossiers
        </button>
      </div>

      <p className={styles.count}>
        {displayed.length} député{displayed.length > 1 ? 's' : ''} trouvé{displayed.length > 1 ? 's' : ''}
        {activeGroup && (
          <span className={styles.filterTag}>
            {' '}— {activeGroup}{' '}
            <button className={styles.filterReset} onClick={() => setActiveGroup(null)}>×</button>
          </span>
        )}
      </p>
      <div className={styles.list}>
        {displayed.map((p, i) => (
          <ParlementaireCard key={p.id} parlementaire={p} rank={i + 1} onClick={() => onSelectParlementaire(p)} />
        ))}
      </div>
    </div>
  )
}
