#!/usr/bin/env python3
"""SQLite CRUD for linkedin_saved_items in summaries.db."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


def existing_urns(conn: sqlite3.Connection) -> set[str]:
    return {
        r["linkedin_urn"]
        for r in conn.execute(
            "SELECT linkedin_urn FROM linkedin_saved_items WHERE deleted_at IS NULL"
        )
    }


def upsert_capture(conn: sqlite3.Connection, item: dict[str, Any], *, refresh: bool = False) -> str:
    """Insert or update a captured item. Returns 'inserted' | 'updated' | 'skipped'."""
    now = utc_now()
    urn = item["linkedin_urn"]
    existing = conn.execute(
        "SELECT id, content_hash, capture_status FROM linkedin_saved_items WHERE linkedin_urn = ?",
        (urn,),
    ).fetchone()

    raw_metadata = item.get("raw_metadata") or {}
    if isinstance(raw_metadata, dict):
        raw_metadata = json.dumps(raw_metadata, ensure_ascii=False)
    tags = item.get("tags")
    if isinstance(tags, list):
        tags = json.dumps(tags)
    notebooklm_links = item.get("notebooklm_links")
    if isinstance(notebooklm_links, list):
        notebooklm_links = json.dumps(notebooklm_links)

    payload = {
        "linkedin_urn": urn,
        "item_type": item["item_type"],
        "linkedin_url": item["linkedin_url"],
        "source_url": item.get("source_url"),
        "author_name": item.get("author_name"),
        "author_url": item.get("author_url"),
        "author_headline": item.get("author_headline"),
        "title": item.get("title"),
        "content_text": item.get("content_text"),
        "raw_metadata": raw_metadata or "{}",
        "content_hash": item.get("content_hash"),
        "extracted_at": item.get("extracted_at") or now,
        "capture_status": item["capture_status"],
        "capture_error": item.get("capture_error"),
        "updated_at": now,
    }

    if existing is None:
        conn.execute(
            """
            INSERT INTO linkedin_saved_items (
              linkedin_urn, item_type, linkedin_url, source_url,
              author_name, author_url, author_headline, title, content_text,
              raw_metadata, content_hash, extracted_at,
              capture_status, capture_error, enrichment_status,
              notebooklm_links, tags, created_at, updated_at
            ) VALUES (
              :linkedin_urn, :item_type, :linkedin_url, :source_url,
              :author_name, :author_url, :author_headline, :title, :content_text,
              :raw_metadata, :content_hash, :extracted_at,
              :capture_status, :capture_error, 'pending',
              '[]', '[]', :updated_at, :updated_at
            )
            """,
            payload,
        )
        return "inserted"

    if not refresh and existing["capture_status"] in ("complete", "metadata_only"):
        return "skipped"

    new_hash = payload.get("content_hash")
    old_hash = existing["content_hash"]
    reset_enrichment = bool(new_hash and new_hash != old_hash)

    conn.execute(
        f"""
        UPDATE linkedin_saved_items SET
          item_type = :item_type,
          linkedin_url = :linkedin_url,
          source_url = :source_url,
          author_name = :author_name,
          author_url = :author_url,
          author_headline = :author_headline,
          title = :title,
          content_text = :content_text,
          raw_metadata = :raw_metadata,
          content_hash = :content_hash,
          extracted_at = :extracted_at,
          capture_status = :capture_status,
          capture_error = :capture_error,
          updated_at = :updated_at
          {", enrichment_status = 'pending', enrichment_error = NULL, summary_text = NULL, enriched_at = NULL" if reset_enrichment else ""}
        WHERE linkedin_urn = :linkedin_urn
        """,
        payload,
    )
    return "updated"
