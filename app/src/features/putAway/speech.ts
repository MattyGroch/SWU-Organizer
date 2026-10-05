import { useCallback, useEffect } from 'react';

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Reads a step aloud with the device's own voice, so the screen is a back-up rather than
 * the only way to follow along. Each new line cuts off the last: stepping quickly never
 * queues a backlog of speech.
 *
 * `speak(text, onDone)` calls `onDone` once the line has been read — straight away when
 * speech is off — and returns a function that cancels it, after which `onDone` never fires.
 */
export function useSpeech(enabled: boolean): (text: string, onDone?: () => void) => () => void {
  useEffect(() => {
    if (!supported()) return;
    if (!enabled) window.speechSynthesis.cancel();
    return () => window.speechSynthesis.cancel();
  }, [enabled]);

  return useCallback(
    (text: string, onDone?: () => void) => {
      let finished = false;
      const timers: number[] = [];
      const done = () => {
        if (finished) return;
        finished = true;
        timers.forEach((t) => window.clearTimeout(t));
        onDone?.();
      };
      if (!enabled || !supported()) {
        timers.push(window.setTimeout(done, 0));
      } else {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = done;
        utterance.onerror = done;
        window.speechSynthesis.speak(utterance);
        // Some phones never report the end of a line: allow a generous reading time instead.
        timers.push(window.setTimeout(done, 1500 + text.length * 90));
      }
      return () => {
        finished = true;
        timers.forEach((t) => window.clearTimeout(t));
      };
    },
    [enabled],
  );
}

export const speechSupported = supported;

/** Keeps the screen on while `active` — the phone sits on the table, untouched. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let released = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (released) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    acquire();
    // The lock lapses when the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
