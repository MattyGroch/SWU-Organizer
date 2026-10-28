import { describe, expect, it } from 'vitest';
import type { DeckContents } from './deckContents';
import { deckToSwudbJson, formatSwudbJson, swudbCardId } from './deckExport';
import { parseDeckJson } from './decklist';

const ref = (setKey: string, baseNumber: number, count = 1) => ({ setKey, baseNumber, count });

const premier: DeckContents & { name: string } = {
  name: 'Vader Aggro',
  leader: ref('SOR', 10),
  base: ref('SOR', 26),
  mainDeck: [ref('SOR', 46, 3), ref('TS26', 67, 2)],
  sideboard: [ref('SHD', 185, 1)],
};

// Karabast's own check, from forceteki-client's checkJson.ts.
const KARABAST_CARD_ID = /^[A-Z0-9]{3,4}_\d{1,3}$/;
const KARABAST_SAFE = /[^\x20-\x7E]|[^\w\s{}[\]:"',.\-_]/g;

describe('swudbCardId', () => {
  it('pads the number to three digits', () => {
    expect(swudbCardId('SOR', 5)).toBe('SOR_005');
    expect(swudbCardId('TS26', 123)).toBe('TS26_123');
  });
});

describe('deckToSwudbJson', () => {
  it('lists leader, base, deck and sideboard by SWUDB id', () => {
    expect(deckToSwudbJson(premier)).toEqual({
      metadata: { name: 'Vader Aggro' },
      leader: { id: 'SOR_010', count: 1 },
      base: { id: 'SOR_026', count: 1 },
      deck: [
        { id: 'SOR_046', count: 3 },
        { id: 'TS26_067', count: 2 },
      ],
      sideboard: [{ id: 'SHD_185', count: 1 }],
    });
  });

  it('writes a Twin Suns second leader as `secondleader`', () => {
    const json = deckToSwudbJson({ ...premier, secondLeader: ref('TS26', 5) });
    expect(json.secondleader).toEqual({ id: 'TS26_005', count: 1 });
  });

  it('merges a card listed twice and drops zero counts', () => {
    const json = deckToSwudbJson({
      ...premier,
      mainDeck: [ref('SOR', 46, 1), ref('SOR', 46, 2), ref('SOR', 50, 0)],
    });
    expect(json.deck).toEqual([{ id: 'SOR_046', count: 3 }]);
  });

  it('keeps the name to characters Karabast does not strip', () => {
    expect(deckToSwudbJson({ ...premier, name: 'Han & "Chewie" — Bo-Katan’s' }).metadata.name).toBe(
      'Han Chewie Bo-Katans',
    );
    expect(deckToSwudbJson({ ...premier, name: '★' }).metadata.name).toBe('Deck');
  });
});

describe('formatSwudbJson', () => {
  it('survives Karabast’s sanitising and validation', () => {
    const text = formatSwudbJson({ ...premier, name: 'It\'s "mine" \\ ok?' });
    const sanitised = text.replace(KARABAST_SAFE, '');
    const parsed = JSON.parse(sanitised) as ReturnType<typeof deckToSwudbJson>;
    expect(sanitised).toBe(text);
    expect(text.length).toBeLessThan(5000);
    for (const card of [parsed.leader, parsed.base, ...parsed.deck, ...parsed.sideboard]) {
      expect(card.id).toMatch(KARABAST_CARD_ID);
    }
  });

  it('reads back through our own JSON import', () => {
    const parsed = parseDeckJson(formatSwudbJson({ ...premier, secondLeader: ref('TS26', 5) }));
    expect(parsed.malformed).toEqual([]);
    expect(parsed.deckName).toBe('Vader Aggro');
    expect(parsed.entries.map((e) => [e.role, e.exact, e.count])).toEqual([
      ['leader', { setKey: 'SOR', printingNumber: 10 }, 1],
      ['leader', { setKey: 'TS26', printingNumber: 5 }, 1],
      ['base', { setKey: 'SOR', printingNumber: 26 }, 1],
      ['deck', { setKey: 'SOR', printingNumber: 46 }, 3],
      ['deck', { setKey: 'TS26', printingNumber: 67 }, 2],
      ['sideboard', { setKey: 'SHD', printingNumber: 185 }, 1],
    ]);
  });
});
