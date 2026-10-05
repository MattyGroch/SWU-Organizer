import type { VariantSlug } from './catalog';
import { binderLayout, pageToSpread, spreadToPrimaryPage } from './binder';
import type { SetKey } from './types';

/**
 * Putting a scanned stack away without reading a single card number.
 *
 * The stack is still in the order it was scanned, so the app knows every card's place in
 * it. It turns that into a list of one-card steps: deal this card onto pile 5; scoop the
 * piles back up; file this card at page 11, row 2, column 3. Deals split the stack into
 * binder ranges, and any range that would still mean flipping back and forth is dealt
 * again, so every card is filed with the binder already open at its spread.
 *
 * Physical conventions the steps rely on: a dealt card goes on top of its pile, and the
 * piles are scooped up from pile 1 onto pile 2, onto pile 3 and so on — so pile 1 ends up
 * on top, each pile's last-dealt card first.
 */

/** Where a scanned copy goes: its binder pocket, or somewhere other than the binder. */
export type StackFate = 'binder' | 'spare' | 'bulk' | 'unsure';

export type StackCardInput = {
  id: string;
  setKey: SetKey;
  base: number;
  num: string;
  variant: VariantSlug;
  fate: StackFate;
  /** The weaker copy this one replaces in its pocket, which leaves for bulk. */
  swapOut?: { num: string; variant: VariantSlug };
};

/** Why a card is set aside rather than filed. `hidden`: its set has no binder. */
export type AsideReason = Exclude<StackFate, 'binder'> | 'hidden';

export type BinderSpot = { setKey: SetKey; page: number; row: number; column: number };

export type PutAwayStep =
  | { kind: 'deal'; card: StackCardInput; pile: number; piles: number; aside: boolean }
  | { kind: 'scoop'; piles: number }
  | {
      kind: 'file';
      card: StackCardInput;
      spot: BinderSpot;
      /** Set when the binder must be turned to a new spread (or set) before this card. */
      turnTo?: SpreadRef;
    }
  | { kind: 'aside'; card: StackCardInput; reason: AsideReason };

export type SpreadRef = { setKey: SetKey; spread: number; pages: [number, number] | [number] };

/** Piles per sorter: a 3×3 grid. */
export const PILES_PER_SORTER = 9;

type Placed = { card: StackCardInput; aside?: AsideReason; setIndex: number; spread: number };

/**
 * Every step to put a stack away, in order.
 *
 * `cards` is the stack top first — scan order. Sets missing from `setOrder` sort last.
 */
export function planPutAway(
  cards: readonly StackCardInput[],
  {
    setOrder,
    hiddenSets = new Set<SetKey>(),
    sorters,
  }: { setOrder: readonly SetKey[]; hiddenSets?: ReadonlySet<SetKey>; sorters: number },
): PutAwayStep[] {
  const rank = new Map(setOrder.map((key, i) => [key, i]));
  const placed: Placed[] = cards.map((card) => {
    const aside: AsideReason | undefined =
      card.fate !== 'binder' ? card.fate : hiddenSets.has(card.setKey) ? 'hidden' : undefined;
    return {
      card,
      ...(aside ? { aside } : {}),
      setIndex: rank.get(card.setKey) ?? setOrder.length,
      spread: pageToSpread(binderLayout(card.base).page),
    };
  });

  const steps: PutAwayStep[] = [];
  const state = { open: undefined as string | undefined };
  work(placed, Math.max(1, sorters) * PILES_PER_SORTER, steps, state);
  return steps;
}

function spreadKey(p: Placed): string {
  return `${p.setIndex}:${p.card.setKey}:${p.spread}`;
}

function compareSpread(a: Placed, b: Placed): number {
  return (
    a.setIndex - b.setIndex || a.card.setKey.localeCompare(b.card.setKey) || a.spread - b.spread
  );
}

/** True when the cards can be filed as they come, turning the binder forward only. */
function inSpreadOrder(cards: readonly Placed[]): boolean {
  for (let i = 1; i < cards.length; i++) {
    if (compareSpread(cards[i - 1]!, cards[i]!) > 0) return false;
  }
  return true;
}

function work(
  cards: Placed[],
  cells: number,
  steps: PutAwayStep[],
  state: { open: string | undefined },
): void {
  if (!cards.length) return;
  const asides = cards.filter((p) => p.aside);
  const binder = cards.filter((p) => !p.aside);

  if (!asides.length && inSpreadOrder(binder)) {
    fileAll(binder, steps, state);
    return;
  }

  // One pile per group of neighbouring spreads; set-aside cards get a pile of their own,
  // right after the last binder pile, so the piles in use are always 1…n with no gaps.
  const groups = partitionSpreads(binder, asides.length ? cells - 1 : cells);
  const pileOf = new Map<string, number>();
  groups.forEach((group, i) => group.forEach((key) => pileOf.set(key, i)));
  const asidePile = groups.length;
  const piles = groups.length + (asides.length ? 1 : 0);

  const dealt: Placed[][] = Array.from({ length: piles }, () => []);
  for (const p of cards) {
    const pile = p.aside ? asidePile : pileOf.get(spreadKey(p))!;
    dealt[pile]!.push(p);
    steps.push({ kind: 'deal', card: p.card, pile, piles, aside: Boolean(p.aside) });
  }
  steps.push({ kind: 'scoop', piles });

  // After the scoop, pile 1 is on top, each pile's last-dealt card first.
  for (let i = 0; i < groups.length; i++) {
    work(dealt[i]!.reverse(), cells, steps, state);
  }
  if (asides.length) {
    for (const p of dealt[asidePile]!.reverse()) {
      steps.push({ kind: 'aside', card: p.card, reason: p.aside! });
    }
  }
}

function fileAll(cards: Placed[], steps: PutAwayStep[], state: { open: string | undefined }) {
  for (const p of cards) {
    const key = spreadKey(p);
    const { page, row, column } = binderLayout(p.card.base);
    const step: PutAwayStep = {
      kind: 'file',
      card: p.card,
      spot: { setKey: p.card.setKey, page, row, column },
    };
    if (state.open !== key) {
      step.turnTo = spreadRef(p.card.setKey, p.spread);
      state.open = key;
    }
    steps.push(step);
  }
}

export function spreadRef(setKey: SetKey, spread: number): SpreadRef {
  const first = spreadToPrimaryPage(spread);
  return { setKey, spread, pages: spread === 0 ? [first] : [first, first + 1] };
}

/**
 * Splits the distinct spreads (in binder order) into at most `cells` contiguous groups,
 * keeping the largest group as small as possible. A spread is never split.
 */
function partitionSpreads(cards: readonly Placed[], cells: number): string[][] {
  const counts = new Map<string, { p: Placed; n: number }>();
  for (const p of cards) {
    const key = spreadKey(p);
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, { p, n: 1 });
  }
  const units = [...counts.entries()]
    .sort(([, a], [, b]) => compareSpread(a.p, b.p))
    .map(([key, { n }]) => ({ key, n }));
  if (!units.length) return [];
  if (units.length <= cells) return units.map((u) => [u.key]);

  const fits = (limit: number) => {
    let groups = 1;
    let size = 0;
    for (const u of units) {
      if (size + u.n > limit) {
        groups++;
        size = 0;
      }
      size += u.n;
    }
    return groups <= cells;
  };
  let low = Math.max(...units.map((u) => u.n));
  let high = units.reduce((sum, u) => sum + u.n, 0);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid + 1;
  }

  const groups: string[][] = [[]];
  let size = 0;
  units.forEach((u, i) => {
    // Never leave fewer spreads than piles still to fill: an empty pile is a wasted cell.
    const remaining = units.length - i;
    const open = cells - groups.length;
    if (groups.at(-1)!.length && (size + u.n > low || remaining <= open)) {
      groups.push([]);
      size = 0;
    }
    groups.at(-1)!.push(u.key);
    size += u.n;
  });
  return groups;
}

/** A pile's place in the sorters: which sorter, and which cell of its 3×3 grid. */
export function pileCell(pile: number): {
  sorter: number;
  cell: number;
  row: number;
  column: number;
} {
  const sorter = Math.floor(pile / PILES_PER_SORTER);
  const cell = pile % PILES_PER_SORTER;
  return { sorter, cell, row: Math.floor(cell / 3), column: cell % 3 };
}

export const SORTER_NAMES = ['Red', 'Blue', 'Green'] as const;

/** "Pile 5" with one sorter in use; "Blue 5" with several. */
export function pileName(pile: number, sorters: number): string {
  const { sorter, cell } = pileCell(pile);
  return sorters > 1
    ? `${SORTER_NAMES[sorter] ?? `Sorter ${sorter + 1}`} ${cell + 1}`
    : `Pile ${cell + 1}`;
}
