#!/usr/bin/env python3
"""Probe b-template activity cards that lack .entity-result__content-summary."""

from __future__ import annotations

import json
import os
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
CARD_SEL = "main div[data-chameleon-result-urn], .scaffold-finite-scroll__content div[data-chameleon-result-urn]"
TARGETS = {
    "urn:li:activity:7441893640693506048",
    "urn:li:activity:7259294129652727808",
    "urn:li:activity:7192675903536009216",
}


def main() -> int:
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
        page.wait_for_timeout(3000)

        found = {}
        for _ in range(25):
            for urn in list(TARGETS - set(found)):
                loc = page.locator(f'div[data-chameleon-result-urn="{urn}"]')
                if loc.count() == 0:
                    continue
                card = loc.first
                probe = card.evaluate(
                    """e => {
                      const pick = (sel) => {
                        const n = e.querySelector(sel)
                        return n ? n.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240) : null
                      }
                      const classes = [...e.querySelectorAll('[class]')].flatMap(n =>
                        (n.className || '').toString().split(/\\s+/).filter(t =>
                          /summary|commentary|update|description|content|entity-result|feed-shared/i.test(t)
                        )
                      ).filter((v,i,a)=>a.indexOf(v)===i).slice(0,40)
                      return {
                        view: e.getAttribute('data-view-name'),
                        summary: pick('.entity-result__content-summary'),
                        commentary: pick('.feed-shared-update-v2__description'),
                        commentary2: pick('.update-components-text'),
                        actor: pick('.entity-result__content-actor'),
                        inner_candidates: [...e.querySelectorAll('p, span, div')].map(n => ({
                          cls: (n.className||'').toString().split(/\\s+/).filter(Boolean).slice(0,3).join(' '),
                          text: (n.innerText||'').replace(/\\s+/g,' ').trim().slice(0,160),
                          len: (n.innerText||'').trim().length,
                        })).filter(x => x.len > 40 && x.len < 1200).slice(0, 12),
                        classes,
                        text_preview: (e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,300),
                      }
                    }"""
                )
                found[urn] = probe
            if len(found) == len(TARGETS):
                break
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(1200)

        print(json.dumps({"found": len(found), "probes": found}, indent=2))
        context.close()
    return 0 if len(found) == len(TARGETS) else 2


if __name__ == "__main__":
    raise SystemExit(main())
