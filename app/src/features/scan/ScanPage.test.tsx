import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
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
  });
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
  });
});
