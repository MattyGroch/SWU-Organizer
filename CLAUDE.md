# Working in this repo

Matt often runs two or three Claude Code sessions at once, on different fixes and features. These rules keep them from colliding. They also keep them out of his way.

## One worktree per task

- **Never edit, commit or switch branches in the main checkout** (`~/SWU-Organizer`). It belongs to Matt. He edits `TODO.md` there (in Obsidian), and his dev server on port 5173 runs from it. A branch switch under it changes his files mid-work.
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

## Dev servers

- **Each worktree runs its own dev server on its own port** (`npm run dev -- --port 51xx`, plus `--host` for a phone on the same Wi‑Fi). Never use or restart 5173, which is Matt's.
- **Stop the server when you're done with it.**

## Deploying

- **Production** (swu.mattyflix.com) runs the image CI publishes from `main` (`mattygroch/swu-organizer:latest`). Watchtower installs it daily at about 04:30 UTC.
- **To deploy sooner:** after a merge, wait for the "Publish Docker image" run for the new `main` commit to finish. Then ask the production session (Remote Control, "Live prod site work") to `git pull && docker compose up -d swu-organizer`.
- **Read `docs/deploy.md`** for rollback and everything else.
