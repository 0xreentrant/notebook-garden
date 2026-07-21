# LinkedIn Saved runbook

Worktree/branch: `feature/linkedin-saved` (repo root may be `notebook-garden-linkedin`).

## Auth

```bash
python3 scripts/linkedin/li-login.py
```

Profile: `~/.config/linkedin-saved/chrome-profile` (mode `0700`).
Manual login only. Hard-stop on checkpoint / captcha / restricted account.

## Collect (read-only, no unsave)

```bash
# sample
python3 scripts/linkedin/li-collect.py --limit 5

# dry run
python3 scripts/linkedin/li-collect.py --dry-run --limit 3

# all new URNs
python3 scripts/linkedin/li-collect.py
```

Writes to `summaries.db` table `linkedin_saved_items`.

## Enrich

```bash
python3 scripts/linkedin/generate-linkedin-summaries.py --limit 2
python3 scripts/linkedin/generate-linkedin-summaries.py --dry-run --limit 1
```

Requires `cursor agent` auth. Uses stored `content_text` only.

## UI

```bash
npm run db:migrate
npm run dev
```

Open the **LinkedIn Saved** tab.

## Inspect

```bash
sqlite3 summaries.db "SELECT capture_status, enrichment_status, COUNT(*) FROM linkedin_saved_items GROUP BY 1,2;"
sqlite3 summaries.db "SELECT id, item_type, substr(title,1,60), length(content_text) FROM linkedin_saved_items ORDER BY id DESC LIMIT 10;"
```

## Self-check

```bash
python3 scripts/linkedin/check-posts-db.py
```

## Unsave

Not enabled in collection. Overflow label is **Unsave** (see `RECON.md`). Implement `li-unsave.py` only after repeated successful collects.

## Recon notes

See [RECON.md](RECON.md).
