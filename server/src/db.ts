import Database, { type Database as DatabaseInstance } from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(here, 'schema.sql')

export type Db = DatabaseInstance

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  bootstrap(db)
  return db
}

function bootstrap(db: Db): void {
  const currentVersion = Number(
    (db.pragma('user_version', { simple: true }) as number | bigint) ?? 0,
  )
  // schema.sql is idempotent (CREATE TABLE IF NOT EXISTS), so re-running it against an
  // already-bootstrapped database only adds whatever's new since its last recorded version.
  if (currentVersion >= 2) return
  const schema = readFileSync(SCHEMA_PATH, 'utf8')
  db.exec(schema)
}
