import { describe, expect, it } from 'vitest'
import { memoryDb } from './helpers.js'
import { getAll, getOne, replaceAll, upsertOne } from '../src/inventories/repo.js'

function seedUser(db: ReturnType<typeof memoryDb>): number {
  const result = db
    .prepare('INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)')
    .run('sub', 'a@b.c', Date.now())
  return Number(result.lastInsertRowid)
}

describe('inventory repo', () => {
  it('upserts with optimistic concurrency', () => {
    const db = memoryDb()
    const userId = seedUser(db)

    const create = upsertOne(db, userId, 'SOR', { 1: 1 }, 0)
    expect(create).toEqual({ ok: true, version: 1 })

    const stale = upsertOne(db, userId, 'SOR', { 1: 9 }, 0)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.current.version).toBe(1)

    const next = upsertOne(db, userId, 'SOR', { 1: 2 }, 1)
    expect(next).toEqual({ ok: true, version: 2 })

    const row = getOne(db, userId, 'SOR')
    expect(row).toMatchObject({ setKey: 'SOR', data: { '1': 2 }, version: 2 })
  })

  it('replaceAll wipes and inserts atomically', () => {
    const db = memoryDb()
    const userId = seedUser(db)
    upsertOne(db, userId, 'SOR', { 1: 1 }, 0)
    upsertOne(db, userId, 'SHD', { 2: 2 }, 0)
    const rows = replaceAll(db, userId, { SOR: { 3: 3 } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.setKey).toBe('SOR')
    expect(getAll(db, userId)).toHaveLength(1)
  })

  it('rejects a first-write with a non-zero If-Match', () => {
    const db = memoryDb()
    const userId = seedUser(db)
    const outcome = upsertOne(db, userId, 'SOR', { 1: 1 }, 5)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.current.version).toBe(0)
  })
})
