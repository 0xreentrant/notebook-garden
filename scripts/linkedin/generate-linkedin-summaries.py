#!/usr/bin/env python3
"""Enrich captured LinkedIn items with cursor-agent summaries + follow-up Q&A.

Reads only stored content_text (no LinkedIn browser).

  python3 scripts/linkedin/generate-linkedin-summaries.py --limit 2
  python3 scripts/linkedin/generate-linkedin-summaries.py --dry-run --limit 1
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from posts_db import connect, utc_now

DEFAULT_DB = Path(__file__).resolve().parents[2] / "summaries.db"
PROMPT_VERSION = "li-summary-v1"


def build_prompt(row: dict) -> str:
    return f"""Summarize this LinkedIn saved item for a personal knowledge base.

Return markdown only with:
1) A short title line as `# …`
2) A concise summary (3-8 bullets or short paragraphs)
3) A section exactly headed `### Follow-up questions` with 3 Q&A pairs as:

**Q:** …
**A:** …

Item type: {row['item_type']}
Author: {row.get('author_name') or 'unknown'}
Title: {row.get('title') or ''}
URL: {row.get('source_url') or row.get('linkedin_url')}

Content:
{row.get('content_text') or ''}
"""


def run_cursor_agent(prompt: str, model: str | None) -> str:
    cmd = [
        "cursor",
        "agent",
        "--print",
        "--trust",
        "--mode",
        "ask",
    ]
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}")
    return proc.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--model", default=os.environ.get("LI_ENRICH_MODEL"))
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--retry-backoff", type=float, default=5.0)
    args = parser.parse_args()

    conn = connect(args.db)
    if args.force:
        where = "capture_status = 'complete' AND content_text IS NOT NULL AND deleted_at IS NULL"
    else:
        where = (
            "capture_status = 'complete' AND content_text IS NOT NULL AND deleted_at IS NULL "
            "AND (enrichment_status != 'complete' OR summary_text IS NULL "
            "OR summary_text NOT LIKE '%### Follow-up questions%')"
        )
    sql = f"""
      SELECT id, linkedin_urn, item_type, linkedin_url, source_url,
             author_name, title, content_text, enrichment_status
      FROM linkedin_saved_items
      WHERE {where}
      ORDER BY created_at DESC, id DESC
    """
    rows = [dict(r) for r in conn.execute(sql).fetchall()]
    if args.limit > 0:
        rows = rows[: args.limit]

    print(f"Enriching {len(rows)} rows (dry_run={args.dry_run})", file=sys.stderr)
    ok = 0
    failed = 0
    for row in rows:
        print(f"- {row['linkedin_urn']}", file=sys.stderr)
        prompt = build_prompt(row)
        if args.dry_run:
            print(prompt[:500])
            ok += 1
            continue
        last_err = None
        for attempt in range(args.max_retries + 1):
            try:
                text = run_cursor_agent(prompt, args.model)
                if "### Follow-up questions" not in text:
                    raise RuntimeError("missing Follow-up questions section")
                conn.execute(
                    """
                    UPDATE linkedin_saved_items SET
                      summary_text = ?,
                      enrichment_status = 'complete',
                      enrichment_error = NULL,
                      enrichment_model = ?,
                      enrichment_prompt_version = ?,
                      enriched_at = ?,
                      updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        text,
                        args.model or "cursor-agent",
                        PROMPT_VERSION,
                        utc_now(),
                        utc_now(),
                        row["id"],
                    ),
                )
                conn.commit()
                ok += 1
                last_err = None
                break
            except Exception as exc:
                last_err = str(exc)
                if attempt < args.max_retries:
                    time.sleep(args.retry_backoff * (2**attempt))
        if last_err:
            failed += 1
            conn.execute(
                """
                UPDATE linkedin_saved_items SET
                  enrichment_status = 'error',
                  enrichment_error = ?,
                  updated_at = ?
                WHERE id = ?
                """,
                (last_err[:500], utc_now(), row["id"]),
            )
            conn.commit()
            print(f"  error: {last_err}", file=sys.stderr)

    conn.close()
    print(json.dumps({"ok": ok, "failed": failed}, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
