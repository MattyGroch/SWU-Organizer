# Deploying

Production runs on one host with Docker Compose behind Traefik: the app container (`Dockerfile`, nginx) and the sync API (`server/Dockerfile`, SQLite). Traefik sends `swu.mattyflix.com/api/*` to the API and everything else to the app. Both images are built on the host from this repo.

Portainer is not in the loop for now; when it is back, the same `docker-compose.yml` and variables work as a stack.

## Watchtower

The host runs Watchtower, which by default updates _every_ container whose image has a newer version in a registry. Both images here are built on the host (Watchtower cannot pull them) and both services carry `com.centurylinklabs.watchtower.enable=false`, so it never touches this stack. Before the v2 cutover the live frontend ran `mattygroch/swu-organizer:latest` from Docker Hub — which is why v2 is deployed from the `v2` branch _before_ it is merged: merging publishes a new `:latest`.

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

## Later deploys

```bash
git pull && docker compose up -d --build
```

The card catalog updates through the daily data PR; merging it and redeploying ships new sets. Prices refresh inside the running app container every 24 hours on their own.

## Rolling back to v1

Portainer's stack 99 directory still holds v1 exactly as it ran. From the host:

```bash
cd /opt/swu-organizer && docker compose down
mkdir -p /var/config/swu-organizer/v2-backup
mv /var/config/swu-organizer/swu.db* /var/config/swu-organizer/v2-backup/ 2>/dev/null
mv /var/config/swu-organizer/v1-backup/swu.db* /var/config/swu-organizer/

cd /var/lib/docker/volumes/portainer_data/_data/compose/99/9289939e59bf01bdab6560d3db62f68a2c2088a0
docker compose -p swu-organizer -f docker-compose.yml -f restore-override.yml --env-file stack.env up -d
```

v1's last commit is also tagged `v1-final` in git.
