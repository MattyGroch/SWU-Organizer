import Database, { type Database as DatabaseInstance } from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(here, 'schema.sql')

export type Db = DatabaseInstance

/** The version schema.sql leaves a new database at (its closing `PRAGMA user_version`). */
export const BASELINE_VERSION = 2

/** One schema step: upgrades the database from version `to - 1` to `to`. */
export interface Migration {
  to: number
  up: (db: Db) => void
}

/**
 * Every schema change after the baseline, in order. Prod holds real data, so:
 * - append a step; never edit, reorder or remove one that has shipped,
 * - carry existing rows forward (prefer adding a table or column to dropping one),
 * - leave schema.sql alone: it is the baseline for a new database, and the steps run after it.
 */
export const MIGRATIONS: Migration[] = []

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  bootstrap(db)
  migrate(db, MIGRATIONS, dbPath === ':memory:' ? undefined : dbPath)
  // Writes left in the WAL by a server that was killed rather than closed go into the main
  // file now, so swu.db on its own holds everything.
  checkpoint(db)
  return db
}

/** Folds the WAL into the main file and empties it. */
export function checkpoint(db: Db): void {
  db.pragma('wal_checkpoint(TRUNCATE)')
}

/** Closes the database with every write in the main file, ready to copy on its own. */
export function closeDb(db: Db): void {
  checkpoint(db)
  db.close()
}

export function userVersion(db: Db): number {
  return Number((db.pragma('user_version', { simple: true }) as number | bigint) ?? 0)
}

function bootstrap(db: Db): void {
  // A database at the baseline (or past it) keeps its tables; only a new one gets them.
  if (userVersion(db) >= BASELINE_VERSION) return
  const schema = readFileSync(SCHEMA_PATH, 'utf8')
  db.transaction(() => db.exec(schema))()
}

/**
 * Runs each step past the database's version, one transaction per step, so a failing step
 * leaves the database at the last good version. Before the first step it copies the database
 * beside itself (`<db>.pre-v<N>-<time>`), so an upgrade can always be undone by hand.
 */
export function migrate(db: Db, migrations: Migration[], backupFrom?: string): void {
  migrations.forEach((m, i) => {
    if (m.to !== BASELINE_VERSION + i + 1) {
      throw new Error(`Migration ${i} goes to v${m.to}; expected v${BASELINE_VERSION + i + 1}`)
    }
  })
  const pending = migrations.filter((m) => m.to > userVersion(db))
  if (pending.length === 0) return

  if (backupFrom) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    db.prepare('VACUUM INTO ?').run(`${backupFrom}.pre-v${pending[0]!.to}-${stamp}`)
  }

  for (const m of pending) {
    db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.to}`)
    })()
  }
}
