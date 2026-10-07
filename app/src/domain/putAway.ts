import type { VariantSlug } from './catalog';
import { binderLayout, pageToSpread, spreadToPrimaryPage } from './binder';
import type { SetKey } from './types';

/**
 * Putting a scanned stack away without reading a single card number.
 *
 * The stack is still in the order it was scanned — the last card scanned on top — so the
 * app knows every card's place in it. It turns that into a list of one-card steps: deal this card onto pile 5; scoop the
 * piles back up; file this card at page 11, row 2, column 3. Deals split the stack into
 * binder ranges, and any range that would still mean flipping back and forth is dealt
 * again, so every card is filed with the binder already open at its spread.
 *
 * Physical conventions the steps rely on: a dealt card goes on top of its pile, and the
 * piles are scooped up from pile 1 onto pile 2, onto pile 3 and so on — so pile 1 ends up
 * on top, each pile's last-dealt card first.
 *
 * Cards that miss the binder all end up at the bottom, and are left in one last step: a
 * list of what is still in hand, for the bulk box.
 *
 * A plan, once started, never shifts: cards already dealt are sitting on their piles. A
 * card corrected or found missing partway through is pulled out instead — put to one side,
 * its later steps dropped — and filed after everything else (see `pulls`, `toOneSide`).
 * One corrected while it is being filed is in hand with the binder open, so it is filed
 * there and then instead (`Pull.now`).
 */

/** Where a scanned copy goes: its binder pocket, the bulk box, or nowhere yet. */
export type StackFate = 'binder' | 'bulk' | 'unsure';

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

/**
 * Why a card is set aside rather than filed. `hidden`: its set has no binder. `replaced`:
 * a better printing scanned later in the same stack takes its place in the pocket.
 */
export type AsideReason = Exclude<StackFate, 'binder'> | 'hidden' | 'replaced';

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
      /** From the cards put to one side partway through, not the stack in hand. */
      fromSide?: true;
    }
  /** Always the last step: every card left over, top of the stack in hand first. */
  | { kind: 'bulk'; cards: LeftoverCard[] };

export type LeftoverCard = {
  card: StackCardInput;
  reason: AsideReason;
  /** From the cards put to one side partway through, not the stack in hand. */
  fromSide?: true;
};

/**
 * A card taken out of the plan at step `at`: its steps from there on are dropped. With
 * `now`, it was corrected while being filed, binder open: what it really is is filed at
 * that same step, instead of at the end.
 */
export type Pull = { id: string; at: number; now?: true };

export type SpreadRef = { setKey: SetKey; spread: number; pages: [number, number] | [number] };

/** Piles per sorter: a 3×3 grid. */
export const PILES_PER_SORTER = 9;

type Placed = { card: StackCardInput; aside?: AsideReason; setIndex: number; spread: number };

/**
 * Every step to put a stack away, in order.
 *
 * `cards` is the stack top first: the last card scanned first, as it was when putting
 * away started. Sets missing from `setOrder` sort last.
 *
 * `pulls`, in the order they were made, take cards out partway through; `toOneSide` is
 * what those cards really are now (plus any copy the scanner missed), filed at the end.
 */
export function planPutAway(
  cards: readonly StackCardInput[],
  {
    setOrder,
    hiddenSets = new Set<SetKey>(),
    sorters,
    pulls = [],
    toOneSide = [],
  }: {
    setOrder: readonly SetKey[];
    hiddenSets?: ReadonlySet<SetKey>;
    sorters: number;
    pulls?: readonly Pull[];
    toOneSide?: readonly StackCardInput[];
  },
): PutAwayStep[] {
  const rank = new Map(setOrder.map((key, i) => [key, i]));
  const place = (card: StackCardInput, replaced = false): Placed => {
    const aside: AsideReason | undefined = replaced
      ? 'replaced'
      : card.fate !== 'binder'
        ? card.fate
        : hiddenSets.has(card.setKey)
          ? 'hidden'
          : undefined;
    return {
      card,
      ...(aside ? { aside } : {}),
      setIndex: rank.get(card.setKey) ?? setOrder.length,
      spread: pageToSpread(binderLayout(card.base).page),
    };
  };
  const swaps = resolveSwaps(cards);
  const placed = cards.map((original) => {
    const card = swaps.upgraded.get(original.id) ?? original;
    return place(card, swaps.victims.has(card.id));
  });

  let steps: PutAwayStep[] = [];
  work(placed, Math.max(1, sorters) * PILES_PER_SORTER, steps);
  const last = steps.at(-1);
  let leftover: LeftoverCard[] = [];
  if (last?.kind === 'bulk') {
    steps.pop();
    leftover = last.cards;
  }

  const side = toOneSide.map((card) => place(card));
  const filedNow = new Set<string>();
  // A pulled card was in hand at its step: from there on it is not in the stack.
  for (const { id, at, now } of pulls) {
    const filing = steps[at];
    const inPlace = now && filing?.kind === 'file' && filing.card.id === id;
    steps = steps.filter((s, i) => i < at || !('card' in s) || s.card.id !== id);
    const fixed = inPlace ? side.find((p) => p.card.id === id) : undefined;
    if (fixed && !fixed.aside) {
      steps.splice(at, 0, fileStep(fixed.card));
      filedNow.add(id);
    }
  }
  const pulled = new Set(pulls.map((p) => p.id));
  leftover = leftover.filter((l) => !pulled.has(l.card.id));

  const later = side.filter((p) => !filedNow.has(p.card.id));
  for (const p of later.filter((p) => !p.aside).sort(compareSpotOrder)) {
    steps.push({ ...fileStep(p.card), fromSide: true });
  }
  for (const p of later.filter((p) => p.aside)) {
    leftover.push({ card: p.card, reason: p.aside!, fromSide: true });
  }
  if (leftover.length) steps.push({ kind: 'bulk', cards: leftover });
  markTurns(steps);
  return steps;
}

function compareSpotOrder(a: Placed, b: Placed): number {
  return compareSpread(a, b) || a.card.base - b.card.base;
}

/** Says to turn the binder wherever a card is filed on a different spread from the last. */
function markTurns(steps: PutAwayStep[]): void {
  let open: string | undefined;
  for (const step of steps) {
    if (step.kind !== 'file') continue;
    const spread = pageToSpread(step.spot.page);
    const key = `${step.spot.setKey}:${spread}`;
    if (key !== open) {
      step.turnTo = spreadRef(step.spot.setKey, spread);
      open = key;
    } else {
      delete step.turnTo;
    }
  }
}

/**
 * A better printing bumps the weakest copy in its pocket. When that copy is in this same
 * stack — three Normals scanned, then a Hyperspace — it never reaches the binder: one of
 * those Normals goes straight to bulk, and the Hyperspace has nothing to take out.
 */
function resolveSwaps(cards: readonly StackCardInput[]): {
  victims: Set<string>;
  upgraded: Map<string, StackCardInput>;
} {
  const victims = new Set<string>();
  const upgraded = new Map<string, StackCardInput>();
  for (const card of cards) {
    if (card.fate !== 'binder' || !card.swapOut) continue;
    const { num } = card.swapOut;
    const victim = cards.find(
      (c) =>
        c.fate === 'binder' &&
        c.setKey === card.setKey &&
        c.num === num &&
        !c.swapOut &&
        !victims.has(c.id),
    );
    if (!victim) continue;
    victims.add(victim.id);
    const { swapOut: _, ...rest } = card;
    upgraded.set(card.id, rest);
  }
  return { victims, upgraded };
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

function work(cards: Placed[], cells: number, steps: PutAwayStep[]): void {
  if (!cards.length) return;
  const asides = cards.filter((p) => p.aside);
  const binder = cards.filter((p) => !p.aside);

  if (!asides.length && inSpreadOrder(binder)) {
    for (const p of binder) steps.push(fileStep(p.card));
    return;
  }
  // Nothing for the binder: the whole stack is already the leftover pile.
  if (!binder.length) {
    steps.push({ kind: 'bulk', cards: asides.map((p) => ({ card: p.card, reason: p.aside! })) });
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
    work(dealt[i]!.reverse(), cells, steps);
  }
  if (asides.length) {
    steps.push({
      kind: 'bulk',
      cards: dealt[asidePile]!.reverse().map((p) => ({ card: p.card, reason: p.aside! })),
    });
  }
}

/** Filing one card; `markTurns` adds where the binder must be turned first. */
function fileStep(card: StackCardInput): Extract<PutAwayStep, { kind: 'file' }> {
  const { page, row, column } = binderLayout(card.base);
  return { kind: 'file', card, spot: { setKey: card.setKey, page, row, column } };
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

/**
 * The card under the one in hand at `index`: what the next step takes off the stack. None
 * when a scoop comes first (the hand is empty until then), or when filing from one side.
 */
export function nextInHand(
  steps: readonly PutAwayStep[],
  index: number,
): StackCardInput | undefined {
  const step = steps[index];
  if (!step || step.kind === 'scoop' || step.kind === 'bulk') return undefined;
  if (step.kind === 'file' && step.fromSide) return undefined;
  const next = steps[index + 1];
  if (!next || next.kind === 'scoop') return undefined;
  if (next.kind === 'bulk') return next.cards.find((l) => !l.fromSide)?.card;
  return next.kind === 'file' && next.fromSide ? undefined : next.card;
}
