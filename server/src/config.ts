import { z } from 'zod'

const bool = z
  .union([z.boolean(), z.string()])
  .transform(v => (typeof v === 'boolean' ? v : /^(1|true|yes|on)$/i.test(v)))

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().min(1).default('/data/swu.db'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  OAUTH_REDIRECT: z.string().url(),
  POST_LOGIN_REDIRECT: z.string().url().default('http://localhost:5173/'),
  ALLOWED_EMAILS: z
    .string()
    .transform(v =>
      v
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().email()).min(1, 'ALLOWED_EMAILS must include at least one email')),
  COOKIE_SECURE: bool.default(true),
  TRUST_PROXY: bool.default(true),
})

export type Config = z.infer<typeof Env>

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
    throw new Error(`Invalid server configuration:\n${issues}`)
  }
  return parsed.data
}
