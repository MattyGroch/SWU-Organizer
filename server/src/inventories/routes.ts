import { Router } from 'express'
import { z } from 'zod'
import type { Db } from '../db.js'
import { requireAuth } from '../auth/session.js'
import { getAll, replaceAll, upsertOne, type InventoryRow } from './repo.js'

const SET_KEY_RE = /^[A-Z0-9]{1,16}$/
const InventorySchema = z.record(z.string(), z.number().int().nonnegative())
const PutBody = z.object({ data: InventorySchema })
const BulkBody = z.object({
  sets: z.record(z.string().regex(SET_KEY_RE), InventorySchema),
})

type Deps = { db: Db }

function toResponseSets(rows: InventoryRow[]): Record<string, { data: Record<string, number>; version: number; updatedAt: number }> {
  const out: Record<string, { data: Record<string, number>; version: number; updatedAt: number }> = {}
  for (const r of rows) {
    out[r.setKey] = { data: r.data, version: r.version, updatedAt: r.updatedAt }
  }
  return out
}

export function makeInventoryRouter(deps: Deps): Router {
  const router = Router()
  router.use(requireAuth())

  router.get('/', (req, res) => {
    const rows = getAll(deps.db, req.session!.userId)
    res.json({ sets: toResponseSets(rows) })
  })

  router.put('/', (req, res) => {
    const parsed = BulkBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const rows = replaceAll(deps.db, req.session!.userId, parsed.data.sets)
    res.json({ sets: toResponseSets(rows) })
  })

  router.put('/:setKey', (req, res) => {
    const setKey = req.params.setKey ?? ''
    if (!SET_KEY_RE.test(setKey)) {
      res.status(400).json({ error: 'invalid_set_key' })
      return
    }
    const parsedBody = PutBody.safeParse(req.body)
    if (!parsedBody.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsedBody.error.issues })
      return
    }
    const ifMatch = req.header('if-match')
    const expected = ifMatch === undefined ? NaN : Number(ifMatch)
    if (!Number.isInteger(expected) || expected < 0) {
      res.status(428).json({ error: 'if_match_required' })
      return
    }

    const outcome = upsertOne(deps.db, req.session!.userId, setKey, parsedBody.data.data, expected)
    if (outcome.ok) {
      res.json({ version: outcome.version })
      return
    }
    res.status(409).json({
      error: 'version_conflict',
      current: {
        data: outcome.current.data,
        version: outcome.current.version,
        updatedAt: outcome.current.updatedAt,
      },
    })
  })

  return router
}
