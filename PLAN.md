# notebook-garden merge plan

Unified local app merging YouTube summary ingestion UI and NotebookLM library tending (historically from `watch-laterer` + `notebooklm-browser`; `watch-laterer` is archive-only). Python Watch Later drain scripts live in `~/.cursor/skills/youtube-ask-summarize/scripts/`; this app reads the SQLite file they write to.

## UX model

### Use case 1: Creation (entrypoint)

User has summarized YouTube videos and wants a NotebookLM notebook per video (or batch). Flow is **produce → import → land in library**.

- Summaries view: browse Ask summaries, filter by notebook presence, one-click **Create notebook** on an entry.
- On success: open NotebookLM, persist `notebooklm_url` on the entry, **upsert** the notebook into the local library cache.
- Mental model: planting a seed from source material.

### Use case 2: Organization (garden tending)

User maintains their NotebookLM corpus: sync, rename, tag, pin, delete, create empty notebooks.

- Library view: flat cards, source counts, sync from remote, bulk ops.
- Mental model: tending the garden - pruning, labeling, arranging.
- Sync pulls remote truth; local-only metadata (pins, tags) survives upsert.

### Cross-view behavior

- Creating from a summary should make the notebook appear in Library without a manual sync (optimistic upsert).
- Library link on summary cards opens NotebookLM; optional future: jump Library → filtered by linked entry.
- Two tabs in one shell; no routing library needed (matches existing single-page pattern).

## Architecture decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Repo name | `notebook-garden` | Matches organization metaphor |
| Database | Single `summaries.db` | Python scripts already use this name/path; add `notebooks` table via migration |
| DB env | `APP_DB` (fallback `summaries.db`) | Clarity; no legacy env names |
| NotebookLM client | One `src/server/notebooklm/` module | All RPCs: list, create, rename, delete, add-source, create-and-import |
| Auth | Newest Playwright profile cookie strategy from both repos (identical) | `NOTEBOOKLM_COOKIE` override, `YT_PROFILE_DIR`, headed login retry |
| API server | Hono (`server/app.ts`) + Vite dev proxy | Single route table; local-only, no deploy split |
| Extension | Optional Chrome path retained | Browser-session cookies when extension installed |
| State (Library) | SWR for notebooks; Summaries stays fetch-on-load | Proven in notebooklm-browser; avoid XState unless sync UX needs it |
| UI shell | Tab bar: **Summaries** / **Library** | Minimal new dependency surface |

## What stays / goes / modularizes

**Remain (from watch-laterer):**

- `summary_entries` schema and entries API
- `summary-markdown.ts`, collapsible entry cards, NotebookLM import button
- `notebooklm-importer.ts` (extension + API fallback)
- Extension `background.js` (RPC IDs from shared constants file)

**Remain (from notebooklm-browser):**

- `notebooks` table, sync/upsert/prune, remote rename/delete/create
- Library card UI, sync animations, `useNotebooks` + API client

**Replace / dedupe:**

- Duplicate `notebooklm-auth.ts`, `notebooklm-login.ts` → one copy
- Partial `notebooklm.ts` in each repo → one file with all RPCs
- Duplicate `sendJson`/`readJsonBody` → `http-utils.ts`
- Two monolithic `App.tsx` → `App.tsx` shell + `SummariesView` + `LibraryView`
- Duplicate list helpers → keep separate (`entry-list` vs `notebook-list`) - different filters

**Do not port:**

- watch-laterer droplet deploy / sync stack (reverted, local-only)
- notebooklm-browser XState machine (SWR + local sync visual state is enough)

## Phases

### Phase 0: Foundation

- [x] Backup `summaries.db` and `local.db` to `_db-backups/`
- [x] Init repo, `PLAN.md`, `BUILD_LOG.md`
- [x] `.gitignore`, base `package.json`, tsconfig, vite, tailwind

### Phase 1: Unified NotebookLM core

- [x] `src/server/notebooklm/` - auth, login, full RPC client
- [x] `scripts/notebooklm-login.ts`
- [x] Port integration tests for auth + RPC parsing

### Phase 2: Database

- [x] Drizzle schema: `summary_entries` + `notebooks`
- [x] Migrations from both parents (squashed where sensible)
- [x] Import notebooks from backup `local.db` into unified DB
- [x] Copy backup `summaries.db` as starting `summaries.db`

### Phase 3: API layer

- [x] Hono app: `/api/entries`, `/api/notebooks`, `/api/notebooklm/create-and-import`
- [x] Vite middleware for all API routes
- [x] Create-and-import upserts notebook row after RPC success

### Phase 4: Frontend shell

- [x] `SummariesView` from watch-laterer App
- [x] `LibraryView` from notebooklm-browser App (SWR only)
- [x] Tab navigation + title branding

### Phase 5: Extension + polish

- [x] Extension retained; RPC IDs in unified notebooklm.ts
- [x] README with local workflow (python `--db` path, login, dev)

### Phase 6: Test suite

- [x] API integration tests (entries + notebooks)
- [x] NotebookLM client unit tests (parsers)
- [x] Browser smoke verified on dev server (tabs + API)

## Success criteria

1. `npm run dev` serves both views with working APIs against one `summaries.db`.
2. Create notebook from summary updates entry + library cache.
3. Library sync/create/rename/delete works with Playwright profile auth.
4. Tests pass: `npm run test:run`.
5. YouTube Ask scripts live in the youtube-ask-summarize skill; documented `--db` path to shared DB.
