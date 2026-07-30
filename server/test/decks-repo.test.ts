import { describe, expect, it } from 'vitest'
import { memoryDb } from './helpers.js'
import { getOne, upsertOne } from '../src/decks/repo.js'

function seedUser(db: ReturnType<typeof memoryDb>): number {
  const result = db
    .prepare('INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)')
    .run('sub', 'a@b.c', Date.now())
  return Number(result.lastInsertRowid)
}

describe('deck library repo', () => {
  it('returns null for a user with no saved library', () => {
    const db = memoryDb()
    const userId = seedUser(db)
    expect(getOne(db, userId)).toBeNull()
  })

  it('upserts with optimistic concurrency', () => {
    const db = memoryDb()
    const userId = seedUser(db)
    const library = { customDecks: [], preconOwnership: { 'SOR-heroism': 1 } }

    const create = upsertOne(db, userId, library, 0)
    expect(create).toEqual({ ok: true, version: 1 })

    const stale = upsertOne(db, userId, library, 0)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.current.version).toBe(1)

    const next = upsertOne(db, userId, { customDecks: [], preconOwnership: { 'SOR-villainy': 1 } }, 1)
    expect(next).toEqual({ ok: true, version: 2 })

    const row = getOne(db, userId)
    expect(row).toMatchObject({
      data: { customDecks: [], preconOwnership: { 'SOR-villainy': 1 } },
      version: 2,
    })
  })

  it('rejects a first-write with a non-zero If-Match', () => {
    const db = memoryDb()
    const userId = seedUser(db)
    const outcome = upsertOne(db, userId, { customDecks: [], preconOwnership: {} }, 5)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.current.version).toBe(0)
  })

  it('scopes rows per user', () => {
    const db = memoryDb()
    const userA = seedUser(db)
    const userB = Number(
      db
        .prepare('INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)')
        .run('sub-b', 'b@b.c', Date.now()).lastInsertRowid,
    )
    upsertOne(db, userA, { customDecks: [], preconOwnership: { a: 1 } }, 0)
    expect(getOne(db, userB)).toBeNull()
  })
})
