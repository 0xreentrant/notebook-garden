#!/usr/bin/env python3
"""Generate a meta-analysis of Watch Later summaries via cursor agent CLI."""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

# Reuse cursor agent helper from watch-laterer when available
WATCH_LATERER_SCRIPTS = Path.home() / "projects/dreams/watch-laterer/scripts"
if WATCH_LATERER_SCRIPTS.is_dir():
    sys.path.insert(0, str(WATCH_LATERER_SCRIPTS))

from follow_up_questions_lib import call_cursor_agent  # noqa: E402

FOLLOW_UP_CUT = re.compile(
    r"(?ms)^[ \t]*#{2,3}[ \t]*Follow-up questions.*\Z|"
    r"^[ \t]*\*\*Follow-up questions:\*\*.*\Z",
    re.MULTILINE | re.DOTALL,
)
EXCERPT_CHARS = 320

SYSTEM_PROMPT = """You are analyzing one person's YouTube Watch Later → Ask summaries corpus.

This is a personal interest archaeology task, not a video catalog.

Write a clear markdown report covering:

1. **Current interests** - what they seem to care about right now (most recent ~3–6 months of entries, weighted by recency and depth of summary)
2. **Evolution of desires and needs** - how themes, motivations, and problems-to-solve changed over the last couple of years (use entry dates)
3. **Stable threads** - interests that persist across the whole window
4. **Emerging / fading** - what is rising vs cooling off
5. **Implied needs** - practical, emotional, career, craft, health, relationships, money, identity - inferred from what they save and study, not just topic labels
6. **Tensions and contradictions** - competing pulls visible in the corpus

Rules:
- Ground claims in the corpus (cite a few example titles + dates when making a non-obvious claim)
- Prefer patterns over listing every video
- Do not invent biography facts that are not implied by the material
- No fluff openers; start with the substance
- Output markdown only (no JSON wrapper, no code fences around the whole document)
"""


def strip_follow_up(text: str) -> str:
    return FOLLOW_UP_CUT.sub("", text or "").strip()


def build_corpus(db_path: Path) -> tuple[str, str, int]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT title, created_at, updated_at, summary_text
        FROM summary_entries
        WHERE status = 'complete'
          AND deleted_at IS NULL
          AND summary_text IS NOT NULL
          AND length(trim(summary_text)) > 0
        ORDER BY created_at ASC, id ASC
        """
    ).fetchall()
    fingerprint_row = conn.execute(
        """
        SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS mx
        FROM summary_entries
        WHERE status = 'complete' AND deleted_at IS NULL
        """
    ).fetchone()
    conn.close()

    fingerprint = f"{fingerprint_row['n']}:{fingerprint_row['mx']}"
    lines: list[str] = [
        f"Corpus size: {len(rows)} complete summaries.",
        "Each entry: date | title, then a short excerpt of the Ask summary.",
        "",
    ]
    for row in rows:
        body = strip_follow_up(row["summary_text"] or "")
        excerpt = re.sub(r"\s+", " ", body)[:EXCERPT_CHARS].strip()
        date = (row["created_at"] or "")[:10]
        lines.append(f"### {date} | {row['title']}")
        if excerpt:
            lines.append(excerpt)
        lines.append("")
    return "\n".join(lines), fingerprint, len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Meta-analyze summaries.db via cursor agent")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path.home() / "projects/dreams/notebook-garden/summaries.db",
    )
    parser.add_argument("--model", default="auto")
    parser.add_argument("--timeout", type=int, default=0, help="Seconds; 0 = no timeout")
    parser.add_argument(
        "--fingerprint-only",
        action="store_true",
        help="Print source fingerprint and exit",
    )
    args = parser.parse_args()

    corpus, fingerprint, n = build_corpus(args.db)
    if args.fingerprint_only:
        print(fingerprint)
        return 0
    if n == 0:
        print("No complete summaries to analyze.", file=sys.stderr)
        return 1

    prompt = (
        f"{SYSTEM_PROMPT}\n\n---\n\n# Summary corpus\n\n{corpus}\n\n---\n\n"
        "Now write the meta-analysis markdown report."
    )
    text = call_cursor_agent(
        prompt=prompt,
        model=args.model,
        workspace=args.db.resolve().parent,
        timeout=args.timeout or None,
    )
    # Fingerprint on stderr only after success so failed runs don't leak it as the UI error
    print(fingerprint, file=sys.stderr)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
