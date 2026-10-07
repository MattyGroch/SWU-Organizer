import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import styles from './SwipePage.module.css';

type Props = {
  /**
   * The page on screen; when it changes, the new page slides in from that side. A swipe
   * sets the side itself, so a list that wraps (last set → first) still slides the way
   * the finger went.
   */
  page: number;
  canPrev: boolean;
  canNext: boolean;
  onStep: (delta: 1 | -1) => void;
  children: ReactNode;
};

/** A drag this far across the page (or a quick flick) turns it; anything less springs back. */
const TURN_FRACTION = 0.25;
const FLICK_SPEED = 0.5; // px per ms
/** How far a finger must move before the gesture counts as a drag rather than a tap. */
const DEAD_ZONE = 8;
/** Past the first or last page the page still moves, but only this much of the drag. */
const EDGE_RESISTANCE = 0.3;
const TURN_MS = 180;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);

/**
 * One binder page that follows the finger: drag it sideways and it moves with you; let go
 * past a quarter of the width (or flick) and it slides off while the next page slides in;
 * let go short of that and it springs back. The buttons and the page picker get the same
 * slide. With reduced motion asked for, pages simply change.
 *
 * Vertical drags are left to the browser, so the page still scrolls, and a drag never
 * counts as a tap on the card under the finger.
 */
export function SwipePage({ page, canPrev, canNext, onStep, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    t: number;
    axis: 'x' | 'y' | null;
  } | null>(null);
  /** Set once a drag moves, so the click that ends it does not select a card. */
  const dragged = useRef(false);
  const turning = useRef(false);
  const previous = useRef(page);
  /** The direction of the swipe that asked for the page now arriving. */
  const swiped = useRef<1 | -1 | null>(null);

  const width = () => ref.current?.offsetWidth || window.innerWidth;

  // A new page enters from the side it lies on: from the right going forward.
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = page;
    turning.current = false;
    const direction = swiped.current ?? (page > from ? 1 : -1);
    swiped.current = null;
    if (from === page || reducedMotion()) {
      setAnimate(false);
      setOffset(0);
      return;
    }
    setAnimate(false);
    setOffset(direction * width());
  }, [page]);

  // …then glides to rest on the next frame, once the starting position has painted.
  useEffect(() => {
    if (offset === 0 || animate || drag.current) return;
    const frame = requestAnimationFrame(() => {
      setAnimate(true);
      setOffset(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [offset, animate]);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (!touch || turning.current) return;
    drag.current = { x: touch.clientX, y: touch.clientY, t: event.timeStamp, axis: null };
    dragged.current = false;
    setAnimate(false);
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = drag.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!start.axis) {
      if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
      start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (start.axis !== 'x') return;
    dragged.current = true;
    const blocked = (dx > 0 && !canPrev) || (dx < 0 && !canNext);
    if (!reducedMotion()) setOffset(blocked ? dx * EDGE_RESISTANCE : dx);
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = drag.current;
    const touch = event.changedTouches[0];
    drag.current = null;
    if (!start || !touch || start.axis !== 'x') return;
    const dx = touch.clientX - start.x;
    const speed = Math.abs(dx) / Math.max(1, event.timeStamp - start.t);
    const direction: 1 | -1 = dx < 0 ? 1 : -1;
    const allowed = direction === 1 ? canNext : canPrev;
    const far = Math.abs(dx) > width() * TURN_FRACTION || speed > FLICK_SPEED;

    if (!allowed || !far) {
      setAnimate(true);
      setOffset(0);
      return;
    }
    if (reducedMotion()) {
      onStep(direction);
      return;
    }
    // Off it goes; the new page slides in from the far side once this one has left.
    turning.current = true;
    swiped.current = direction;
    setAnimate(true);
    setOffset(-direction * width());
    window.setTimeout(() => onStep(direction), TURN_MS);
  }

  return (
    <div className={styles.viewport}>
      <div
        ref={ref}
        className={styles.page}
        data-animate={animate}
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          opacity: offset ? Math.max(0.4, 1 - Math.abs(offset) / width()) : undefined,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(event) => {
          if (!dragged.current) return;
          dragged.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
