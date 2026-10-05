import { promoParts, type LoadedSet, type VariantSlug } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import { RESERVED_SET_KEYS, type ImportSkip, type ImportedPrinting } from './types';

export type CatalogLookup = ReadonlyMap<SetKey, LoadedSet>;

/**
 * Turns a parsed source row into a concrete printing, or explains why it cannot.
 *
 * Collects skips with a reason rather than dropping silently: an import that quietly
 * loses a third of a collection is indistinguishable from one that worked.
 */
export class PrintingResolver {
  private readonly accumulated = new Map<string, ImportedPrinting>();
  readonly skipped: ImportSkip[] = [];
  recognized = 0;

  /** Promo set code (`SOROP`) → the base set its printings belong to (`SOR`). */
  private readonly promoSets = new Map<string, SetKey>();

  constructor(private readonly catalog: CatalogLookup) {
    for (const set of catalog.values()) {
      for (const printings of set.printingsByBase.values()) {
        for (const printing of printings) {
          const promo = promoParts(printing.num);
          if (promo) this.promoSets.set(promo.set, set.setKey);
        }
      }
    }
  }

  private skip(reason: ImportSkip['reason'], detail: string): false {
    this.skipped.push({ reason, detail });
    return false;
  }

  /** Whether the catalog has this printing of the card — e.g. not every card has a promo. */
  hasPrinting(rawSetKey: string, rawBase: unknown, variant: VariantSlug): boolean {
    const set = this.catalog.get(
      String(rawSetKey ?? '')
        .trim()
        .toUpperCase(),
    );
    const card = set?.cardsByBase.get(Number(rawBase));
    return Boolean(card?.printings.some((p) => p.variant === variant));
  }

  /** Adds `count` copies of a card identified by its *base* number and a variant. */
  addByBase(
    rawSetKey: string,
    rawBase: unknown,
    variant: VariantSlug,
    rawCount: unknown,
    detail: string,
  ): boolean {
    const setKey = String(rawSetKey ?? '')
      .trim()
      .toUpperCase();
    if (!setKey) return this.skip('malformed', detail);
    if (RESERVED_SET_KEYS.has(setKey.toLowerCase())) return this.skip('reserved-key', detail);

    const count = Number(rawCount);
    const base = Number(rawBase);
    if (!Number.isFinite(count) || count <= 0) return this.skip('malformed', detail);
    if (!Number.isInteger(base) || base <= 0) return this.skip('malformed', detail);

    const set = this.catalog.get(setKey);
    if (!set) return this.skip('unknown-set', detail);

    const card = set.cardsByBase.get(base);
    if (!card) return this.skip('unknown-card', detail);

    const printing = card.printings.find((p) => p.variant === variant);
    if (!printing) return this.skip('unknown-variant', detail);

    this.record(setKey, base, printing.num, printing.variant, count);
    return true;
  }

  /**
   * Adds copies identified by a *printing* number — the SWUDB CSV and the legacy app's
   * own JSON export both work this way. The printing's own variant is used, so importing
   * `SOR,324,2` records two Hyperspace copies rather than two Normals.
   */
  addByPrinting(
    rawSetKey: string,
    rawPrintingNumber: unknown,
    rawCount: unknown,
    detail: string,
  ): boolean {
    const setKey = String(rawSetKey ?? '')
      .trim()
      .toUpperCase();
    if (!setKey) return this.skip('malformed', detail);
    if (RESERVED_SET_KEYS.has(setKey.toLowerCase())) return this.skip('reserved-key', detail);

    const count = Number(rawCount);
    if (!Number.isFinite(count) || count <= 0) return this.skip('malformed', detail);

    const raw = String(rawPrintingNumber ?? '').trim();
    if (!raw) return this.skip('malformed', detail);

    // A weekly-play promo set (`SOROP 015`) is a printing of its base set's card.
    const promoBase = this.promoSets.get(setKey);
    const set = this.catalog.get(promoBase ?? setKey);
    if (!set) return this.skip('unknown-set', detail);

    // Accept "059", "59" and "059F" alike — exports disagree about leading zeros.
    const numbers = [raw, raw.toUpperCase(), raw.replace(/^0+/, '')];
    const asNumber = Number(raw.replace(/[^\d]/g, ''));
    if (Number.isInteger(asNumber) && asNumber > 0) {
      numbers.push(
        String(asNumber).padStart(3, '0'),
        String(asNumber).padStart(2, '0'),
        String(asNumber),
      );
    }
    const candidates = promoBase ? numbers.map((n) => `${setKey}-${n}`) : numbers;

    let base: number | undefined;
    let matched: string | undefined;
    for (const candidate of candidates) {
      const found = set.baseByPrinting.get(candidate);
      if (found !== undefined) {
        base = found;
        matched = candidate;
        break;
      }
    }
    if (base === undefined || matched === undefined) return this.skip('unknown-card', detail);

    const card = set.cardsByBase.get(base);
    const printing = card?.printings.find((p) => p.num === matched);
    if (!printing) return this.skip('unknown-card', detail);

    this.record(set.setKey, base, printing.num, printing.variant, count);
    return true;
  }

  private record(
    setKey: SetKey,
    base: number,
    num: string,
    variant: VariantSlug,
    count: number,
  ): void {
    this.recognized += 1;
    const key = `${setKey}:${num}`;
    const existing = this.accumulated.get(key);
    if (existing) existing.count += count;
    else this.accumulated.set(key, { setKey, base, num, variant, count });
  }

  get printings(): ImportedPrinting[] {
    return [...this.accumulated.values()];
  }

  get copies(): number {
    return this.printings.reduce((sum, p) => sum + p.count, 0);
  }
}
