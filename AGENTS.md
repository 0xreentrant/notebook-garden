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

`npm run db:migrate` creates `summaries.db` in the repo root when the file is missing and applies `drizzle/`. The dev server prints its URL, usually `http://localhost:5176`. The API is served by that same process.

Phone access on the tailnet uses the same port behind Tailscale HTTPS, same pattern as Qalm:

```bash
npm run dev:tailscale
```

That binds Vite to this machine's Tailscale IP on port 5176 and proxies `https://notebook-garden.<tailnet>.ts.net` at it. `npm run tailscale:serve` only updates the proxy. `npm run tailscale:reset` removes it. `npm run dev:tailscale:http` skips HTTPS.

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

## Reddit saved

Saved posts are read from a logged-in Chrome profile, not the Data API. This login is not required to boot the app. Google Chrome must be installed. The first run opens a window and waits up to five minutes:

```bash
npm run reddit:saved-login
```

The script prints `Reddit saved login OK` and stores the session under `~/.config/reddit-saved/chrome-profile` (override with `REDDIT_PROFILE_DIR`). Then:

```bash
npm run reddit:saved-collect -- --limit 5
```

That writes into `reddit_saved_items`. Reload the Reddit Saved tab. Omit `--limit` to collect every new save. The script does not unsave. Requests are at least 8 seconds apart. A 429 stops login and collect, and neither script retries. `REDDIT_PROFILE_DIR` can live in `.env`.

Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `npm ci` only when this login will not be run. Login needs the Playwright browser.

## Not part of app setup

- `scripts/backup-db.sh` publishes the owner's database to a private GitHub repo. Do not run it for someone else's checkout.
- YouTube Watch Later ingestion lives outside this repo, in `~/.cursor/skills/youtube-ask-summarize/scripts/`.
- LinkedIn collectors under `scripts/linkedin/` need Python Playwright and a logged-in Chrome profile. They are not required to boot the app.
