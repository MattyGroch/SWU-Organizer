# Deploying

Production runs on one Docker host with Compose behind Traefik: the app container (`Dockerfile`, nginx) and the sync API (`server/Dockerfile`, SQLite). Traefik sends `swu.mattyflix.com/api/*` to the API and everything else to the app.

## Where it runs

- **Host:** the `docker` VM (ID 120) on the Proxmox host `pve`, at 192.168.5.10. `ssh docker` reaches it as root; `ssh proxmox` reaches `pve`.
- **Portainer:** `https://192.168.5.10:9443`. The deployment is the stack `swu-organizer` (stack ID 7) on the `local` environment (ID 3). It is a git stack: Portainer pulls `docker-compose.yml` from `main` of this repo. Portainer keeps its own copy of the files in its data volume, so the host has **no checkout** of the repo (there is no `/opt/swu-organizer`).
- **Settings** (`SESSION_SECRET`, the Google OAuth values, `ALLOWED_EMAILS`, the redirect URLs) are the stack's **Environment variables** in Portainer, not a `.env` file. `.env.example` lists the names.
- **Data:** the API's SQLite files are in `/var/config/swu-organizer/` on the VM (`swu.db`, with `-wal` and `-shm` beside it while it runs), and snapshots go in `snapshots/` beside them.
- **Access for scripts and sessions:** a Portainer access token (My account → Access tokens) sent as an `X-API-Key` header. Matt's is in `~/.portainer_api_key`; never print it or commit it.

## How a deploy happens

1. A PR merges to `main` (a feature, or the daily data refresh with a new set).
2. `docker-publish.yml` builds the image and pushes `latest`, `main` and `sha-<commit>` (release tags `v*.*.*` push that tag too), which takes about five minutes.
3. The workflow's last step, "Trigger Portainer redeploy", POSTs to the stack's webhook (the repo secret `PORTAINER_WEBHOOK_URL`). Portainer pulls `main` and redeploys the stack, which recreates the containers: a few seconds' downtime. The step runs for pushes to `main` and for manual runs, never for tags, and the job fails if the secret is missing.

**Every merge therefore reaches prod within minutes**, not within a day. Snapshot before merging, not after.

Watchtower still runs on the host as a fallback. The app service is labelled `com.centurylinklabs.watchtower.enable=true`, so it also picks up a newer `latest` on its own schedule; the API carries `…=false`. Watchtower's schedule is its own container's setting, not part of this repo.

## Everyday deploys

- **Merge** and wait: it is live once the "Publish Docker image" run finishes.
- **Redeploy without a merge:** re-run "Publish Docker image" on `main` (it has a manual trigger and fires the webhook), or open the stack in Portainer and choose **Pull and redeploy**.
- **Compose or environment changes:** a merged compose change arrives with the next redeploy. Environment variables are edited in the stack's editor in Portainer, then **Update the stack**.
- **API changes** (`server/`) ship in the same redeploy, and they usually change stored data, so snapshot first. After a server change, check that the API image was rebuilt: `ssh docker docker image inspect swu-organizer-swu-api --format '{{.Created}}'`.

## Snapshot the database

Do this before merging or deploying anything that changes stored data. SQLite keeps recent writes in the `-wal` file. A cleanly stopped API folds them into `swu.db` and leaves it on its own, but copy all three files together anyway, in case it was killed:

```bash
ssh docker
snap=/var/config/swu-organizer/snapshots/$(date +%F-%H%M)
docker stop swu-api
mkdir -p "$snap" && cp -a /var/config/swu-organizer/swu.db* "$snap"/
docker start swu-api
```

Stopping the API takes sync offline for about twenty seconds; the app container keeps serving. Docker can report the API as `starting` for up to a minute after the start before the health check passes. Check `docker ps` before you merge.

The stop and start can go through the Portainer API instead (`POST /api/endpoints/3/docker/containers/swu-api/stop`, then `…/start`, with the `X-API-Key` header). The copy itself still runs on the VM over SSH. Stop only the `swu-api` container: the stack-level stop in Portainer takes the app down too.

To restore: stop the API, move the current `swu.db*` aside, copy the snapshot's files back, then start the API again.

The server copy only holds what has synced. Also choose **Download backup** in the app on the main device. That file is the client-side copy of the collection and decks.

## Trying a branch before merging

Prod has no checkout to build from, so try a branch with its own dev server against a local API (see `CLAUDE.md`). `docker-compose.build.yml` builds a checkout instead of pulling the published image, for a machine that has one; it is not used on prod.

## Rolling back the app

Every merge stays on Docker Hub under a fixed tag. In Portainer, open the stack's Environment variables, add `SWU_APP_TAG` set to a tag, such as `v2.0.0` or `sha-6be7a7f`, and **Update the stack**. The variable stays across redeploys, so later merges don't move the app off the pinned tag, and Watchtower follows the pinned tag too. Delete the variable and update the stack again to follow `latest` once the fix is merged.

This rolls back the app image only. The API is built from `server/` in the stack's checkout of `main`, and the database doesn't roll back; restore a snapshot for that.

## First v2 deploy (clean database)

> **Historical.** This is the October 2026 cutover, done on the old host (`photon`). That host, its `/opt/swu-organizer` checkout and Portainer stack 99 are gone since the move to the Proxmox VM. It is kept for the record, not as a procedure.

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

> **Historical.** Written for the old host. The steps below name paths and a Portainer stack (99) that no longer exist; adapt them rather than paste them.

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
