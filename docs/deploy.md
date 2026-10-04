# Deploying

Production runs on one host with Docker Compose behind Traefik: the app container (`Dockerfile`, nginx) and the sync API (`server/Dockerfile`, SQLite). Traefik sends `swu.mattyflix.com/api/*` to the API and everything else to the app. Both images are built on the host from this repo.

Portainer is not in the loop for now; when it is back, the same `docker-compose.yml` and variables work as a stack.

## One-time setup on the host

1. Clone the repo (or use the existing checkout) and switch to `main`.
2. Create `.env` next to `docker-compose.yml` from `.env.example` and fill it in. It is gitignored. Use a **new** `SESSION_SECRET` for production (`openssl rand -base64 32`), and the OAuth client ID/secret.
3. The `proxy` network must exist (Traefik's): `docker network ls | grep proxy`.

## First v2 deploy (clean database)

From the repo directory on the host:

```bash
git fetch && git checkout main && git pull

# 1. Build both images first. This does not touch the running containers, and fails
#    early if anything is wrong (the app image also runs `nginx -t`).
docker compose build

# 2. Stop the running v1 containers. If v1 was started from a different directory,
#    run `docker compose down` there instead, or: docker rm -f swu-organizer swu-api
docker compose down

# 3. Start v2 on a clean database: move the old one aside (keep it until v2 is confirmed).
sudo mkdir -p /var/config/swu-organizer/v1-backup
sudo sh -c 'mv /var/config/swu-organizer/swu.db* /var/config/swu-organizer/v1-backup/ 2>/dev/null || true'

# 4. Start v2.
docker compose up -d
docker compose ps
```

Then check, from anywhere:

```bash
curl -sI https://swu.mattyflix.com/ | grep -i "permissions-policy\|cache-control"
curl -s -o /dev/null -w "%{http_code}\n" https://swu.mattyflix.com/api/auth/me   # 401 = API up, signed out
docker compose logs --tail 20 swu-organizer   # price refresh output
```

Finally, in the browser: on `localhost:5173` choose **Download backup**; on `swu.mattyflix.com` import it with **Replace entire collection** (decks ticked), then **Sign in to sync** — the clean cloud receives everything.

## Later deploys

```bash
git pull && docker compose up -d --build
```

The card catalog updates through the daily data PR; merging it and redeploying ships new sets. Prices refresh inside the running app container every 24 hours on their own.

## Rolling back to v1

v1's last commit is tagged `v1-final`.

```bash
docker compose down
git checkout v1-final
sudo sh -c 'mv /var/config/swu-organizer/swu.db* /tmp/ ; mv /var/config/swu-organizer/v1-backup/swu.db* /var/config/swu-organizer/'
docker compose up -d --build
```
