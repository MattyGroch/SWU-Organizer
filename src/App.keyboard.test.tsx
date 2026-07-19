import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    fireEvent.click(screen.getByRole('button', { name: 'Single Page' }));
    await waitFor(() => expect(subtitle()).toContain('Binder — Page 3'));
    fireEvent.keyDown(window, { key: '.', code: 'Period' });
    fireEvent.keyDown(window, { key: ',', code: 'Comma' });
    expect(subtitle()).toContain('Binder — Page 3');
  });
});
