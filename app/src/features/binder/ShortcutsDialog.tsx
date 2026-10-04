import { useEffect, useRef } from 'react';

import { VARIANTS, variantHotkey, variantLabel } from '~/domain/catalog';

import { SHORTCUT_HELP } from './shortcuts';
import styles from './ShortcutsDialog.module.css';

/** Every binder shortcut, opened with `?` or the toolbar button. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="shortcuts-title"
    >
      <div className={styles.header}>
        <h2 id="shortcuts-title" className={styles.title}>
          Keyboard shortcuts
        </h2>
        <button type="button" className={styles.close} onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </div>

      <div className={styles.body}>
        {SHORTCUT_HELP.map((group) => (
          <section key={group.title} className={styles.group}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            <dl className={styles.list}>
              {group.items.map((item) => (
                <div key={item.action} className={styles.row}>
                  <dt className={styles.keys}>
                    {item.keys.map((key) => (
                      <kbd key={key} className={styles.kbd}>
                        {key}
                      </kbd>
                    ))}
                  </dt>
                  <dd className={styles.action}>{item.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>Printing digits</h3>
          <dl className={styles.digits}>
            {VARIANTS.map((variant) => (
              <div key={variant} className={styles.row}>
                <dt className={styles.keys}>
                  <kbd className={styles.kbd}>{variantHotkey(variant)}</kbd>
                </dt>
                <dd className={styles.action}>{variantLabel(variant)}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.note}>
            A digit does nothing for a card without that printing. Shortcuts are paused while typing
            in a field or while a dialog is open.
          </p>
        </section>
      </div>
    </dialog>
  );
}
