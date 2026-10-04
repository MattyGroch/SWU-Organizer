import { createContext, useContext } from 'react';

/**
 * Transient notifications, with an optional action.
 *
 * Exists mainly so destructive keyboard shortcuts can offer undo instead of a
 * confirmation dialog — a prompt would interrupt the fast pack-filing flow those
 * shortcuts are for, while silently discarding a slot is worse.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type ToastAction = {
  label: string;
  onAction: () => void | Promise<void>;
};

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};

export type ShowToast = (toast: Omit<Toast, 'id'> & { durationMs?: number }) => void;

export const ToastContext = createContext<ShowToast | null>(null);

const noop: ShowToast = () => {};

/** No-ops when no provider is mounted, so components stay renderable in isolation. */
export function useToast(): ShowToast {
  return useContext(ToastContext) ?? noop;
}
