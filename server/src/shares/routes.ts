import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { Db } from '../db.js'
import { requireAuth } from '../auth/session.js'
import { getAll } from '../inventories/repo.js'
import { getOne as getDeckLibrary } from '../decks/repo.js'
import { createOrRegenerate, getShare, getShareByToken, revoke, setHiddenSets } from './repo.js'

const SET_KEY_RE = /^[A-Z0-9]{1,16}$/
const HiddenSets = z.array(z.string().regex(SET_KEY_RE)).max(200)
const CreateBody = z.object({ hiddenSets: HiddenSets.optional() })
const SettingsBody = z.object({ hiddenSets: HiddenSets })
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/

type Deps = { db: Db }

/** The owner's controls for their share link: `/api/share`. */
export function makeShareRouter(deps: Deps): Router {
  const router = Router()
  router.use(requireAuth())

  router.get('/', (req, res) => {
    const share = getShare(deps.db, req.session!.userId)
    if (!share) {
      res.status(404).json({ error: 'no_share' })
      return
    }
    res.json(share)
  })

  router.post('/', (req, res) => {
    const parsed = CreateBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    res.json(createOrRegenerate(deps.db, req.session!.userId, parsed.data.hiddenSets))
  })

  router.put('/settings', (req, res) => {
    const parsed = SettingsBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    if (!setHiddenSets(deps.db, req.session!.userId, parsed.data.hiddenSets)) {
      res.status(404).json({ error: 'no_share' })
      return
    }
    res.json(getShare(deps.db, req.session!.userId))
  })

  router.delete('/', (req, res) => {
    revoke(deps.db, req.session!.userId)
    res.status(204).end()
  })

  return router
}

/**
 * What anyone holding a share link can read: `/api/shared/:token`. No sign-in. It returns
 * the owner's counts and deck library (the binder needs the decks to know what is held out
 * of it), never who the owner is.
 */
export function makeSharedRouter(deps: Deps): Router {
  const router = Router()

  router.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  router.get('/:token', (req, res) => {
    const token = req.params.token ?? ''
    const share = TOKEN_RE.test(token) ? getShareByToken(deps.db, token) : null
    if (!share) {
      res.status(404).json({ error: 'not_found' })
      return
    }

    const rows = getAll(deps.db, share.userId)
    const decks = getDeckLibrary(deps.db, share.userId)
    const sets: Record<string, { data: Record<string, number>; version: number; updatedAt: number }> = {}
    for (const r of rows) sets[r.setKey] = { data: r.data, version: r.version, updatedAt: r.updatedAt }

    // no-cache, not no-store: the browser keeps the copy and revalidates it every time, which is
    // what lets a polling viewer send If-None-Match and get a 304.
    res.set('Cache-Control', 'private, no-cache')
    // Express sends a weak ETag over the body and answers a matching If-None-Match with 304,
    // so a viewer polling an unchanged collection gets an empty reply.
    res.json({
      sets,
      decks: {
        customDecks: decks?.data.customDecks ?? [],
        preconOwnership: decks?.data.preconOwnership ?? {},
      },
      hiddenSets: share.hiddenSets,
    })
  })

  return router
}
