import type { ResolvedDeckRow } from './decklist';
import { normalize } from './search';
import type { Card, SetKey } from './types';

export type PlayFormat = 'premier' | 'eternal' | 'twinSuns';
/** What the user picked in the UI; 'auto' infers the format from the decklist's leader count. */
export type FormatChoice = 'auto' | PlayFormat;

export const PLAY_FORMATS: readonly PlayFormat[] = ['premier', 'eternal', 'twinSuns'];

export function isPlayFormat(value: unknown): value is PlayFormat {
  return typeof value === 'string' && (PLAY_FORMATS as readonly string[]).includes(value);
}

/**
 * Sets that have rotated out of Premier. Rotation began with A Lawless Time (March 2026),
 * which took the first three sets out; newer sets are legal until a later rotation adds
 * them here. Eternal and Twin Suns allow every set.
 */
export const ROTATED_FROM_PREMIER: ReadonlySet<SetKey> = new Set(['SOR', 'SHD', 'TWI']);

export type FormatRules = {
  label: string;
  /** Exact number of leader cards the format requires. */
  leaders: number;
  /** Minimum main-deck size. */
  minDeck: number;
  /** Default copies allowed per card title, across main deck and sideboard combined. */
  copyLimit: number;
  maxSideboard: number;
};

export const FORMAT_RULES: Record<PlayFormat, FormatRules> = {
  premier: { label: 'Premier', leaders: 1, minDeck: 50, copyLimit: 3, maxSideboard: 10 },
  eternal: { label: 'Eternal', leaders: 1, minDeck: 50, copyLimit: 3, maxSideboard: 10 },
  twinSuns: { label: 'Twin Suns', leaders: 2, minDeck: 80, copyLimit: 1, maxSideboard: 10 },
};

/** Every set each card title is printed in — a reprint keeps a rotated card legal. */
export type CardPool = ReadonlyMap<string, ReadonlySet<SetKey>>;

export function buildCardPool(sets: Iterable<{ setKey: SetKey; baseCards: Card[] }>): CardPool {
  const pool = new Map<string, Set<SetKey>>();
  for (const set of sets) {
    for (const card of set.baseCards) {
      const key = titleKeyOf(card.Name, card.Subtitle);
      const printedIn = pool.get(key) ?? new Set<SetKey>();
      printedIn.add(set.setKey);
      pool.set(key, printedIn);
    }
  }
  return pool;
}

/**
 * Is this card legal in the format? Premier needs a printing in a set that has not rotated;
 * every other format takes any set. A card missing from the pool is judged by its own set.
 */
export function isLegalIn(
  format: PlayFormat,
  card: { name: string; subtitle?: string; setKey: SetKey },
  pool?: CardPool,
): boolean {
  if (format !== 'premier') return true;
  const printedIn = pool?.get(titleKeyOf(card.name, card.subtitle)) ?? [card.setKey];
  return [...printedIn].some((setKey) => !ROTATED_FROM_PREMIER.has(setKey));
}

export type DeckLegalityIssueCode =
  | 'leader-count'
  | 'base-count'
  | 'leader-copies'
  | 'base-copies'
  | 'deck-size'
  | 'copy-limit'
  | 'sideboard-size'
  | 'rotated';

export type DeckLegalityIssue = {
  code: DeckLegalityIssueCode;
  /** Errors make the deck illegal; warnings are advisory only. */
  severity: 'error' | 'warning';
  message: string;
};

export type DeckStats = {
  leaderCount: number;
  baseCount: number;
  /** Total main-deck cards (sum of counts, not distinct titles). */
  mainDeckSize: number;
  sideboardSize: number;
  distinctMainDeckCards: number;
};

export type DeckLegality = {
  format: PlayFormat;
  /** True when the format was inferred from the decklist rather than chosen explicitly. */
  autoDetected: boolean;
  rules: FormatRules;
  stats: DeckStats;
  issues: DeckLegalityIssue[];
  /** True when there are no error-severity issues. */
  legal: boolean;
};

/** Cards are unique by title (name + subtitle), not by printing — the same card from two sets is still one card. */
function titleKey(row: ResolvedDeckRow): string {
  return titleKeyOf(row.name, row.subtitle);
}

function titleKeyOf(name: string, subtitle: string | undefined): string {
  return `${normalize(name)}|${normalize(subtitle ?? '')}`;
}

function displayTitle(row: ResolvedDeckRow): string {
  return row.subtitle ? `${row.name} - ${row.subtitle}` : row.name;
}

/**
 * Infers the play format from the decklist itself. Two leaders is the one unambiguous Twin Suns
 * signal — deck size can't be trusted, since an in-progress list is short of both minimums.
 */
export function detectPlayFormat(rows: ResolvedDeckRow[]): PlayFormat {
  const leaderCopies = rows.filter((r) => r.role === 'leader').reduce((sum, r) => sum + r.count, 0);
  return leaderCopies >= 2 ? 'twinSuns' : 'premier';
}

export function deckStats(rows: ResolvedDeckRow[]): DeckStats {
  let leaderCount = 0;
  let baseCount = 0;
  let mainDeckSize = 0;
  let sideboardSize = 0;
  let distinctMainDeckCards = 0;

  for (const row of rows) {
    if (row.role === 'leader') leaderCount += row.count;
    else if (row.role === 'base') baseCount += row.count;
    else if (row.role === 'deck') {
      mainDeckSize += row.count;
      distinctMainDeckCards++;
    } else if (row.role === 'sideboard') sideboardSize += row.count;
  }

  return { leaderCount, baseCount, mainDeckSize, sideboardSize, distinctMainDeckCards };
}

/**
 * Checks a resolved decklist against a format's deck-building rules. Pass the card pool
 * to check Premier rotation too.
 *
 * The copy limit is applied per card title across main deck and sideboard combined, and a card
 * whose own text overrides the limit (`maxCopies`, e.g. Swarming Vulture Droid) keeps its override
 * in both formats — card text beats the format's default.
 */
export function checkDeckLegality(
  rows: ResolvedDeckRow[],
  choice: FormatChoice = 'auto',
  pool?: CardPool,
): DeckLegality {
  const format = choice === 'auto' ? detectPlayFormat(rows) : choice;
  const rules = FORMAT_RULES[format];
  const stats = deckStats(rows);
  const issues: DeckLegalityIssue[] = [];

  if (stats.leaderCount !== rules.leaders) {
    issues.push({
      code: 'leader-count',
      severity: 'error',
      message: `${rules.label} needs exactly ${rules.leaders} leader${rules.leaders === 1 ? '' : 's'} — this deck has ${stats.leaderCount}.`,
    });
  }
  if (stats.baseCount !== 1) {
    issues.push({
      code: 'base-count',
      severity: 'error',
      message: `A deck needs exactly 1 base — this deck has ${stats.baseCount}.`,
    });
  }

  // A leader/base row with count > 1 means the same card was listed twice; in Twin Suns that also
  // means the two leaders aren't two different cards.
  for (const row of rows) {
    if (row.role !== 'leader' && row.role !== 'base') continue;
    if (row.count <= 1) continue;
    issues.push({
      code: row.role === 'leader' ? 'leader-copies' : 'base-copies',
      severity: 'error',
      message: `${displayTitle(row)} is listed ${row.count}× as a ${row.role} — only 1 copy of a ${row.role} is allowed.`,
    });
  }

  if (stats.mainDeckSize < rules.minDeck) {
    issues.push({
      code: 'deck-size',
      severity: 'error',
      message: `${rules.label} needs at least ${rules.minDeck} cards in the main deck — this deck has ${stats.mainDeckSize}.`,
    });
  }

  if (stats.sideboardSize > rules.maxSideboard) {
    issues.push({
      code: 'sideboard-size',
      severity: 'warning',
      message: `Sideboard has ${stats.sideboardSize} cards — the limit is ${rules.maxSideboard}.`,
    });
  }

  const byTitle = new Map<string, { title: string; count: number; limit: number }>();
  for (const row of rows) {
    if (row.role !== 'deck' && row.role !== 'sideboard') continue;
    const key = titleKey(row);
    const existing = byTitle.get(key);
    const limit = row.maxCopies ?? rules.copyLimit;
    if (existing) {
      existing.count += row.count;
      // Printings of one card should agree, but if they don't, the most permissive text wins.
      existing.limit = Math.max(existing.limit, limit);
    } else {
      byTitle.set(key, { title: displayTitle(row), count: row.count, limit });
    }
  }

  for (const entry of byTitle.values()) {
    if (entry.count <= entry.limit) continue;
    issues.push({
      code: 'copy-limit',
      severity: 'error',
      message:
        entry.limit === 1
          ? `${entry.title} appears ${entry.count}× — ${rules.label} allows only 1 copy of each card.`
          : `${entry.title} appears ${entry.count}× — the limit is ${entry.limit}.`,
    });
  }

  // Rotation needs to know every set a title is printed in, so it is checked only with a pool.
  const rotated = new Set<string>();
  for (const row of pool ? rows : []) {
    if (isLegalIn(format, row, pool)) continue;
    rotated.add(displayTitle(row));
  }
  for (const title of rotated) {
    issues.push({
      code: 'rotated',
      severity: 'error',
      message: `${title} has rotated out of ${rules.label} — none of its sets are legal.`,
    });
  }

  return {
    format,
    autoDetected: choice === 'auto',
    rules,
    stats,
    issues,
    legal: !issues.some((i) => i.severity === 'error'),
  };
}
