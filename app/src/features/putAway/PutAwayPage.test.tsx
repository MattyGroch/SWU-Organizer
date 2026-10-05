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

import { db, writeMeta } from '~/data/db';
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
      value: {
        speak: (u: { text: string; onend?: () => void }) => {
          spoken.push(u.text);
          setTimeout(() => u.onend?.(), 0);
        },
        cancel: () => {},
      },
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

  /** A stack scanned in this order: the scout first, Krennic last — so Krennic is on top. */
  const scanStack = async () => {
    await logScan(card(80));
    await logScan(card(59, 'bulk'));
    await logScan(card(1));
    return (await db.stacks.toArray())[0]!.id;
  };

  it('starts from the last card scanned and runs hands-free to the end', async () => {
    // No pause between steps, so the whole walk plays out at once.
    await writeMeta(db, 'putAway:pace', '0');
    renderPage(await scanStack());

    expect(await screen.findByRole('heading', { name: 'Put away 3 cards' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(spoken.at(-1)).toBe('All put away.'), { timeout: 4000 });
    // Piles in binder order: page 1, then pages 6–7; the bulk card gets the last pile.
    expect(spoken).toEqual([
      'Pile 1. Krennic',
      'Pile 3. 2-1B Surgical Droid',
      'Pile 2. Nameless Scout',
      'Scoop up the piles, Pile 1 through Pile 3.',
      'Open Spark of Rebellion to page 1. Page 1, row 1, column 1. Krennic.',
      'Open Spark of Rebellion to pages 6 and 7. Page 7, row 2, column 4. Nameless Scout.',
      'Bulk. 2-1B Surgical Droid',
      'All put away.',
    ]);

    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(async () => expect(await db.stacks.count()).toBe(0));
  });

  it('pauses, steps back and forth by hand, and resumes', async () => {
    await writeMeta(db, 'putAway:pace', '10');
    renderPage(await scanStack());
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 3. 2-1B Surgical Droid'));
    expect(await screen.findByText(/Step 2 of 7/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));

    // Stepping by hand never restarts the walk on its own.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByText(/Paused/)).not.toBeInTheDocument();
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
