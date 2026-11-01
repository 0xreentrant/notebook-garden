#!/usr/bin/env python3
"""SQLite open helper for linkedin_saved_items in summaries.db.

The collector writes from TypeScript. This module stays so
generate-linkedin-summaries.py can open the same database.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_COLUMNS = {
    "linkedin_urn",
    "item_type",
    "linkedin_url",
    "capture_status",
    "enrichment_status",
    "content_text",
    "content_hash",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(db_path: Path | str) -> sqlite3.Connection:
    path = Path(db_path)
    if not path.exists():
        raise FileNotFoundError(f"DB missing: {path}")
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='linkedin_saved_items'"
    ).fetchone()
    if not row:
        raise RuntimeError(
            "linkedin_saved_items table missing; run npm run db:migrate in notebook-garden"
        )
    cols = {
        r["name"]
        for r in conn.execute("PRAGMA table_info(linkedin_saved_items)").fetchall()
    }
    missing = REQUIRED_COLUMNS - cols
    if missing:
        raise RuntimeError(f"linkedin_saved_items missing columns: {sorted(missing)}")
