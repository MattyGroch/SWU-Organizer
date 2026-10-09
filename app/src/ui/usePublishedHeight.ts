import { useLayoutEffect, useRef } from 'react';

/**
 * Publishes an element's height as a CSS custom property on the root (e.g.
 * `--app-header-height`), so anything else pinned to the top of the page can sit just
 * below it. Kept current as the element wraps or grows; removed when it unmounts.
 */
export function usePublishedHeight<T extends HTMLElement>(property: `--${string}`) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(property, `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty(property);
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(property);
    };
  }, [property]);
  return ref;
}
