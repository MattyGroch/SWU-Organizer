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
    const top = hand.shift();
    expect(top?.id).toBe(step.card.id);
    if (step.kind === 'deal') (piles[step.pile] ??= []).push(top!);
    else if (step.kind === 'file') filed.push(step);
    else aside.push(top!);
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
    const reasons = steps.flatMap((s) => (s.kind === 'aside' ? [s.reason] : []));
    expect(reasons.sort()).toEqual(['bulk', 'bulk', 'hidden', 'unsure']);
    // Set-aside cards come last, after everything is filed.
    expect(steps.at(-1)!.kind).toBe('aside');
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
    expect(steps.flatMap((s) => (s.kind === 'aside' ? [s.reason] : []))).toEqual(['replaced']);
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

  it('places sets missing from the set order after the known ones', () => {
    const stack = [card('NEW', 1), card('SOR', 1)];
    const { filed } = play(stack, planPutAway(stack, { setOrder: SET_ORDER, sorters: 1 }));
    expect(filed.map((s) => s.spot.setKey)).toEqual(['SOR', 'NEW']);
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
