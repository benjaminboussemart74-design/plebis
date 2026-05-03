import styles from './KeywordsDisplay.module.css'

export default function KeywordsDisplay({ keywords, query }) {
  if (!keywords || keywords.length === 0) return null

  const expanded = keywords.filter((k) => k.toLowerCase() !== query.toLowerCase())

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>Résultats pour</span>
      <span className={styles.queryWord}>{query}</span>
      {expanded.length > 0 && (
        <>
          <span className={styles.label}>— termes associés :</span>
          {expanded.map((kw, i) => (
            <span key={i} className={styles.keyword}>{kw}</span>
          ))}
        </>
      )}
    </div>
  )
}
