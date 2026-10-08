# Deploying

Production runs on one host with Docker Compose behind Traefik: the app container (`Dockerfile`, nginx) and the sync API (`server/Dockerfile`, SQLite). Traefik sends `swu.mattyflix.com/api/*` to the API and everything else to the app. The app runs the image CI publishes to Docker Hub (`mattygroch/swu-organizer`) on every merge to `main`, and Watchtower keeps it current; the API is built on the host from this repo.

Portainer is not in the loop for now; when it is back, the same `docker-compose.yml` and variables work as a stack.

## Watchtower

The host runs Watchtower, which updates a container when the registry has a newer image for the tag it runs. That is what deploys the app:

1. A PR merges to `main` (a feature, or the daily data refresh with a new set).
2. `docker-publish.yml` builds the image and pushes `latest`, `main` and `sha-<commit>` (release tags `v*.*.*` push that tag too) — about five minutes.
3. On its next check — once a day — Watchtower pulls the new `latest` and restarts the app container: a few seconds' downtime.

The app service is labelled `com.centurylinklabs.watchtower.enable=true`; the API carries `…=false` (it is built on the host, so there is nothing to pull). Watchtower's schedule is its own container's setting on the host, not part of this repo.

## Everyday deploys

- **Wait for Watchtower** — merged changes are live within a day.
- **Now:** `cd /opt/swu-organizer && docker compose up -d swu-organizer` — the service always pulls its tag on `up`.
- **API changes** (`server/`): `git pull && docker compose up -d --build swu-api`.
- **Compose or `.env` changes:** `git pull && docker compose up -d`.

## Snapshot the database

Do this before merging or deploying anything that changes stored data. SQLite keeps recent writes in the `-wal` file. A cleanly stopped API folds them into `swu.db` and leaves it on its own, but copy all three files together anyway, in case it was killed:

```bash
cd /opt/swu-organizer
snap=/var/config/swu-organizer/snapshots/$(date +%F-%H%M)
docker compose stop swu-api
mkdir -p "$snap"
cp -a /var/config/swu-organizer/swu.db* "$snap"/
docker compose start swu-api
```

To restore: stop the API, move the current `swu.db*` aside, copy the snapshot's files back, then start the API again.

The server copy only holds what has synced. Also choose **Download backup** in the app on the main device. That file is the client-side copy of the collection and decks.

## Trying a branch before merging

Build the checkout instead of the published image:

```bash
git fetch && git checkout <branch>
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build swu-organizer
```

The local image (`swu-organizer-local`) has a name Docker Hub doesn't know, so Watchtower leaves it in place until you switch back: `git checkout main && docker compose up -d swu-organizer`.

## Rolling back the app

Every merge stays on Docker Hub under a fixed tag. Pin one in `.env` — `SWU_APP_TAG=v2.0.0` or `SWU_APP_TAG=sha-6be7a7f` — and run `docker compose up -d swu-organizer`. Watchtower follows the pinned tag, which never changes, so it stays put. Remove the line (and `up -d` again) to follow `latest` once the fix is merged.

## First v2 deploy (clean database)

v1 ran as Portainer stack 99, from a Portainer-managed directory (no git checkout) with a `restore-override.yml` pointing the frontend at the Docker Hub image and Portainer's `stack.env` for settings. v2 moves to a plain checkout in `/opt/swu-organizer`.

On the host (as root):

```bash
# 1. A checkout of the v2 branch.
git clone -b v2 https://github.com/MattyGroch/SWU-Organizer.git /opt/swu-organizer
cd /opt/swu-organizer

# 2. Settings: create .env from .env.example. The values can come from Portainer's
#    stack.env in the stack 99 directory; a new SESSION_SECRET is recommended.
#    (Done by hand — never commit or print it.)

# 3. Build both images while v1 keeps serving. Fails early if anything is wrong (the app
#    image also runs `nginx -t`).
docker compose build

# 4. Stop v1.
docker stop swu-organizer swu-api && docker rm swu-organizer swu-api

# 5. Clean database: move the old one aside with the API stopped. SQLite keeps recent
#    writes in the -wal file, so all three files move together.
mkdir -p /var/config/swu-organizer/v1-backup
mv /var/config/swu-organizer/swu.db* /var/config/swu-organizer/v1-backup/

# 6. Start v2.
docker compose up -d
docker compose ps
```

Check:

```bash
curl -sI https://swu.mattyflix.com/ | grep -i "permissions-policy\|cache-control"   # camera=(self); no-cache
curl -s -o /dev/null -w "%{http_code}\n" https://swu.mattyflix.com/api/auth/me      # 401 = API up, signed out
docker compose logs --tail 30 swu-organizer                                           # price refresh
```

Then merge the `v2` pull request and move the checkout onto `main` (`git checkout main && git pull` — nothing to rebuild if the merge changed nothing).

Finally, in the browser: on `localhost:5173` choose **Download backup**; on `swu.mattyflix.com` import it with **Replace entire collection** (decks ticked), then **Sign in to sync** — the clean cloud receives everything.

## Card data

The card catalog updates through the daily data PR (`update-sets.yml`). A new set joins it only once every card is listed and every picture is on the CDN (`scripts/check-readiness.mjs`), so prerelease listings wait. Merging the PR publishes a new image, which Watchtower deploys. Prices refresh inside the running app container every 24 hours on their own.

## Rolling back to v1

v1's exact images were tagged before the cutover: `swu-organizer-swu-api:v1-rollback` and `mattygroch/swu-organizer:v1-rollback`. Use those — the v2 build has taken over the `swu-organizer-swu-api` name, and Docker Hub's `:latest` is v2 once the PR is merged. Portainer's stack 99 directory still holds v1's compose files and `stack.env`.

```bash
cd /opt/swu-organizer && docker compose down

# Swap the databases back.
mkdir -p /var/config/swu-organizer/v2-backup
mv /var/config/swu-organizer/swu.db* /var/config/swu-organizer/v2-backup/ 2>/dev/null
mv /var/config/swu-organizer/v1-backup/swu.db* /var/config/swu-organizer/

# Point the names v1's compose expects at the v1 images, then start without building or pulling.
docker tag swu-organizer-swu-api:v1-rollback swu-organizer-swu-api:latest
docker tag mattygroch/swu-organizer:v1-rollback mattygroch/swu-organizer:latest
cd /var/lib/docker/volumes/portainer_data/_data/compose/99/9289939e59bf01bdab6560d3db62f68a2c2088a0
docker compose -p swu-organizer -f docker-compose.yml -f restore-override.yml --env-file stack.env up -d --no-build --pull never
```

v1's last commit is also tagged `v1-final` in git.

## Rolling back past the service worker

From `1c1c3be` on, the app installs a service worker (`/sw.js`) that caches the app for offline use. Pages are fetched network-first, so after any rollback a browser still loads whatever the server now serves. But an image that has no `sw.js` answers `/sw.js` with `index.html`, the browser's update check then fails on the MIME type, and the old worker stays registered: it keeps caching data and serves its cached shell when offline. To retire it cleanly, serve this as `/sw.js` from the rolled-back image (put it in that build's `app/public/sw.js`):

```js
// Unregisters itself and drops its caches; the next load is a plain website again.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
```

On a single phone, uninstalling the app or clearing the site's data does the same.

## Build host permissions

The image normalises file permissions in the web root (`chmod -R a+rX`), so a checkout made under a strict umask — root on photonOS uses 0027 — still serves correctly. Without it, nginx's non-root workers answered 403 for everything copied from `app/public`.
