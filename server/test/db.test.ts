import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASELINE_VERSION,
  MIGRATIONS,
  closeDb,
  migrate,
  openDb,
  userVersion,
  type Db,
} from '../src/db.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A database file the way prod has it today: the baseline schema, holding a user's data. */
function existingDb(): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'swu-db-'))
  dirs.push(dir)
  const path = join(dir, 'swu.db')
  const db = openDb(path)
  db.prepare("INSERT INTO users (google_sub, email, created_at) VALUES ('sub', 'a@b.c', 1)").run()
  db.prepare(
    "INSERT INTO inventories (user_id, set_key, data_json, version, updated_at) VALUES (1, 'SOR', '{\"1\":3}', 4, 1)",
  ).run()
  db.close()
  return { path, dir }
}

function inventoryRows(db: Db) {
  return db.prepare('SELECT * FROM inventories').all()
}

const addNote = { to: BASELINE_VERSION + 1, up: (db: Db) => db.exec('ALTER TABLE inventories ADD COLUMN note TEXT') }

describe('openDb', () => {
  it('brings a new database to the latest version', () => {
    const db = openDb(':memory:')
    expect(userVersion(db)).toBe(BASELINE_VERSION + MIGRATIONS.length)
  })

  it('reopens an existing database without touching its data', () => {
    const { path } = existingDb()
    const db = openDb(path)
    expect(inventoryRows(db)).toEqual([
      { user_id: 1, set_key: 'SOR', data_json: '{"1":3}', version: 4, updated_at: 1 },
    ])
  })
})

describe('migrate', () => {
  it('runs a new step on an existing database and keeps its rows', () => {
    const { path } = existingDb()
    const db = new Database(path)
    migrate(db, [addNote])
    expect(userVersion(db)).toBe(BASELINE_VERSION + 1)
    expect(inventoryRows(db)).toEqual([
      { user_id: 1, set_key: 'SOR', data_json: '{"1":3}', version: 4, updated_at: 1, note: null },
    ])
  })

  it('runs each step once', () => {
    const { path } = existingDb()
    const db = new Database(path)
    migrate(db, [addNote])
    // A second run would fail on the duplicate column if the step ran again.
    expect(() => migrate(db, [addNote])).not.toThrow()
  })

  it('copies the database aside before upgrading it', () => {
    const { path, dir } = existingDb()
    const db = new Database(path)
    migrate(db, [addNote], path)
    const backups = readdirSync(dir).filter((f) => f.startsWith(`swu.db.pre-v${BASELINE_VERSION + 1}-`))
    expect(backups).toHaveLength(1)
    const copy = new Database(join(dir, backups[0]!), { readonly: true })
    expect(userVersion(copy)).toBe(BASELINE_VERSION)
    expect(inventoryRows(copy)).toHaveLength(1)
  })

  it('makes no copy when nothing is pending', () => {
    const { path, dir } = existingDb()
    migrate(new Database(path), [], path)
    expect(readdirSync(dir).filter((f) => f.includes('.pre-v'))).toEqual([])
  })

  it('rolls a failing step back and stops at the last good version', () => {
    const { path } = existingDb()
    const db = new Database(path)
    const broken = {
      to: BASELINE_VERSION + 2,
      up: (d: Db) => {
        d.exec("UPDATE inventories SET data_json = '{}'")
        throw new Error('boom')
      },
    }
    expect(() => migrate(db, [addNote, broken])).toThrow('boom')
    expect(userVersion(db)).toBe(BASELINE_VERSION + 1)
    expect(inventoryRows(db)).toMatchObject([{ data_json: '{"1":3}' }])
  })

  it('refuses steps out of order', () => {
    const db = openDb(':memory:')
    expect(() => migrate(db, [{ ...addNote, to: BASELINE_VERSION + 2 }])).toThrow(/expected v3/)
  })
})

/** Opens a copy of the main database file alone, as a backup that skipped the -wal would. */
function mainFileAlone(path: string, dir: string): Db {
  const copy = join(dir, 'alone.db')
  copyFileSync(path, copy)
  return new Database(copy, { readonly: true })
}

describe('self-contained database file', () => {
  it('folds writes a killed server left in the WAL into the main file on open', () => {
    const { path, dir } = existingDb()
    // Still open, as if killed: its last write sits in the WAL.
    const killed = openDb(path)
    killed.prepare("UPDATE inventories SET data_json = '{\"1\":5}'").run()
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0)

    const db = openDb(path)
    expect(statSync(`${path}-wal`).size).toBe(0)
    expect(mainFileAlone(path, dir).prepare('SELECT data_json FROM inventories').get()).toEqual({
      data_json: '{"1":5}',
    })
    db.close()
    killed.close()
  })

  it('closeDb leaves every write in the main file', () => {
    const { path, dir } = existingDb()
    const db = openDb(path)
    db.prepare("UPDATE inventories SET data_json = '{\"1\":7}'").run()
    closeDb(db)
    expect(!existsSync(`${path}-wal`) || statSync(`${path}-wal`).size === 0).toBe(true)
    expect(mainFileAlone(path, dir).prepare('SELECT data_json FROM inventories').get()).toEqual({
      data_json: '{"1":7}',
    })
  })
})
