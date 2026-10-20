# Agent setup

Get notebook-garden running on a new machine with an empty database. Personal summary data is not in this repository.

## Prerequisites

- Node.js 24.1.0. This repo has `.nvmrc`. From the repo root, `source ~/.nvm/nvm.sh && nvm use` when nvm is installed. Otherwise install Node 24.1.0 and put `node` and `npm` on `PATH` before the commands below.
- A C++ toolchain (`python3`, `make`, `g++`) so `better-sqlite3` can build during install.
- Network access. `npm ci` also downloads a Playwright browser because `playwright` is a runtime dependency.

## Setup

From the repo root:

```bash
npm ci
npm run db:migrate
npm run dev
```

`npm run db:migrate` creates `summaries.db` in the repo root when the file is missing and applies `drizzle/`. The dev server prints its URL, usually `http://localhost:5173`. The API is served by that same process.

Stop there. The app is running. The YouTube and Library views open with empty data until this machine imports or collects some.

## Checks

```bash
npm run test:run
```

Tests create their own temporary databases. They do not need `summaries.db`.

## Database rules

- The app reads `summaries.db`, or the path in `APP_DB`.
- That file, its `-wal` and `-shm` sidecars, and `summaries.db.corrupt-*` are gitignored.
- Do not commit a database file. Do not copy someone else's `summaries.db` into a shared branch.

Standalone API, if you are not using the dev server: `npm run start:api` (port 3002, override with `PORT`).

## Optional: NotebookLM

Skip this unless the task is creating, syncing, renaming, or deleting notebooks.

- `npm run login`, or set `NOTEBOOKLM_COOKIE`.
- `NOTEBOOKLM_BASE_URL` defaults to `https://notebook.google.com`.
- `YT_PROFILE_DIR` defaults to `~/.config/youtube-ask-summarize/chrome-profile`.
- Unpacked Chrome extension instructions are in `extension/README.md`. The dev server must be on `localhost` or `127.0.0.1`.

Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `npm ci` only when NotebookLM login is not needed and install time matters. Login needs the Playwright browser.

## Not part of app setup

- `scripts/backup-db.sh` publishes the owner's database to a private GitHub repo. Do not run it for someone else's checkout.
- YouTube Watch Later ingestion lives outside this repo, in `~/.cursor/skills/youtube-ask-summarize/scripts/`.
- LinkedIn collectors under `scripts/linkedin/` need Python Playwright and a logged-in Chrome profile. They are not required to boot the app.
