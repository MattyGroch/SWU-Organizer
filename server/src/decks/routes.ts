import { Router } from 'express'
import { z } from 'zod'
import type { Db } from '../db.js'
import { requireAuth } from '../auth/session.js'
import { getOne, upsertOne, type DeckLibrary, type DeckLibraryRow } from './repo.js'

const DeckLibrarySchema = z.object({
  customDecks: z.array(z.unknown()),
  preconOwnership: z.record(z.string(), z.number()),
})
const PutBody = z.object({ data: DeckLibrarySchema })

type Deps = { db: Db }

function toResponse(row: DeckLibraryRow | null): { data: DeckLibrary; version: number; updatedAt: number } {
  if (!row) return { data: { customDecks: [], preconOwnership: {} }, version: 0, updatedAt: 0 }
  return { data: row.data, version: row.version, updatedAt: row.updatedAt }
}

export function makeDeckRouter(deps: Deps): Router {
  const router = Router()
  router.use(requireAuth())

  router.get('/', (req, res) => {
    const row = getOne(deps.db, req.session!.userId)
    res.json(toResponse(row))
  })

  router.put('/', (req, res) => {
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

    const outcome = upsertOne(deps.db, req.session!.userId, parsedBody.data.data, expected)
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
