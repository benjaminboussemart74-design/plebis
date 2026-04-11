import { useState } from 'react'
import styles from './SearchBar.module.css'

const AI_LABELS = {
  on:  { label: 'Expansion IA', desc: 'L\'IA génère des synonymes et acronymes législatifs pour élargir la recherche.' },
  off: { label: 'Recherche exacte', desc: 'Recherche sur les mots saisis uniquement, sans interprétation.' },
}

export default function SearchBar({ onSearch, loading }) {
  const [query, setQuery] = useState('')
  const [useAI, setUseAI] = useState(true)

  function handleSubmit(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    onSearch({ query: q, orientation: null, chambre: null, useAI })
  }

  const current = useAI ? AI_LABELS.on : AI_LABELS.off

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.searchRow}>
        <input
          className={styles.input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Recherchez une thématique parlementaire…"
          disabled={loading}
          autoFocus
        />
        <button className={styles.button} type="submit" disabled={loading || !query.trim()}>
          {loading ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : (
            'Rechercher'
          )}
        </button>
      </div>

      <div className={styles.aiRow}>
        <button
          type="button"
          className={`${styles.aiToggle} ${useAI ? styles.aiOn : styles.aiOff}`}
          onClick={() => setUseAI(!useAI)}
          disabled={loading}
        >
          <span className={styles.aiDot} />
          {current.label}
        </button>
        <span className={styles.aiDesc}>{current.desc}</span>
      </div>
    </form>
  )
}
