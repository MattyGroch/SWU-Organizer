import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { makeTestApp, memoryDb, seedUserWithSession } from './helpers.js'

async function seedCollection(app: ReturnType<typeof makeTestApp>, cookie: string) {
  await request(app).put('/api/inventories/SOR').set('Cookie', cookie).set('If-Match', '0').send({ data: { '1': 3 } })
  await request(app)
    .put('/api/decks')
    .set('Cookie', cookie)
    .set('If-Match', '0')
    .send({
      data: {
        customDecks: [{ id: 'deck-1' }],
        preconOwnership: { 'SOR-heroism': 1 },
        deletedDecks: { 'deck-0': '2026-10-01T00:00:00.000Z' },
      },
    })
}

describe('share owner API', () => {
  it('rejects unauthenticated requests', async () => {
    const app = makeTestApp(memoryDb())
    expect((await request(app).get('/api/share')).status).toBe(401)
    expect((await request(app).post('/api/share')).status).toBe(401)
    expect((await request(app).delete('/api/share')).status).toBe(401)
  })

  it('has no share until one is created', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    expect((await request(app).get('/api/share').set('Cookie', cookie)).status).toBe(404)

    const created = await request(app).post('/api/share').set('Cookie', cookie).send({ hiddenSets: ['IBH'] })
    expect(created.status).toBe(200)
    expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(created.body.hiddenSets).toEqual(['IBH'])

    const got = await request(app).get('/api/share').set('Cookie', cookie)
    expect(got.body).toEqual(created.body)
  })

  it('regenerating replaces the token and keeps the hidden sets', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const first = await request(app).post('/api/share').set('Cookie', cookie).send({ hiddenSets: ['IBH'] })
    const second = await request(app).post('/api/share').set('Cookie', cookie).send({})
    expect(second.body.token).not.toBe(first.body.token)
    expect(second.body.hiddenSets).toEqual(['IBH'])
    expect((await request(app).get(`/api/shared/${first.body.token}`)).status).toBe(404)
    expect((await request(app).get(`/api/shared/${second.body.token}`)).status).toBe(200)
  })

  it('updates hidden sets, and 404s when there is no share', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const none = await request(app).put('/api/share/settings').set('Cookie', cookie).send({ hiddenSets: [] })
    expect(none.status).toBe(404)

    const { body } = await request(app).post('/api/share').set('Cookie', cookie).send({})
    const put = await request(app).put('/api/share/settings').set('Cookie', cookie).send({ hiddenSets: ['SOR', 'SHD'] })
    expect(put.status).toBe(200)
    expect(put.body.hiddenSets).toEqual(['SOR', 'SHD'])

    const shared = await request(app).get(`/api/shared/${body.token}`)
    expect(shared.body.hiddenSets).toEqual(['SOR', 'SHD'])
  })

  it('rejects malformed set keys', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    await request(app).post('/api/share').set('Cookie', cookie).send({})
    const res = await request(app).put('/api/share/settings').set('Cookie', cookie).send({ hiddenSets: ['sor; drop'] })
    expect(res.status).toBe(400)
  })

  it('revoking stops the link working', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const { body } = await request(app).post('/api/share').set('Cookie', cookie).send({})
    expect((await request(app).delete('/api/share').set('Cookie', cookie)).status).toBe(204)
    expect((await request(app).get(`/api/shared/${body.token}`)).status).toBe(404)
    expect((await request(app).get('/api/share').set('Cookie', cookie)).status).toBe(404)
  })
})

describe('public shared view', () => {
  it('returns the owner’s collection without signing in', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    await seedCollection(app, cookie)
    const { body: share } = await request(app).post('/api/share').set('Cookie', cookie).send({ hiddenSets: ['IBH'] })

    const res = await request(app).get(`/api/shared/${share.token}`)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.sets.SOR).toMatchObject({ data: { '1': 3 }, version: 1 })
    expect(res.body.decks).toEqual({ customDecks: [{ id: 'deck-1' }], preconOwnership: { 'SOR-heroism': 1 } })
    expect(res.body.hiddenSets).toEqual(['IBH'])
  })

  it('never exposes who the owner is', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie, userId } = seedUserWithSession(db)
    await seedCollection(app, cookie)
    const { body: share } = await request(app).post('/api/share').set('Cookie', cookie).send({})
    const res = await request(app).get(`/api/shared/${share.token}`)
    expect(res.text).not.toContain('allowed@example.com')
    expect(Object.keys(res.body).sort()).toEqual(['decks', 'hiddenSets', 'sets'])
    expect(res.text).not.toContain(`"userId":${userId}`)
  })

  it('serves an empty collection for an owner with no data yet', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    const { body: share } = await request(app).post('/api/share').set('Cookie', cookie).send({})
    const res = await request(app).get(`/api/shared/${share.token}`)
    expect(res.body).toEqual({ sets: {}, decks: { customDecks: [], preconOwnership: {} }, hiddenSets: [] })
  })

  it('404s an unknown or malformed token', async () => {
    const app = makeTestApp(memoryDb())
    expect((await request(app).get('/api/shared/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404)
    expect((await request(app).get('/api/shared/x')).status).toBe(404)
  })

  it('answers 304 when nothing has changed since the last poll', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const { cookie } = seedUserWithSession(db)
    await seedCollection(app, cookie)
    const { body: share } = await request(app).post('/api/share').set('Cookie', cookie).send({})
    const first = await request(app).get(`/api/shared/${share.token}`)
    const etag = first.headers.etag
    expect(etag).toBeTruthy()
    const again = await request(app).get(`/api/shared/${share.token}`).set('If-None-Match', etag)
    expect(again.status).toBe(304)

    await request(app).put('/api/inventories/SOR').set('Cookie', cookie).set('If-Match', '1').send({ data: { '1': 4 } })
    const changed = await request(app).get(`/api/shared/${share.token}`).set('If-None-Match', etag)
    expect(changed.status).toBe(200)
    expect(changed.body.sets.SOR.data).toEqual({ '1': 4 })
  })

  it('keeps one user’s share from reaching another user’s data', async () => {
    const db = memoryDb()
    const app = makeTestApp(db)
    const a = seedUserWithSession(db, 'allowed@example.com')
    const b = seedUserWithSession(db, 'other@example.com')
    await seedCollection(app, a.cookie)
    const { body: share } = await request(app).post('/api/share').set('Cookie', b.cookie).send({})
    const res = await request(app).get(`/api/shared/${share.token}`)
    expect(res.body.sets).toEqual({})
  })
})
