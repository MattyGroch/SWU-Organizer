import { useCallback, useEffect } from 'react';

/**
 * Reads a step aloud with the device's own voice, so the screen is a back-up rather than
 * the only way to follow along. Each new line cuts off the last: a quick tap through the
 * steps never queues a backlog of speech.
 */
export function useSpeech(enabled: boolean): (text: string) => void {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (!supported) return;
    if (!enabled) window.speechSynthesis.cancel();
    return () => window.speechSynthesis.cancel();
  }, [enabled, supported]);

  return useCallback(
    (text: string) => {
      if (!enabled || !supported) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    },
    [enabled, supported],
  );
}

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
