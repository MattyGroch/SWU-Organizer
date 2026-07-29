import { pino } from 'pino'
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { makeApp } from './app.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const config = loadConfig()
const db = openDb(config.DB_PATH)
const app = makeApp({ db, config, logger })

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'swu-api listening')
})
