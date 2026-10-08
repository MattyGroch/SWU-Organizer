import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_FILTERS } from '~/features/binder/cardRows';

import {
  readLastSet,
  readLastView,
  readFilters,
  readPosition,
  rememberFilters,
  rememberPlace,
  rememberPosition,
  resetLastPlaceForTests,
} from './lastPlace';

afterEach(() => vi.useRealTimers());

describe('lastPlace', () => {
  it('remembers the set and view, and Bulk keeps the last set', () => {
    rememberPlace('list', 'SHD');
    rememberPlace('bulk');

    resetLastPlaceForTests();
    expect(readLastView()).toBe('bulk');
    expect(readLastSet()).toBe('SHD');
  });

  it('ignores a stored view it does not know', () => {
    localStorage.setItem('inventory:lastView', 'gallery');
    expect(readLastView()).toBeUndefined();
  });

  it('merges positions per set and writes them to storage once settled', () => {
    vi.useFakeTimers();
    rememberPosition('SOR', { page: 5 });
    rememberPosition('SOR', { listTop: 880 });
    rememberPosition('SHD', { card: 31 });

    expect(readPosition('SOR')).toEqual({ page: 5, listTop: 880 });
    expect(localStorage.getItem('inventory:positions')).toBeNull();

    vi.advanceTimersByTime(300);
    resetLastPlaceForTests();
    expect(readPosition('SOR')).toEqual({ page: 5, listTop: 880 });
    expect(readPosition('SHD')).toEqual({ card: 31 });
    expect(readPosition('TWI')).toEqual({});
  });

  it('writes straight away when the app goes to the background', () => {
    vi.useFakeTimers();
    rememberPosition('SOR', { page: 7 });
    window.dispatchEvent(new Event('pagehide'));

    expect(JSON.parse(localStorage.getItem('inventory:positions')!)).toEqual({ SOR: { page: 7 } });
  });

  it('starts from the top when the stored positions are corrupt', () => {
    localStorage.setItem('inventory:positions', '{not json');
    expect(readPosition('SOR')).toEqual({});
  });

  it('keeps the filters, and starts unfiltered when they are unreadable', () => {
    expect(readFilters()).toEqual(EMPTY_FILTERS);

    rememberFilters({ ...EMPTY_FILTERS, rarity: ['Rare'], text: 'vader', hideInDecks: true });
    resetLastPlaceForTests();
    expect(readFilters()).toEqual({
      ...EMPTY_FILTERS,
      rarity: ['Rare'],
      text: 'vader',
      hideInDecks: true,
    });

    localStorage.setItem('inventory:filters', JSON.stringify({ rarity: 'Rare', text: 7 }));
    resetLastPlaceForTests();
    expect(readFilters()).toEqual(EMPTY_FILTERS);
  });
});
