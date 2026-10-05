import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '~/data/db';
import { logScan } from '~/data/stacks';
import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';

import { PutAwayPage } from './PutAwayPage';

const sor = toLoadedSet(
  parseSetCatalog({
    setKey: 'SOR',
    label: 'Spark of Rebellion',
    cards: [
      {
        base: 1,
        name: 'Krennic',
        type: 'Leader',
        aspects: [],
        printings: [{ num: '001', variant: 'normal' }],
      },
      {
        base: 59,
        name: '2-1B Surgical Droid',
        type: 'Unit',
        aspects: [],
        printings: [{ num: '059', variant: 'normal' }],
      },
      {
        base: 80,
        name: 'Nameless Scout',
        type: 'Unit',
        aspects: [],
        printings: [{ num: '080', variant: 'normal' }],
      },
    ],
  }),
  new Map(),
);

function renderPage(stackId: string) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/put-away/$stackId',
    component: function Page() {
      return <PutAwayPage sets={new Map([['SOR', sor]])} stackId={page.useParams().stackId} />;
    },
  });
  const intake = createRoute({
    getParentRoute: () => root,
    path: '/intake',
    component: () => 'Intake',
  });
  const router = createRouter({
    routeTree: root.addChildren([page, intake]),
    history: createMemoryHistory({ initialEntries: [`/put-away/${stackId}`] }),
  });
  render(<RouterProvider router={router} />);
}

const spoken: string[] = [];

describe('PutAwayPage', () => {
  beforeEach(async () => {
    spoken.length = 0;
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    );
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: (u: { text: string }) => spoken.push(u.text), cancel: () => {} },
    });
    await db.open();
    await db.stacks.clear();
    await db.stackCards.clear();
    await db.meta.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const card = (base: number, fate: 'binder' | 'bulk' = 'binder') => ({
    setKey: 'SOR',
    base,
    num: String(base).padStart(3, '0'),
    variant: 'normal' as const,
    fate,
  });

  it('deals, scoops, files and sets aside, reading each step aloud', async () => {
    await logScan(card(80));
    await logScan(card(59, 'bulk'));
    await logScan(card(1));
    const stackId = (await db.stacks.toArray())[0]!.id;
    renderPage(stackId);

    expect(await screen.findByRole('heading', { name: 'Put away 3 cards' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    const next = async (text: string) => {
      await waitFor(() => expect(spoken.at(-1)).toBe(text));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    };
    // Piles in binder order: page 1, then pages 6–7; the bulk card gets the last pile.
    await next('Pile 2. Nameless Scout');
    expect(await screen.findByText('Step 2 of 7')).toBeInTheDocument();
    await next('Pile 3. 2-1B Surgical Droid');
    await next('Pile 1. Krennic');
    await next('Scoop up the piles, Pile 1 through Pile 3.');
    await next('Open Spark of Rebellion to page 1. Page 1, row 1, column 1. Krennic.');
    await next(
      'Open Spark of Rebellion to pages 6 and 7. Page 7, row 2, column 4. Nameless Scout.',
    );
    await next('Bulk. 2-1B Surgical Droid');
    await waitFor(() => expect(spoken.at(-1)).toBe('All put away.'));

    // Progress is kept: Back steps through it again.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Bulk. 2-1B Surgical Droid'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(async () => expect(await db.stacks.count()).toBe(0));
  });

  it('stays quiet when reading aloud is off', async () => {
    await logScan(card(1));
    const stackId = (await db.stacks.toArray())[0]!.id;
    renderPage(stackId);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Read each step aloud' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/Row 1 · Column 1/)).toBeInTheDocument();
    expect(spoken).toEqual([]);
  });
});
