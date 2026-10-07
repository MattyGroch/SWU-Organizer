import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '~/data/db';
import { queueScan } from '~/data/intake';
import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';

import { IntakePage } from './IntakePage';

const sor = toLoadedSet(
  parseSetCatalog({
    setKey: 'SOR',
    label: 'SOR',
    cards: [
      {
        base: 59,
        name: '2-1B Surgical Droid',
        type: 'Unit',
        aspects: [],
        printings: [
          { num: '059', variant: 'normal' },
          { num: '059F', variant: 'foil' },
          { num: '324', variant: 'hyperspace' },
        ],
      },
    ],
  }),
  new Map(),
);
const sets = new Map([['SOR', sor]]);
const normal = { setKey: 'SOR', base: 59, num: '059', variant: 'normal' } as const;

const linesByNum = async () =>
  Object.fromEntries((await db.intakeLines.toArray()).map((l) => [l.num, l.count]));

describe('Intake on a phone: the Fix sheet', () => {
  beforeEach(async () => {
    // jsdom implements <dialog> but not its modal API.
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    await db.open();
    await db.intakeBatches.clear();
    await db.intakeLines.clear();
  });

  it('moves a single scanned copy to whichever printing is tapped', async () => {
    await queueScan(normal);
    render(<IntakePage sets={sets} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fix 2-1B Surgical Droid' }));

    const sheet = screen.getByRole('dialog');
    const choices = within(sheet).getByRole('radiogroup', { name: /Printing of/ });
    expect(within(choices).getByRole('radio', { name: 'Normal' })).toBeChecked();

    await userEvent.click(within(choices).getByRole('radio', { name: 'Hyperspace' }));
    await waitFor(async () => expect(await linesByNum()).toEqual({ '324': 1 }));
    await waitFor(() =>
      expect(within(sheet).getByRole('radio', { name: 'Hyperspace' })).toBeChecked(),
    );

    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('allocates copies one at a time when there are several, and can remove the card', async () => {
    await queueScan(normal);
    await queueScan(normal);
    render(<IntakePage sets={sets} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fix 2-1B Surgical Droid' }));

    const sheet = screen.getByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: /^Foil: 0/ }));
    await waitFor(async () => expect(await linesByNum()).toEqual({ '059': 1, '059F': 1 }));

    await userEvent.click(within(sheet).getByRole('button', { name: 'Remove from batch' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(0));
  });
});

describe('Intake with nothing queued', () => {
  beforeEach(async () => {
    await db.open();
    await db.intakeBatches.clear();
    await db.intakeLines.clear();
  });

  it('offers a way to the scanner', async () => {
    const root = createRootRoute();
    const intake = createRoute({
      getParentRoute: () => root,
      path: '/intake',
      component: () => <IntakePage sets={sets} />,
    });
    const scan = createRoute({
      getParentRoute: () => root,
      path: '/scan',
      component: () => 'Scanner',
    });
    const router = createRouter({
      routeTree: root.addChildren([intake, scan]),
      history: createMemoryHistory({ initialEntries: ['/intake'] }),
    });
    render(<RouterProvider router={router} />);

    await userEvent.click(await screen.findByRole('link', { name: 'Start scanning' }));
    expect(await screen.findByText('Scanner')).toBeInTheDocument();
  });
});

describe('Intake: a scanned deck', () => {
  const deckSet = toLoadedSet(
    parseSetCatalog({
      setKey: 'SOR',
      label: 'SOR',
      cards: [
        {
          base: 10,
          name: 'Darth Vader',
          subtitle: 'Dark Lord of the Sith',
          type: 'Leader',
          aspects: [],
          printings: [{ num: '010', variant: 'normal' }],
        },
        {
          base: 28,
          name: 'Kestro City',
          type: 'Base',
          aspects: [],
          printings: [{ num: '028', variant: 'normal' }],
        },
        {
          base: 59,
          name: '2-1B Surgical Droid',
          type: 'Unit',
          aspects: [],
          printings: [{ num: '059', variant: 'normal' }],
        },
      ],
    }),
    new Map(),
  );
  const deckSets = new Map([['SOR', deckSet]]);
  const vader = { setKey: 'SOR', base: 10, num: '010', variant: 'normal' } as const;
  const kestro = { setKey: 'SOR', base: 28, num: '028', variant: 'normal' } as const;

  /** In a router: once the deck is built, the empty queue links to the scanner. */
  const renderRouted = () => {
    const root = createRootRoute();
    const intake = createRoute({
      getParentRoute: () => root,
      path: '/intake',
      component: () => <IntakePage sets={deckSets} />,
    });
    const router = createRouter({
      routeTree: root.addChildren([intake]),
      history: createMemoryHistory({ initialEntries: ['/intake'] }),
    });
    render(<RouterProvider router={router} />);
  };

  beforeEach(async () => {
    await db.open();
    await Promise.all([
      db.intakeBatches.clear(),
      db.intakeLines.clear(),
      db.owned.clear(),
      db.deckLibrary.clear(),
      db.stacks.clear(),
      db.stackCards.clear(),
    ]);
  });

  it('waits for a base, then builds the named deck', async () => {
    await queueScan(vader, { kind: 'deckScan' });
    await queueScan(normal, { kind: 'deckScan' });
    renderRouted();

    const build = await screen.findByRole('button', { name: 'Build deck with 2 cards' });
    expect(build).toBeDisabled();
    expect(screen.getByText(/No base scanned yet/)).toBeInTheDocument();

    await queueScan(kestro, { kind: 'deckScan' });
    const ready = await screen.findByRole('button', { name: 'Build deck with 3 cards' });
    await waitFor(() => expect(ready).toBeEnabled());
    const name = screen.getByRole('textbox', { name: 'Deck name' });
    expect(name).toHaveValue('Darth Vader – Kestro City');
    await userEvent.clear(name);
    await userEvent.type(name, 'Vader Aggro');
    await userEvent.click(ready);

    await waitFor(async () => expect(await db.intakeBatches.count()).toBe(0));
    const library = JSON.parse((await db.deckLibrary.get('library'))!.json);
    expect(library.customDecks).toMatchObject([{ name: 'Vader Aggro', constructed: true }]);
  });

  it('turns scanned cards into a scanned deck', async () => {
    await queueScan(vader);
    render(<IntakePage sets={deckSets} />);
    await userEvent.click(await screen.findByRole('button', { name: 'It’s a deck' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make it a deck' }));
    expect(await screen.findByText('Scanned deck', { selector: 'h2' })).toBeInTheDocument();
    expect((await db.intakeBatches.toArray()).map((b) => b.kind)).toEqual(['deckScan']);
  });
});
