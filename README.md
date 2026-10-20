# notebook-garden

Unified local app for planting NotebookLM notebooks from YouTube summaries and tending your notebook library.

## Views

- **YouTube** (`/youtube`) - browse Ask summaries from `summaries.db`, create NotebookLM notebooks from videos. `/summaries` redirects here.
- **Library** - sync, tag, pin, rename, and delete notebooks cached locally.

## Database

Local SQLite file: `summaries.db` (override with `APP_DB`). A clone does not include it. `npm run db:migrate` creates an empty one.

Backups of your real database go to the private repo `0xreentrant/notebook-garden-db` (override with `DB_BACKUP_REPO`):

```bash
scripts/backup-db.sh
```

Restore by copying that repo's `summaries.db` into this directory.

Python Watch Later scripts live in `~/.cursor/skills/youtube-ask-summarize/scripts/`. Point them at this DB:

```bash
cd ~/.cursor/skills/youtube-ask-summarize
python3 scripts/yt-headless-batch.py --db ~/projects/dreams/notebook-garden/summaries.db
```

## Setup

New machine, including an agent doing the setup: follow [AGENTS.md](AGENTS.md).

```bash
npm ci
npm run db:migrate
npm run dev
```

NotebookLM auth: `npm run login` or set `NOTEBOOKLM_COOKIE`. Base URL: `NOTEBOOKLM_BASE_URL` (default `https://notebook.google.com`). Profile dir: `YT_PROFILE_DIR` (default `~/.config/youtube-ask-summarize/chrome-profile`).

## API

- `GET/PATCH/DELETE /api/entries`
- `GET/PATCH/DELETE /api/notebooks`, `POST /api/notebooks/sync`, remote create/rename/delete
- `POST /api/notebooklm/create-and-import`

Standalone API: `npm run start:api` (port 3002).

## Tests

```bash
npm run test:run
```
