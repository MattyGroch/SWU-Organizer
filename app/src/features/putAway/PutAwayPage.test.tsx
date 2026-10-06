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
import { queueScan } from '~/data/intake';
import { logScan, stackCards } from '~/data/stacks';
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
        printings: [
          { num: '080', variant: 'normal' },
          { num: '300', variant: 'hyperspace' },
        ],
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
    // jsdom implements <dialog> but not its modal API.
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    await db.open();
    await db.stacks.clear();
    await db.stackCards.clear();
    await db.meta.clear();
    await db.intakeBatches.clear();
    await db.intakeLines.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const card = (base: number, fate: 'binder' | 'bulk' = 'binder') => ({
    setKey: 'SOR',
    base,
    num: String(base).padStart(3, '0'),
    variant: 'normal' as const,
    fate,
  });

  /**
   * A stack scanned in this order: the scout first, Krennic last — so Krennic is on top.
   * Every copy is in Intake too, as the scanner leaves them.
   */
  const scanStack = async () => {
    for (const c of [card(80), card(59, 'bulk'), card(1)]) {
      await logScan(c);
      await queueScan(c);
    }
    return (await db.stacks.toArray())[0]!.id;
  };
  const queued = async () =>
    (await db.intakeLines.toArray()).map((l) => `${l.num}×${l.count}`).sort();

  it('starts from the last card scanned and runs hands-free to the end', async () => {
    // No pause between steps, so the whole walk plays out at once.
    await writeMeta(db, 'putAway:pace', '0');
    renderPage(await scanStack());

    expect(await screen.findByRole('heading', { name: 'Put away 3 cards' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(spoken.at(-1)).toBe('The last card is to be deposited into bulk.'), {
      timeout: 4000,
    });
    // Piles in binder order: page 1, then pages 6–7; the bulk card gets the last pile.
    expect(spoken).toEqual([
      'Pile 1. Krennic',
      'Pile 3. 2-1B Surgical Droid',
      'Pile 2. Nameless Scout',
      'Scoop up the piles, Pile 1 through Pile 3.',
      'Open Spark of Rebellion to page 1. Right page, row 1, column 1. Krennic.',
      'Open Spark of Rebellion to pages 6 and 7. Right page, row 2, column 4. Nameless Scout.',
      'The last card is to be deposited into bulk.',
    ]);
    // The leftover list waits to be checked.
    expect(screen.getByRole('listitem')).toHaveTextContent('2-1B Surgical Droid');
    await new Promise((r) => setTimeout(r, 50));
    expect(spoken.at(-1)).toBe('The last card is to be deposited into bulk.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('All put away.'));

    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(async () => expect(await db.stacks.count()).toBe(0));
  });

  it('pauses, steps back and forth by hand, and resumes', async () => {
    await writeMeta(db, 'putAway:pace', '10');
    renderPage(await scanStack());
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));
    // The card under Krennic, to check the stack against.
    expect(screen.getByText('Next in the stack').closest('figure')).toHaveTextContent(
      '2-1B Surgical Droid',
    );

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

  it('turns reading aloud off and on partway through', async () => {
    await writeMeta(db, 'putAway:pace', '10');
    renderPage(await scanStack());
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));

    await userEvent.click(screen.getByRole('button', { name: 'Read aloud: on' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Step 2 of 7/)).toBeInTheDocument();
    expect(spoken).toEqual(['Pile 1. Krennic']);

    await userEvent.click(screen.getByRole('button', { name: 'Read aloud: off' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 3. 2-1B Surgical Droid'));
  });

  it('removes a card scanned twice from the stack and from Intake', async () => {
    await writeMeta(db, 'putAway:pace', '10');
    const stackId = await scanStack();
    renderPage(stackId);
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));

    await userEvent.click(screen.getByRole('button', { name: 'Wrong card?' }));
    await userEvent.click(screen.getByRole('button', { name: /It isn’t here/ }));
    // The rest of the plan stands: the next card goes to the pile it always would.
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 3. 2-1B Surgical Droid'));
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
    expect(await queued()).toEqual(['059×1', '080×1']);
    expect((await stackCards(stackId)).map((c) => c.base)).toEqual([80, 59]);
  });

  it('files a corrected card from one side at the end, with Intake corrected too', async () => {
    await writeMeta(db, 'putAway:pace', '10');
    const stackId = await scanStack();
    renderPage(stackId);
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 2. Nameless Scout'));

    await userEvent.click(screen.getByRole('button', { name: 'Wrong card?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hyperspace' }));
    await waitFor(() => expect(spoken.at(-1)).toMatch(/^Scoop up the piles/));
    expect(await queued()).toEqual(['001×1', '059×1', '300×1']);

    await writeMeta(db, 'putAway:pace', '0');
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(spoken.at(-1)).toMatch(/deposited into bulk/), { timeout: 4000 });
    expect(spoken.slice(-3)).toEqual([
      'Open Spark of Rebellion to page 1. Right page, row 1, column 1. Krennic.',
      'From the cards to one side. Open Spark of Rebellion to pages 6 and 7. Right page, row 2, column 4. Nameless Scout.',
      'The last card is to be deposited into bulk.',
    ]);
  });

  it('adds a copy the scanner missed, to Intake and to the end of the walk', async () => {
    await writeMeta(db, 'putAway:pace', '10');
    const stackId = await scanStack();
    renderPage(stackId);
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(spoken.at(-1)).toBe('Pile 1. Krennic'));

    await userEvent.click(screen.getByRole('button', { name: 'Wrong card?' }));
    await userEvent.click(screen.getByRole('button', { name: /There’s another copy/ }));
    await waitFor(async () => expect(await queued()).toEqual(['001×2', '059×1', '080×1']));
    expect(await screen.findByText(/Step 1 of 8/)).toBeInTheDocument();
    expect((await stackCards(stackId)).map((c) => c.base)).toEqual([80, 59, 1, 1]);
  });
});
