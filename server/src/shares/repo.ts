import { randomBytes } from 'node:crypto'
import type { Db } from '../db.js'

export type Share = {
  token: string
  hiddenSets: string[]
}

export type ShareOwner = Share & { userId: number }

function parseHiddenSets(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

export function newToken(): string {
  return randomBytes(16).toString('base64url')
}

export function getShare(db: Db, userId: number): Share | null {
  const row = db
    .prepare('SELECT token, hidden_sets_json AS hiddenSetsJson FROM shares WHERE user_id = ?')
    .get(userId) as { token: string; hiddenSetsJson: string } | undefined
  if (!row) return null
  return { token: row.token, hiddenSets: parseHiddenSets(row.hiddenSetsJson) }
}

export function getShareByToken(db: Db, token: string): ShareOwner | null {
  const row = db
    .prepare('SELECT user_id AS userId, token, hidden_sets_json AS hiddenSetsJson FROM shares WHERE token = ?')
    .get(token) as { userId: number; token: string; hiddenSetsJson: string } | undefined
  if (!row) return null
  return { userId: row.userId, token: row.token, hiddenSets: parseHiddenSets(row.hiddenSetsJson) }
}

/** Creates the user's share link, or replaces its token (the old link stops working). */
export function createOrRegenerate(
  db: Db,
  userId: number,
  hiddenSets: string[] | undefined,
  now = Date.now(),
): Share {
  const token = newToken()
  const tx = db.transaction(() => {
    const existing = getShare(db, userId)
    const sets = hiddenSets ?? existing?.hiddenSets ?? []
    db.prepare(
      `INSERT INTO shares (user_id, token, hidden_sets_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, hidden_sets_json = excluded.hidden_sets_json`,
    ).run(userId, token, JSON.stringify(sets), now)
  })
  tx()
  return getShare(db, userId)!
}

/** Returns false when the user has no share to update. */
export function setHiddenSets(db: Db, userId: number, hiddenSets: string[]): boolean {
  const result = db
    .prepare('UPDATE shares SET hidden_sets_json = ? WHERE user_id = ?')
    .run(JSON.stringify(hiddenSets), userId)
  return result.changes > 0
}

export function revoke(db: Db, userId: number): void {
  db.prepare('DELETE FROM shares WHERE user_id = ?').run(userId)
}
