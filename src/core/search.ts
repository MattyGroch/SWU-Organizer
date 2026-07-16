import type { Card, SetKey } from './types'

export type SearchCatalog = {
  setKey: SetKey
  cards: Card[]
  printingNumbersByBase: Map<number, number[]>
  baseByPrintingNumber: Map<number, number>
}

export type SearchSuggestion = {
  kind: 'name' | 'number'
  setKey: SetKey
  baseNumber: number
  name: string
  subtitle?: string
  type?: string
  printingNumbers: number[]
  label: string
}

type RankedSuggestion = SearchSuggestion & { score: number }

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function nameMatchScore(card: Card, rawQuery: string, normalizedQuery: string): number | null {
  const normalizedName = normalize(card.Name)
  const normalizedSubtitle = normalize(card.Subtitle ?? '')
  const lowerQuery = rawQuery.toLowerCase()
  const lowerName = card.Name.toLowerCase()
  const words = lowerName.split(/[^a-z0-9]+/).filter(Boolean)

  if (normalizedName === normalizedQuery) return 0
  if (words.some(word => word.startsWith(lowerQuery))) return 10
  if (lowerName.includes(lowerQuery)) return 20
  if (normalizedSubtitle.includes(normalizedQuery)) return 30
  if (normalizedName.includes(normalizedQuery)) return 40
  return null
}

export function buildSearchSuggestions(
  query: string,
  catalogs: SearchCatalog[],
  currentSetKey: SetKey,
  limit = 10,
): SearchSuggestion[] {
  const rawQuery = query.trim()
  if (!rawQuery || limit <= 0) return []

  const normalizedQuery = normalize(rawQuery)
  const numericQuery = /^\d+$/.test(rawQuery)
    ? Number(rawQuery.replace(/^0+/, '') || '0')
    : null
  const byIdentity = new Map<string, RankedSuggestion>()

  for (const catalog of catalogs) {
    for (const card of catalog.cards) {
      const printingNumbers = catalog.printingNumbersByBase.get(card.Number) ?? [card.Number]
      const exactPrinting = numericQuery !== null
        && catalog.baseByPrintingNumber.get(numericQuery) === card.Number
      const matchScore = exactPrinting
        ? 0
        : nameMatchScore(card, rawQuery, normalizedQuery)

      if (matchScore === null) continue

      const kind = exactPrinting ? 'number' : 'name'
      const setScore = catalog.setKey === currentSetKey ? 0 : 50
      const score = exactPrinting ? setScore : 100 + setScore + matchScore
      const suggestion: RankedSuggestion = {
        kind,
        setKey: catalog.setKey,
        baseNumber: card.Number,
        name: card.Name,
        subtitle: card.Subtitle,
        type: card.Type,
        printingNumbers,
        label: `${card.Name}${card.Subtitle ? ` - ${card.Subtitle}` : ''} — #${card.Number} (${catalog.setKey})`,
        score,
      }
      const identity = `${catalog.setKey}:${card.Number}`
      const existing = byIdentity.get(identity)
      if (!existing || suggestion.score < existing.score) byIdentity.set(identity, suggestion)
    }
  }

  return [...byIdentity.values()]
    .sort((a, b) =>
      a.score - b.score
      || a.name.localeCompare(b.name)
      || a.baseNumber - b.baseNumber
      || (a.subtitle ?? '').localeCompare(b.subtitle ?? ''),
    )
    .slice(0, limit)
    .map(({ score: _score, ...suggestion }) => suggestion)
}

export function submittedSuggestion(
  suggestions: SearchSuggestion[],
  highlightIndex: number,
): SearchSuggestion | null {
  if (!suggestions.length) return null
  return suggestions[highlightIndex] ?? suggestions[0]
}
