import styles from './KeywordsDisplay.module.css'

export default function KeywordsDisplay({ keywords, query }) {
  if (!keywords || keywords.length === 0) return null

  const displayed = keywords.filter((k) => k.toLowerCase() !== query.toLowerCase())

  if (displayed.length === 0) return null

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>Termes recherchés :</span>
      {displayed.map((kw, i) => (
        <span key={i} className={styles.keyword}>{kw}</span>
      ))}
    </div>
  )
}
