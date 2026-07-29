import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { Db } from '../db.js'

const COOKIE_NAME = 'sid'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000

export type SessionRow = {
  id: string
  user_id: number
  expires_at: number
}

export type SessionUser = {
  userId: number
  sessionId: string
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionUser
  }
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function encodeSid(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`
}

export function decodeSid(cookie: string | undefined, secret: string): string | null {
  if (!cookie) return null
  const dot = cookie.indexOf('.')
  if (dot < 0) return null
  const id = cookie.slice(0, dot)
  const mac = cookie.slice(dot + 1)
  if (!id || !mac) return null
  if (!safeEqual(mac, sign(id, secret))) return null
  return id
}

export function createSession(db: Db, userId: number, now = Date.now()): SessionRow {
  const id = randomBytes(32).toString('base64url')
  const expiresAt = now + SESSION_TTL_MS
  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, userId, expiresAt, now)
  return { id, user_id: userId, expires_at: expiresAt }
}

export function readSession(db: Db, id: string, now = Date.now()): SessionRow | null {
  const row = db
    .prepare('SELECT id, user_id, expires_at FROM sessions WHERE id = ?')
    .get(id) as SessionRow | undefined
  if (!row) return null
  if (row.expires_at <= now) {
    destroySession(db, id)
    return null
  }
  if (row.expires_at - now < SESSION_TTL_MS - REFRESH_WINDOW_MS) {
    const newExpires = now + SESSION_TTL_MS
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(newExpires, id)
    row.expires_at = newExpires
  }
  return row
}

export function destroySession(db: Db, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

type SessionCookieOptions = {
  secret: string
  secure: boolean
}

export function setSessionCookie(res: Response, sessionId: string, opts: SessionCookieOptions): void {
  const value = encodeSid(sessionId, opts.secret)
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  })
}

export function clearSessionCookie(res: Response, opts: SessionCookieOptions): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax',
    path: '/',
  })
}

export function readSessionCookie(req: Request, secret: string): string | null {
  const raw = req.cookies?.[COOKIE_NAME] as string | undefined
  return decodeSid(raw, secret)
}

type AuthDeps = {
  db: Db
  secret: string
}

export function attachSession(deps: AuthDeps): RequestHandler {
  return (req, _res, next) => {
    const id = readSessionCookie(req, deps.secret)
    if (!id) return next()
    const row = readSession(deps.db, id)
    if (row) req.session = { userId: row.user_id, sessionId: row.id }
    next()
  }
}

export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    next()
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
