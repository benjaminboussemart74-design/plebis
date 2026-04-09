import { useState } from 'react'
import ParlementaireCard from './ParlementaireCard'
import styles from './ResultsList.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'

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

export default function ResultsList({ results, groupStats, loading, searched, onSelectParlementaire }) {
  const [activeGroup, setActiveGroup] = useState(null)

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
        <div className={styles.emptyIcon}>🏛️</div>
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
        <div className={styles.emptyIcon}>🔍</div>
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
      <p className={styles.count}>
        {displayed.length} parlementaire{displayed.length > 1 ? 's' : ''} trouvé{displayed.length > 1 ? 's' : ''}
        {activeGroup && <span className={styles.filterTag}> — {activeGroup} <button className={styles.filterReset} onClick={() => setActiveGroup(null)}>×</button></span>}
      </p>
      <div className={styles.list}>
        {displayed.map((p, i) => (
          <ParlementaireCard key={p.id} parlementaire={p} rank={i + 1} onClick={() => onSelectParlementaire(p)} />
        ))}
      </div>
    </div>
  )
}
