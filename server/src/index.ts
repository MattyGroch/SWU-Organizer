import { pino } from 'pino'
import { loadConfig } from './config.js'
import { closeDb, openDb } from './db.js'
import { makeApp } from './app.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const config = loadConfig()
const db = openDb(config.DB_PATH)
const app = makeApp({ db, config, logger })

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'swu-api listening')
})

// As PID 1 in its container, node ignores SIGTERM unless it handles it, so `docker compose
// stop` waited 10s and killed it, leaving writes in the WAL. Finish requests, then close the
// database cleanly.
function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'swu-api shutting down')
  server.close(() => {
    closeDb(db)
    logger.info('swu-api stopped')
    process.exit(0)
  })
  // Idle keep-alive connections would hold server.close open.
  server.closeIdleConnections()
  setTimeout(() => server.closeAllConnections(), 5000).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
