import { pino } from 'pino'
import { openDb, type Db } from '../src/db.js'
import type { Config } from '../src/config.js'
import { makeApp } from '../src/app.js'
import { createSession, encodeSid } from '../src/auth/session.js'

const silentLogger = pino({ level: 'silent' })

// The same path as prod: baseline schema, then every migration.
export function memoryDb(): Db {
  return openDb(':memory:')
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
