import styles from './Header.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <h1 className={styles.logo}>
          Plé<span className={styles.accent}>bis</span>
        </h1>
        <p className={styles.tagline}>
          Moteur de recherche des parlementaires français par thématique
        </p>
      </div>
      <div className={styles.filet} />
    </header>
  )
}
