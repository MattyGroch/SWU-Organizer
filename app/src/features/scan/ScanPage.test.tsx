import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '~/data/db';
import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';
import type { ScanResult } from './useScanner';

// The camera, index and frame loop are replaced; everything after "a card was recognised" is real.
let fire: ((r: ScanResult) => void) | null = null;
vi.mock('./useCamera', () => ({
  useCamera: () => ({
    videoRef: { current: null },
    state: 'live',
    start: vi.fn(),
    stop: vi.fn(),
    torchAvailable: false,
    torchOn: false,
    toggleTorch: vi.fn(),
  }),
}));
vi.mock('./useScanIndex', () => ({
  useScanIndex: () => ({ data: { entries: [] }, isError: false }),
}));
vi.mock('./useScanner', () => ({
  useScanner: ({ onResult }: { onResult: (r: ScanResult) => void }) => {
    fire = onResult;
    return { phase: 'holding', rearm: vi.fn() };
  },
}));

const { ScanPage } = await import('./ScanPage');

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
          { num: '324', variant: 'hyperspace' },
        ],
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

function renderPage() {
  const root = createRootRoute();
  const scan = createRoute({
    getParentRoute: () => root,
    path: '/scan',
    component: () => <ScanPage sets={new Map([['SOR', sor]])} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([scan]),
    history: createMemoryHistory({ initialEntries: ['/scan'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const match = (num: string, base: number, variant: string, score: number) => ({
  entry: { setKey: 'SOR', num, base, variant },
  index: 0,
  score,
  bits: score,
});

describe('ScanPage', () => {
  beforeEach(async () => {
    await db.open();
    await db.intakeBatches.clear();
    await db.intakeLines.clear();
    await db.owned.clear();
    await db.stacks.clear();
    await db.stackCards.clear();
  });

  /** The scanned stack, top first: printing and where it goes. */
  const stack = async () =>
    (await db.stackCards.toArray())
      .sort((a, b) => a.seq - b.seq)
      .map((c) => [c.num, c.fate, c.swapOut?.num ?? null]);

  /** A full pocket: three Normal copies of the droid (a Unit's quota is 3). */
  const fillPocket = () =>
    db.owned.put({
      id: 'SOR:059',
      setKey: 'SOR',
      base: 59,
      num: '059',
      variant: 'normal',
      count: 3,
      updatedAt: 1,
    });

  const scan = async (num: string, variant: string) => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({ matches: [match(num, 59, variant, 10), match('080', 80, 'normal', 90)], at: 1 });
    });
  };
  afterEach(() => {
    fire = null;
  });

  it('adds a confident scan to Intake and shows it with Correct and Rescan', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({ matches: [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)], at: 1 });
    });
    expect(await screen.findByRole('heading', { name: /2-1B Surgical Droid/ })).toBeInTheDocument();
    expect(screen.getByText('Added to Intake')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    expect(await stack()).toEqual([['059', 'binder', null]]);

    // Rescan takes the card back out of the stack.
    await userEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    await waitFor(async () => expect(await stack()).toEqual([]));
  });

  it('logs every scan in order, one per copy, and corrects one in place', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    for (const num of ['059', '080', '059']) {
      await act(async () => {
        fire!({
          matches: [match(num, num === '059' ? 59 : 80, 'normal', 10), match('x', 1, 'normal', 90)],
          at: 1,
        });
      });
    }
    await waitFor(async () =>
      expect(await stack()).toEqual([
        ['059', 'binder', null],
        ['080', 'binder', null],
        ['059', 'binder', null],
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Correct' }));
    await userEvent.click(await screen.findByTitle(/Hyperspace/));
    await waitFor(async () =>
      expect(await stack()).toEqual([
        ['059', 'binder', null],
        ['080', 'binder', null],
        ['324', 'binder', null],
      ]),
    );
  });

  it('does not add a copy the binder has no room for, and says to bulk it', async () => {
    await fillPocket();
    await scan('059', 'normal');
    expect(await screen.findByText(/Maximum count reached for/)).toBeInTheDocument();
    expect(await db.intakeLines.count()).toBe(0);
    // Not added, but still in the stack in your hand: it goes to bulk.
    await waitFor(async () => expect(await stack()).toEqual([['059', 'bulk', null]]));

    await userEvent.click(screen.getByRole('button', { name: 'Add anyway, as a spare' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    expect(await stack()).toEqual([['059', 'spare', null]]);
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
  });

  it('adds a better printing straight away, bumping the weakest copy to bulk', async () => {
    await fillPocket();
    await scan('324', 'hyperspace');
    expect(
      await screen.findByText(/Bumps a Normal 2-1B Surgical Droid to bulk/),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const lines = await db.intakeLines.toArray();
      expect(lines.map((l) => [l.num, Boolean(l.swapOut)]).sort()).toEqual([
        ['059', true],
        ['324', false],
      ]);
    });
    expect(await stack()).toEqual([['324', 'binder', '059']]);

    // Second thoughts: keep the Normal too — the Hyperspace stays queued.
    await userEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    await waitFor(async () => {
      const lines = await db.intakeLines.toArray();
      expect(lines.map((l) => [l.num, Boolean(l.swapOut)])).toEqual([['324', false]]);
    });
    expect(await stack()).toEqual([['324', 'spare', null]]);
    expect(screen.getByText('Added to Intake')).toBeInTheDocument();
  });
});
