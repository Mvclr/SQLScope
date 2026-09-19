import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.main}>
      <svg className={styles.mark} viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M5 24h9l4-10 6 20 5-14 3 4h11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <h1 className={styles.title}>SQLScope</h1>
      <p className={styles.tagline}>Build it. Query it. Break it. Secure it.</p>
      <p className={styles.status}>Em construção — Fase 0.</p>
    </main>
  );
}
