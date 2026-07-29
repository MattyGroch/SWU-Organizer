import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { makeTestApp, memoryDb, seedUserWithSession } from './helpers.js'
import { decodeSid, encodeSid } from '../src/auth/session.js'

describe('auth', () => {
  it('GET /api/health responds without auth', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('GET /api/auth/me returns 401 without a session cookie', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me returns email for a valid session', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db, 'allowed@example.com')
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ email: 'allowed@example.com' })
  })

  it('POST /api/auth/logout clears the session and cookie', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie, sessionId } = seedUserWithSession(db)
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie)
    expect(res.status).toBe(204)
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId)
    expect(row).toBeUndefined()
  })

  it('GET /api/auth/login sets an oauth_state cookie and redirects to Google', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const res = await request(app).get('/api/auth/login')
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('accounts.google.com')
    expect(res.headers['set-cookie']?.join(';')).toContain('oauth_state=')
  })

  it('GET /api/auth/callback rejects mismatched state', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const res = await request(app)
      .get('/api/auth/callback?code=abc&state=notmatching')
      .set('Cookie', 'oauth_state=different')
    expect(res.status).toBe(400)
  })

  it('signed session cookies round-trip', () => {
    const secret = 'testing-secret-1234567890'
    const encoded = encodeSid('abc123', secret)
    expect(decodeSid(encoded, secret)).toBe('abc123')
    expect(decodeSid(encoded, 'wrong-secret')).toBeNull()
    expect(decodeSid('abc123.tampered', secret)).toBeNull()
  })
})
