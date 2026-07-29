import { Router, type RequestHandler } from 'express'
import rateLimit from 'express-rate-limit'
import { randomBytes } from 'node:crypto'
import type { OAuth2Client } from 'google-auth-library'
import type { Db } from '../db.js'
import { buildAuthUrl, exchangeCodeForIdentity } from './google.js'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
} from './session.js'

type Deps = {
  db: Db
  googleClient: OAuth2Client
  googleClientId: string
  allowedEmails: Set<string>
  sessionSecret: string
  cookieSecure: boolean
  postLoginRedirect: string
}

const STATE_COOKIE = 'oauth_state'
const STATE_TTL_MS = 10 * 60 * 1000

export function makeAuthRouter(deps: Deps): Router {
  const router = Router()

  const callbackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  })

  router.get('/login', loginLimiter, (_req, res) => {
    const state = randomBytes(24).toString('base64url')
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: deps.cookieSecure,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: STATE_TTL_MS,
    })
    res.redirect(buildAuthUrl(deps.googleClient, state))
  })

  router.get('/callback', callbackLimiter, (async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const cookieState = req.cookies?.[STATE_COOKIE] as string | undefined
    res.clearCookie(STATE_COOKIE, { path: '/api/auth' })

    if (!code || !state || !cookieState || state !== cookieState) {
      res.status(400).json({ error: 'invalid_state' })
      return
    }

    let identity
    try {
      identity = await exchangeCodeForIdentity(deps.googleClient, code, deps.googleClientId)
    } catch {
      res.status(400).json({ error: 'code_exchange_failed' })
      return
    }

    if (!identity.emailVerified) {
      res.status(403).json({ error: 'email_not_verified' })
      return
    }
    if (!deps.allowedEmails.has(identity.email)) {
      res.status(403).json({ error: 'email_not_allowed' })
      return
    }

    const now = Date.now()
    const existing = deps.db
      .prepare('SELECT id FROM users WHERE google_sub = ?')
      .get(identity.sub) as { id: number } | undefined

    let userId: number
    if (existing) {
      userId = existing.id
      deps.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(identity.email, userId)
    } else {
      const result = deps.db
        .prepare('INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)')
        .run(identity.sub, identity.email, now)
      userId = Number(result.lastInsertRowid)
    }

    const session = createSession(deps.db, userId, now)
    setSessionCookie(res, session.id, { secret: deps.sessionSecret, secure: deps.cookieSecure })
    res.redirect(deps.postLoginRedirect)
  }) as RequestHandler)

  router.post('/logout', (req, res) => {
    const sid = req.session?.sessionId
    if (sid) destroySession(deps.db, sid)
    clearSessionCookie(res, { secret: deps.sessionSecret, secure: deps.cookieSecure })
    res.status(204).end()
  })

  router.get('/me', requireAuth(), (req, res) => {
    const row = deps.db
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(req.session!.userId) as { email: string } | undefined
    if (!row) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    res.json({ email: row.email })
  })

  return router
}
