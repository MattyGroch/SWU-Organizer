import { describe, expect, it } from 'vitest';
import {
  focusedPageForSpread,
  viewModeAfterSelection,
} from './binderView';

describe('binder view continuity', () => {
  it('preserves the browsed physical-page side when changing spreads', () => {
    expect(focusedPageForSpread(4, 2, 9)).toBe(4);
    expect(focusedPageForSpread(4, 3, 9)).toBe(6);
    expect(focusedPageForSpread(5, 3, 9)).toBe(7);
  });

  it('handles page one and clamps an incomplete final spread', () => {
    expect(focusedPageForSpread(1, 1, 9)).toBe(3);
    expect(focusedPageForSpread(9, 0, 9)).toBe(1);
    expect(focusedPageForSpread(7, 4, 8)).toBe(8);
  });

  it('uses the setting only for card activation mode changes', () => {
    expect(viewModeAfterSelection({ autoOpenSinglePage: true }, 'spread')).toBe('single');
    expect(viewModeAfterSelection({ autoOpenSinglePage: false }, 'spread')).toBe('spread');
    expect(viewModeAfterSelection({ autoOpenSinglePage: false }, 'single')).toBe('single');
  });
});
