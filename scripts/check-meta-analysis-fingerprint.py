#!/usr/bin/env python3
"""ponytail: assert fingerprint cache hit/miss for meta_analyses."""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

SCHEMA = """
CREATE TABLE summary_entries (
  id INTEGER PRIMARY KEY,
  status TEXT,
  deleted_at TEXT,
  updated_at TEXT,
  summary_text TEXT,
  title TEXT,
  created_at TEXT
);
CREATE TABLE meta_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""


def fingerprint(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        """
        SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), '') AS mx
        FROM summary_entries
        WHERE status = 'complete' AND deleted_at IS NULL
        """
    ).fetchone()
    return f"{row[0]}:{row[1]}"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "t.db"
        conn = sqlite3.connect(db)
        conn.executescript(SCHEMA)
        conn.execute(
            "INSERT INTO summary_entries VALUES (1,'complete',NULL,'2026-01-01','x','t','2026-01-01')"
        )
        conn.commit()
        fp1 = fingerprint(conn)
        conn.execute(
            "INSERT INTO meta_analyses (content, source_fingerprint, created_at) VALUES ('a', ?, '2026-01-02')",
            (fp1,),
        )
        conn.commit()
        latest = conn.execute(
            "SELECT source_fingerprint FROM meta_analyses ORDER BY id DESC LIMIT 1"
        ).fetchone()[0]
        assert latest == fp1
        assert latest == fingerprint(conn)

        conn.execute(
            "INSERT INTO summary_entries VALUES (2,'complete',NULL,'2026-02-01','y','u','2026-02-01')"
        )
        conn.commit()
        fp2 = fingerprint(conn)
        assert fp2 != fp1
        assert latest != fp2
        conn.close()
    print("ok")


if __name__ == "__main__":
    main()
