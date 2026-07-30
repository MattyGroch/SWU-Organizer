import type { SetKey } from './types'
import type { DeckContents } from './deckContents'
import { parseDeckContents } from './deckContents'

// Free-text label, not a strict enum: most precons are Heroism/Villainy, but some products
// (e.g. Twin Suns) ship dual-leader decks that don't split cleanly into either.
export type PreconAspect = string

export type PreconManifestEntry = {
  key: string
  label: string
  setKey: SetKey
  aspect: PreconAspect
  file: string
}

export type PreconCatalogEntry = PreconManifestEntry & { contents: DeckContents }

type Fetcher = (input: RequestInfo | URL) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parsePreconManifest(payload: unknown): PreconManifestEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.precons)) {
    throw new Error('Invalid precon manifest payload.')
  }
  return payload.precons.filter((entry): entry is PreconManifestEntry =>
    isRecord(entry) &&
    typeof entry.key === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.setKey === 'string' &&
    typeof entry.aspect === 'string' && entry.aspect.trim().length > 0 &&
    typeof entry.file === 'string',
  )
}

export function parsePreconContents(payload: unknown): DeckContents {
  try {
    return parseDeckContents(payload)
  } catch {
    throw new Error('Invalid precon deck payload.')
  }
}

export async function fetchPreconManifest(
  fetcher: Fetcher,
  url = '/precons/manifest.json',
): Promise<PreconManifestEntry[]> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Failed to fetch precon manifest from ${url}.`)
  return parsePreconManifest(await response.json())
}

export async function fetchPreconEntry(
  fetcher: Fetcher,
  manifestEntry: PreconManifestEntry,
  baseUrl = '/precons/',
): Promise<PreconCatalogEntry> {
  const url = `${baseUrl}${manifestEntry.file}`
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Failed to fetch precon deck from ${url}.`)
  const contents = parsePreconContents(await response.json())
  return { ...manifestEntry, contents }
}

export async function fetchPreconCatalog(
  fetcher: Fetcher,
  manifestUrl = '/precons/manifest.json',
  baseUrl = '/precons/',
): Promise<PreconCatalogEntry[]> {
  const manifest = await fetchPreconManifest(fetcher, manifestUrl)
  const entries = await Promise.allSettled(
    manifest.map(entry => fetchPreconEntry(fetcher, entry, baseUrl)),
  )
  return entries
    .filter((r): r is PromiseFulfilledResult<PreconCatalogEntry> => r.status === 'fulfilled')
    .map(r => r.value)
}
