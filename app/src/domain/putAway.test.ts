import { describe, expect, it } from 'vitest';

import { binderLayout, pageToSpread } from './binder';
import {
  pileCell,
  pileName,
  planPutAway,
  type PutAwayStep,
  type StackCardInput,
  type StackFate,
} from './putAway';
import type { SetKey } from './types';

const SET_ORDER: SetKey[] = ['SOR', 'SHD', 'TWI', 'TS26'];

let nextId = 0;
function card(setKey: SetKey, base: number, fate: StackFate = 'binder'): StackCardInput {
  return {
    id: `c${nextId++}`,
    setKey,
    base,
    num: String(base).padStart(3, '0'),
    variant: 'normal',
    fate,
  };
}

/** A repeatable shuffle, so a failure reproduces. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Plays the steps against a physical stack: every card a step names must be the one on
 * top of the hand at that moment. Returns the cards in the order they were filed or set
 * aside.
 */
function play(stack: StackCardInput[], steps: PutAwayStep[]) {
  let hand = [...stack];
  let piles: StackCardInput[][] = [];
  const filed: Extract<PutAwayStep, { kind: 'file' }>[] = [];
  const aside: StackCardInput[] = [];
  for (const step of steps) {
    if (step.kind === 'scoop') {
      expect(piles.length).toBeLessThanOrEqual(step.piles);
      // Pile 1 onto pile 2, onto pile 3…: pile 1 on top, each pile's last card first.
      const scooped = piles.flatMap((pile) => [...(pile ?? [])].reverse());
      hand = [...scooped, ...hand];
      piles = [];
      continue;
    }
    if (step.kind === 'bulk') {
      // The list names what is left in hand, top first.
      const inHand = step.cards.filter((l) => !l.fromSide).map((l) => l.card.id);
      expect(inHand).toEqual(hand.map((c) => c.id));
      aside.push(...hand);
      hand = [];
      continue;
    }
    if (step.kind === 'file' && step.fromSide) {
      filed.push(step);
      continue;
    }
    const top = hand.shift();
    expect(top?.id).toBe(step.card.id);
    if (step.kind === 'deal') (piles[step.pile] ??= []).push(top!);
    else filed.push(step);
  }
  expect(hand).toEqual([]);
  expect(piles.flat()).toEqual([]);
  return { filed, aside };
}

/** Every run of filing between "turn to" markers stays inside one spread of one set. */
function expectNoFlipping(filed: Extract<PutAwayStep, { kind: 'file' }>[]) {
  let open: string | undefined;
  for (const step of filed) {
    const here = `${step.spot.setKey}:${pageToSpread(step.spot.page)}`;
    if (step.turnTo) {
      expect(`${step.turnTo.setKey}:${step.turnTo.spread}`).toBe(here);
      open = here;
    }
    expect(open).toBe(here);
  }
}

describe('planPutAway', () => {
  it('files a stack already in binder order without dealing', () => {
    const stack = [card('SOR', 1), card('SOR', 2), card('SOR', 30), card('SHD', 4)];
    const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 });
    expect(steps.map((s) => s.kind)).toEqual(['file', 'file', 'file', 'file']);
    const { filed } = play(stack, steps);
    expectNoFlipping(filed);
    expect(filed.filter((s) => s.turnTo).map((s) => s.turnTo!.pages)).toEqual([[1], [2, 3], [1]]);
  });

  it('gives each spread its own pile when there are enough', () => {
    // Spreads: SOR 1 (page 1), SOR 1 again (page 2–3 are spread 1), SHD page 1.
    const stack = [card('SHD', 1), card('SOR', 13), card('SOR', 1), card('SOR', 25)];
    const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 });
    const deals = steps.filter((s) => s.kind === 'deal');
    expect(deals.map((s) => s.pile)).toEqual([2, 1, 0, 1]);
    const { filed } = play(stack, steps);
    expectNoFlipping(filed);
    expect(filed.map((s) => `${s.spot.setKey}${s.card.base}`)).toEqual([
      'SOR1',
      'SOR25',
      'SOR13',
      'SHD1',
    ]);
  });

  it('keeps duplicate copies as separate cards in their own places', () => {
    const a = card('SOR', 40);
    const b = card('SOR', 40);
    const stack = [a, card('SOR', 1), b];
    const { filed } = play(stack, planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 }));
    expect(filed.map((s) => s.card.id).sort()).toEqual([a.id, b.id, stack[1]!.id].sort());
  });

  it('sets aside bulk, unsure and hidden-set cards on one last pile', () => {
    const stack = [
      card('SOR', 5, 'bulk'),
      card('SOR', 50),
      card('SOR', 9, 'bulk'),
      card('TS26', 3),
      card('SOR', 2, 'unsure'),
      card('SOR', 1),
    ];
    const steps = planPutAway(stack, {
      setOrder: SET_ORDER,
      hiddenSets: new Set(['TS26']),
      sorters: 1,
    });
    const deals = steps.filter((s) => s.kind === 'deal');
    const asidePile = Math.max(...deals.map((s) => s.pile));
    expect(deals.filter((s) => s.aside).every((s) => s.pile === asidePile)).toBe(true);
    const { aside } = play(stack, steps);
    expect(aside).toHaveLength(4);
    // Set-aside cards come last, after everything is filed, as one list.
    const last = steps.at(-1)!;
    expect(steps.filter((s) => s.kind === 'bulk')).toHaveLength(1);
    expect(last.kind === 'bulk' && last.cards.map((l) => l.reason).sort()).toEqual([
      'bulk',
      'bulk',
      'hidden',
      'unsure',
    ]);
  });

  it('never uses more piles than the sorters hold', () => {
    const stack = shuffled(
      Array.from({ length: 120 }, (_, i) => card('SOR', 1 + i * 2)),
      7,
    );
    for (const sorters of [1, 2, 3]) {
      const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters });
      for (const step of steps) {
        if (step.kind === 'deal') expect(step.pile).toBeLessThan(sorters * 9);
        if (step.kind === 'scoop') expect(step.piles).toBeLessThanOrEqual(sorters * 9);
      }
    }
  });

  it('deals wide piles again until no pile needs a page turn', () => {
    const stack = shuffled(
      Array.from({ length: 120 }, (_, i) => card('SOR', 1 + i * 2)),
      11,
    );
    const one = planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 });
    const three = planPutAway(stack, { setOrder: SET_ORDER, sorters: 3 });
    expect(one.filter((s) => s.kind === 'scoop').length).toBeGreaterThan(1);
    expect(three.filter((s) => s.kind === 'deal').length).toBeLessThan(
      one.filter((s) => s.kind === 'deal').length,
    );
  });

  it('files every card exactly once, turning only to whole spreads', () => {
    const sets: SetKey[] = ['SOR', 'SHD', 'TWI'];
    for (const size of [1, 5, 9, 10, 27, 60, 200]) {
      for (const sorters of [1, 2, 3]) {
        const stack = shuffled(
          Array.from({ length: size }, (_, i) =>
            card(sets[i % 3]!, 1 + ((i * 37) % 260), i % 17 === 5 ? 'bulk' : 'binder'),
          ),
          size * 31 + sorters,
        );
        const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters });
        const { filed, aside } = play(stack, steps);
        expect(filed.length + aside.length).toBe(size);
        expect(new Set([...filed.map((s) => s.card.id), ...aside.map((c) => c.id)]).size).toBe(
          size,
        );
        expectNoFlipping(filed);
        for (const step of filed) {
          expect(step.spot).toEqual({ setKey: step.card.setKey, ...binderLayout(step.card.base) });
        }
      }
    }
  });

  it('files a single spread with more cards than piles as one pile', () => {
    const stack = shuffled(
      Array.from({ length: 30 }, (_, i) => card('SOR', 14 + (i % 23))),
      3,
    );
    const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 });
    expect(steps.every((s) => s.kind === 'file')).toBe(true);
    expect(steps.filter((s) => s.kind === 'file' && s.turnTo)).toHaveLength(1);
  });

  it('sends a Normal from the same stack to bulk when a better printing replaces it', () => {
    const normals = [card('SOR', 40), card('SOR', 40), card('SOR', 40)];
    const hyper: StackCardInput = {
      ...card('SOR', 40),
      num: '300',
      variant: 'hyperspace',
      swapOut: { num: '040', variant: 'normal' },
    };
    const stack = [hyper, ...normals];
    const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 });
    const { filed, aside } = play(stack, steps);
    expect(filed.map((s) => s.card.num).sort()).toEqual(['040', '040', '300']);
    // Nothing to take out of the binder: the replaced copy never got there.
    expect(filed.every((s) => !s.card.swapOut)).toBe(true);
    expect(aside).toHaveLength(1);
    expect(steps.flatMap((s) => (s.kind === 'bulk' ? s.cards.map((l) => l.reason) : []))).toEqual([
      'replaced',
    ]);
  });

  it('still says to take the weaker copy out when it is already in the binder', () => {
    const hyper: StackCardInput = {
      ...card('SOR', 40),
      num: '300',
      variant: 'hyperspace',
      swapOut: { num: '040', variant: 'normal' },
    };
    const { filed } = play([hyper], planPutAway([hyper], { setOrder: SET_ORDER, sorters: 1 }));
    expect(filed[0]!.card.swapOut).toEqual({ num: '040', variant: 'normal' });
  });

  it('lists an all-bulk stack without dealing it', () => {
    const stack = [card('SOR', 5, 'bulk'), card('SOR', 9, 'bulk')];
    const steps = planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 });
    expect(steps.map((s) => s.kind)).toEqual(['bulk']);
    play(stack, steps);
  });

  it('places sets missing from the set order after the known ones', () => {
    const stack = [card('NEW', 1), card('SOR', 1)];
    const { filed } = play(stack, planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 }));
    expect(filed.map((s) => s.spot.setKey)).toEqual(['SOR', 'NEW']);
  });
});

describe('planPutAway, pulling cards partway through', () => {
  const stack = () => [
    card('SOR', 200),
    card('SOR', 1),
    card('SOR', 5, 'bulk'),
    card('SOR', 100),
    card('SOR', 3),
  ];

  /** The card in hand at step `at`, pulled there. */
  function pullAt(steps: PutAwayStep[], at: number) {
    const step = steps[at]!;
    expect(step.kind === 'deal' || step.kind === 'file').toBe(true);
    return { id: (step as { card: StackCardInput }).card.id, at };
  }

  it('keeps every step before the pull, and drops the card from then on', () => {
    const cards = stack();
    const before = planPutAway(cards, { setOrder: SET_ORDER, sorters: 1 });
    const pull = pullAt(before, 3);
    const fixed = { ...cards.find((c) => c.id === pull.id)!, num: '150', base: 150 };
    const after = planPutAway(cards, {
      setOrder: SET_ORDER,
      sorters: 1,
      pulls: [pull],
      toOneSide: [fixed],
    });
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    const rest = after.slice(3).filter((s) => s.kind !== 'scoop' && s.kind !== 'bulk');
    expect(
      rest.filter((s) => 'card' in s && s.card === cards.find((c) => c.id === pull.id)),
    ).toEqual([]);
    // Filed at the end from the side pile, as what it really is.
    const fromSide = after.filter((s) => s.kind === 'file' && s.fromSide);
    expect(fromSide).toHaveLength(1);
    expect(fromSide[0]!.kind === 'file' && fromSide[0]!.spot.page).toBe(binderLayout(150).page);
    expect(after.at(-1)!.kind).toBe('bulk');
  });

  it('still matches the stack in hand once a card is taken out', () => {
    const cards = shuffled(
      Array.from({ length: 60 }, (_, i) =>
        card('SOR', 1 + ((i * 37) % 260), i % 9 ? 'binder' : 'bulk'),
      ),
      5,
    );
    let pulls: { id: string; at: number }[] = [];
    let steps = planPutAway(cards, { setOrder: SET_ORDER, sorters: 1 });
    // Pull three cards at different points, each from the plan as it stood then.
    for (const want of [10, 40, 70]) {
      const at = steps.findIndex((s, i) => i >= want && (s.kind === 'deal' || s.kind === 'file'));
      pulls = [...pulls, pullAt(steps, at)];
      steps = planPutAway(cards, { setOrder: SET_ORDER, sorters: 1, pulls });
    }
    // Replaying with the pulled cards removed from the stack at their step:
    let hand = [...cards];
    let piles: StackCardInput[][] = [];
    const seen = new Set<string>();
    steps.forEach((step, i) => {
      for (const p of pulls) {
        if (p.at === i && hand[0]?.id === p.id) hand.shift();
      }
      if (step.kind === 'scoop') {
        hand = [...piles.flatMap((pile) => [...(pile ?? [])].reverse()), ...hand];
        piles = [];
        return;
      }
      if (step.kind === 'bulk') {
        expect(step.cards.map((l) => l.card.id)).toEqual(hand.map((c) => c.id));
        hand.forEach((c) => seen.add(c.id));
        hand = [];
        return;
      }
      expect(hand[0]?.id).toBe(step.card.id);
      const top = hand.shift()!;
      if (step.kind === 'deal') (piles[step.pile] ??= []).push(top);
      else seen.add(top.id);
    });
    expect(seen.size).toBe(cards.length - 3);
  });

  it('turns the binder again when the step that turned it is dropped', () => {
    const a = card('SOR', 13);
    const b = card('SOR', 14);
    const cards = [a, b];
    const before = planPutAway(cards, { setOrder: SET_ORDER, sorters: 1 });
    expect(before.map((s) => s.kind === 'file' && Boolean(s.turnTo))).toEqual([true, false]);
    const after = planPutAway(cards, {
      setOrder: SET_ORDER,
      sorters: 1,
      pulls: [{ id: a.id, at: 0 }],
    });
    expect(after).toHaveLength(1);
    expect(after[0]!.kind === 'file' && after[0]!.turnTo?.pages).toEqual([2, 3]);
  });

  it('lists side cards that miss the binder after the stack in hand', () => {
    const cards = [card('SOR', 1), card('SOR', 5, 'bulk')];
    const extra = card('SOR', 9, 'bulk');
    const steps = planPutAway(cards, { setOrder: SET_ORDER, sorters: 1, toOneSide: [extra] });
    const last = steps.at(-1)!;
    expect(last.kind === 'bulk' && last.cards.map((l) => [l.card.id, l.fromSide])).toEqual([
      [cards[1]!.id, undefined],
      [extra.id, true],
    ]);
  });

  it('takes a pulled card off the leftover list', () => {
    const cards = [card('SOR', 1), card('SOR', 5, 'bulk')];
    const steps = planPutAway(cards, {
      setOrder: SET_ORDER,
      sorters: 1,
      pulls: [{ id: cards[1]!.id, at: 4 }],
    });
    expect(steps.some((s) => s.kind === 'bulk')).toBe(false);
  });
});

describe('pile names', () => {
  it('numbers cells 1–9 in reading order, sorter by sorter', () => {
    expect(pileCell(0)).toEqual({ sorter: 0, cell: 0, row: 0, column: 0 });
    expect(pileCell(5)).toEqual({ sorter: 0, cell: 5, row: 1, column: 2 });
    expect(pileCell(13)).toEqual({ sorter: 1, cell: 4, row: 1, column: 1 });
  });

  it('names the sorter only when there is more than one', () => {
    expect(pileName(4, 1)).toBe('Pile 5');
    expect(pileName(4, 2)).toBe('Red 5');
    expect(pileName(13, 2)).toBe('Blue 5');
  });
});
