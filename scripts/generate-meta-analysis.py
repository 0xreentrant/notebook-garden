#!/usr/bin/env python3
"""Generate a meta-analysis of Watch Later summaries via cursor agent CLI."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

YT_ASK_SCRIPTS = Path.home() / ".cursor/skills/youtube-ask-summarize/scripts"
if not YT_ASK_SCRIPTS.is_dir():
    raise SystemExit(f"Missing YouTube Ask scripts: {YT_ASK_SCRIPTS}")
sys.path.insert(0, str(YT_ASK_SCRIPTS))

from follow_up_questions_lib import resolve_cursor_agent_command  # noqa: E402
from viewer_profile import VIEWER_PROFILE  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from obsidian_vault import with_workspace_switch  # noqa: E402

FOLLOW_UP_CUT = re.compile(
    r"(?ms)^[ \t]*#{2,3}[ \t]*Follow-up questions.*\Z|"
    r"^[ \t]*\*\*Follow-up questions:\*\*.*\Z",
    re.MULTILINE | re.DOTALL,
)
EXCERPT_CHARS = 320

SYSTEM_PROMPT = f"""You are analyzing one person's personal knowledge corpus, saved and studied across four sources:
- YouTube Watch Later → Ask summaries (dated, with excerpts - QA questions are AI-generated from the viewer profile below)
- LinkedIn saved posts / articles (author + short summary or captured text where available)
- Browser bookmarks (title + folder + tags; many include a generated page summary excerpt - treat those as primary evidence, titles alone as weaker signal)
- NotebookLM notebooks (title + tags + source count)

{VIEWER_PROFILE}

This is a personal interest archaeology task, not a catalog.

Write a clear markdown report covering:

1. **Current interests** - what they seem to care about right now (most recent ~3–6 months of entries, weighted by recency and depth of summary)
2. **Evolution of desires and needs** - how themes, motivations, and problems-to-solve changed over the last couple of years (use entry dates)
3. **Stable threads** - interests that persist across the whole window
4. **Emerging / fading** - what is rising vs cooling off
5. **Implied needs** - practical, emotional, career, craft, health, relationships, money, identity - inferred from what they save and study, not just topic labels
6. **Tensions and contradictions** - competing pulls visible in the corpus

Rules:
- Ground claims in the corpus (cite a few example titles + dates, noting the source when useful, for non-obvious claims)
- Treat all four sources as one person's signal; look for themes that cross sources
- Prefer patterns over listing every item
- Weight deeper evidence higher: YouTube Ask summaries and bookmark page summaries > LinkedIn text > titles/folders alone
- Bookmark folders and user tags are intentional self-labels - use them, but do not let them override summary content
- Do not invent biography facts that are not implied by the material
- No fluff openers; start with the substance
- Output markdown only (no JSON wrapper, no code fences around the whole document)
"""


def strip_follow_up(text: str) -> str:
    return FOLLOW_UP_CUT.sub("", text or "").strip()


# ponytail: browser bookmarks can number in the thousands; cap to the most recent
# BOOKMARK_LIMIT to keep the prompt bounded. Upgrade path: sample across the window.
BOOKMARK_LIMIT = 600


def _table_fingerprint(conn, table: str, where: str, date_col: str) -> str:
    try:
        row = conn.execute(
            f"SELECT COUNT(*) AS n, COALESCE(MAX({date_col}), '') AS mx FROM {table} {where}"
        ).fetchone()
        return f"{row['n']}:{row['mx']}"
    except sqlite3.OperationalError:
        return "0:"


def source_fingerprint(conn) -> str:
    """Combined fingerprint across all corpus sources.

    Must stay byte-identical to currentSourceFingerprint() in
    src/server/meta-analysis-api.ts or the DB cache never hits.
    """
    s = _table_fingerprint(
        conn, "summary_entries", "WHERE status = 'complete' AND deleted_at IS NULL", "updated_at"
    )
    # Include complete-summary count: bookmark summarizer does not bump updated_at.
    try:
        brow = conn.execute(
            """
            SELECT COUNT(*) AS n,
                   COALESCE(MAX(updated_at), '') AS mx,
                   SUM(CASE WHEN summary_status = 'complete' THEN 1 ELSE 0 END) AS sc
            FROM bookmarks
            WHERE deleted_at IS NULL
            """
        ).fetchone()
        b = f"{brow['n']}:{brow['mx']}:{brow['sc'] or 0}"
    except sqlite3.OperationalError:
        b = "0::0"
    li = _table_fingerprint(conn, "linkedin_saved_items", "WHERE deleted_at IS NULL", "updated_at")
    nb = _table_fingerprint(conn, "notebooks", "", "created_at")
    return f"s{s}|b{b}|l{li}|nb{nb}"


def _safe_query(conn, sql: str) -> list:
    try:
        return conn.execute(sql).fetchall()
    except sqlite3.OperationalError:
        return []


def _tags(raw: str | None) -> str:
    try:
        parsed = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return ""
    tags = [str(t).strip() for t in parsed if str(t).strip()]
    return f" [{', '.join(tags)}]" if tags else ""


def build_corpus(db_path: Path) -> tuple[str, str, int]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    summaries = _safe_query(
        conn,
        """
        SELECT title, created_at, summary_text
        FROM summary_entries
        WHERE status = 'complete'
          AND deleted_at IS NULL
          AND summary_text IS NOT NULL
          AND length(trim(summary_text)) > 0
        ORDER BY created_at ASC, id ASC
        """,
    )
    linkedin = _safe_query(
        conn,
        """
        SELECT title, author_name, author_headline, summary_text, content_text, created_at
        FROM linkedin_saved_items
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        """,
    )
    bookmarks = _safe_query(
        conn,
        """
        SELECT title, url, folder_path, tags, created_at, summary_text, summary_status
        FROM bookmarks
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        """,
    )[-BOOKMARK_LIMIT:]
    notebooks = _safe_query(
        conn,
        """
        SELECT title, tags, source_count, created_at
        FROM notebooks
        ORDER BY created_at ASC, id ASC
        """,
    )

    fingerprint = source_fingerprint(conn)
    conn.close()

    bookmark_summarized = sum(
        1 for row in bookmarks if row["summary_status"] == "complete" and (row["summary_text"] or "").strip()
    )
    total = len(summaries) + len(linkedin) + len(bookmarks) + len(notebooks)
    lines: list[str] = [
        f"Corpus size: {len(summaries)} YouTube summaries, {len(linkedin)} LinkedIn saves, "
        f"{len(bookmarks)} bookmarks ({bookmark_summarized} with page summaries in this window), "
        f"{len(notebooks)} notebooks.",
        "",
        "## YouTube Watch Later summaries",
        "Each entry: date | title, then a short excerpt of the Ask summary.",
        "",
    ]
    for row in summaries:
        body = strip_follow_up(row["summary_text"] or "")
        excerpt = re.sub(r"\s+", " ", body)[:EXCERPT_CHARS].strip()
        date = (row["created_at"] or "")[:10]
        lines.append(f"### {date} | {row['title']}")
        if excerpt:
            lines.append(excerpt)
        lines.append("")

    lines += ["## LinkedIn saved posts / articles", ""]
    for row in linkedin:
        date = (row["created_at"] or "")[:10]
        title = (row["title"] or "").strip() or "(untitled)"
        author = (row["author_name"] or "").strip()
        headline = (row["author_headline"] or "").strip()
        who = f"{author} — {headline}" if author and headline else author
        lines.append(f"### {date} | {title}" + (f" · {who}" if who else ""))
        body = strip_follow_up(row["summary_text"] or "") or (row["content_text"] or "")
        excerpt = re.sub(r"\s+", " ", body)[:EXCERPT_CHARS].strip()
        if excerpt:
            lines.append(excerpt)
        lines.append("")

    lines += [
        "## Browser bookmarks",
        "Prefer entries that include a page-summary excerpt. Title/folder-only rows are weaker signal.",
        "",
    ]
    for row in bookmarks:
        date = (row["created_at"] or "")[:10]
        folder = (row["folder_path"] or "").strip()
        suffix = f" — {folder}" if folder else ""
        summary = strip_follow_up(row["summary_text"] or "") if row["summary_status"] == "complete" else ""
        excerpt = re.sub(r"\s+", " ", summary)[:EXCERPT_CHARS].strip()
        if excerpt:
            lines.append(f"### {date} | {row['title']}{suffix}{_tags(row['tags'])}")
            lines.append(excerpt)
            lines.append("")
        else:
            lines.append(f"- {date} | {row['title']}{suffix}{_tags(row['tags'])}")
    lines.append("")

    lines += ["## NotebookLM notebooks", ""]
    for row in notebooks:
        date = (row["created_at"] or "")[:10]
        lines.append(
            f"- {date} | {row['title']} ({row['source_count']} sources){_tags(row['tags'])}"
        )
    lines.append("")

    return "\n".join(lines), fingerprint, total


def emit_live(kind: str, **fields: Any) -> None:
    print(f"LIVE\t{json.dumps({'kind': kind, **fields}, ensure_ascii=False)}", file=sys.stderr, flush=True)


def assistant_delta_text(event: dict[str, Any]) -> str | None:
    if event.get("type") != "assistant":
        return None
    if event.get("timestamp_ms") is None or event.get("model_call_id") is not None:
        return None
    message = event.get("message") or {}
    parts = message.get("content") or []
    chunks: list[str] = []
    for part in parts:
        if isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
            chunks.append(str(part["text"]))
    text = "".join(chunks)
    return text or None


def tool_label(event: dict[str, Any]) -> str | None:
    if event.get("type") != "tool_call" or event.get("subtype") != "started":
        return None
    tool_call = event.get("tool_call") or {}
    if not isinstance(tool_call, dict):
        return None
    for key, payload in tool_call.items():
        if not isinstance(payload, dict):
            continue
        name = key.removesuffix("ToolCall") if key.endswith("ToolCall") else key
        args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
        if key == "function":
            name = str(payload.get("name") or "function")
            raw_args = payload.get("arguments")
            detail = str(raw_args)[:80] if raw_args else ""
            return f"{name} {detail}".strip()
        if "path" in args:
            return f"{name} {args['path']}"
        if "command" in args:
            return f"{name} {str(args['command'])[:80]}"
        if args:
            first = next(iter(args.values()), "")
            return f"{name} {str(first)[:80]}".strip()
        return name
    return "tool"


def call_cursor_agent_streaming(
    *,
    prompt: str,
    model: str | None = None,
    workspace: Path | None = None,
    timeout: int | None = None,
) -> str:
    cmd = [
        *resolve_cursor_agent_command(),
        "--print",
        "--trust",
        "--mode",
        "ask",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
    ]
    if model:
        cmd.extend(["--model", model])
    if workspace is not None:
        cmd.extend(["--workspace", str(workspace)])

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as error:
        raise SystemExit(f"cursor agent failed to start: {error}") from error

    assert proc.stdin is not None
    assert proc.stdout is not None
    assert proc.stderr is not None
    proc.stdin.write(prompt)
    proc.stdin.close()

    result_text: str | None = None
    agent_stderr: list[str] = []

    def read_stderr() -> None:
        for line in proc.stderr:
            agent_stderr.append(line.rstrip("\n"))

    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stderr_thread.start()

    try:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue

            delta = assistant_delta_text(event)
            if delta is not None:
                emit_live("delta", text=delta)

            label = tool_label(event)
            if label is not None:
                emit_live("tool", label=label)

            if event.get("type") == "result" and isinstance(event.get("result"), str):
                result_text = event["result"]
    finally:
        try:
            proc.wait(timeout=timeout if timeout and timeout > 0 else None)
        except subprocess.TimeoutExpired as error:
            proc.kill()
            raise SystemExit(f"cursor agent timed out after {timeout}s") from error
        stderr_thread.join(timeout=5)

    err = "\n".join(agent_stderr).strip()
    if proc.returncode != 0:
        detail = err or f"exit code {proc.returncode}"
        raise SystemExit(f"cursor agent failed: {detail}")
    if "Authentication required" in err:
        raise SystemExit("cursor agent is not authenticated. Run: cursor agent login")
    if not result_text or not result_text.strip():
        raise SystemExit("cursor agent returned empty output")
    return result_text.strip()


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
        print("No saved items to analyze.", file=sys.stderr)
        return 1

    prompt = with_workspace_switch(
        f"{SYSTEM_PROMPT}\n\n---\n\n# Corpus\n\n{corpus}\n\n---\n\n"
        "Now write the meta-analysis markdown report.",
        args.db,
    )
    text = call_cursor_agent_streaming(
        prompt=prompt,
        model=args.model,
        workspace=args.db.resolve().parent,
        timeout=args.timeout or None,
    )
    # Fingerprint on stderr only after success so failed runs don't leak it as the UI error
    print(fingerprint, file=sys.stderr, flush=True)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
