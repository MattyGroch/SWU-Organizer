import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const cards = Array.from({ length: 108 }, (_, index) => ({
  Name: `Card ${index + 1}`,
  Number: index + 1,
  Type: 'Unit',
  Set: 'TST',
}));

describe('App binder keyboard shortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sets/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            sets: [{ key: 'TST', label: 'Test Set', file: 'test.json' }],
          }),
        } as Response;
      }
      if (url.endsWith('/sets/test.json')) {
        return { ok: true, json: async () => cards } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the current spread anchor for repeated period and comma presses', async () => {
    const { container } = render(<App />);
    const subtitle = () => container.querySelector('.binder-subtitle')?.textContent ?? '';

    await waitFor(() => expect(subtitle()).toContain('Spread: Page 1'));
    await waitFor(() => {
      const jump = screen.getByRole('combobox', { name: 'Jump to spread' });
      expect(jump.querySelectorAll('option')).toHaveLength(5);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', code: 'Period' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', code: 'Period' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', code: 'Period' }));
    });
    await waitFor(() => expect(subtitle()).toContain('Page 6 (left) | Page 7 (right)'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma' }));
    });
    await waitFor(() => expect(subtitle()).toContain('Page 2 (left) | Page 3 (right)'));
  });

  it('uses [ and ] to cycle sets, but ignores them while typing in the search box', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/sets/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            sets: [
              { key: 'AAA', label: 'Set AAA', file: 'aaa.json' },
              { key: 'BBB', label: 'Set BBB', file: 'bbb.json' },
            ],
          }),
        } as Response;
      }
      if (url.endsWith('/sets/aaa.json') || url.endsWith('/sets/bbb.json')) {
        return { ok: true, json: async () => cards } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }));

    const { container } = render(<App />);
    const setSelect = () => container.querySelector<HTMLSelectElement>('.set-switch-group select');

    // Newest set (last in manifest) is selected initially.
    await waitFor(() => expect(setSelect()?.value).toBe('BBB'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
    });
    await waitFor(() => expect(setSelect()?.value).toBe('AAA'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }));
    });
    await waitFor(() => expect(setSelect()?.value).toBe('BBB'));

    const search = screen.getByRole('textbox', { name: 'Search cards' });
    search.focus();
    act(() => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
    });
    expect(setSelect()?.value).toBe('BBB');
  });
});
