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

## NotebookLM login

After `npm run dev` is up, run token acquisition in another terminal. Google Chrome must be installed. This opens a Chrome window and pauses in the Playwright inspector:

```bash
npm run login
```

The person signs in at NotebookLM. Then resume the inspector. The script prints `NotebookLM login OK` and stores the session under `~/.config/youtube-ask-summarize/chrome-profile` (override with `YT_PROFILE_DIR`). That directory is the same on macOS and Linux. Create, sync, rename, and delete use that session through the API.

Bookmark sync reads the machine Chrome profile: `~/Library/Application Support/Google/Chrome` on macOS, `~/.config/google-chrome` on Linux.

## Reddit login

Saved sync needs a Reddit app (installed, or web if you have a secret) at https://www.reddit.com/prefs/apps. Set the redirect URI to `http://127.0.0.1:8765/callback`. Then:

```bash
export REDDIT_CLIENT_ID=your_client_id
npm run reddit:login
```

The script prints `Reddit login OK` and stores the refresh token at `~/.config/youtube-ask-summarize/reddit-oauth.json` (override with `REDDIT_TOKEN_PATH`). Also export `REDDIT_CLIENT_SECRET` when the app type is web. Sync from the Reddit Saved tab. `npm run dev` reads those variables from `.env`. This login is not required to boot the app.

Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `npm ci` only when this login will not be run. Login needs the Playwright browser.

## Not part of app setup

- `scripts/backup-db.sh` publishes the owner's database to a private GitHub repo. Do not run it for someone else's checkout.
- YouTube Watch Later ingestion lives outside this repo, in `~/.cursor/skills/youtube-ask-summarize/scripts/`.
- LinkedIn collectors under `scripts/linkedin/` need Python Playwright and a logged-in Chrome profile. They are not required to boot the app.
