import type { Db } from '../db.js'

export type DeckLibrary = {
  customDecks: unknown[]
  preconOwnership: Record<string, number>
}

export type DeckLibraryRow = {
  data: DeckLibrary
  version: number
  updatedAt: number
}

export type PutOutcome =
  | { ok: true; version: number }
  | { ok: false; current: DeckLibraryRow }

const EMPTY_LIBRARY: DeckLibrary = { customDecks: [], preconOwnership: {} }

function parseData(json: string): DeckLibrary {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_LIBRARY }
    const customDecks = Array.isArray(parsed.customDecks) ? parsed.customDecks : []
    const preconOwnership =
      parsed.preconOwnership && typeof parsed.preconOwnership === 'object' && !Array.isArray(parsed.preconOwnership)
        ? parsed.preconOwnership
        : {}
    return { customDecks, preconOwnership }
  } catch {
    return { ...EMPTY_LIBRARY }
  }
}

export function getOne(db: Db, userId: number): DeckLibraryRow | null {
  const row = db
    .prepare(
      'SELECT data_json AS dataJson, version, updated_at AS updatedAt FROM deck_library WHERE user_id = ?',
    )
    .get(userId) as { dataJson: string; version: number; updatedAt: number } | undefined
  if (!row) return null
  return { data: parseData(row.dataJson), version: row.version, updatedAt: row.updatedAt }
}

export function upsertOne(
  db: Db,
  userId: number,
  data: DeckLibrary,
  expectedVersion: number,
  now = Date.now(),
): PutOutcome {
  const json = JSON.stringify(data)
  const tx = db.transaction((): PutOutcome => {
    const current = getOne(db, userId)
    if (!current) {
      if (expectedVersion !== 0) {
        return { ok: false, current: { data: { ...EMPTY_LIBRARY }, version: 0, updatedAt: 0 } }
      }
      db.prepare(
        'INSERT INTO deck_library (user_id, data_json, version, updated_at) VALUES (?, ?, ?, ?)',
      ).run(userId, json, 1, now)
      return { ok: true, version: 1 }
    }
    if (current.version !== expectedVersion) {
      return { ok: false, current }
    }
    const nextVersion = current.version + 1
    db.prepare(
      'UPDATE deck_library SET data_json = ?, version = ?, updated_at = ? WHERE user_id = ?',
    ).run(json, nextVersion, now, userId)
    return { ok: true, version: nextVersion }
  })
  return tx()
}
