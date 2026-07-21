#!/usr/bin/env python3
"""Self-check for LinkedIn posts_db upsert / hash / enrichment reset."""

from __future__ import annotations

import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from li_dom import content_hash
from posts_db import connect, upsert_capture


SCHEMA = Path(__file__).resolve().parents[2] / "drizzle" / "0009_linkedin_saved_items.sql"


def main() -> int:
    sql = SCHEMA.read_text().replace("--> statement-breakpoint", "")
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        raw = sqlite3.connect(db_path)
        raw.executescript(sql)
        raw.close()

        conn = connect(db_path)
        item = {
            "linkedin_urn": "urn:li:activity:1",
            "item_type": "activity",
            "linkedin_url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
            "title": "Hello",
            "content_text": "body one",
            "content_hash": content_hash("body one"),
            "capture_status": "complete",
            "raw_metadata": {"view": "a"},
        }
        assert upsert_capture(conn, item) == "inserted"
        conn.commit()
        assert upsert_capture(conn, item) == "skipped"

        conn.execute(
            "UPDATE linkedin_saved_items SET enrichment_status='complete', summary_text='old' WHERE linkedin_urn=?",
            (item["linkedin_urn"],),
        )
        conn.commit()

        item2 = dict(item)
        item2["content_text"] = "body two"
        item2["content_hash"] = content_hash("body two")
        assert upsert_capture(conn, item2, refresh=True) == "updated"
        conn.commit()
        row = conn.execute(
            "SELECT enrichment_status, summary_text, content_text FROM linkedin_saved_items WHERE linkedin_urn=?",
            (item["linkedin_urn"],),
        ).fetchone()
        assert row["enrichment_status"] == "pending"
        assert row["summary_text"] is None
        assert row["content_text"] == "body two"
        conn.close()
    print("check-posts-db: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
