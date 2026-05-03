import { useState, useEffect, useRef } from 'react'
import { fetchTopAmendeurs, fetchTopQuestionneurs, fetchTopEfficaces } from '../lib/search'
import { getGroupeLogo } from '../lib/groupeLogos'
import s from './LandingHero.module.css'

const SUGGESTION_GROUPS = [
  ['transition énergétique', 'immigration', 'réforme des retraites', 'intelligence artificielle', 'logement social'],
  ['souveraineté industrielle', 'dette publique', 'violences conjugales', 'agriculture biologique', 'désinformation'],
  ['santé mentale', 'déserts médicaux', 'nucléaire civil', 'fin de vie', 'fracture numérique'],
  ['sécurité intérieure', 'laïcité', 'féminisme', 'commerce équitable', 'chômage des jeunes'],
]

const STATS = [
  { value: 577,   label: 'députés' },
  { value: 99583, label: 'amendements' },
  { value: 12400, label: 'questions écrites' },
  { value: 34700, label: 'interventions en séance' },
]

function useCountUp(target, duration = 1600) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let start = null
    let raf
    function step(timestamp) {
      if (!start) start = timestamp
      const progress = Math.min((timestamp - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * target))
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return count
}

function StatItem({ value, label }) {
  const count = useCountUp(value)
  return (
    <div className={s.statItem}>
      <span className={s.statNum}>{count.toLocaleString('fr-FR')}</span>
      <span className={s.statLabel}>{label}</span>
    </div>
  )
}

function Avatar({ nom, prenom, photo_url, couleur_groupe, className }) {
  const [imgError, setImgError] = useState(false)
  const initials = `${(prenom?.[0] ?? '')}${(nom?.[0] ?? '')}`.toUpperCase()

  if (photo_url && !imgError) {
    return (
      <img
        src={photo_url}
        alt={`${prenom} ${nom}`}
        className={`${s.photo} ${className ?? ''}`}
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <div
      className={`${s.initials} ${className ?? ''}`}
      style={{ background: couleur_groupe ?? 'var(--color-accent)' }}
    >
      {initials}
    </div>
  )
}

function PodiumItem({ item, rank, metric }) {
  return (
    <div className={`${s.podiumItem} ${rank === 1 ? s.rank1 : ''}`}>
      <span className={s.rank}>{rank}</span>
      <Avatar
        nom={item.nom}
        prenom={item.prenom}
        photo_url={item.photo_url}
        couleur_groupe={item.couleur_groupe}
      />
      <div className={s.info}>
        <div className={s.name}>{item.prenom} {item.nom}</div>
        <div className={s.groupeRow}>
          {getGroupeLogo(item.groupe_sigle) && (
            <img src={getGroupeLogo(item.groupe_sigle)} alt="" className={s.groupeLogo} />
          )}
          <span className={s.groupe}>{item.groupe_sigle}</span>
        </div>
      </div>
      <span className={s.metric}>{metric}</span>
    </div>
  )
}

function RankingColumn({ title, methodology, items, metricFn, loading, onSeeAll }) {
  if (loading) {
    return (
      <div className={s.column}>
        <div className={s.columnTitle}>{title}</div>
        <div className={s.methodology}>&nbsp;</div>
        {[1, 2, 3].map(i => (
          <div key={i} className={s.podiumItem}>
            <div className={s.skeleton} style={{ width: 18, height: 14 }} />
            <div className={`${s.skeleton} ${s.photo}`} />
            <div className={s.info}>
              <div className={s.skeleton} style={{ height: 13, width: '70%', marginBottom: 4 }} />
              <div className={s.skeleton} style={{ height: 11, width: '40%' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={s.column}>
      <div className={s.columnTitle}>{title}</div>
      <div className={s.methodology}>{methodology}</div>
      {items.slice(0, 3).map((item, i) => (
        <PodiumItem key={item.parlementaire_id} item={item} rank={i + 1} metric={metricFn(item)} />
      ))}
      <button className={s.seeAllBtn} onClick={onSeeAll}>
        Voir les 577 députés →
      </button>
    </div>
  )
}

function RankingModal({ title, items, metricFn, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={s.modalBackdrop} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        <div className={s.modalHeader}>
          <span className={s.modalTitle}>{title}</span>
          <button className={s.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={s.modalList}>
          {items.map((item, i) => (
            <div key={item.parlementaire_id} className={s.modalItem}>
              <span className={s.modalRank}>{i + 1}</span>
              <Avatar
                nom={item.nom}
                prenom={item.prenom}
                photo_url={item.photo_url}
                couleur_groupe={item.couleur_groupe}
              />
              <div className={s.info}>
                <div className={s.name}>{item.prenom} {item.nom}</div>
                <div className={s.groupeRow}>
                  {getGroupeLogo(item.groupe_sigle)
                    ? <img src={getGroupeLogo(item.groupe_sigle)} alt={item.groupe_sigle} className={s.groupeLogo} />
                    : <span className={s.groupe}>{item.groupe_sigle}</span>
                  }
                </div>
              </div>
              <span className={s.modalMetric}>{metricFn(item)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function LandingHero({ onSearch }) {
  const [displayIndex, setDisplayIndex] = useState(0)
  const [fading, setFading] = useState(false)
  const [amendeurs, setAmendeurs] = useState([])
  const [questionneurs, setQuestionneurs] = useState([])
  const [efficaces, setEfficaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const intervalRef = useRef(null)
  const fadeTimerRef = useRef(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFading(true)
      fadeTimerRef.current = setTimeout(() => {
        setDisplayIndex(i => (i + 1) % SUGGESTION_GROUPS.length)
        setFading(false)
      }, 250)
    }, 4500)
    return () => {
      clearInterval(intervalRef.current)
      clearTimeout(fadeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    Promise.all([
      fetchTopAmendeurs(577),
      fetchTopQuestionneurs(577),
      fetchTopEfficaces(577),
    ])
      .then(([a, q, e]) => {
        setAmendeurs(a)
        setQuestionneurs(q)
        setEfficaces(e)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const columns = [
    {
      key: 'amendeurs',
      title: 'Amendements déposés',
      methodology: 'Nombre total d\'amendements déposés par le député depuis le début de la 17e législature (juillet 2024), tous textes confondus.',
      items: amendeurs,
      metricFn: item => Number(item.nb).toLocaleString('fr-FR'),
    },
    {
      key: 'questionneurs',
      title: 'Questions écrites',
      methodology: 'Nombre de questions écrites adressées au gouvernement depuis le début de la 17e législature (juillet 2024). Instrument de contrôle parlementaire individuel.',
      items: questionneurs,
      metricFn: item => Number(item.nb).toLocaleString('fr-FR'),
    },
    {
      key: 'efficaces',
      title: 'Taux d\'adoption',
      methodology: 'Part des amendements adoptés en séance sur le total déposé. Calculé uniquement pour les députés ayant déposé au moins 10 amendements.',
      items: efficaces,
      metricFn: item => `${Math.round(Number(item.ratio) * 100)} %`,
    },
  ]

  const activeModal = columns.find(c => c.key === modal)
  const currentGroup = SUGGESTION_GROUPS[displayIndex]

  return (
    <div className={s.hero}>
      <div className={s.suggestionsSection}>
        <span className={s.suggestionsLabel}>Explorer&nbsp;:</span>
        <div className={`${s.suggestionsGrid} ${fading ? s.suggestionsGridFading : ''}`}>
          {currentGroup.map((theme, i) => (
            <button
              key={theme}
              className={s.pill}
              style={{ animationDelay: `${i * 40}ms` }}
              onClick={() => onSearch({ query: theme, orientation: null, chambre: null })}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>

      <div className={s.statsBar}>
        {STATS.map(({ value, label }) => (
          <StatItem key={label} value={value} label={label} />
        ))}
      </div>

      <div className={s.rankingSection}>
        <div className={s.rankingTitle}>Classements — 17e législature</div>
        <div className={s.columns}>
          {columns.map(col => (
            <RankingColumn
              key={col.key}
              title={col.title}
              methodology={col.methodology}
              items={col.items}
              metricFn={col.metricFn}
              loading={loading}
              onSeeAll={() => setModal(col.key)}
            />
          ))}
        </div>
      </div>

      {activeModal && (
        <RankingModal
          title={activeModal.title}
          items={activeModal.items}
          metricFn={activeModal.metricFn}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
