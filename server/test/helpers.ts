import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { pino } from 'pino'
import type { Db } from '../src/db.js'
import type { Config } from '../src/config.js'
import { makeApp } from '../src/app.js'
import { createSession, encodeSid } from '../src/auth/session.js'

const silentLogger = pino({ level: 'silent' })

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(here, '..', 'src', 'schema.sql')

export function memoryDb(): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'))
  return db
}

export const TEST_CONFIG: Config = {
  PORT: 0,
  DB_PATH: ':memory:',
  SESSION_SECRET: 'test-secret-test-secret-test-secret',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_REDIRECT: 'http://localhost/api/auth/callback',
  POST_LOGIN_REDIRECT: 'http://localhost/',
  ALLOWED_EMAILS: ['allowed@example.com'],
  COOKIE_SECURE: false,
  TRUST_PROXY: false,
}

export function makeTestApp(db: Db) {
  return makeApp({ db, config: TEST_CONFIG, logger: silentLogger })
}

export function seedUserWithSession(db: Db, email = 'allowed@example.com') {
  const result = db
    .prepare('INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)')
    .run(`sub-${email}`, email, Date.now())
  const userId = Number(result.lastInsertRowid)
  const session = createSession(db, userId)
  const cookie = `sid=${encodeSid(session.id, TEST_CONFIG.SESSION_SECRET)}`
  return { userId, sessionId: session.id, cookie }
}
