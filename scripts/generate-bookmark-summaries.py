#!/usr/bin/env python3
"""Summarize bookmarked pages with cursor agent (auto router).

Fetches each page (stdlib urllib), strips HTML to text, and asks cursor agent
for a markdown summary. Writes summary_text / summary_status on bookmarks.

  python3 scripts/generate-bookmark-summaries.py --limit 5
  python3 scripts/generate-bookmark-summaries.py --ids 12,34
  python3 scripts/generate-bookmark-summaries.py --sleep 30   # slow backfill
  python3 scripts/generate-bookmark-summaries.py --self-check
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[1] / "summaries.db"
CONTENT_CHARS = 8000
FETCH_TIMEOUT = 20
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) notebook-garden-bookmark-summarizer"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self.SKIP:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self.chunks.append(data)


def html_to_text(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html)
    return re.sub(r"\s+", " ", " ".join(parser.chunks)).strip()


def fetch_page_text(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        raise RuntimeError(f"unsupported scheme: {url.split(':', 1)[0]}")
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        ctype = resp.headers.get_content_type()
        if not (ctype.startswith("text/") or ctype.endswith("xml")):
            raise RuntimeError(f"non-text content-type: {ctype}")
        raw = resp.read(2_000_000)
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        charset = resp.headers.get_content_charset() or "utf-8"
    html = raw.decode(charset, errors="replace")
    text = html_to_text(html)
    if not text:
        raise RuntimeError("page produced no text")
    return text[:CONTENT_CHARS]


def build_prompt(row: dict, content: str) -> str:
    return f"""Summarize this bookmarked web page for a personal knowledge base.

Return markdown only with:
1) A short title line as `# …`
2) A concise summary (3-8 bullets or short paragraphs) of what the page covers and why it might have been worth bookmarking

Bookmark title: {row['title']}
URL: {row['url']}
Bookmark folder: {row.get('folder_path') or '(none)'}

Page content (extracted text, may be truncated):
{content}
"""


def run_cursor_agent(prompt: str, model: str) -> str:
    cmd = ["cursor", "agent", "--print", "--trust", "--mode", "ask", "--model", model, prompt]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}")
    text = proc.stdout.strip()
    if not text:
        raise RuntimeError("empty agent response")
    return text


def select_rows(conn: sqlite3.Connection, ids: list[int], limit: int) -> list[dict]:
    if ids:
        marks = ",".join("?" * len(ids))
        sql = f"""
          SELECT id, url, title, folder_path FROM bookmarks
          WHERE id IN ({marks}) AND deleted_at IS NULL
          ORDER BY created_at DESC, id DESC
        """
        rows = conn.execute(sql, ids).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT id, url, title, folder_path FROM bookmarks
            WHERE deleted_at IS NULL AND summary_status = 'pending'
            ORDER BY created_at DESC, id DESC
            """
        ).fetchall()
    rows = [dict(r) for r in rows]
    return rows[:limit] if limit > 0 else rows


# ponytail: summaries intentionally do NOT bump updated_at; the meta-analysis
# fingerprint uses MAX(updated_at) and bookmark summaries are not in that corpus,
# so bumping it would keep the cached meta-analysis permanently stale.
def save_summary(conn: sqlite3.Connection, row_id: int, text: str) -> None:
    conn.execute(
        "UPDATE bookmarks SET summary_text = ?, summary_status = 'complete', summary_error = NULL WHERE id = ?",
        (text, row_id),
    )
    conn.commit()


def save_error(conn: sqlite3.Connection, row_id: int, error: str) -> None:
    conn.execute(
        "UPDATE bookmarks SET summary_status = 'error', summary_error = ? WHERE id = ?",
        (error[:500], row_id),
    )
    conn.commit()


def self_check() -> int:
    text = html_to_text(
        "<html><head><style>p{color:red}</style><script>var x=1</script></head>"
        "<body><h1>Hi</h1><p>A  b</p><noscript>no</noscript></body></html>"
    )
    assert text == "Hi A b", repr(text)

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE bookmarks (
          id INTEGER PRIMARY KEY, url TEXT, title TEXT, folder_path TEXT,
          summary_text TEXT, summary_status TEXT NOT NULL DEFAULT 'pending',
          summary_error TEXT, created_at TEXT, deleted_at TEXT
        );
        INSERT INTO bookmarks (id, url, title, folder_path, created_at) VALUES
          (1, 'https://a', 'A', '', '2026-01-01'),
          (2, 'https://b', 'B', '', '2026-01-02'),
          (3, 'https://c', 'C', '', '2026-01-03');
        UPDATE bookmarks SET summary_status = 'complete' WHERE id = 2;
        UPDATE bookmarks SET deleted_at = 'x' WHERE id = 3;
        """
    )
    picked = [r["id"] for r in select_rows(conn, [], 0)]
    assert picked == [1], picked
    picked = [r["id"] for r in select_rows(conn, [2, 3], 0)]
    assert picked == [2], picked

    save_summary(conn, 1, "# ok")
    row = conn.execute("SELECT summary_status, summary_text FROM bookmarks WHERE id = 1").fetchone()
    assert (row["summary_status"], row["summary_text"]) == ("complete", "# ok")
    save_error(conn, 1, "boom")
    row = conn.execute("SELECT summary_status, summary_error FROM bookmarks WHERE id = 1").fetchone()
    assert (row["summary_status"], row["summary_error"]) == ("error", "boom")

    try:
        fetch_page_text("chrome://settings")
    except RuntimeError as exc:
        assert "unsupported scheme" in str(exc)
    else:
        raise AssertionError("expected unsupported scheme error")

    print("ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--ids", default="", help="Comma-separated bookmark ids (e.g. from a sync)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=3.0, help="Seconds between items")
    parser.add_argument("--model", default="auto")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    if args.self_check:
        return self_check()

    ids = [int(x) for x in args.ids.split(",") if x.strip()]
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rows = select_rows(conn, ids, args.limit)
    print(f"Summarizing {len(rows)} bookmarks (dry_run={args.dry_run})", file=sys.stderr)

    ok = 0
    failed = 0
    for i, row in enumerate(rows):
        if i > 0 and args.sleep > 0 and not args.dry_run:
            time.sleep(args.sleep)
        print(f"- [{row['id']}] {row['url']}", file=sys.stderr)
        try:
            content = fetch_page_text(row["url"])
            prompt = build_prompt(row, content)
            if args.dry_run:
                print(prompt[:500])
                ok += 1
                continue
            save_summary(conn, row["id"], run_cursor_agent(prompt, args.model))
            ok += 1
        except Exception as exc:
            failed += 1
            error = str(exc)
            print(f"  error: {error}", file=sys.stderr)
            if not args.dry_run:
                save_error(conn, row["id"], error)

    conn.close()
    print(json.dumps({"ok": ok, "failed": failed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
