import type { Card, SetKey } from './types'
import type { CanonicalCatalog } from './inventory'
import { normalize } from './search'

export type DeckRole = 'leader' | 'base' | 'deck' | 'sideboard'
/** Picklist format doesn't label its first two entries; the resolver splits this into leader/base. */
type InternalRole = DeckRole | 'leaderOrBase'

export type DeckEntryCandidate = { setKey: SetKey; printingNumber: number }

export type RawDeckEntry = {
  role: InternalRole
  name: string
  subtitle?: string
  count: number
  /** Format A: exact identity. */
  exact?: DeckEntryCandidate
  /** Format C: acceptable (set, printing#) alternates, in source order. */
  alternates?: DeckEntryCandidate[]
  /** Generic fallback: an explicit (SET) hint, used only as a disambiguation tiebreaker. */
  setHint?: SetKey
}

export type DeckFormat = 'json' | 'melee' | 'picklist' | 'generic'

export type ParsedDeckList = {
  format: DeckFormat
  deckName?: string
  entries: RawDeckEntry[]
  /** Lines/entries that couldn't be parsed at all. */
  malformed: string[]
}

export type ResolvedDeckRow = {
  role: DeckRole
  count: number
  setKey: SetKey
  baseNumber: number
  name: string
  subtitle?: string
  type?: string
  price: number
  /** True if this row's set was guessed because the same name matched more than one tracked set. */
  ambiguous: boolean
  ambiguousOtherSets?: SetKey[]
}

export type UnresolvedDeckEntry = {
  role: DeckRole
  name: string
  subtitle?: string
  count: number
  reason: 'unknown-set' | 'no-name-match' | 'malformed'
}

export type DeckResolution = {
  deckName?: string
  format: DeckFormat
  rows: ResolvedDeckRow[]
  unresolved: UnresolvedDeckEntry[]
}

export type DeckLookupSet = { byNumber: Map<number, Card>; baseCards: Card[] }

export type DeckRowWithNeed = ResolvedDeckRow & { have: number; needed: number; rowCost: number }

export type DeckSummary = {
  totalNeededCards: number
  totalCost: number
  /** null when the decklist had no leader/base entry at all. */
  leaderOwned: boolean | null
  baseOwned: boolean | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRoleForDisplay(role: InternalRole): DeckRole {
  return role === 'leaderOrBase' ? 'leader' : role
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export function detectDeckFormat(text: string): DeckFormat {
  const trimmed = text.trim()
  if (!trimmed) return 'generic'

  if (trimmed.startsWith('{')) {
    try {
      const payload: unknown = JSON.parse(trimmed)
      if (
        isRecord(payload) &&
        (Array.isArray(payload.deck) || isRecord(payload.leader) || isRecord(payload.base))
      ) {
        return 'json'
      }
    } catch {
      // not JSON after all — fall through to text-format detection
    }
  }

  if (/^Picklist:/m.test(trimmed)) return 'picklist'
  if (/^(Leaders?|Bases?|Main ?Deck|Deck|Sideboards?)\s*$/im.test(trimmed)) return 'melee'
  return 'generic'
}

// ---------------------------------------------------------------------------
// Format A — JSON
// ---------------------------------------------------------------------------

function parseCardId(id: unknown): DeckEntryCandidate | null {
  if (typeof id !== 'string') return null
  const idx = id.lastIndexOf('_')
  if (idx <= 0 || idx === id.length - 1) return null
  const setKey = id.slice(0, idx).trim().toUpperCase()
  const printingNumber = Number(id.slice(idx + 1))
  if (!setKey || !Number.isInteger(printingNumber) || printingNumber <= 0) return null
  return { setKey, printingNumber }
}

export function parseDeckJson(text: string): ParsedDeckList {
  const payload: unknown = JSON.parse(text)
  if (!isRecord(payload)) throw new Error('Invalid decklist JSON payload.')

  const entries: RawDeckEntry[] = []
  const malformed: string[] = []

  function pushRef(role: InternalRole, ref: unknown, label: string) {
    if (ref === undefined) return
    const record = isRecord(ref) ? ref : null
    const count = record ? Number(record.count) : NaN
    const candidate = record ? parseCardId(record.id) : null
    if (!record || !candidate || !Number.isFinite(count) || count <= 0) {
      malformed.push(`${label}: ${JSON.stringify(ref)}`)
      return
    }
    entries.push({
      role,
      name: typeof record.id === 'string' ? record.id : label,
      count,
      exact: candidate,
    })
  }

  pushRef('leader', payload.leader, 'leader')
  // Twin Suns decks run two leaders; swudb-style exports carry the second under `secondleader`.
  pushRef('leader', payload.secondleader, 'secondleader')
  pushRef('base', payload.base, 'base')
  if (Array.isArray(payload.deck)) {
    payload.deck.forEach((item, i) => pushRef('deck', item, `deck[${i}]`))
  }
  if (Array.isArray(payload.sideboard)) {
    payload.sideboard.forEach((item, i) => pushRef('sideboard', item, `sideboard[${i}]`))
  }

  const deckName =
    isRecord(payload.metadata) && typeof payload.metadata.name === 'string'
      ? payload.metadata.name
      : undefined

  return { format: 'json', deckName, entries, malformed }
}

// ---------------------------------------------------------------------------
// Format B — Melee text
// ---------------------------------------------------------------------------

const MELEE_HEADERS: Record<string, DeckRole> = {
  leader: 'leader',
  leaders: 'leader',
  base: 'base',
  bases: 'base',
  maindeck: 'deck',
  'main deck': 'deck',
  deck: 'deck',
  sideboard: 'sideboard',
  sideboards: 'sideboard',
}

const MELEE_CARD_LINE = /^(\d+)\s*\|?\s*([^|]+?)\s*(?:\|\s*(.+))?$/

export function parseDeckMelee(text: string): ParsedDeckList {
  const lines = text.split(/\r\n|\r|\n/)
  const entries: RawDeckEntry[] = []
  const malformed: string[] = []
  let currentRole: DeckRole | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    const headerRole = MELEE_HEADERS[line.toLowerCase()]
    if (headerRole) {
      currentRole = headerRole
      continue
    }
    if (!currentRole) continue

    const match = MELEE_CARD_LINE.exec(line)
    if (!match) {
      malformed.push(line)
      continue
    }
    const count = Number(match[1])
    const name = match[2].trim()
    const subtitle = match[3]?.trim() || undefined
    if (!Number.isFinite(count) || count <= 0 || !name) {
      malformed.push(line)
      continue
    }
    entries.push({ role: currentRole, name, subtitle, count })
  }

  return { format: 'melee', entries, malformed }
}

// ---------------------------------------------------------------------------
// Format C — Picklist text
// ---------------------------------------------------------------------------

const BRACKET_LINE = /^((?:\[\s?\]\s*)+)(.+)$/
const ALT_ENTRY = /^([A-Za-z0-9]+)\s+(\d+)$/

function splitSections(lines: string[]): string[][] {
  const sections: string[][] = [[]]
  for (const line of lines) {
    if (line.trim() === '-----') {
      sections.push([])
    } else {
      sections[sections.length - 1].push(line)
    }
  }
  return sections
}

function parseAlternatesLine(line: string): DeckEntryCandidate[] | null {
  const parts = line.split(',').map(p => p.trim()).filter(Boolean)
  if (!parts.length) return null
  const candidates: DeckEntryCandidate[] = []
  for (const part of parts) {
    const match = ALT_ENTRY.exec(part)
    if (!match) return null
    candidates.push({ setKey: match[1].toUpperCase(), printingNumber: Number(match[2]) })
  }
  return candidates
}

function roleForSection(sectionIndex: number, totalSections: number): 'leaderOrBase' | 'deck' | 'sideboard' {
  if (sectionIndex === 0) return 'leaderOrBase'
  if (totalSections >= 3 && sectionIndex === totalSections - 1) return 'sideboard'
  return 'deck'
}

export function parseDeckPicklist(text: string): ParsedDeckList {
  const allLines = text.split(/\r\n|\r|\n/)
  const malformed: string[] = []
  let deckName: string | undefined
  let bodyLines = allLines

  const firstContentIdx = allLines.findIndex(l => l.trim().length > 0)
  if (firstContentIdx >= 0) {
    const headerMatch = /^Picklist:\s*(.*)$/i.exec(allLines[firstContentIdx].trim())
    if (headerMatch) {
      deckName = headerMatch[1].trim() || undefined
      bodyLines = allLines.slice(firstContentIdx + 1)
    } else {
      malformed.push('missing "Picklist:" header')
    }
  }

  const sections = splitSections(bodyLines)
  const entries: RawDeckEntry[] = []

  sections.forEach((sectionLines, sectionIndex) => {
    const role = roleForSection(sectionIndex, sections.length)

    for (let i = 0; i < sectionLines.length; i++) {
      const line = sectionLines[i].trim()
      if (!line) continue
      if (/^Needed tokens:/i.test(line)) continue

      const bracketMatch = BRACKET_LINE.exec(line)
      if (!bracketMatch) {
        malformed.push(line)
        continue
      }
      const count = (bracketMatch[1].match(/\[\s?\]/g) ?? []).length
      const rest = bracketMatch[2].trim()
      const parts = rest.split('|').map(s => s.trim())
      const namePart = parts[0]
      const subtitlePart = parts[1] || undefined

      if (!count || !namePart) {
        malformed.push(line)
        continue
      }

      let j = i + 1
      while (j < sectionLines.length && sectionLines[j].trim() === '') j++
      const altLine = j < sectionLines.length ? sectionLines[j].trim() : ''
      const alternates = altLine ? parseAlternatesLine(altLine) : null

      if (!alternates) {
        malformed.push(line)
        continue
      }

      entries.push({ role, name: namePart, subtitle: subtitlePart, count, alternates })
      i = j
    }
  })

  return { format: 'picklist', deckName, entries, malformed }
}

// ---------------------------------------------------------------------------
// Generic fallback — one card per line, mirrors the app's own missing-card export
// ---------------------------------------------------------------------------

const TRAILING_SET = /[([]([A-Za-z0-9]{2,6})[)\]]\s*$/
const QTY_NAME = /^(\d+)\s*x?\s+(.+)$/i
const NAME_SUBTITLE = /^(.*?)\s[-–]\s(.*)$/
/** Compact "3xSET_042" shorthand — no space, so it can't be confused with a "3x Card Name" line. */
const QTY_EXACT_ID = /^(\d+)x([A-Za-z0-9]{2,6})_(\d+)$/i

export function parseDeckGeneric(text: string): ParsedDeckList {
  const lines = text.split(/\r\n|\r|\n/)
  const entries: RawDeckEntry[] = []
  const malformed: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const idMatch = QTY_EXACT_ID.exec(line)
    if (idMatch) {
      const count = Number(idMatch[1])
      const setKey = idMatch[2].toUpperCase()
      const printingNumber = Number(idMatch[3])
      if (Number.isFinite(count) && count > 0 && Number.isInteger(printingNumber) && printingNumber > 0) {
        entries.push({
          role: 'deck',
          name: `${setKey}_${idMatch[3]}`,
          count,
          exact: { setKey, printingNumber },
        })
        continue
      }
    }

    let working = line
    let setHint: SetKey | undefined
    const setMatch = TRAILING_SET.exec(working)
    if (setMatch) {
      setHint = setMatch[1].toUpperCase()
      working = working.slice(0, setMatch.index).trim()
    }

    const qtyMatch = QTY_NAME.exec(working)
    if (!qtyMatch) {
      malformed.push(line)
      continue
    }
    const count = Number(qtyMatch[1])
    const rest = qtyMatch[2].trim()
    if (!Number.isFinite(count) || count <= 0 || !rest) {
      malformed.push(line)
      continue
    }

    let name = rest
    let subtitle: string | undefined
    const dashMatch = NAME_SUBTITLE.exec(rest)
    if (dashMatch && dashMatch[1].trim()) {
      name = dashMatch[1].trim()
      subtitle = dashMatch[2].trim()
    }

    entries.push({ role: 'deck', name, subtitle, count, setHint })
  }

  return { format: 'generic', entries, malformed }
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export function parseDeckList(text: string): ParsedDeckList {
  const format = detectDeckFormat(text)
  if (format === 'json') {
    try {
      return parseDeckJson(text)
    } catch {
      return parseDeckGeneric(text)
    }
  }
  if (format === 'melee') return parseDeckMelee(text)
  if (format === 'picklist') return parseDeckPicklist(text)
  return parseDeckGeneric(text)
}

// ---------------------------------------------------------------------------
// Resolver — RawDeckEntry[] + catalog/inventory -> DeckResolution
// ---------------------------------------------------------------------------

function cardMatchKey(name: string, subtitle?: string): string {
  return `${normalize(name)}|${normalize(subtitle ?? '')}`
}

type ResolvedIdentity = { setKey: SetKey; baseNumber: number; card: Card }

function resolveExact(
  candidate: DeckEntryCandidate,
  catalog: CanonicalCatalog,
  parsedSets: Map<SetKey, DeckLookupSet>,
): ResolvedIdentity | null {
  const ref = catalog.get(`${candidate.setKey}:${candidate.printingNumber}`)
  if (!ref) return null
  const card = parsedSets.get(ref.setKey)?.byNumber.get(ref.baseNumber)
  if (!card) return null
  return { setKey: ref.setKey, baseNumber: ref.baseNumber, card }
}

export function resolveDeckList(
  parsed: ParsedDeckList,
  catalog: CanonicalCatalog,
  parsedSets: Map<SetKey, DeckLookupSet>,
  trackedSetKeys: SetKey[],
  ownedByBase: (setKey: SetKey, baseNumber: number) => number,
): DeckResolution {
  const nameIndex = new Map<string, Array<{ setKey: SetKey; card: Card }>>()
  for (const setKeyIter of trackedSetKeys) {
    const set = parsedSets.get(setKeyIter)
    if (!set) continue
    for (const card of set.baseCards) {
      const key = cardMatchKey(card.Name, card.Subtitle)
      const arr = nameIndex.get(key) ?? []
      arr.push({ setKey: setKeyIter, card })
      nameIndex.set(key, arr)
    }
  }

  const rowMap = new Map<string, ResolvedDeckRow>()
  const unresolved: UnresolvedDeckEntry[] = []
  let leaderBaseOrdinal = 0

  for (const entry of parsed.entries) {
    if (entry.count <= 0) {
      unresolved.push({
        role: normalizeRoleForDisplay(entry.role),
        name: entry.name,
        subtitle: entry.subtitle,
        count: entry.count,
        reason: 'malformed',
      })
      continue
    }

    let resolved: ResolvedIdentity | null = null
    let ambiguous = false
    let ambiguousOtherSets: SetKey[] | undefined

    if (entry.exact) {
      resolved = resolveExact(entry.exact, catalog, parsedSets)
      if (!resolved) {
        unresolved.push({
          role: normalizeRoleForDisplay(entry.role),
          name: entry.name,
          subtitle: entry.subtitle,
          count: entry.count,
          reason: 'unknown-set',
        })
        continue
      }
    } else if (entry.alternates) {
      for (const alt of entry.alternates) {
        if (!trackedSetKeys.includes(alt.setKey)) continue
        const candidate = resolveExact(alt, catalog, parsedSets)
        if (candidate) {
          resolved = candidate
          break
        }
      }
      if (!resolved) {
        unresolved.push({
          role: normalizeRoleForDisplay(entry.role),
          name: entry.name,
          subtitle: entry.subtitle,
          count: entry.count,
          reason: 'unknown-set',
        })
        continue
      }
    } else {
      const key = cardMatchKey(entry.name, entry.subtitle)
      const candidates = nameIndex.get(key) ?? []
      if (candidates.length === 0) {
        unresolved.push({
          role: normalizeRoleForDisplay(entry.role),
          name: entry.name,
          subtitle: entry.subtitle,
          count: entry.count,
          reason: 'no-name-match',
        })
        continue
      }
      if (candidates.length === 1) {
        resolved = {
          setKey: candidates[0].setKey,
          baseNumber: candidates[0].card.Number,
          card: candidates[0].card,
        }
      } else {
        ambiguous = true
        let chosen = entry.setHint ? candidates.find(c => c.setKey === entry.setHint) : undefined
        if (!chosen) {
          const owned = candidates.filter(c => ownedByBase(c.setKey, c.card.Number) > 0)
          if (owned.length === 1) chosen = owned[0]
        }
        if (!chosen) {
          chosen = [...candidates].sort(
            (a, b) => trackedSetKeys.indexOf(a.setKey) - trackedSetKeys.indexOf(b.setKey),
          )[0]
        }
        resolved = { setKey: chosen.setKey, baseNumber: chosen.card.Number, card: chosen.card }
        ambiguousOtherSets = candidates.filter(c => c.setKey !== chosen!.setKey).map(c => c.setKey)
      }
    }

    let role: DeckRole
    if (entry.role === 'leaderOrBase') {
      const cardType = (resolved.card.Type ?? '').trim().toLowerCase()
      if (cardType === 'base') role = 'base'
      else if (cardType === 'leader') role = 'leader'
      else role = leaderBaseOrdinal === 0 ? 'leader' : 'base'
      leaderBaseOrdinal++
    } else if (entry.role === 'deck' && parsed.format === 'generic') {
      // The generic format has no leader/base sections at all — a plain "one card per line"
      // list is the only place a Leader/Base card can otherwise never be recognized as such.
      const cardType = (resolved.card.Type ?? '').trim().toLowerCase()
      role = cardType === 'leader' ? 'leader' : cardType === 'base' ? 'base' : 'deck'
    } else {
      role = entry.role
    }

    const rowKey = `${role}:${resolved.setKey}:${resolved.baseNumber}`
    const existing = rowMap.get(rowKey)
    if (existing) {
      existing.count += entry.count
    } else {
      rowMap.set(rowKey, {
        role,
        count: entry.count,
        setKey: resolved.setKey,
        baseNumber: resolved.baseNumber,
        name: resolved.card.Name,
        subtitle: resolved.card.Subtitle,
        type: resolved.card.Type,
        price: Number(resolved.card.MarketPrice ?? 0),
        ambiguous,
        ambiguousOtherSets,
      })
    }
  }

  for (const line of parsed.malformed) {
    unresolved.push({ role: 'deck', name: line, count: 0, reason: 'malformed' })
  }

  return {
    deckName: parsed.deckName,
    format: parsed.format,
    rows: [...rowMap.values()],
    unresolved,
  }
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

export function computeDeckRows(
  rows: ResolvedDeckRow[],
  ownedByBase: (setKey: SetKey, baseNumber: number) => number,
): DeckRowWithNeed[] {
  return rows.map(row => {
    const have = ownedByBase(row.setKey, row.baseNumber)
    const needed = Math.max(0, row.count - have)
    return { ...row, have, needed, rowCost: needed * row.price }
  })
}

export function summarizeDeck(rows: DeckRowWithNeed[], includeSideboard: boolean): DeckSummary {
  let totalNeededCards = 0
  let totalCost = 0
  // Twin Suns decks run two leader rows — track all of them rather than the last one seen,
  // so a partially-owned pair of leaders doesn't get reported as fully owned.
  const leaderRows: DeckRowWithNeed[] = []
  const baseRows: DeckRowWithNeed[] = []

  for (const row of rows) {
    if (row.role === 'sideboard' && !includeSideboard) continue
    totalNeededCards += row.needed
    totalCost += row.rowCost
    if (row.role === 'leader') leaderRows.push(row)
    if (row.role === 'base') baseRows.push(row)
  }

  const leaderOwned = leaderRows.length ? leaderRows.every(r => r.have >= r.count) : null
  const baseOwned = baseRows.length ? baseRows.every(r => r.have >= r.count) : null

  return { totalNeededCards, totalCost, leaderOwned, baseOwned }
}

// ---------------------------------------------------------------------------
// Shared clipboard-export line format (mirrors App.tsx's existing missing-card export)
// ---------------------------------------------------------------------------

export function formatMissingCardsList(rows: DeckRowWithNeed[], includeSideboard: boolean): string {
  return rows
    .filter(r => (r.role !== 'sideboard' || includeSideboard) && r.needed > 0)
    .map(r => formatMissingLine(r.name, r.subtitle, r.setKey, r.needed))
    .join('\n')
}

export function formatMissingLine(
  name: string,
  subtitle: string | undefined,
  setKey: SetKey,
  qty: number,
): string {
  const namePart = subtitle ? `${name} - ${subtitle}` : name
  return `${qty} ${namePart} [${setKey}]`
}
