import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import pinoHttp from 'pino-http'
import { pino, type Logger } from 'pino'
import type { Db } from './db.js'
import type { Config } from './config.js'
import { attachSession } from './auth/session.js'
import { makeAuthRouter } from './auth/routes.js'
import { makeInventoryRouter } from './inventories/routes.js'
import { makeDeckRouter } from './decks/routes.js'
import { makeGoogleClient } from './auth/google.js'

export type AppDeps = {
  db: Db
  config: Config
  logger?: Logger
}

export function makeApp({ db, config, logger }: AppDeps): Express {
  const app = express()

  if (config.TRUST_PROXY) app.set('trust proxy', 1)

  const log: Logger = logger ?? pino({ level: process.env.LOG_LEVEL ?? 'info' })
  app.use(pinoHttp({ logger: log }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())
  app.use(attachSession({ db, secret: config.SESSION_SECRET }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  const googleClient = makeGoogleClient({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    redirectUri: config.OAUTH_REDIRECT,
  })

  app.use(
    '/api/auth',
    makeAuthRouter({
      db,
      googleClient,
      googleClientId: config.GOOGLE_CLIENT_ID,
      allowedEmails: new Set(config.ALLOWED_EMAILS),
      sessionSecret: config.SESSION_SECRET,
      cookieSecure: config.COOKIE_SECURE,
      postLoginRedirect: config.POST_LOGIN_REDIRECT,
    }),
  )
  app.use('/api/inventories', makeInventoryRouter({ db }))
  app.use('/api/decks', makeDeckRouter({ db }))

  return app
}
