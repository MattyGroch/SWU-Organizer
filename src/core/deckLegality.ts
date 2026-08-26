import type { ResolvedDeckRow } from './decklist'
import { normalize } from './search'

export type PlayFormat = 'premier' | 'twinSuns'
/** What the user picked in the UI; 'auto' infers the format from the decklist's leader count. */
export type FormatChoice = 'auto' | PlayFormat

export type FormatRules = {
  label: string
  /** Exact number of leader cards the format requires. */
  leaders: number
  /** Minimum main-deck size. */
  minDeck: number
  /** Default copies allowed per card title, across main deck and sideboard combined. */
  copyLimit: number
  maxSideboard: number
}

export const FORMAT_RULES: Record<PlayFormat, FormatRules> = {
  premier: { label: 'Premier', leaders: 1, minDeck: 50, copyLimit: 3, maxSideboard: 10 },
  twinSuns: { label: 'Twin Suns', leaders: 2, minDeck: 80, copyLimit: 1, maxSideboard: 10 },
}

export type DeckLegalityIssueCode =
  | 'leader-count'
  | 'base-count'
  | 'leader-copies'
  | 'base-copies'
  | 'deck-size'
  | 'copy-limit'
  | 'sideboard-size'

export type DeckLegalityIssue = {
  code: DeckLegalityIssueCode
  /** Errors make the deck illegal; warnings are advisory only. */
  severity: 'error' | 'warning'
  message: string
}

export type DeckStats = {
  leaderCount: number
  baseCount: number
  /** Total main-deck cards (sum of counts, not distinct titles). */
  mainDeckSize: number
  sideboardSize: number
  distinctMainDeckCards: number
}

export type DeckLegality = {
  format: PlayFormat
  /** True when the format was inferred from the decklist rather than chosen explicitly. */
  autoDetected: boolean
  rules: FormatRules
  stats: DeckStats
  issues: DeckLegalityIssue[]
  /** True when there are no error-severity issues. */
  legal: boolean
}

/** Cards are unique by title (name + subtitle), not by printing — the same card from two sets is still one card. */
function titleKey(row: ResolvedDeckRow): string {
  return `${normalize(row.name)}|${normalize(row.subtitle ?? '')}`
}

function displayTitle(row: ResolvedDeckRow): string {
  return row.subtitle ? `${row.name} - ${row.subtitle}` : row.name
}

/**
 * Infers the play format from the decklist itself. Two leaders is the one unambiguous Twin Suns
 * signal — deck size can't be trusted, since an in-progress list is short of both minimums.
 */
export function detectPlayFormat(rows: ResolvedDeckRow[]): PlayFormat {
  const leaderCopies = rows
    .filter(r => r.role === 'leader')
    .reduce((sum, r) => sum + r.count, 0)
  return leaderCopies >= 2 ? 'twinSuns' : 'premier'
}

export function deckStats(rows: ResolvedDeckRow[]): DeckStats {
  let leaderCount = 0
  let baseCount = 0
  let mainDeckSize = 0
  let sideboardSize = 0
  let distinctMainDeckCards = 0

  for (const row of rows) {
    if (row.role === 'leader') leaderCount += row.count
    else if (row.role === 'base') baseCount += row.count
    else if (row.role === 'deck') {
      mainDeckSize += row.count
      distinctMainDeckCards++
    } else if (row.role === 'sideboard') sideboardSize += row.count
  }

  return { leaderCount, baseCount, mainDeckSize, sideboardSize, distinctMainDeckCards }
}

/**
 * Checks a resolved decklist against a format's deck-building rules.
 *
 * The copy limit is applied per card title across main deck and sideboard combined, and a card
 * whose own text overrides the limit (`maxCopies`, e.g. Swarming Vulture Droid) keeps its override
 * in both formats — card text beats the format's default.
 */
export function checkDeckLegality(
  rows: ResolvedDeckRow[],
  choice: FormatChoice = 'auto',
): DeckLegality {
  const format = choice === 'auto' ? detectPlayFormat(rows) : choice
  const rules = FORMAT_RULES[format]
  const stats = deckStats(rows)
  const issues: DeckLegalityIssue[] = []

  if (stats.leaderCount !== rules.leaders) {
    issues.push({
      code: 'leader-count',
      severity: 'error',
      message: `${rules.label} needs exactly ${rules.leaders} leader${rules.leaders === 1 ? '' : 's'} — this deck has ${stats.leaderCount}.`,
    })
  }
  if (stats.baseCount !== 1) {
    issues.push({
      code: 'base-count',
      severity: 'error',
      message: `A deck needs exactly 1 base — this deck has ${stats.baseCount}.`,
    })
  }

  // A leader/base row with count > 1 means the same card was listed twice; in Twin Suns that also
  // means the two leaders aren't two different cards.
  for (const row of rows) {
    if (row.role !== 'leader' && row.role !== 'base') continue
    if (row.count <= 1) continue
    issues.push({
      code: row.role === 'leader' ? 'leader-copies' : 'base-copies',
      severity: 'error',
      message: `${displayTitle(row)} is listed ${row.count}× as a ${row.role} — only 1 copy of a ${row.role} is allowed.`,
    })
  }

  if (stats.mainDeckSize < rules.minDeck) {
    issues.push({
      code: 'deck-size',
      severity: 'error',
      message: `${rules.label} needs at least ${rules.minDeck} cards in the main deck — this deck has ${stats.mainDeckSize}.`,
    })
  }

  if (stats.sideboardSize > rules.maxSideboard) {
    issues.push({
      code: 'sideboard-size',
      severity: 'warning',
      message: `Sideboard has ${stats.sideboardSize} cards — the limit is ${rules.maxSideboard}.`,
    })
  }

  const byTitle = new Map<string, { title: string; count: number; limit: number }>()
  for (const row of rows) {
    if (row.role !== 'deck' && row.role !== 'sideboard') continue
    const key = titleKey(row)
    const existing = byTitle.get(key)
    const limit = row.maxCopies ?? rules.copyLimit
    if (existing) {
      existing.count += row.count
      // Printings of one card should agree, but if they don't, the most permissive text wins.
      existing.limit = Math.max(existing.limit, limit)
    } else {
      byTitle.set(key, { title: displayTitle(row), count: row.count, limit })
    }
  }

  for (const entry of byTitle.values()) {
    if (entry.count <= entry.limit) continue
    issues.push({
      code: 'copy-limit',
      severity: 'error',
      message:
        entry.limit === 1
          ? `${entry.title} appears ${entry.count}× — ${rules.label} allows only 1 copy of each card.`
          : `${entry.title} appears ${entry.count}× — the limit is ${entry.limit}.`,
    })
  }

  return {
    format,
    autoDetected: choice === 'auto',
    rules,
    stats,
    issues,
    legal: !issues.some(i => i.severity === 'error'),
  }
}
