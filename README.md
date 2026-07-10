# notebook-garden

Unified local app for planting NotebookLM notebooks from YouTube summaries and tending your notebook library.

## Views

- **Summaries** - browse Ask summaries from `summaries.db`, create NotebookLM notebooks from videos.
- **Library** - sync, tag, pin, rename, and delete notebooks cached locally.

## Database

Single SQLite file: `summaries.db` (override with `APP_DB` or `WATCH_LATERER_DB`).

Python Watch Later scripts in `../watch-laterer` are unchanged. Point them at this DB:

```bash
cd ../watch-laterer
python3 scripts/yt-headless-batch.py --db ../notebook-garden/summaries.db
```

## Setup

```bash
npm install
npm run db:migrate
npm run db:import-notebooks   # optional: import notebooks from backup local.db
npm run dev
```

NotebookLM auth: `npm run login` or set `NOTEBOOKLM_COOKIE`. Profile dir: `YT_PROFILE_DIR` (default `~/.config/youtube-ask-summarize/chrome-profile`).

## API

- `GET/PATCH/DELETE /api/entries`
- `GET/PATCH/DELETE /api/notebooks`, `POST /api/notebooks/sync`, remote create/rename/delete
- `POST /api/notebooklm/create-and-import`

Standalone API: `npm run start:api` (port 3002).

## Tests

```bash
npm run test:run
```
