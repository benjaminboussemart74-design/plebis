import styles from './ParlementaireCard.module.css'

const CHAMBRE_LABEL = { AN: 'Assemblée nationale', Senat: 'Sénat' }

const PROXY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/an-proxy`

function photoProxyUrl(id) {
  return id ? `${PROXY}?type=photo&id=${id}` : null
}

export default function ParlementaireCard({ parlementaire, rank, onClick }) {
  const {
    id, nom, prenom, chambre, groupe_sigle, groupe_libelle,
    couleur_groupe, circonscription, score, scorePct,
  } = parlementaire

  const proxiedPhoto = photoProxyUrl(id)
  const initials = `${prenom?.[0] ?? ''}${nom?.[0] ?? ''}`.toUpperCase()

  return (
    <article className={styles.card} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className={styles.rank}>#{rank}</div>

      <div className={styles.avatar}>
        {proxiedPhoto ? (
          <img
            src={proxiedPhoto}
            alt={`${prenom} ${nom}`}
            crossOrigin="anonymous"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div
          className={styles.initials}
          style={{ display: proxiedPhoto ? 'none' : 'flex', background: couleur_groupe ?? '#888' }}
        >
          {initials}
        </div>
      </div>

      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{prenom} {nom}</span>
          <span
            className={styles.groupe}
            style={{ background: couleur_groupe ?? '#888' }}
            title={groupe_libelle}
          >
            {groupe_sigle}
          </span>
        </div>

        <div className={styles.meta}>
          <span className={styles.chambre}>{CHAMBRE_LABEL[chambre] ?? chambre}</span>
          {circonscription && (
            <span className={styles.circ}> · {circonscription}</span>
          )}
        </div>

        <div className={styles.scoreRow}>
          <div className={styles.scoreBar}>
            <div
              className={styles.scoreFill}
              style={{ width: `${scorePct}%`, background: couleur_groupe ?? 'var(--color-accent)' }}
            />
          </div>
          <span className={styles.scoreValue}>
            {score} amendement{score > 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </article>
  )
}
