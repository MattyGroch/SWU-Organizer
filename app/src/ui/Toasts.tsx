import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ToastContext, type ShowToast, type Toast } from './toastContext';
import styles from './Toasts.module.css';

const DEFAULT_DURATION_MS = 4000;
/** Long enough to actually reach for undo after a destructive action. */
const ACTION_DURATION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    ({ durationMs, ...toast }) => {
      const id = (nextId.current += 1);
      setToasts((current) => [...current, { ...toast, id }]);

      const timeout = durationMs ?? (toast.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), timeout),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className={styles.toast} data-tone={toast.tone} role="status">
            <span className={styles.message}>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  void toast.action?.onAction();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className={styles.close}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
