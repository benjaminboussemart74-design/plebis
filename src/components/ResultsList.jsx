import ParlementaireCard from './ParlementaireCard'
import styles from './ResultsList.module.css'

export default function ResultsList({ results, loading, searched, onSelectParlementaire }) {
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

  return (
    <div className={styles.wrapper}>
      <p className={styles.count}>
        {results.length} parlementaire{results.length > 1 ? 's' : ''} trouvé{results.length > 1 ? 's' : ''}
      </p>
      <div className={styles.list}>
        {results.map((p, i) => (
          <ParlementaireCard key={p.id} parlementaire={p} rank={i + 1} onClick={() => onSelectParlementaire(p)} />
        ))}
      </div>
    </div>
  )
}
