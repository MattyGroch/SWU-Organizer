import type { MoveDirection } from '~/domain/binder';

/**
 * The app's keyboard contract, as data.
 *
 * Expressed as a pure `keydown` → intent mapping so the whole shortcut surface is
 * testable without rendering anything. The legacy app spread this across two overlapping
 * `window.addEventListener('keydown')` effects in App.tsx that both re-registered on
 * every selection change, and whose `isTyping` guards had drifted apart.
 */

export type BinderIntent =
  | { type: 'focusSearch' }
  | { type: 'submitSearch' }
  | { type: 'clearSelection' }
  | { type: 'move'; direction: MoveDirection }
  | { type: 'adjustDefault'; delta: number }
  | { type: 'adjustVariant'; hotkey: number; delta: number }
  /** Shift+plus — top the default printing up to a full playset. */
  | { type: 'fillPlayset' }
  /** Shift+minus — empty the slot entirely. Undoable. */
  | { type: 'clearSlot' }
  | { type: 'stepSpread'; delta: number }
  | { type: 'stepSet'; delta: number };

export type KeyContext = {
  /** Focus is in a text field, so the key belongs to that field. */
  typing: boolean;
  hasSelection: boolean;
  hasQuery: boolean;
};

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  // `isContentEditable` is not implemented on every element in every engine, so coerce
  // rather than returning whatever it happens to be.
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!element.isContentEditable;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

const DIRECTIONS: Record<string, MoveDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * Resolves a keypress to an intent, or null to let it through.
 *
 * `+` and `-` stay bound to the card's default (Normal) printing so existing muscle
 * memory for opening packs is untouched; the digits add variant precision on top.
 */
export function resolveShortcut(event: KeyLike, context: KeyContext): BinderIntent | null {
  // Never steal a browser or OS chord.
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  if (context.typing) return null;

  if (event.key === '/') return { type: 'focusSearch' };
  if (event.key === 'Enter') return context.hasQuery ? { type: 'submitSearch' } : null;
  if (event.key === 'Escape') return { type: 'clearSelection' };

  if (event.key === ',' || event.key === '<') return { type: 'stepSpread', delta: -1 };
  if (event.key === '.' || event.key === '>') return { type: 'stepSpread', delta: 1 };
  if (event.key === '[') return { type: 'stepSet', delta: -1 };
  if (event.key === ']') return { type: 'stepSet', delta: 1 };

  if (!context.hasSelection) return null;

  const direction = DIRECTIONS[event.key];
  if (direction) return { type: 'move', direction };

  // Matched on both key and code: on a US layout "+" is only reachable as Shift+Equal and
  // Shift+Minus reports "_", so the physical key is the reliable signal. Shift turns each
  // into its bulk form, mirroring how Shift+digit decrements a variant.
  const plusKey =
    event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd';
  const minusKey =
    event.key === '-' ||
    event.key === '_' ||
    event.code === 'Minus' ||
    event.code === 'NumpadSubtract';

  if (plusKey) {
    return event.shiftKey ? { type: 'fillPlayset' } : { type: 'adjustDefault', delta: 1 };
  }
  if (minusKey) {
    return event.shiftKey ? { type: 'clearSlot' } : { type: 'adjustDefault', delta: -1 };
  }

  // Digits 1-8 target a specific printing; Shift decrements it.
  // `event.code` is used so the mapping survives non-US layouts, where Shift+1 is not "!".
  const digitMatch = /^Digit([1-8])$/.exec(event.code) ?? /^Numpad([1-8])$/.exec(event.code);
  if (digitMatch?.[1]) {
    return { type: 'adjustVariant', hotkey: Number(digitMatch[1]), delta: event.shiftKey ? -1 : 1 };
  }

  return null;
}
