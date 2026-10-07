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
const retry = vi.fn();
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
    return { phase, rearm: vi.fn(), resume, retry };
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
          { num: '059F', variant: 'foil' },
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

/** The droid again, reprinted in SHD with the same art. */
const shd = toLoadedSet(
  parseSetCatalog({
    setKey: 'SHD',
    label: 'Shadows of the Galaxy',
    cards: [
      {
        base: 200,
        name: '2-1B Surgical Droid',
        type: 'Unit',
        aspects: [],
        printings: [{ num: '200', variant: 'normal' }],
      },
      {
        base: 201,
        name: 'Some Other Card',
        type: 'Unit',
        aspects: [],
        printings: [{ num: '201', variant: 'normal' }],
      },
    ],
  }),
  new Map(),
);

/** The page, with SOR and any `more` sets. */
function renderPage(more: [string, ReturnType<typeof toLoadedSet>][] = []) {
  const root = createRootRoute();
  const scan = createRoute({
    getParentRoute: () => root,
    path: '/scan',
    component: () => <ScanPage sets={new Map([['SOR', sor], ...more])} />,
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
    localStorage.clear();
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
    retry.mockClear();
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
          // Each copy is lifted off the stack: a new card, not a re-read.
          afterGap: true,
          tooClose: false,
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

  it('adds a copy the binder has no room for without fuss, noting it for bulk', async () => {
    await fillPocket();
    await scan('059', 'normal');
    // Nothing to do about it while scanning: Put away deals with bulk.
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
    expect(screen.queryByText(/bulk/i)).not.toBeInTheDocument();
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    // Still in the stack in your hand: Put away sets it aside for the bulk box.
    await waitFor(async () => expect(await stack()).toEqual([['059', 'bulk', null]]));
  });

  it('adds a better printing straight away, bumping the weakest copy to bulk', async () => {
    await fillPocket();
    await scan('324', 'hyperspace');
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
    expect(screen.queryByText(/bulk/i)).not.toBeInTheDocument();
    await waitFor(async () => {
      const lines = await db.intakeLines.toArray();
      expect(lines.map((l) => l.num)).toEqual(['324']);
    });
    // Filing it means taking the Normal out of the pocket, for bulk.
    expect(await stack()).toEqual([['324', 'binder', '059']]);
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
    // Scanning resumes once the card is also logged in the stack.
    await waitFor(() => expect(resume).toHaveBeenCalled());
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
    // Found by search, it still keeps its place in the stack.
    expect(await stack()).toEqual([['059', 'binder', null]]);
  });

  it('marks the last result as the previous card while stuck on a new one', async () => {
    await scan('059', 'normal');
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
    expect(screen.queryByText(/Previous card/)).not.toBeInTheDocument();
    // The next card won't read: the droid still shows, but plainly as the card before.
    phase = 'stuck';
    // Any re-render picks the new phase up from the mocked scanner.
    await userEvent.click(screen.getByRole('radio', { name: 'Look up' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Add to Intake' }));
    expect(await screen.findByText('Previous card — not the one in view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2-1B Surgical Droid/ })).toBeInTheDocument();
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
    // Unsure, but already in the stack in your hand.
    await waitFor(async () => expect(await stack()).toEqual([['059', 'unsure', null]]));

    await userEvent.click(screen.getByRole('button', { name: 'Yes, add it' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    expect(await stack()).toEqual([['059', 'binder', null]]);
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
  });

  it('asks which set when the index knows the same art in another set, however sure the read', async () => {
    renderPage([['SHD', shd]]);
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({
        // A confident read: the SHD copy never even made the shortlist.
        matches: [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)],
        at: 1,
        afterGap: true,
        tooClose: false,
        twins: [
          { setKey: 'SHD', num: '200', base: 200, variant: 'normal' },
          // Close art, but a different card: never offered.
          { setKey: 'SHD', num: '201', base: 201, variant: 'normal' },
        ],
      });
    });
    expect(await screen.findByText(/looks the same in more than one set/)).toBeInTheDocument();
    expect(await db.intakeLines.count()).toBe(0);
    const choices = screen.getAllByRole('button', { name: /^S[OH][RD] #/ });
    expect(choices.map((b) => b.textContent)).toEqual(['SOR #059', 'SHD #200']);

    await userEvent.click(screen.getByRole('button', { name: 'SHD #200' }));
    await waitFor(async () =>
      expect((await db.intakeLines.toArray()).map((l) => `${l.setKey}:${l.num}`)).toEqual([
        'SHD:200',
      ]),
    );
    expect(await stack()).toEqual([['200', 'binder', null]]);
  });

  it('adds a scan straight away when its only twin is a different card', async () => {
    renderPage([['SHD', shd]]);
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({
        matches: [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)],
        at: 1,
        afterGap: true,
        tooClose: false,
        twins: [{ setKey: 'SHD', num: '201', base: 201, variant: 'normal' }],
      });
    });
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

  it('treats a re-read that lands while the first read is still being saved as the same card', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    const confident = [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)];
    // The camera re-fires as fast as it likes: the second read arrives before the first is saved.
    await act(async () => {
      fire!({ matches: confident, at: 1, afterGap: true, tooClose: false });
      fire!({ matches: confident, at: 2, afterGap: false, tooClose: false });
    });
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    expect((await db.intakeLines.toArray())[0]!.count).toBe(1);
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

  it('holds an open "Not sure" question when a re-read ranks the cards the other way', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    const unsure = [match('059', 59, 'normal', 10), match('080', 80, 'normal', 15)];
    await act(async () => fire!({ matches: unsure, at: 1, afterGap: true, tooClose: false }));
    expect(await screen.findByText(/Not sure — is this the right card/)).toBeInTheDocument();

    // An unsure card flips between its candidates, and the phone moves as the button is
    // reached for: neither replaces the question being answered.
    const flipped = [match('080', 80, 'normal', 10), match('059', 59, 'normal', 15)];
    await act(async () => fire!({ matches: flipped, at: 2, afterGap: true, tooClose: false }));
    expect(screen.getByRole('heading', { name: /2-1B Surgical Droid/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, add it' }));
    expect(await screen.findByText('Added to Intake')).toBeInTheDocument();
    const lines = await db.intakeLines.toArray();
    expect(lines.map((l) => [l.num, l.count])).toEqual([['059', 1]]);
  });

  it('clears the result on Rescan rather than showing the scan before it', async () => {
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    const scout = [match('080', 80, 'normal', 10), match('059', 59, 'normal', 90)];
    const droid = [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)];
    await act(async () => fire!({ matches: scout, at: 1, afterGap: true, tooClose: false }));
    await act(async () => fire!({ matches: droid, at: 2, afterGap: true, tooClose: false }));
    expect(await screen.findByRole('heading', { name: /2-1B Surgical Droid/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(1));
    expect(screen.queryByRole('heading', { name: /Nameless Scout/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rescan' })).not.toBeInTheDocument();
    // The scout is still listed, as an earlier scan.
    expect(screen.getByText('Nameless Scout')).toBeInTheDocument();

    // A second scout read straight after counts — it is not taken for the first re-read.
    await act(async () => fire!({ matches: scout, at: 3, afterGap: false, tooClose: false }));
    expect(await screen.findByRole('heading', { name: /Nameless Scout/ })).toBeInTheDocument();
    await waitFor(async () =>
      expect((await db.intakeLines.toArray()).map((l) => [l.num, l.count])).toEqual([['080', 2]]),
    );
  });

  it('flips the latest scan to foil and back with one tap', async () => {
    await scan('059', 'normal');
    const foil = await screen.findByRole('button', { name: '✦ Foil' });
    expect(foil).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(foil);
    await waitFor(async () =>
      expect((await db.intakeLines.toArray()).map((l) => l.num)).toEqual(['059F']),
    );
    expect(screen.getByText(/SOR #059F · Foil/)).toBeInTheDocument();
    expect(await stack()).toEqual([['059F', 'binder', null]]);
    expect(screen.getByRole('button', { name: '✦ Foil' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '✦ Foil' }));
    await waitFor(async () =>
      expect((await db.intakeLines.toArray()).map((l) => l.num)).toEqual(['059']),
    );
  });

  it('records every scan as its foil printing in Foils mode', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Foils off/ }));
    expect(screen.getByRole('button', { name: /Foils on/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({
        matches: [match('059', 59, 'normal', 10), match('080', 80, 'normal', 90)],
        at: 1,
        afterGap: true,
        tooClose: false,
      });
    });
    await waitFor(async () =>
      expect((await db.intakeLines.toArray()).map((l) => l.num)).toEqual(['059F']),
    );
    expect(localStorage.getItem('scan.foils')).toBe('1');
  });

  it('records a card with no foil printing as it is, even in Foils mode', async () => {
    localStorage.setItem('scan.foils', '1');
    renderPage();
    await waitFor(() => expect(fire).not.toBeNull());
    await act(async () => {
      fire!({
        matches: [match('080', 80, 'normal', 10), match('059', 59, 'normal', 90)],
        at: 1,
        afterGap: true,
        tooClose: false,
      });
    });
    await waitFor(async () =>
      expect((await db.intakeLines.toArray()).map((l) => l.num)).toEqual(['080']),
    );
    expect(screen.queryByRole('button', { name: '✦ Foil' })).not.toBeInTheDocument();
  });

  it('offers Rescan on the "couldn’t recognise" prompt, for a hiccup like an empty tray', async () => {
    phase = 'stuck';
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Rescan' }));
    expect(retry).toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(await db.intakeLines.count()).toBe(0);
  });
});
