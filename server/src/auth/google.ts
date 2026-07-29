import { OAuth2Client } from 'google-auth-library'

export type GoogleIdentity = {
  sub: string
  email: string
  emailVerified: boolean
}

export type GoogleConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function makeGoogleClient(cfg: GoogleConfig): OAuth2Client {
  return new OAuth2Client({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri,
  })
}

export function buildAuthUrl(client: OAuth2Client, state: string): string {
  return client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email'],
    state,
    include_granted_scopes: false,
  })
}

export async function exchangeCodeForIdentity(
  client: OAuth2Client,
  code: string,
  clientId: string,
): Promise<GoogleIdentity> {
  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) throw new Error('Google response missing id_token')
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId })
  const payload = ticket.getPayload()
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Google id_token payload missing sub/email')
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
  }
}
