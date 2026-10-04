import { describe, expect, it } from 'vitest';

import { isTypingTarget, resolveShortcut, type KeyContext } from './shortcuts';

function key(init: Partial<KeyboardEvent> & { key: string }) {
  return {
    key: init.key,
    code: init.code ?? '',
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
  };
}

const selected: KeyContext = { typing: false, hasSelection: true, hasQuery: false };
const nothingSelected: KeyContext = { typing: false, hasSelection: false, hasQuery: false };

describe('isTypingTarget', () => {
  it('recognises text entry targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('recognises contenteditable', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(el, 'isContentEditable', { value: true });
    expect(isTypingTarget(el)).toBe(true);
  });
});

describe('resolveShortcut', () => {
  it('ignores everything while typing', () => {
    const typing = { typing: true, hasSelection: true, hasQuery: true };
    for (const k of ['/', 'Enter', 'ArrowLeft', '+', '.', '[']) {
      expect(resolveShortcut(key({ key: k }), typing)).toBeNull();
    }
  });

  it('never steals a browser chord', () => {
    expect(resolveShortcut(key({ key: '/', ctrlKey: true }), selected)).toBeNull();
    expect(resolveShortcut(key({ key: 'ArrowLeft', metaKey: true }), selected)).toBeNull();
    expect(resolveShortcut(key({ key: '1', code: 'Digit1', altKey: true }), selected)).toBeNull();
  });

  it('focuses search on slash regardless of selection', () => {
    expect(resolveShortcut(key({ key: '/' }), nothingSelected)).toEqual({ type: 'focusSearch' });
  });

  it('submits search on Enter only when there is a query', () => {
    expect(resolveShortcut(key({ key: 'Enter' }), nothingSelected)).toBeNull();
    expect(resolveShortcut(key({ key: 'Enter' }), { ...nothingSelected, hasQuery: true })).toEqual({
      type: 'submitSearch',
    });
  });

  it('clears the selection on Escape', () => {
    expect(resolveShortcut(key({ key: 'Escape' }), selected)).toEqual({ type: 'clearSelection' });
  });

  it('pages spreads with comma and period', () => {
    expect(resolveShortcut(key({ key: ',' }), nothingSelected)).toEqual({
      type: 'stepSpread',
      delta: -1,
    });
    expect(resolveShortcut(key({ key: '.' }), nothingSelected)).toEqual({
      type: 'stepSpread',
      delta: 1,
    });
    // Shifted variants on the same physical keys.
    expect(resolveShortcut(key({ key: '<' }), nothingSelected)).toEqual({
      type: 'stepSpread',
      delta: -1,
    });
    expect(resolveShortcut(key({ key: '>' }), nothingSelected)).toEqual({
      type: 'stepSpread',
      delta: 1,
    });
  });

  it('switches sets with brackets', () => {
    expect(resolveShortcut(key({ key: '[' }), nothingSelected)).toEqual({
      type: 'stepSet',
      delta: -1,
    });
    expect(resolveShortcut(key({ key: ']' }), nothingSelected)).toEqual({
      type: 'stepSet',
      delta: 1,
    });
  });

  it('moves the selection with arrow keys', () => {
    expect(resolveShortcut(key({ key: 'ArrowLeft' }), selected)).toEqual({
      type: 'move',
      direction: 'left',
    });
    expect(resolveShortcut(key({ key: 'ArrowDown' }), selected)).toEqual({
      type: 'move',
      direction: 'down',
    });
  });

  it('ignores selection-scoped keys when nothing is selected', () => {
    for (const k of ['ArrowLeft', '+', '-']) {
      expect(resolveShortcut(key({ key: k }), nothingSelected)).toBeNull();
    }
    expect(resolveShortcut(key({ key: '1', code: 'Digit1' }), nothingSelected)).toBeNull();
  });

  it('keeps +/- bound to the default printing', () => {
    expect(resolveShortcut(key({ key: '+' }), selected)).toEqual({
      type: 'adjustDefault',
      delta: 1,
    });
    expect(resolveShortcut(key({ key: '=' }), selected)).toEqual({
      type: 'adjustDefault',
      delta: 1,
    });
    expect(resolveShortcut(key({ key: '-' }), selected)).toEqual({
      type: 'adjustDefault',
      delta: -1,
    });
  });

  it('tops up a playset on Shift+plus', () => {
    // On a US layout "+" is only reachable as Shift+Equal, so the physical key decides.
    expect(resolveShortcut(key({ key: '+', code: 'Equal', shiftKey: true }), selected)).toEqual({
      type: 'fillPlayset',
    });
    expect(resolveShortcut(key({ key: '+', code: 'NumpadAdd', shiftKey: true }), selected)).toEqual(
      { type: 'fillPlayset' },
    );
  });

  it('clears the slot on Shift+minus', () => {
    // Shift+Minus reports "_" as the key, which is why `code` is consulted.
    expect(resolveShortcut(key({ key: '_', code: 'Minus', shiftKey: true }), selected)).toEqual({
      type: 'clearSlot',
    });
    expect(
      resolveShortcut(key({ key: '-', code: 'NumpadSubtract', shiftKey: true }), selected),
    ).toEqual({ type: 'clearSlot' });
  });

  it('keeps unshifted plus and minus as single-copy adjustments', () => {
    expect(resolveShortcut(key({ key: '=', code: 'Equal' }), selected)).toEqual({
      type: 'adjustDefault',
      delta: 1,
    });
    expect(resolveShortcut(key({ key: '-', code: 'Minus' }), selected)).toEqual({
      type: 'adjustDefault',
      delta: -1,
    });
  });

  it('does not fire the bulk forms without a selection', () => {
    expect(
      resolveShortcut(key({ key: '+', code: 'Equal', shiftKey: true }), nothingSelected),
    ).toBeNull();
    expect(
      resolveShortcut(key({ key: '_', code: 'Minus', shiftKey: true }), nothingSelected),
    ).toBeNull();
  });

  it('supports the numeric keypad for +/-', () => {
    expect(resolveShortcut(key({ key: 'Unidentified', code: 'NumpadAdd' }), selected)).toEqual({
      type: 'adjustDefault',
      delta: 1,
    });
    expect(resolveShortcut(key({ key: 'Unidentified', code: 'NumpadSubtract' }), selected)).toEqual(
      { type: 'adjustDefault', delta: -1 },
    );
  });

  it('maps digits 1-8 to variants, with Shift to decrement', () => {
    expect(resolveShortcut(key({ key: '1', code: 'Digit1' }), selected)).toEqual({
      type: 'adjustVariant',
      hotkey: 1,
      delta: 1,
    });
    expect(resolveShortcut(key({ key: '4', code: 'Digit4' }), selected)).toEqual({
      type: 'adjustVariant',
      hotkey: 4,
      delta: 1,
    });
    expect(resolveShortcut(key({ key: '!', code: 'Digit1', shiftKey: true }), selected)).toEqual({
      type: 'adjustVariant',
      hotkey: 1,
      delta: -1,
    });
  });

  it('reads digits from the physical key, so non-US layouts still work', () => {
    // On a French AZERTY layout the unshifted key reports "&", not "1".
    expect(resolveShortcut(key({ key: '&', code: 'Digit1' }), selected)).toEqual({
      type: 'adjustVariant',
      hotkey: 1,
      delta: 1,
    });
  });

  it('ignores digits outside the variant range', () => {
    expect(resolveShortcut(key({ key: '9', code: 'Digit9' }), selected)).toBeNull();
    expect(resolveShortcut(key({ key: '0', code: 'Digit0' }), selected)).toBeNull();
  });
});
