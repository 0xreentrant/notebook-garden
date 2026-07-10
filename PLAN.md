# notebook-garden merge plan

Unified local app merging `watch-laterer` (YouTube summary ingestion UI) and `notebooklm-browser` (NotebookLM library tending). Python Watch Later drain scripts remain in `watch-laterer` unchanged; this app reads the same SQLite file they write to.

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
| DB env | `APP_DB` (fallback `WATCH_LATERER_DB`, then `summaries.db`) | Python compat + clarity |
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
- [ ] `.gitignore`, base `package.json`, tsconfig, vite, tailwind

### Phase 1: Unified NotebookLM core

- [ ] `src/server/notebooklm/` - auth, login, full RPC client
- [ ] `scripts/notebooklm-login.ts`
- [ ] Port integration tests for auth + RPC parsing

### Phase 2: Database

- [ ] Drizzle schema: `summary_entries` + `notebooks`
- [ ] Migrations from both parents (squashed where sensible)
- [ ] Import notebooks from backup `local.db` into unified DB
- [ ] Copy backup `summaries.db` as starting `summaries.db`

### Phase 3: API layer

- [ ] Hono app: `/api/entries`, `/api/notebooks`, `/api/notebooklm/create-and-import`
- [ ] Vite proxy to Hono in dev (or shared handlers - pick proxy for one server truth)
- [ ] Create-and-import upserts notebook row after RPC success

### Phase 4: Frontend shell

- [ ] `SummariesView` from watch-laterer App
- [ ] `LibraryView` from notebooklm-browser App
- [ ] Shared: search/tag/bulk primitives where identical
- [ ] Tab navigation + title branding

### Phase 5: Extension + polish

- [ ] Extension RPC IDs imported from shared `rpc-ids.ts` or build-time sync
- [ ] README with local workflow (python `--db` path, login, dev)

### Phase 6: Test suite

- [ ] API integration tests (entries + notebooks)
- [ ] NotebookLM client unit tests (parsers, mocks)
- [ ] Browser e2e: tab switch, list render (vitest + playwright or MCP browser)
- [ ] Prune tests that no longer match surface area

## Success criteria

1. `npm run dev` serves both views with working APIs against one `summaries.db`.
2. Create notebook from summary updates entry + library cache.
3. Library sync/create/rename/delete works with Playwright profile auth.
4. Tests pass: `npm run test:run`.
5. watch-laterer Python scripts untouched; documented path to shared DB.
