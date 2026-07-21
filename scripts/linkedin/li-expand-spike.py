#!/usr/bin/env python3
"""Read-only expand + article-follow spike on LinkedIn Saved Posts.

Uses the dedicated profile from li-dom-spike.py.
No DB writes. No unsave.

  python3 scripts/linkedin/li-expand-spike.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PROFILE_DIR = Path(
    os.environ.get(
        "LI_PROFILE_DIR",
        Path.home() / ".config/linkedin-saved/chrome-profile",
    )
)
SAVED_URL = "https://www.linkedin.com/my-items/saved-posts/"


def card_info(card) -> dict:
    return card.evaluate(
        """e => {
          const urn = e.getAttribute('data-chameleon-result-urn') || ''
          const view = e.getAttribute('data-view-name') || ''
          const text = (e.innerText || '').replace(/\\s+/g, ' ').trim()
          const update = [...e.querySelectorAll('a[href*="/feed/update/"]')]
            .map(a => a.href)[0] || null
          const profiles = [...e.querySelectorAll('a[href*="/in/"]')]
            .map(a => ({href: a.href.split('?')[0], text: (a.innerText||'').trim().slice(0,80)}))
            .filter(x => x.text)
          const seeMore = [...e.querySelectorAll('button, a')].find(
            el => /see more/i.test(el.innerText || '') || /see more/i.test(el.getAttribute('aria-label') || '')
          )
          return {
            urn,
            view,
            kind: urn.includes('article:') ? 'article' : urn.includes('activity:') ? 'activity' : 'unknown',
            text_len: text.length,
            text_preview: text.slice(0, 280),
            update_url: update,
            profiles: profiles.slice(0, 3),
            has_see_more: !!seeMore,
          }
        }"""
    )


def expand_see_more(card) -> dict:
    before = card.evaluate("e => (e.innerText || '').replace(/\\s+/g, ' ').trim()")
    btn = card.locator("button.reusable-search-show-more-link, button:has-text('see more'), a:has-text('see more')").first
    if btn.count() == 0:
        return {"expanded": False, "reason": "no see-more control"}
    btn.click(timeout=5000)
    card.page.wait_for_timeout(1500)
    after = card.evaluate("e => (e.innerText || '').replace(/\\s+/g, ' ').trim()")
    still = card.locator("button.reusable-search-show-more-link, button:has-text('see more')").count()
    return {
        "expanded": True,
        "before_len": len(before),
        "after_len": len(after),
        "delta": len(after) - len(before),
        "see_more_still_present": still > 0,
        "before_preview": before[:300],
        "after_preview": after[:600],
        "after_tail": after[-400:] if len(after) > 400 else after,
    }


def extract_destination_from_update_page(page) -> dict:
    page.wait_for_timeout(3000)
    return page.evaluate(
        """() => {
          const abs = (href) => {
            try { return new URL(href, location.origin).href } catch { return href }
          }
          const externals = [...document.querySelectorAll('a[href]')]
            .map(a => ({
              href: abs(a.getAttribute('href') || a.href),
              text: (a.innerText || '').trim().slice(0, 120),
              aria: a.getAttribute('aria-label'),
            }))
            .filter(x =>
              x.href &&
              !/^javascript:/i.test(x.href) &&
              !/^#/.test(x.href) &&
              /^https?:/i.test(x.href) &&
              !/linkedin\\.com|licdn\\.com|microsoft\\.com/i.test(x.href)
            )
          // de-dupe
          const seen = new Set()
          const unique = []
          for (const x of externals) {
            if (seen.has(x.href)) continue
            seen.add(x.href)
            unique.push(x)
          }
          const articleTitle = document.querySelector('h1')?.innerText?.trim() || null
          const ogUrl = document.querySelector('meta[property="og:url"]')?.content || null
          const canonical = document.querySelector('link[rel="canonical"]')?.href || null
          const bodySample = document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500)
          return {
            url: location.href,
            title: document.title,
            articleTitle,
            ogUrl,
            canonical,
            external_links: unique.slice(0, 15),
            body_sample: bodySample,
          }
        }"""
    )


def main() -> int:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    out: dict = {"saved_url": SAVED_URL, "activity_expand": None, "article_follow": None}

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            channel="chrome",
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(SAVED_URL, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(4000)

        if "/login" in page.url:
            print("Session expired. Re-run li-dom-spike.py and log in first.", file=sys.stderr)
            context.close()
            return 1

        cards = page.locator("div[data-chameleon-result-urn]")
        n = cards.count()
        print(f"Found {n} chameleon cards", file=sys.stderr)
        infos = []
        for i in range(min(n, 12)):
            info = card_info(cards.nth(i))
            info["index"] = i
            infos.append(info)
        out["cards_overview"] = infos

        # 1) Expand one activity card that has see more
        activity_idx = next((c["index"] for c in infos if c["kind"] == "activity" and c["has_see_more"]), None)
        if activity_idx is None:
            out["activity_expand"] = {"expanded": False, "reason": "no activity+see-more card"}
        else:
            print(f"Expanding activity card {activity_idx}", file=sys.stderr)
            card = cards.nth(activity_idx)
            result = expand_see_more(card)
            result["index"] = activity_idx
            result["urn"] = infos[activity_idx]["urn"]
            result["update_url"] = infos[activity_idx]["update_url"]
            # After expand, also pull summary node text if present
            summary = card.locator(".entity-result__content-summary").first
            if summary.count():
                result["summary_text"] = re.sub(r"\s+", " ", summary.inner_text()).strip()
            out["activity_expand"] = result

        # 2) Follow one article card's update URL in a new page
        article = next((c for c in infos if c["kind"] == "article" and c.get("update_url")), None)
        if article is None:
            out["article_follow"] = {"ok": False, "reason": "no article card with update_url"}
        else:
            print(f"Following article card {article['index']}: {article['update_url']}", file=sys.stderr)
            upd = context.new_page()
            upd.goto(article["update_url"], wait_until="domcontentloaded", timeout=90000)
            dest = extract_destination_from_update_page(upd)
            # If LinkedIn still wraps and first external looks like the target, also try navigating it
            followed = None
            if dest["external_links"]:
                preferred = next(
                    (
                        x["href"]
                        for x in dest["external_links"]
                        if x.get("aria") and "Open article" in x["aria"]
                    ),
                    dest["external_links"][0]["href"],
                )
                first = preferred
                print(f"Navigating first external: {first}", file=sys.stderr)
                try:
                    upd.goto(first, wait_until="domcontentloaded", timeout=60000)
                    upd.wait_for_timeout(2000)
                    followed = {
                        "final_url": upd.url,
                        "title": upd.title(),
                        "body_sample": re.sub(
                            r"\s+",
                            " ",
                            upd.locator("body").inner_text(),
                        ).strip()[:400],
                    }
                except Exception as exc:
                    followed = {"error": str(exc), "attempted": first}
            out["article_follow"] = {
                "ok": True,
                "index": article["index"],
                "urn": article["urn"],
                "from_saved_text": article["text_preview"],
                "update_page": dest,
                "followed_external": followed,
            }
            upd.close()

        print(json.dumps(out, indent=2))
        print("Expand spike done. No mutations performed.", file=sys.stderr)
        page.wait_for_timeout(3000)
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
