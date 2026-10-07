import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, printingId } from '~/data/db';
import { readDeckLibrary } from '~/data/deckLibrary';
import { buildRouter } from '~/router';
import { ToastProvider } from '~/ui/Toasts';

/**
 * The Decks tab over the real stack and the real committed catalog: paste → save → My
 * decks → construct → deconstruct → delete/undo, with every step persisted to IndexedDB.
 */

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../../../public');

// SOR #1 Director Krennic (Leader), #19 Security Complex (Base), #33 Death Trooper (Unit).
const DECK = JSON.stringify({
  metadata: { name: 'Krennic Troopers' },
  leader: { id: 'SOR_001', count: 1 },
  base: { id: 'SOR_019', count: 1 },
  deck: [{ id: 'SOR_033', count: 3 }],
  sideboard: [],
});

async function own(base: number, count: number) {
  const num = String(base).padStart(3, '0');
  await db.owned.put({
    id: printingId('SOR', num),
    setKey: 'SOR',
    base,
    num,
    variant: 'normal',
    count,
    updatedAt: 0,
  });
}

async function renderDecks() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const router = buildRouter(queryClient, createMemoryHistory({ initialEntries: ['/decks'] }));
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'My decks' }, { timeout: 5000 });
}

/** Pastes the deck and saves it. `fireEvent` because typing JSON braces through userEvent is lossy. */
async function pasteAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(myDecks()).getByRole('button', { name: 'Import' }));
  const box = screen.getByRole('textbox', { name: 'Decklist' });
  fireEvent.change(box, { target: { value: DECK } });
  // Resolving runs over every set; under a loaded run that can outlast the 1s default.
  await screen.findByRole('table', { name: 'Decklist cards' }, { timeout: 5000 });
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Krennic Troopers');
  await user.click(screen.getByRole('button', { name: 'Save to My decks' }));
  await waitFor(async () => expect((await readDeckLibrary()).customDecks).toHaveLength(1));
}

const myDecks = () => screen.getByRole('region', { name: 'My decks' });

beforeEach(async () => {
  await db.open();
  await db.owned.clear();
  await db.deckLibrary.clear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      try {
        return new Response(readFileSync(join(publicDir, url), 'utf8'), { status: 200 });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom implements <dialog> but not its modal API.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.owned.clear();
  await db.deckLibrary.clear();
  await db.intakeBatches.clear();
  await db.intakeLines.clear();
});

describe('decks tab, end to end', () => {
  it('checks a pasted deck against the collection and saves it to My decks', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await own(33, 1);
    await renderDecks();

    await pasteAndSave(user);

    const item = within(myDecks()).getByRole('listitem');
    expect(within(item).getByRole('button', { name: /Krennic Troopers/ })).toBeInTheDocument();
    // 3 Death Troopers wanted, 1 owned.
    expect(within(item).getByText('Need 2 to buy')).toBeInTheDocument();
    expect(within(item).getByText('Premier')).toBeInTheDocument();
    // Saving closes the Import popup.
    expect(screen.queryByRole('dialog', { name: 'Import a decklist' })).not.toBeInTheDocument();
  });

  it('constructs a deck from the binder, then puts it back', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await own(33, 3);
    await renderDecks();
    await pasteAndSave(user);

    await user.click(within(myDecks()).getByRole('button', { name: 'Construct' }));
    const dialog = screen.getByRole('dialog', { name: /Construct: Krennic Troopers/ });
    // Binder order: Krennic is page 1, row 1, column 1.
    const firstRow = within(dialog).getAllByRole('row')[1]!;
    expect(firstRow).toHaveTextContent(/^111Director Krennic/);
    await user.click(within(dialog).getByRole('button', { name: 'Mark as built' }));

    await waitFor(async () => {
      const [deck] = (await readDeckLibrary()).customDecks;
      expect(deck?.constructed).toBe(true);
      expect(deck?.pulledCards).toContainEqual({
        setKey: 'SOR',
        baseNumber: 33,
        count: 3,
        variants: { normal: 3 },
      });
    });
    expect(await within(myDecks()).findByText('Built')).toBeInTheDocument();

    await user.click(within(myDecks()).getByRole('button', { name: 'Deconstruct' }));
    const putBack = screen.getByRole('dialog', { name: /Deconstruct: Krennic Troopers/ });
    await user.click(within(putBack).getByRole('button', { name: 'Mark as put away' }));

    await waitFor(async () => {
      const [deck] = (await readDeckLibrary()).customDecks;
      expect(deck?.constructed).toBe(false);
      expect(deck?.pulledCards).toEqual([]);
    });
  });

  it('edits a deck: moves a card to the sideboard and adds one from the lookup', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await own(33, 3);
    await renderDecks();
    await pasteAndSave(user);

    await user.click(within(myDecks()).getByRole('link', { name: 'Edit' }));
    const main = await screen.findByRole('region', { name: 'Main deck' }, { timeout: 5000 });
    await user.click(within(main).getByRole('button', { name: /Move one Death Trooper to/ }));
    const side = screen.getByRole('region', { name: 'Sideboard' });
    expect(within(side).getByText('Death Trooper')).toBeInTheDocument();

    // Not owned, so only "All cards" finds it. SOR has rotated, so the deck goes Eternal.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'eternal');
    await user.click(screen.getByRole('button', { name: 'All cards' }));
    await user.click(screen.getByRole('button', { name: 'In aspect' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search cards' }), 'Vanquish');
    const results = screen.getByRole('list', { name: 'Search results' });
    await user.click(within(results).getAllByRole('button', { name: /to the main deck/ })[0]!);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('heading', { name: 'My decks' });
    const [deck] = (await readDeckLibrary()).customDecks;
    expect(deck).toMatchObject({ format: 'eternal', sideboard: [{ baseNumber: 33, count: 1 }] });
    expect(deck?.mainDeck).toHaveLength(2);
    expect(deck?.mainDeck[0]).toMatchObject({ baseNumber: 33, count: 2 });
    expect(within(myDecks()).getByText('Eternal')).toBeInTheDocument();
  });

  it('builds a new deck: format, leader, base, then cards', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await renderDecks();

    // No library saved yet still counts as loaded: the empty state shows.
    expect(await within(myDecks()).findByText(/No saved decks yet/)).toBeInTheDocument();
    await user.click(within(myDecks()).getByRole('link', { name: 'New deck' }));
    // SOR has rotated out of Premier, so this deck is Eternal.
    await user.click(await screen.findByRole('button', { name: /^Eternal/ }, { timeout: 5000 }));

    // Owned cards by default: Krennic is the only leader owned.
    const leaders = screen.getByRole('list', { name: 'Search results' });
    expect(within(leaders).getByText('Director Krennic')).toBeInTheDocument();
    await user.click(within(leaders).getByRole('button', { name: 'Choose' }));
    const bases = screen.getByRole('list', { name: 'Search results' });
    await user.click(within(bases).getByRole('button', { name: 'Choose' }));

    // The editor, unsaved until Save.
    expect(await screen.findByText('New deck — not saved yet')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Deck name' })).toHaveValue('Director Krennic');
    expect((await readDeckLibrary()).customDecks).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'All cards' }));
    await user.click(screen.getByRole('button', { name: 'In aspect' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search cards' }), 'Death Trooper');
    const results = screen.getByRole('list', { name: 'Search results' });
    await user.click(within(results).getAllByRole('button', { name: /to the main deck/ })[0]!);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('heading', { name: 'My decks' });
    const [deck] = (await readDeckLibrary()).customDecks;
    expect(deck).toMatchObject({
      name: 'Director Krennic',
      format: 'eternal',
      constructed: false,
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 19, count: 1 },
      mainDeck: [{ count: 1 }],
      sideboard: [],
    });
  }, 30_000);

  it('editing a built deck lists the dropped copies to put back', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await own(33, 3);
    await renderDecks();
    await pasteAndSave(user);
    await user.click(within(myDecks()).getByRole('button', { name: 'Construct' }));
    const build = screen.getByRole('dialog', { name: /Construct: Krennic Troopers/ });
    await user.click(within(build).getByRole('button', { name: 'Mark as built' }));
    expect(await within(myDecks()).findByText('Built')).toBeInTheDocument();

    await user.click(within(myDecks()).getByRole('link', { name: 'Edit' }));
    const main = await screen.findByRole('region', { name: 'Main deck' }, { timeout: 5000 });
    await user.click(within(main).getByRole('button', { name: 'One fewer Death Trooper' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const putBack = screen.getByRole('dialog', { name: /Put back: Krennic Troopers/ });
    expect(within(putBack).getByText('Death Trooper')).toBeInTheDocument();
    await user.click(within(putBack).getByRole('button', { name: 'Save and mark as put back' }));

    await waitFor(async () => {
      const [deck] = (await readDeckLibrary()).customDecks;
      expect(deck?.mainDeck).toEqual([{ setKey: 'SOR', baseNumber: 33, count: 2 }]);
      expect(deck?.constructed).toBe(true);
      expect(deck?.pulledCards).toContainEqual({
        setKey: 'SOR',
        baseNumber: 33,
        count: 2,
        variants: { normal: 2 },
      });
    });
    expect(await within(myDecks()).findByText('Built')).toBeInTheDocument();
  });

  it('builds with cards missing, telling owned-elsewhere from not owned', async () => {
    const user = userEvent.setup();
    // Own all three Death Troopers, but deck A already has two in its box.
    await own(1, 1);
    await own(19, 1);
    await own(33, 3);
    await renderDecks();
    await pasteAndSave(user);
    const [first] = (await readDeckLibrary()).customDecks;
    await db.deckLibrary.put({
      id: 'library',
      updatedAt: 0,
      json: JSON.stringify({
        preconOwnership: {},
        customDecks: [
          first,
          {
            ...first,
            id: 'other',
            name: 'Other deck',
            constructed: true,
            pulledCards: [{ setKey: 'SOR', baseNumber: 33, count: 2 }],
          },
        ],
      }),
    });

    const krennic = await within(myDecks()).findAllByRole('listitem');
    await user.click(within(krennic[0]!).getByRole('button', { name: 'Construct' }));
    const dialog = screen.getByRole('dialog', { name: /Construct: Krennic Troopers/ });

    // Binder supplies leader, base and the one free trooper; deck A holds the other two.
    const offer = within(dialog).getByRole('checkbox', {
      name: /Take 2× Death Trooper .* from Other deck/,
    });
    expect(offer).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Mark as built, cards missing' }));

    // Left them in the other deck: this one is built, missing 2 that are owned elsewhere.
    const items = within(myDecks()).getAllByRole('listitem');
    expect(await within(items[0]!).findByText('2 owned elsewhere')).toBeInTheDocument();
    expect(within(items[0]!).queryByText(/not owned/)).not.toBeInTheDocument();
  });

  it('takes a card from another built deck, leaving that one flagged', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await own(33, 3);
    await renderDecks();
    await pasteAndSave(user);
    const [first] = (await readDeckLibrary()).customDecks;
    await db.deckLibrary.put({
      id: 'library',
      updatedAt: 0,
      json: JSON.stringify({
        preconOwnership: {},
        customDecks: [
          first,
          {
            ...first,
            id: 'other',
            name: 'Other deck',
            constructed: true,
            pulledCards: [
              { setKey: 'SOR', baseNumber: 1, count: 1 },
              { setKey: 'SOR', baseNumber: 19, count: 1 },
              { setKey: 'SOR', baseNumber: 33, count: 2 },
            ],
          },
        ],
      }),
    });

    const items = await within(myDecks()).findAllByRole('listitem');
    await user.click(within(items[0]!).getByRole('button', { name: 'Construct' }));
    const dialog = screen.getByRole('dialog', { name: /Construct/ });
    for (const box of within(dialog).getAllByRole('checkbox', { name: /^Take/ })) {
      await user.click(box);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Mark as built' }));

    await waitFor(async () => {
      const [mine, other] = (await readDeckLibrary()).customDecks;
      expect(mine).toMatchObject({ constructed: true });
      expect(other).toMatchObject({ constructed: true, pulledCards: [] });
    });
    const after = within(myDecks()).getAllByRole('listitem');
    expect(await within(after[0]!).findByText('Built')).toBeInTheDocument();
    expect(within(after[1]!).getByText('Built · cards missing')).toBeInTheDocument();
  });

  it('moves single cards between the box and the binder', async () => {
    const user = userEvent.setup();
    await own(1, 1);
    await own(19, 1);
    await own(33, 3);
    await renderDecks();
    await pasteAndSave(user);
    await user.click(within(myDecks()).getByRole('button', { name: 'Construct' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as built' }),
    );
    await within(myDecks()).findByText('Built');

    await user.click(within(myDecks()).getByRole('button', { name: /Krennic Troopers/ }));
    await user.click(
      within(myDecks()).getByRole('button', { name: /Take one Death Trooper out of the box/ }),
    );
    expect(await within(myDecks()).findByText('1 owned elsewhere')).toBeInTheDocument();

    await user.click(
      within(myDecks()).getByRole('button', { name: /Put one Death Trooper from the binder/ }),
    );
    expect(await within(myDecks()).findByText('Built')).toBeInTheDocument();
  });

  it('flags cards you do not own at all', async () => {
    const user = userEvent.setup();
    await renderDecks();
    await pasteAndSave(user);

    await user.click(within(myDecks()).getByRole('button', { name: 'Construct' }));
    const dialog = screen.getByRole('dialog', { name: /Construct/ });
    expect(
      within(dialog).getByRole('heading', { name: 'Not owned — purchase list' }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Mark as built, cards missing' }));
    expect(await within(myDecks()).findByText('5 not owned')).toBeInTheDocument();
  });

  it('deletes a deck with undo', async () => {
    const user = userEvent.setup();
    await renderDecks();
    await pasteAndSave(user);

    await user.click(within(myDecks()).getByRole('button', { name: /Krennic Troopers/ }));
    await user.click(within(myDecks()).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await readDeckLibrary()).customDecks).toHaveLength(0));

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await readDeckLibrary()).customDecks).toHaveLength(1));
  });

  it('adds a deck bought already built through intake, with a variant corrected', async () => {
    const user = userEvent.setup();
    await renderDecks();
    await pasteAndSave(user);

    await user.click(within(myDecks()).getByRole('button', { name: 'Add to collection' }));
    const batch = await screen.findByRole(
      'region',
      { name: 'Krennic Troopers' },
      { timeout: 5000 },
    );
    // Nothing is owned while it waits for review.
    expect(await db.owned.count()).toBe(0);

    // One of the three troopers is a Hyperspace: click H once.
    const printings = within(batch).getByRole('group', { name: 'Printings of Death Trooper' });
    await user.click(within(printings).getByRole('button', { name: /^Hyperspace: 0\./ }));
    expect(
      await within(printings).findByRole('button', { name: /^Hyperspace: 1\./ }),
    ).toBeInTheDocument();
    expect(
      within(printings).getByRole('button', { name: 'Normal: 2. Move one back' }),
    ).toBeInTheDocument();

    // N takes it back, and ↺ undoes everything; then set the Hyperspace again.
    await user.click(within(printings).getByRole('button', { name: /^Normal: 2/ }));
    expect(
      await within(printings).findByRole('button', { name: /^Normal: 3/ }),
    ).toBeInTheDocument();
    await user.click(within(printings).getByRole('button', { name: /^Hyperspace: 0\./ }));
    await user.click(await within(printings).findByRole('button', { name: /^Hyperspace: 1\./ }));
    expect(
      await within(printings).findByRole('button', { name: /^Hyperspace: 2\./ }),
    ).toBeInTheDocument();
    await user.click(
      within(batch).getByRole('button', { name: 'Move every Death Trooper back to Normal' }),
    );
    expect(
      await within(printings).findByRole('button', { name: /^Normal: 3/ }),
    ).toBeInTheDocument();
    await user.click(within(printings).getByRole('button', { name: /^Hyperspace: 0\./ }));
    expect(
      await within(printings).findByRole('button', { name: /^Hyperspace: 1\./ }),
    ).toBeInTheDocument();
    await user.click(within(batch).getByRole('button', { name: /Add 5 cards & mark deck built/ }));

    await waitFor(async () => expect(await db.intakeLines.count()).toBe(0));
    const troopers = await db.owned.where('[setKey+base]').equals(['SOR', 33]).toArray();
    expect(troopers.map((r) => [r.variant, r.count]).sort()).toEqual([
      ['hyperspace', 1],
      ['normal', 2],
    ]);
    const [deck] = (await readDeckLibrary()).customDecks;
    expect(deck).toMatchObject({ constructed: true });
    // The deck remembers the Hyperspace, so deconstructing puts that printing back.
    expect(deck!.pulledCards).toContainEqual({
      setKey: 'SOR',
      baseNumber: 33,
      count: 3,
      variants: { normal: 2, hyperspace: 1 },
    });
  });
});
