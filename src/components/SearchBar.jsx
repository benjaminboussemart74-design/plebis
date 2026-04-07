import { useState } from 'react'
import styles from './SearchBar.module.css'

const ORIENTATIONS = [
  { value: '', label: 'Toutes orientations' },
  { value: 'gauche', label: 'Gauche' },
  { value: 'centre', label: 'Centre' },
  { value: 'droite', label: 'Droite' },
]

const CHAMBRES = [
  { value: '', label: 'Toutes chambres' },
  { value: 'AN', label: 'Assemblée nationale' },
  { value: 'Senat', label: 'Sénat' },
]

export default function SearchBar({ onSearch, loading }) {
  const [query, setQuery] = useState('')
  const [orientation, setOrientation] = useState('')
  const [chambre, setChambre] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    onSearch({ query: q, orientation: orientation || null, chambre: chambre || null })
  }

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

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={orientation}
          onChange={(e) => setOrientation(e.target.value)}
          disabled={loading}
        >
          {ORIENTATIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          className={styles.select}
          value={chambre}
          onChange={(e) => setChambre(e.target.value)}
          disabled={loading}
        >
          {CHAMBRES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
    </form>
  )
}
