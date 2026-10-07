import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from './data/db';
import { buildRouter } from './router';
import { ToastProvider } from './ui/Toasts';

/**
 * End-to-end over the real stack: route loader → catalog parse → binder render →
 * keyboard adjust → IndexedDB write → live query → UI update.
 *
 * Served from the actual committed catalog rather than fixtures, so a data-shape change
 * fails here too.
 */

const setsDir = join(dirname(fileURLToPath(import.meta.url)), '../public/sets');

/** `<select>` also maps to role="combobox", so disambiguate by accessible name. */
const searchBox = () => screen.getByRole('combobox', { name: 'Search cards by name or number' });

/**
 * A binder cell, scoped to the grid. The selected-card panel's +/- buttons and the
 * table's jump buttons also carry the card's name, so an unscoped query is ambiguous.
 */
const cell = (name: RegExp) => within(screen.getByRole('grid')).getByRole('button', { name });

function serveFromDisk(url: string) {
  const file = url.replace(/^\/sets\//, '');
  return JSON.parse(readFileSync(join(setsDir, file), 'utf8')) as unknown;
}

async function renderApp(path = '/binder/SOR', ready?: () => HTMLElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const router = buildRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );

  // The Binder page shows the grid; the List page, the card table.
  const landmark = path.includes('/list') ? 'table' : 'grid';
  await waitFor(() => expect(ready ? ready() : screen.getByRole(landmark)).toBeInTheDocument(), {
    timeout: 5000,
  });
  return { router };
}

beforeEach(async () => {
  await db.open();
  await db.owned.clear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      try {
        return new Response(JSON.stringify(serveFromDisk(url)), { status: 200 });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }),
  );

  // jsdom has no ResizeObserver; the table uses it to size its window.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.owned.clear();
  await db.meta.clear();
});

describe('binder, end to end', () => {
  it('loads a real set and renders its first page', async () => {
    await renderApp();

    expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1');
    // SOR #1 is Director Krennic, a Leader.
    expect(cell(/Director Krennic.*Number 1\. Page 1, row 1, column 1/)).toBeInTheDocument();
  });

  it('selects a card and shows its binder location', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(cell(/Director Krennic/));

    const panel = screen.getByRole('heading', { name: 'Director Krennic' }).closest('div')!
      .parentElement!.parentElement!;
    const location = within(panel).getByLabelText('Binder location');
    expect(location).toHaveTextContent('Page1');
    expect(location).toHaveTextContent('Row1');
    expect(location).toHaveTextContent('Column1');
  });

  it('adds a copy with the + key and persists it', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(cell(/Director Krennic/));
    await user.keyboard('+');

    await waitFor(() => expect(cell(/Director Krennic.*1 of 1 in binder/)).toBeInTheDocument());

    // Leaders keep two in the binder by default, and the Normal printing is "001".
    const row = await db.owned.get('SOR:001');
    expect(row).toMatchObject({ setKey: 'SOR', base: 1, num: '001', variant: 'normal', count: 1 });
  });

  it('files a Hyperspace copy into the same binder slot via its digit hotkey', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(cell(/Director Krennic/));
    // 3 = hyperspace. SOR Krennic's hyperspace printing is #269.
    await user.keyboard('{3}');

    await waitFor(async () => expect(await db.owned.get('SOR:269')).toBeDefined());
    const row = await db.owned.get('SOR:269');
    expect(row).toMatchObject({ base: 1, variant: 'hyperspace', count: 1 });

    // One slot, one playset — the variant does not create a second binder position.
    await waitFor(() => expect(cell(/Director Krennic.*1 of 1 in binder/)).toBeInTheDocument());
  });

  it('ignores a digit for a printing the card does not have', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(cell(/Director Krennic/));
    // 5 = prestige; SOR has no Prestige run at all.
    await user.keyboard('{5}');

    expect(await db.owned.count()).toBe(0);
  });

  it('caps the pocket at its playset, and a better printing bumps the weakest to bulk', async () => {
    // jsdom implements <dialog> but not its modal API.
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    const user = userEvent.setup();
    await renderApp();

    // Every card on SOR page 1 is a Leader; #31 Inferno Four is a Unit (quota 3).
    await user.keyboard('/');
    await user.type(searchBox(), 'Inferno Four');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(cell(/Inferno Four/)).toHaveFocus());
    await user.keyboard('+++++');

    expect(await screen.findAllByText(/Inferno Four is full \(3\/3\)/)).not.toHaveLength(0);
    expect(await db.owned.get('SOR:031')).toMatchObject({ count: 3 });
    expect((await db.owned.get('SOR:031'))!.bulk).toBeUndefined();

    // The refusal offers to file the copy in the bulk box instead, behind a confirmation.
    await user.click((await screen.findAllByRole('button', { name: 'Add to bulk…' }))[0]!);
    const confirm = await screen.findByRole('dialog', { name: /Add a Normal Inferno Four/ });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect((await db.owned.get('SOR:031'))!.count).toBe(3);

    await user.click((await screen.findAllByRole('button', { name: 'Add to bulk…' }))[0]!);
    await user.click(
      within(await screen.findByRole('dialog', { name: /Add a Normal Inferno Four/ })).getByRole(
        'button',
        { name: 'Add to bulk' },
      ),
    );
    await waitFor(async () =>
      expect(await db.owned.get('SOR:031')).toMatchObject({ count: 4, bulk: 1 }),
    );
    await waitFor(() => expect(cell(/Inferno Four.*3 of 3 in binder\./)).toBeInTheDocument());

    // Hyperspace beats Normal: it goes in, and one Normal moves to the bulk box.
    await user.keyboard('3');
    expect(
      await screen.findByText(/Move the Normal Inferno Four to the bulk box/),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect(await db.owned.get('SOR:031')).toMatchObject({ count: 4, bulk: 2 }),
    );
    expect(await db.owned.where({ setKey: 'SOR', base: 31, variant: 'hyperspace' }).count()).toBe(
      1,
    );
  });

  it('fills a playset with Shift+plus, respecting the card’s quota', async () => {
    const user = userEvent.setup();
    await renderApp();

    // Krennic is a Leader, so a full playset is one copy, not three.
    await user.click(cell(/Director Krennic/));
    await user.keyboard('{Shift>}+{/Shift}');

    await waitFor(async () => expect(await db.owned.get('SOR:001')).toBeDefined());
    expect((await db.owned.get('SOR:001'))!.count).toBe(1);
  });

  it('fills a Unit to three', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('/');
    await user.type(searchBox(), 'Inferno Four');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(cell(/Inferno Four/)).toHaveFocus());

    await user.keyboard('{Shift>}+{/Shift}');

    await waitFor(() => expect(cell(/Inferno Four.*3 of 3 in binder/)).toBeInTheDocument());
  });

  it('clears a slot with Shift+minus and can undo it', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('/');
    await user.type(searchBox(), 'Inferno Four');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(cell(/Inferno Four/)).toHaveFocus());
    // Two printings of the same card, so undo has a breakdown to restore.
    await user.keyboard('+');
    await user.keyboard('{3}');
    await waitFor(async () => expect(await db.owned.count()).toBe(2));
    const before = await db.owned.toArray();

    await user.keyboard('{Shift>}_{/Shift}');
    await waitFor(async () => expect(await db.owned.count()).toBe(0));

    // Destructive, so it offers a way back rather than a confirmation prompt.
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undo);

    // Exactly as it was, printing by printing.
    await waitFor(async () => expect(await db.owned.toArray()).toEqual(before));
  });

  it('moves the selection with arrow keys', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(cell(/Number 1\. Page 1, row 1, column 1/));
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(cell(/Number 2\. Page 1, row 1, column 2/)).toHaveFocus());
  });

  it('pages between spreads with , and .', async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1');
    await user.keyboard('.');
    await waitFor(() =>
      expect(screen.getByRole('grid')).toHaveAccessibleName('Binder spread, pages 2 and 3'),
    );

    await user.keyboard(',');
    await waitFor(() => expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1'));
  });

  it('pages the binder to a card chosen from search', async () => {
    const user = userEvent.setup();
    await renderApp();

    expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1');

    await user.keyboard('/');
    // Inferno Four is #31 — page 3, so the binder has to turn to the 2/3 spread.
    await user.type(searchBox(), 'Inferno Four');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('grid')).toHaveAccessibleName('Binder spread, pages 2 and 3'),
    );
    expect(cell(/Inferno Four/)).toHaveFocus();
  });

  it('searches across every set, ranking the current set first', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('/');
    // "Vader" exists in several sets; all should be offered once they have loaded.
    await user.type(searchBox(), 'Vader');

    // Scoped to the suggestion listbox: the set picker's <option>s share the role.
    const suggestions = () =>
      within(screen.getByRole('listbox', { name: 'Card suggestions' })).getAllByRole('option');

    await waitFor(() => {
      const setKeys = suggestions().map((option) => option.textContent?.slice(0, 3));
      expect(new Set(setKeys).size).toBeGreaterThan(1);
    });

    // Whatever else matches, a card from the set you are looking at comes first.
    expect(suggestions()[0]!.textContent).toMatch(/^SOR/);
  });

  it('selects and pages to a card named in the URL', async () => {
    // A binder position is linkable: this is what a cross-set search result navigates to.
    await renderApp('/binder/SOR?card=31');

    await waitFor(() =>
      expect(screen.getByRole('grid')).toHaveAccessibleName('Binder spread, pages 2 and 3'),
    );
    // Focus moves in an effect, which can run just after the page-turn render is visible.
    await waitFor(() => expect(cell(/Inferno Four/)).toHaveFocus());
  });

  it('sends links from before the Inventory tab to the Binder page', async () => {
    const { router } = await renderApp('/binder/SOR?card=31');
    expect(router.state.location.pathname).toBe('/inventory/SOR/binder');
    expect(router.state.location.search).toEqual({ card: 31 });
  });

  it('ignores a card param that is not in the set', async () => {
    await renderApp('/binder/SOR?card=99999');
    expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1');
  });

  it('does not carry a stale card selection into another set', async () => {
    const user = userEvent.setup();
    await renderApp('/binder/SOR?card=31');
    await waitFor(() => expect(cell(/Inferno Four/)).toHaveFocus());

    // `]` moves to the next set; the previous set's card must not follow.
    await user.keyboard(']');

    await waitFor(() => expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1'));
  });

  it('focuses search with / and jumps to the chosen card', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('/');
    const search = searchBox();
    expect(search).toHaveFocus();

    await user.type(search, 'Krennic');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(cell(/Director Krennic/)).toHaveFocus());
  });

  it('does not hijack keys while typing in the search box', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('/');
    await user.type(searchBox(), '3');

    expect(searchBox()).toHaveValue('3');
    expect(await db.owned.count()).toBe(0);
  });
});

describe('sets hidden from the binder', () => {
  it('sends a link to a hidden set to the default binder, and leaves it out of the picker', async () => {
    const { router } = await renderApp('/binder/TS26');
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/binder/TS26'));

    const picker = screen.getByRole('combobox', { name: 'Card set' });
    const options = within(picker)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'));
    expect(options).not.toContain('TS26');
    expect(options).not.toContain('IBH');
    expect(options).toContain('SOR');
  });

  it('can be shown again from the Sets menu', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByText('Settings'));
    await user.click(screen.getByRole('checkbox', { name: /TS26/ }));

    const picker = screen.getByRole('combobox', { name: 'Card set' });
    await waitFor(() =>
      expect(
        within(picker)
          .getAllByRole('option')
          .map((o) => o.getAttribute('value')),
      ).toContain('TS26'),
    );
  });
});

describe('bulk edit', () => {
  // jsdom implements <dialog> but not its modal API.
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  });

  const sorCopies = async () =>
    (await db.owned.where('setKey').equals('SOR').toArray()).reduce((n, r) => n + r.count, 0);

  it('fills exactly the cards the filters show, and undoes', async () => {
    const user = userEvent.setup();
    await renderApp('/inventory/SOR/list');

    await user.click(screen.getByRole('button', { name: 'Legendary' }));
    await user.click(screen.getByRole('button', { name: 'Bulk edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Bulk edit' });
    expect(dialog).toHaveTextContent(/Legendary/);

    await user.click(within(dialog).getByRole('button', { name: /^Fill to playset/ }));

    await waitFor(async () => expect(await sorCopies()).toBeGreaterThan(0));
    // Only Legendaries were touched.
    const sor = serveFromDisk('/sets/SWU-SOR.json') as {
      cards: Array<{ base: number; rarity: string }>;
    };
    const rarityOf = new Map(sor.cards.map((c) => [c.base, c.rarity]));
    const after = await db.owned.where('setKey').equals('SOR').toArray();
    expect(after.every((r) => rarityOf.get(r.base) === 'Legendary')).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await sorCopies()).toBe(0));
  });

  it('can fill across the whole collection, leaving hidden sets alone, with one Undo', async () => {
    const user = userEvent.setup();
    await renderApp('/inventory/SOR/list');

    await user.click(screen.getByRole('button', { name: 'Legendary' }));
    await user.click(screen.getByRole('button', { name: 'Bulk edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Bulk edit' });
    await user.click(within(dialog).getByRole('radio', { name: 'Whole collection' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/TS26/);

    const fill = within(dialog).getByRole('button', { name: /^Fill to playset/ });
    await waitFor(() => expect(fill).toBeEnabled(), { timeout: 5000 });
    await user.click(fill);

    // Sets are edited one after another; the Undo toast appears once all of them are done.
    const undo = await screen.findByRole('button', { name: 'Undo' }, { timeout: 5000 });
    const rows = await db.owned.toArray();
    const sets = new Set(rows.map((r) => r.setKey));
    expect(sets.size).toBeGreaterThan(5);
    expect(sets.has('TS26')).toBe(false);
    for (const setKey of sets) {
      const catalog = serveFromDisk(`/sets/SWU-${setKey}.json`) as {
        cards: Array<{ base: number; rarity: string }>;
      };
      const rarityOf = new Map(catalog.cards.map((c) => [c.base, c.rarity]));
      expect(
        rows.filter((r) => r.setKey === setKey).every((r) => rarityOf.get(r.base) === 'Legendary'),
      ).toBe(true);
    }

    await user.click(undo);
    await waitFor(async () => expect(await db.owned.count()).toBe(0));
  });

  it('erases everything only after typing RESET', async () => {
    const user = userEvent.setup();
    await db.owned.put({
      id: 'HMW:001',
      setKey: 'HMW',
      base: 1,
      num: '001',
      variant: 'normal',
      count: 2,
      updatedAt: 0,
    });
    await renderApp();

    await user.click(screen.getByRole('button', { name: 'Bulk edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Bulk edit' });
    await user.click(within(dialog).getByText('Reset…'));
    const button = within(dialog).getByRole('button', { name: 'Erase everything' });
    expect(button).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox', { name: /Type RESET/ }), 'RESET');
    await user.click(button);
    await waitFor(async () => expect(await db.owned.count()).toBe(0));
  });

  it('keeps binder shortcuts out of the way while the dialog is open', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(cell(/Director Krennic/));

    await user.click(screen.getByRole('button', { name: 'Bulk edit' }));
    await user.keyboard('+');
    expect(await db.owned.count()).toBe(0);
  });
});

describe('shortcuts help', () => {
  it('opens on ? and lists every printing digit', async () => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Fill to a playset')).toBeInTheDocument();
    expect(within(dialog).getByText('Prestige Serialized')).toBeInTheDocument();
  });
});

describe('the bulk box', () => {
  const put = (base: number, num: string, count: number, bulk?: number) =>
    db.owned.put({
      id: `SOR:${num}`,
      setKey: 'SOR',
      base,
      num,
      variant: 'normal',
      count,
      ...(bulk !== undefined && { bulk }),
      updatedAt: 0,
    });

  it('lists what is in the box across sets, and finds a card by name', async () => {
    const user = userEvent.setup();
    await put(31, '031', 5, 2);
    await put(1, '001', 1);
    await renderApp('/inventory/bulk', () => screen.getByRole('table', { name: 'Bulk box' }));

    const table = screen.getByRole('table', { name: 'Bulk box' });
    expect(within(table).getByRole('link', { name: 'Inferno Four' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('2 copies of 1 card in the bulk box');

    await user.type(screen.getByRole('searchbox', { name: 'Search the bulk box' }), 'krennic');
    expect(screen.queryByRole('table', { name: 'Bulk box' })).not.toBeInTheDocument();
  });
});
