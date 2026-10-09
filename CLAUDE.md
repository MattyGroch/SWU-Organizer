# Working in this repo

Matt often runs two or three Claude Code sessions at once, on different fixes and features. These rules keep them from colliding. They also keep them out of his way.

## Prod data is critical

Since 2026-10-06 swu.mattyflix.com has held Matt's real collection. Losing or corrupting it is the worst thing a change can do. Data lives in two places: the API's SQLite database on the host (`/var/config/swu-organizer/swu.db`) and the IndexedDB on each of his devices (Dexie, `app/src/data/db.ts`). Sync copies between them.

- **Preserve existing data.** A change to a stored shape (Dexie tables or records, the SQLite schema, the JSON the API stores or returns, the backup file format) needs a migration that carries every existing row forward. Make migrations safe to run twice. Test them on data in the old shape, not only on a fresh database.
- **Prefer additive changes.** Add a field, table or Dexie `version()` rather than rename, repurpose or drop one. Readers must tolerate records that lack a new field.
- **Stay compatible with older clients.** A phone's PWA can run an old build for days. Sync and the API must keep accepting what old clients send, and old clients must survive what the new server returns.
- **Server schema changes go in `MIGRATIONS`** (`server/src/db.ts`), as a new numbered step. `schema.sql` is the baseline for a new database only: editing it never reaches prod. Each step runs once in a transaction, after an automatic copy of the database.
- **Flag destructive or risky changes.** That means anything that deletes, overwrites or rewrites stored data, a schema or format change, or changes to sync, import, export or bulk edits. Say so plainly in chat and under a **Data risk** heading in the PR description. Tell Matt to **snapshot the database before merging** (`docs/deploy.md`, "Snapshot the database"). Do this every time, even when it seems obvious.
- **Never touch prod data directly.** Don't query, edit or restart the prod database or containers without asking. Don't point a dev server's `VITE_API_PROXY_TARGET` at prod; dev runs against a local API.

## Backlog lives in GitHub Issues

- **Check open issues at the start of a task** (`gh issue list`) for anything related to the work. There's no `TODO.md` any more.
- **File new bugs, ideas and follow-ups as issues,** not in a file. Labels: `bug`, `enhancement`, `automation`, `ops` (server, deploy, dependencies), `question`, and `needs-matt` (only Matt can do, test or answer it).
- **Close issues from PRs:** put `Closes #N` in the PR description.

## One worktree per task

- **Never edit, commit or switch branches in the main checkout** (`~/SWU-Organizer`). It belongs to Matt. He may have uncommitted edits there, and his dev server on port 5173 runs from it. A branch switch under it changes his files mid-work.
- **Start every task in its own worktree,** branched from the latest `main`:
  ```bash
  git -C ~/SWU-Organizer fetch origin
  git -C ~/SWU-Organizer worktree add -b <branch> ~/SWU-Organizer-worktrees/<branch> origin/main
  ln -s ~/SWU-Organizer/app/node_modules ~/SWU-Organizer-worktrees/<branch>/app/node_modules
  ln -s ~/SWU-Organizer/node_modules ~/SWU-Organizer-worktrees/<branch>/node_modules
  ```
  Then work, test and commit only inside that folder.
- **Remove the worktree once its PR merges:** `git -C ~/SWU-Organizer worktree remove --force <path>`, then delete the branch. Leave other sessions' worktrees alone; `git worktree list` shows them all.

## Commits and PRs

- **Stage only the files you changed, by exact path.** Never `git add -A`, `git add .` or a whole folder. Check `git diff --cached --stat` before committing. A changed file you didn't touch belongs to someone else: leave it unstaged.
- **Base every PR on `main`. Never stack one PR on another's branch.** GitHub only retargets a stacked PR when the branch beneath it is deleted, so stacked work can merge into a stale branch and never reach `main`.
- **Matt merges PRs.** Don't push to `main`.
- **Call out data risk in the PR.** Any PR that touches stored data gets a **Data risk** section (see "Prod data is critical"). Say "none" when that's true, so Matt can tell it was checked.

## Dev servers

- **Each worktree runs its own dev server on its own port** (`npm run dev -- --port 51xx`, plus `--host` for a phone on the same Wi‑Fi). Never use or restart 5173, which is Matt's.
- **Stop the server when you're done with it.**

## Deploying

- **Production** (swu.mattyflix.com) runs the image CI publishes from `main` (`mattygroch/swu-organizer:latest`). Watchtower installs it daily at about 04:30 UTC.
- **Every merge reaches prod by itself** within a day, through Watchtower. So the snapshot for a risky change comes before the merge, not before the deploy.
- **To deploy sooner:** after a merge, wait for the "Publish Docker image" run for the new `main` commit to finish. Then ask the production session (Remote Control, "Live prod site work") to `git pull && docker compose up -d swu-organizer`.
- **API changes don't deploy through Watchtower.** The API is built on the host (`git pull && docker compose up -d --build swu-api`). Snapshot the database first.
- **Read `docs/deploy.md`** for snapshots, rollback and everything else.
