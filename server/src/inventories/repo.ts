import type { Db } from '../db.js'

export type Inventory = Record<string, number>

export type InventoryRow = {
  setKey: string
  data: Inventory
  version: number
  updatedAt: number
}

export type PutOutcome =
  | { ok: true; version: number }
  | { ok: false; current: InventoryRow }

function parseData(json: string): Inventory {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Inventory) : {}
  } catch {
    return {}
  }
}

export function getAll(db: Db, userId: number): InventoryRow[] {
  const rows = db
    .prepare(
      'SELECT set_key AS setKey, data_json AS dataJson, version, updated_at AS updatedAt FROM inventories WHERE user_id = ?',
    )
    .all(userId) as Array<{ setKey: string; dataJson: string; version: number; updatedAt: number }>
  return rows.map(r => ({
    setKey: r.setKey,
    data: parseData(r.dataJson),
    version: r.version,
    updatedAt: r.updatedAt,
  }))
}

export function getOne(db: Db, userId: number, setKey: string): InventoryRow | null {
  const row = db
    .prepare(
      'SELECT set_key AS setKey, data_json AS dataJson, version, updated_at AS updatedAt FROM inventories WHERE user_id = ? AND set_key = ?',
    )
    .get(userId, setKey) as
    | { setKey: string; dataJson: string; version: number; updatedAt: number }
    | undefined
  if (!row) return null
  return {
    setKey: row.setKey,
    data: parseData(row.dataJson),
    version: row.version,
    updatedAt: row.updatedAt,
  }
}

export function upsertOne(
  db: Db,
  userId: number,
  setKey: string,
  data: Inventory,
  expectedVersion: number,
  now = Date.now(),
): PutOutcome {
  const json = JSON.stringify(data)
  const tx = db.transaction((): PutOutcome => {
    const current = getOne(db, userId, setKey)
    if (!current) {
      if (expectedVersion !== 0) {
        return { ok: false, current: { setKey, data: {}, version: 0, updatedAt: 0 } }
      }
      db.prepare(
        'INSERT INTO inventories (user_id, set_key, data_json, version, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(userId, setKey, json, 1, now)
      return { ok: true, version: 1 }
    }
    if (current.version !== expectedVersion) {
      return { ok: false, current }
    }
    const nextVersion = current.version + 1
    db.prepare(
      'UPDATE inventories SET data_json = ?, version = ?, updated_at = ? WHERE user_id = ? AND set_key = ?',
    ).run(json, nextVersion, now, userId, setKey)
    return { ok: true, version: nextVersion }
  })
  return tx()
}

export function replaceAll(
  db: Db,
  userId: number,
  sets: Record<string, Inventory>,
  now = Date.now(),
): InventoryRow[] {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM inventories WHERE user_id = ?').run(userId)
    const insert = db.prepare(
      'INSERT INTO inventories (user_id, set_key, data_json, version, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    for (const [setKey, data] of Object.entries(sets)) {
      insert.run(userId, setKey, JSON.stringify(data ?? {}), 1, now)
    }
  })
  tx()
  return getAll(db, userId)
}
