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
let phase = 'holding';
const resume = vi.fn();
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
    return { phase, rearm: vi.fn(), resume };
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
  cardScore: score,
  bits: score,
});

describe('ScanPage', () => {
  beforeEach(async () => {
    await db.open();
    await db.intakeBatches.clear();
    await db.intakeLines.clear();
    await db.owned.clear();
  });

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
      fire!({
        matches: [match(num, 59, variant, 10), match('080', 80, 'normal', 90)],
        at: 1,
        afterGap: true,
        tooClose: false,
      });
    });
  };
  afterEach(() => {
    fire = null;
    phase = 'holding';
    resume.mockClear();
  });

  it('adds a confident scan to Intake and shows it with Correct and Rescan', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({
        matches: [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)],
        at: 1,
        afterGap: true,
        tooClose: false,
      });
    });
    expect(await screen.findByRole('heading', { name: /2-1B Surgical Droid/ })).toBeInTheDocument();
    expect(screen.getByText('Added to Intake')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
  });

  it('does not add a copy the binder has no room for, and says to bulk it', async () => {
    await fillPocket();
    await scan('059', 'normal');
    expect(await screen.findByText(/Maximum count reached for/)).toBeInTheDocument();
    expect(await db.intakeLines.count()).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Add anyway, as a spare' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
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

    // Second thoughts: keep the Normal too — the Hyperspace stays queued.
    await userEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    await waitFor(async () => {
      const lines = await db.intakeLines.toArray();
      expect(lines.map((l) => [l.num, Boolean(l.swapOut)])).toEqual([['324', false]]);
    });
    expect(screen.getByText('Added to Intake')).toBeInTheDocument();
  });

  it('after five misses, offers to look the card up by name instead', async () => {
    phase = 'stuck';
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Couldn’t recognise this card' }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByRole('combobox', { name: /Search cards/ }), 'surgical');
    await userEvent.click(await screen.findByRole('option', { name: /2-1B Surgical Droid/ }));

    await waitFor(async () => {
      const lines = await db.intakeLines.toArray();
      expect(lines.map((l) => l.num)).toEqual(['059']);
    });
    expect(resume).toHaveBeenCalled();
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
  });

  it('or skips it, adding nothing', async () => {
    phase = 'stuck';
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip this card' }));
    expect(resume).toHaveBeenCalled();
    expect(await db.intakeLines.count()).toBe(0);
  });

  it('asks when unsure, and "Yes, add it" adds the card', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({
        matches: [match('059', 59, 'normal', 10), match('080', 80, 'normal', 15)],
        at: 1,
        afterGap: true,
        tooClose: false,
      });
    });
    expect(await screen.findByText(/Not sure — is this the right card/)).toBeInTheDocument();
    expect(await db.intakeLines.count()).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Yes, add it' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
  });

  it('treats the same card read again without being lifted as one card, not a second copy', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    const confident = [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)];
    await act(async () => fire!({ matches: confident, at: 1, afterGap: true, tooClose: false }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));

    // Refocusing re-fires the scanner on the card still in the rig: nothing more is added.
    await act(async () => fire!({ matches: confident, at: 2, afterGap: false, tooClose: false }));
    await act(async () => fire!({ matches: confident, at: 3, afterGap: false, tooClose: false }));
    expect((await db.intakeLines.toArray())[0]!.count).toBe(1);

    // Lifted out and a second copy put in: that one counts.
    await act(async () => fire!({ matches: confident, at: 4, afterGap: true, tooClose: false }));
    await waitFor(async () => expect((await db.intakeLines.toArray())[0]!.count).toBe(2));
  });

  it('keeps an open "Not sure" question when the same card is read again, so Yes still works', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    const unsure = [match('059', 59, 'normal', 10), match('080', 80, 'normal', 15)];
    await act(async () => fire!({ matches: unsure, at: 1, afterGap: true, tooClose: false }));
    expect(await screen.findByText(/Not sure — is this the right card/)).toBeInTheDocument();
    await act(async () => fire!({ matches: unsure, at: 2, afterGap: false, tooClose: false }));

    await userEvent.click(screen.getByRole('button', { name: 'Yes, add it' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
  });
});
