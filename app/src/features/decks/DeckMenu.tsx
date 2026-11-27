import { useEffect, useRef, type ReactNode } from 'react';

import styles from './DeckMenu.module.css';

/**
 * A small "more actions" menu: a native <details> that closes on an outside click, on
 * Escape, and after any item inside it is used.
 */
export function DeckMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'click' && el.contains(event.target as Node)) return;
      el.open = false;
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <details ref={ref} className={styles.menu}>
      <summary className={styles.trigger} aria-label={label} title={label}>
        <span aria-hidden="true">⋯</span>
      </summary>
      {/* Items close the menu once clicked. */}
      <div
        className={styles.items}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, a') && ref.current) {
            ref.current.open = false;
          }
        }}
      >
        {children}
      </div>
    </details>
  );
}
