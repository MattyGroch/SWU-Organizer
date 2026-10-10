import { useLayoutEffect, type RefObject } from 'react';

/**
 * Publishes, as `--fill-height` on the element, the height that would take it from where
 * it sits on the page (scrolled to the top) down to the bottom of the window, less
 * `bottomGap`. A scroll box can then use it as its max-height and fill a tall window
 * instead of stopping at a fixed size. Kept current as the window resizes or anything
 * above the element grows or shrinks (filters opening, the header wrapping). Pass
 * `mounted` when the element can come and go, so it is measured again when it returns.
 */
export function useFillViewport(
  ref: RefObject<HTMLElement | null>,
  mounted = true,
  bottomGap = 16,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty(
        '--fill-height',
        `${Math.round(window.innerHeight - top - bottomGap)}px`,
      );
    };
    publish();
    window.addEventListener('resize', publish);
    // The page's size changes when something above the element does. Setting the
    // element's own max-height resizes the page too, but leaves its top (and so the
    // value) where it was, so this settles after one pass.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', publish);
      observer?.disconnect();
    };
  }, [ref, mounted, bottomGap]);
}
