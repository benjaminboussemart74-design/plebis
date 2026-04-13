import { useState } from 'react'
import s from './ThemeNav.module.css'

export default function ThemeNav({ themes, onSearch }) {
  const [activeIndex, setActiveIndex] = useState(null)

  function handleCatClick(i) {
    setActiveIndex(prev => (prev === i ? null : i))
  }

  const activeCat = activeIndex !== null ? themes[activeIndex] : null

  return (
    <div className={s.root}>
      <div className={s.header}>
        <span className={s.label}>Parcourir par thème</span>
      </div>

      <div className={s.catRow}>
        {themes.map((cat, i) => (
          <button
            key={cat.label}
            className={`${s.catBtn} ${activeIndex === i ? s.catActive : ''}`}
            onClick={() => handleCatClick(i)}
            aria-pressed={activeIndex === i}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {activeCat && (
        <div className={s.subRow}>
          <span className={s.subLabel}>{activeCat.label} —</span>
          {activeCat.sub.map(sub => (
            <button
              key={sub.label}
              className={s.subBtn}
              onClick={() =>
                onSearch({
                  query: sub.label,
                  keywords: sub.keywords,
                  orientation: null,
                  chambre: null,
                  useAI: false,
                })
              }
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
