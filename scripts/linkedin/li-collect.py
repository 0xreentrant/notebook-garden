#!/usr/bin/env python3
"""Serial read-only collector for LinkedIn Saved items -> summaries.db.

Never unsaves. Hard-stops on auth/challenge.

  python3 scripts/linkedin/li-collect.py --limit 5
  python3 scripts/linkedin/li-collect.py --dry-run --limit 3
  python3 scripts/linkedin/li-collect.py --headless
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from li_dom import (
    SAVED_URL,
    auth_signals,
    content_hash,
    expand_see_more,
    extract_card_fields,
    find_card_by_urn,
    hard_stop_reason,
    kind_from_urn,
    linkedin_url_for_urn,
    normalize_content,
    resolve_article_destination,
    scroll_collect_urns,
)
from posts_db import connect, existing_urns, utc_now, upsert_capture

PROFILE_DIR = Path(
    os.environ.get(
        "LI_PROFILE_DIR",
        Path.home() / ".config/linkedin-saved/chrome-profile",
    )
)
DEFAULT_DB = Path(__file__).resolve().parents[2] / "summaries.db"


def pause(base: float = 1.2) -> None:
    time.sleep(base + random.uniform(0.2, 1.0))


def ensure_card_visible(page, urn: str, max_scrolls: int = 30):
    for _ in range(max_scrolls):
        card = find_card_by_urn(page, urn)
        if card.count() > 0:
            try:
                card.scroll_into_view_if_needed(timeout=2000)
            except Exception:
                pass
            return card
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1000)
    return None


def capture_one(context, page, urn: str) -> dict:
    card = ensure_card_visible(page, urn)
    if card is None:
        return {
            "linkedin_urn": urn,
            "item_type": kind_from_urn(urn) if kind_from_urn(urn) != "unknown" else "activity",
            "linkedin_url": linkedin_url_for_urn(urn),
            "capture_status": "error",
            "capture_error": "card_not_found_after_scroll",
            "extracted_at": utc_now(),
        }

    fields = extract_card_fields(card)
    item_type = fields.get("kind") or kind_from_urn(urn)
    if item_type == "unknown":
        return {
            "linkedin_urn": urn,
            "item_type": "activity",
            "linkedin_url": linkedin_url_for_urn(urn),
            "capture_status": "error",
            "capture_error": "unknown_item_type",
            "raw_metadata": fields,
            "extracted_at": utc_now(),
        }

    content_text = ""
    source_url = None
    title = None
    capture_error = None

    if item_type == "activity":
        if fields.get("has_see_more"):
            expanded = expand_see_more(card)
            content_text = normalize_content(expanded.get("summary") or "")
            if not expanded.get("see_more_gone") and fields.get("has_see_more"):
                capture_error = "see_more_still_present"
        else:
            content_text = normalize_content(fields.get("summary_text") or "")
        title = (fields.get("embedded_title") or content_text[:120] or None)
        if title:
            title = title[:200]
    else:
        title = fields.get("embedded_title") or None
        update_url = fields.get("update_url") or linkedin_url_for_urn(urn)
        resolved = resolve_article_destination(context, update_url)
        if resolved.get("ok"):
            source_url = resolved["destination"]
            aria = resolved.get("open_article_aria") or ""
            if aria.startswith("Open article:"):
                title = aria[len("Open article:") :].split(" by ")[0].strip() or title
            content_text = title or source_url or ""
        else:
            capture_error = resolved.get("error") or "article_resolve_failed"

    if content_text:
        status = "complete"
    elif item_type == "activity" and fields.get("has_image"):
        status = "metadata_only"
    elif item_type == "article" and source_url:
        status = "complete"
        content_text = content_text or source_url
    else:
        status = "error"
        capture_error = capture_error or "empty_content"

    if capture_error and status == "complete":
        # Soft warning only; keep complete if we have text
        pass
    if capture_error and not content_text and not source_url:
        status = "error"

    return {
        "linkedin_urn": urn,
        "item_type": item_type,
        "linkedin_url": linkedin_url_for_urn(urn),
        "source_url": source_url,
        "author_name": fields.get("author_name"),
        "author_url": fields.get("author_url"),
        "author_headline": fields.get("author_headline"),
        "title": title,
        "content_text": content_text or None,
        "content_hash": content_hash(content_text),
        "raw_metadata": {
            "view": fields.get("view"),
            "has_see_more": fields.get("has_see_more"),
            "has_image": fields.get("has_image"),
            "saved_link_label": fields.get("saved_link_label"),
            "update_url": fields.get("update_url"),
            "capture_warning": capture_error if status == "complete" else None,
        },
        "capture_status": status,
        "capture_error": None if status != "error" else capture_error,
        "extracted_at": utc_now(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--limit", type=int, default=0, help="0 = all new items")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--headed", action="store_true", default=True)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    headed = not args.headless

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    conn = None if args.dry_run else connect(args.db)
    known = set() if args.refresh or args.dry_run else existing_urns(conn)

    results = {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0, "items": []}

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=not headed,
            channel="chrome",
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(SAVED_URL, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(3500)

        signals = auth_signals(page)
        stop = hard_stop_reason(signals)
        if stop:
            print(f"HARD STOP: {stop}", file=sys.stderr)
            context.close()
            if conn:
                conn.close()
            return 2

        print("Harvesting URNs...", file=sys.stderr)
        urns = scroll_collect_urns(page)
        print(f"Found {len(urns)} saved URNs", file=sys.stderr)

        targets = [u for u in urns if args.refresh or u not in known]
        if args.limit and args.limit > 0:
            targets = targets[: args.limit]
        print(f"Capturing {len(targets)} (dry_run={args.dry_run})", file=sys.stderr)

        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(800)

        for i, urn in enumerate(targets):
            stop = hard_stop_reason(auth_signals(page))
            if stop:
                print(f"HARD STOP mid-run: {stop}", file=sys.stderr)
                break
            print(f"[{i+1}/{len(targets)}] {urn}", file=sys.stderr)
            item = capture_one(context, page, urn)
            results["items"].append(
                {
                    "urn": urn,
                    "type": item["item_type"],
                    "status": item["capture_status"],
                    "error": item.get("capture_error"),
                    "title": (item.get("title") or "")[:80],
                    "content_len": len(item.get("content_text") or ""),
                    "source_url": item.get("source_url"),
                }
            )
            if item["capture_status"] == "error":
                results["errors"] += 1
            if args.dry_run:
                print(json.dumps(results["items"][-1], indent=2))
            else:
                assert conn is not None
                action = upsert_capture(conn, item, refresh=args.refresh)
                conn.commit()
                results[action] = results.get(action, 0) + 1
                print(f"  -> {action} {item['capture_status']}", file=sys.stderr)
            pause()

        context.close()

    if conn:
        conn.close()
    print(json.dumps({k: v for k, v in results.items() if k != "items"}, indent=2))
    print(json.dumps(results["items"][:20], indent=2))
    return 0 if results["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
