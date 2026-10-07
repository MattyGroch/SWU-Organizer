import styles from './UniqueMark.module.css';

/**
 * The unique-card star printed before a unique character's name, from the Star Wars:
 * Unlimited rulebook (see src/assets/aspects/CREDITS.md). Takes the text colour; decorative.
 */
export function UniqueMark() {
  return (
    <svg className={styles.mark} viewBox="28 225 700 700" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M728 581q-138 0 -241 103t-103 241h-12q0 -138 -103 -241t-241 -103v-12q138 0 241 -103t103 -241h12q0 138 103 241t241 103v12zM332 621q30 30 46 63q16 -33 46 -63t63 -46q-33 -16 -63 -46t-46 -63q-8 17 -20 32.5t-26 30.5q-30 30 -63 46q33 16 63 46z"
      />
    </svg>
  );
}
