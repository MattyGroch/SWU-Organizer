import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { makeTestApp, memoryDb, seedUserWithSession } from './helpers.js'

describe('decks API', () => {
  it('rejects unauthenticated requests', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const res = await request(app).get('/api/decks')
    expect(res.status).toBe(401)
  })

  it('returns an empty library for a fresh user', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const res = await request(app).get('/api/decks').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { customDecks: [], preconOwnership: {} }, version: 0, updatedAt: 0 })
  })

  it('creates a new deck library when If-Match: 0', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const res = await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .set('If-Match', '0')
      .send({ data: { customDecks: [], preconOwnership: { 'SOR-heroism': 1 } } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ version: 1 })

    const get = await request(app).get('/api/decks').set('Cookie', cookie)
    expect(get.body.data).toEqual({ customDecks: [], preconOwnership: { 'SOR-heroism': 1 } })
    expect(get.body.version).toBe(1)
  })

  it('bumps version on subsequent writes with matching If-Match', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .set('If-Match', '0')
      .send({ data: { customDecks: [], preconOwnership: { a: 1 } } })
    const res = await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .set('If-Match', '1')
      .send({ data: { customDecks: [], preconOwnership: { a: 1, b: 1 } } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ version: 2 })
  })

  it('returns 409 with the current state when If-Match is stale', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .set('If-Match', '0')
      .send({ data: { customDecks: [], preconOwnership: { a: 1 } } })
    const res = await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .set('If-Match', '0')
      .send({ data: { customDecks: [], preconOwnership: { a: 9 } } })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('version_conflict')
    expect(res.body.current).toMatchObject({ data: { customDecks: [], preconOwnership: { a: 1 } }, version: 1 })
  })

  it('requires an If-Match header on PUT', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const res = await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .send({ data: { customDecks: [], preconOwnership: {} } })
    expect(res.status).toBe(428)
  })

  it('rejects a malformed body', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const res = await request(app)
      .put('/api/decks')
      .set('Cookie', cookie)
      .set('If-Match', '0')
      .send({ data: { customDecks: [], preconOwnership: { a: 'not-a-number' } } })
    expect(res.status).toBe(400)
  })

  it('scopes deck libraries per user', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const userA = seedUserWithSession(db, 'a@example.com')
    await request(app)
      .put('/api/decks')
      .set('Cookie', userA.cookie)
      .set('If-Match', '0')
      .send({ data: { customDecks: [], preconOwnership: { a: 1 } } })

    const userB = seedUserWithSession(db, 'b@example.com')
    const res = await request(app).get('/api/decks').set('Cookie', userB.cookie)
    expect(res.body.data).toEqual({ customDecks: [], preconOwnership: {} })
  })
})
