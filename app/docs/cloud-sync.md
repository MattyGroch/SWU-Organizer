# Cloud sync

Sync keeps your collection, decks and precon ownership the same on every device you sign in on. Everything still saves on the device first; sync copies it to the server (`server/`) when you are signed in and online.

## How it behaves

- **Sign in** from the header ("Sign in to sync"). It is a full-page trip through Google; only emails in `ALLOWED_EMAILS` get in.
- **Pushing:** every change is sent about a second after you make it. Offline, changes queue on the device and go up when the connection returns.
- **Pulling:** the app checks the server when you sign in, whenever the tab regains focus, when you come back online, and every 5 minutes — or immediately with **Sync now** in the account menu.
- **Two devices editing at once** (one offline, say): both changes survive. Card counts merge per printing — "+2 here" and "−1 there" both apply. Decks merge deck by deck, the newer edit of a deck winning; a deck deleted on one device stays deleted.
- **First sign-in on a device:** if the cloud is empty, this device's collection is uploaded; if this device is empty, the cloud's is downloaded; if both have a collection, you are asked to **Merge both**, **Use the cloud copy**, or **Use this device**.
- **Not synced:** the Intake queue and the hidden-sets setting stay on each device.

## Google OAuth client (one time)

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, Testing; add your Google account as a test user.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorized redirect URIs** — add both:
   - `http://localhost:5173/api/auth/callback` (local testing, through the Vite dev server)
   - `https://swu.mattyflix.com/api/auth/callback` (production)
4. Keep the **Client ID** and **Client secret**. The secret goes only in `server/.env` (local) and Portainer (production) — never in the repo.

## Running it locally

Create `server/.env` (gitignored) with:

```
SESSION_SECRET=<run: openssl rand -base64 32>
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
OAUTH_REDIRECT=http://localhost:5173/api/auth/callback
POST_LOGIN_REDIRECT=http://localhost:5173/
ALLOWED_EMAILS=matt.grochocinski@gmail.com
COOKIE_SECURE=false
TRUST_PROXY=false
DB_PATH=./data/swu.db
```

Then, in two terminals:

- `cd server && npm run dev` — the API on port 3001 (it reads `server/.env`)
- `cd app && npm run dev` — the app on http://localhost:5173, which forwards `/api` to the API

Open http://localhost:5173 and choose **Sign in to sync**. To try a second device, sign in from a private window or another browser profile.

## Production

Set the same variables in the Portainer stack, with `OAUTH_REDIRECT` / `POST_LOGIN_REDIRECT` on `https://swu.mattyflix.com`, `COOKIE_SECURE=true` and `TRUST_PROXY=true`. The v2 app's nginx must also forward `/api` to the API container — that is part of the cutover, not done yet.
