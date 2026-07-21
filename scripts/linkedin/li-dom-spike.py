#!/usr/bin/env python3
"""Read-only DOM inventory of LinkedIn Saved Posts cards.

No DB writes. No unsave. First 2-3 cards only.

  python3 scripts/linkedin/li-dom-spike.py

If not signed in: complete login in the headed window, then press Enter here.
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
CARD_LIMIT = 3


def summarize_el(el) -> dict:
    tag = el.evaluate("e => e.tagName.toLowerCase()")
    classes = (el.get_attribute("class") or "").strip()
    role = el.get_attribute("role")
    data_attrs = el.evaluate(
        """e => Object.fromEntries(
          [...e.attributes]
            .filter(a => a.name.startsWith('data-') || a.name === 'id')
            .map(a => [a.name, a.value.slice(0, 120)])
        )"""
    )
    links = el.evaluate(
        """e => [...e.querySelectorAll('a[href]')]
          .slice(0, 20)
          .map(a => ({
            href: a.href,
            text: (a.innerText || '').trim().slice(0, 80),
            aria: a.getAttribute('aria-label'),
          }))"""
    )
    buttons = el.evaluate(
        """e => [...e.querySelectorAll('button')]
          .slice(0, 15)
          .map(b => ({
            text: (b.innerText || '').trim().slice(0, 60),
            aria: b.getAttribute('aria-label'),
            classes: (b.className || '').toString().slice(0, 80),
          }))"""
    )
    text = el.inner_text().strip()
    text_preview = re.sub(r"\s+", " ", text)[:400]
    structure = el.evaluate(
        """e => {
          const walk = (node, depth) => {
            if (!node || depth > 4) return null
            const kids = [...node.children].slice(0, 8).map(c => walk(c, depth + 1)).filter(Boolean)
            return {
              tag: node.tagName.toLowerCase(),
              role: node.getAttribute('role'),
              cls: (node.className || '').toString().split(/\\s+/).filter(Boolean).slice(0, 4).join(' '),
              kids: kids.length ? kids : undefined,
            }
          }
          return walk(e, 0)
        }"""
    )
    return {
        "tag": tag,
        "role": role,
        "classes": classes[:200],
        "attrs": data_attrs,
        "text_preview": text_preview,
        "links": links,
        "buttons": buttons,
        "structure": structure,
    }


def find_card_candidates(page) -> list:
    # Try several container shapes LinkedIn has used for saved/feed items.
    selectors = [
        "div.scaffold-finite-scroll__content > div > div",
        "div[data-chameleon-result-urn]",
        "div.feed-shared-update-v2",
        "article",
        "li.reusable-search__result-container",
        "div.entity-result",
        "div[componentkey]",
    ]
    for sel in selectors:
        locs = page.locator(sel)
        n = locs.count()
        if n > 0:
            cards = []
            for i in range(min(n, 12)):
                el = locs.nth(i)
                try:
                    text = el.inner_text(timeout=1000).strip()
                except Exception:
                    continue
                if len(text) < 40:
                    continue
                # Prefer cards that look like saved items / posts / links
                if re.search(
                    r"Saved link|see more|ago|•|github\.com|http|\d+[wdhm]",
                    text,
                    re.I,
                ):
                    cards.append((sel, el, text))
            if len(cards) >= 2:
                return cards[:CARD_LIMIT]
    # Fallback: largest text blocks in main
    main = page.locator("main").first
    if main.count() == 0:
        return []
    blocks = main.locator(":scope > div, :scope section, :scope ul > li")
    cards = []
    for i in range(min(blocks.count(), 20)):
        el = blocks.nth(i)
        try:
            text = el.inner_text(timeout=1000).strip()
        except Exception:
            continue
        if len(text) > 80:
            cards.append(("main-child", el, text))
        if len(cards) >= CARD_LIMIT:
            break
    return cards


def page_signals(page) -> dict:
    return page.evaluate(
        """() => ({
          url: location.href,
          title: document.title,
          hasSignIn: !!document.querySelector('a[href*="signup"], a[href*="login"], button') &&
            /sign in|join now/i.test(document.body.innerText.slice(0, 2000)),
          bodySample: document.body.innerText.slice(0, 500).replace(/\\s+/g, ' '),
          counts: {
            articles: document.querySelectorAll('article').length,
            feedShared: document.querySelectorAll('.feed-shared-update-v2').length,
            chameleon: document.querySelectorAll('[data-chameleon-result-urn]').length,
            componentkey: document.querySelectorAll('[componentkey]').length,
            seeMore: [...document.querySelectorAll('button, a')].filter(e => /see more/i.test(e.innerText || '')).length,
            savedLinkLabels: [...document.querySelectorAll('*')].filter(e => e.childNodes.length && e.childElementCount === 0 && /Saved link/i.test(e.textContent || '')).length,
          },
        })"""
    )


def main() -> int:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Profile: {PROFILE_DIR}", file=sys.stderr)
    print(f"Opening {SAVED_URL}", file=sys.stderr)

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

        signals = page_signals(page)
        print("PAGE_SIGNALS", file=sys.stderr)
        print(json.dumps(signals, indent=2), file=sys.stderr)

        if "/login" in page.url or "/uas/login" in page.url or signals.get("hasSignIn"):
            print(
                "\nNot signed in. Complete LinkedIn login in the Chrome window.\n"
                "Waiting up to 5 minutes for /my-items/saved-posts/ ...",
                file=sys.stderr,
            )
            deadline_ms = 5 * 60 * 1000
            stepped = 0
            while stepped < deadline_ms:
                page.wait_for_timeout(3000)
                stepped += 3000
                if "saved-posts" in page.url and "/login" not in page.url:
                    break
                # After auth, LinkedIn may land on feed; nudge back to Saved.
                if "/feed" in page.url or page.url.rstrip("/").endswith("linkedin.com"):
                    page.goto(SAVED_URL, wait_until="domcontentloaded", timeout=90000)
            if "saved-posts" not in page.url or "/login" in page.url:
                print("Timed out waiting for Saved Posts session.", file=sys.stderr)
                context.close()
                return 1
            page.wait_for_timeout(4000)
            signals = page_signals(page)
            print("PAGE_SIGNALS_AFTER_LOGIN", file=sys.stderr)
            print(json.dumps(signals, indent=2), file=sys.stderr)

        cards = find_card_candidates(page)
        inventory = {
            "url": page.url,
            "title": page.title(),
            "signals": signals,
            "card_count_found": len(cards),
            "cards": [],
        }
        for i, (sel, el, text) in enumerate(cards):
            print(f"Summarizing card {i} via {sel}", file=sys.stderr)
            item = summarize_el(el)
            item["matched_selector"] = sel
            item["index"] = i
            inventory["cards"].append(item)

        print(json.dumps(inventory, indent=2))
        print(
            "\nSpike done. Browser stays open 10s then closes. No mutations performed.",
            file=sys.stderr,
        )
        page.wait_for_timeout(10000)
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
