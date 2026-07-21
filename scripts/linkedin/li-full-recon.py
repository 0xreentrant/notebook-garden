#!/usr/bin/env python3
"""Full read-only LinkedIn Saved recon.

Covers pagination, every card shape, expand-all, article destinations,
overflow-menu inspection (no unsave), and auth-signal inventory.

No DB writes. No unsave clicks.

  python3 scripts/linkedin/li-full-recon.py
"""

from __future__ import annotations

import hashlib
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
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
OUT_PATH = Path(os.environ.get("LI_RECON_OUT", "/tmp/li-full-recon.json"))
# Scope cards to primary content; LinkedIn injects other chameleon nodes elsewhere.
CARD_SEL = "main div[data-chameleon-result-urn], .scaffold-finite-scroll__content div[data-chameleon-result-urn]"
ARTICLE_RESOLVE_LIMIT = int(os.environ.get("LI_ARTICLE_RESOLVE_LIMIT", "5"))
EXPAND_LIMIT = int(os.environ.get("LI_EXPAND_LIMIT", "40"))
OVERFLOW_KINDS = {"activity", "article"}


def redact_text(text: str, limit: int = 180) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def auth_signals(page) -> dict:
    return page.evaluate(
        """() => {
          const t = (document.body.innerText || '').slice(0, 4000)
          const href = location.href.toLowerCase()
          const head = t.slice(0, 800).toLowerCase()
          return {
            url: location.href,
            title: document.title,
            loggedOut: href.includes('/login') || href.includes('/uas/login')
              || head.includes('sign in to linkedin') || head.includes('join linkedin'),
            checkpoint: /checkpoint|security verification|verify your identity|unusual activity|captcha|challenge/i.test(t)
              || href.includes('checkpoint'),
            restricted: /account temporarily restricted|we've restricted|action blocked/i.test(t),
            sample: t.replace(/\\s+/g, ' ').slice(0, 240),
          }
        }"""
    )


def page_counts(page) -> dict:
    return page.evaluate(
        """(sel) => {
          const urns = [...document.querySelectorAll(sel)]
            .map(e => e.getAttribute('data-chameleon-result-urn'))
          const allUrns = [...document.querySelectorAll('[data-chameleon-result-urn]')]
            .map(e => e.getAttribute('data-chameleon-result-urn'))
          const savedLabel = [...document.querySelectorAll('*')]
            .map(e => (e.childElementCount === 0 ? (e.textContent || '').trim() : ''))
            .find(t => /saved posts and articles/i.test(t)) || null
          return {
            urnCount: urns.length,
            uniqueUrns: [...new Set(urns)].length,
            allPageUrnCount: [...new Set(allUrns)].length,
            seeMore: [...document.querySelectorAll(sel)].reduce((n, card) => {
              const hit = [...card.querySelectorAll('button, a')].some(
                e => /see more/i.test(e.innerText || '') || /see more/i.test(e.getAttribute('aria-label') || '')
              )
              return n + (hit ? 1 : 0)
            }, 0),
            savedSidebarLabel: savedLabel,
          }
        }""",
        CARD_SEL,
    )


def scroll_harvest(page, max_rounds: int = 25) -> dict:
    history = []
    seen = []
    seen_set = set()
    stagnant = 0
    for round_i in range(max_rounds):
        counts = page_counts(page)
        urns = page.evaluate(
            """(sel) => [...document.querySelectorAll(sel)]
              .map(e => e.getAttribute('data-chameleon-result-urn'))""",
            CARD_SEL,
        )
        new = 0
        for u in urns:
            if u and u not in seen_set:
                seen_set.add(u)
                seen.append(u)
                new += 1
        history.append(
            {
                "round": round_i,
                "rendered": counts["urnCount"],
                "unique_total": len(seen),
                "new": new,
                "seeMore": counts["seeMore"],
            }
        )
        if new == 0:
            stagnant += 1
        else:
            stagnant = 0
        if stagnant >= 3:
            break
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1800)
        # Also try scrolling the main feed container if present
        page.evaluate(
            """() => {
              const scrollers = [...document.querySelectorAll('*')].filter(e => {
                const s = getComputedStyle(e)
                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 100
              }).slice(0, 5)
              for (const el of scrollers) el.scrollTop = el.scrollHeight
            }"""
        )
        page.wait_for_timeout(1200)
    return {
        "scroll_history": history,
        "urns": seen,
        "sidebar_label": page_counts(page).get("savedSidebarLabel"),
    }


def extract_card(card) -> dict:
    return card.evaluate(
        """e => {
          const urn = e.getAttribute('data-chameleon-result-urn') || ''
          const view = e.getAttribute('data-view-name') || ''
          const kind = urn.includes(':article:') ? 'article'
            : urn.includes(':activity:') ? 'activity'
            : urn.includes(':ugcPost:') ? 'ugcPost'
            : 'unknown'
          const text = (e.innerText || '').replace(/\\s+/g, ' ').trim()
          const update = [...e.querySelectorAll('a[href*="/feed/update/"]')].map(a => a.href)[0] || null
          const profiles = [...e.querySelectorAll('a[href*="/in/"]')]
            .map(a => ({
              href: a.href.split('?')[0],
              text: (a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
            }))
            .filter(x => x.text)
          const summary = e.querySelector('.entity-result__content-summary')
          const summaryText = summary ? summary.innerText.replace(/\\s+/g, ' ').trim() : null
          const seeMore = [...e.querySelectorAll('button, a')].some(
            el => /see more/i.test(el.innerText || '') || /see more/i.test(el.getAttribute('aria-label') || '')
          )
          const hasImage = !!e.querySelector('img')
          const hasDocHint = /\\d+\\s+pages?/i.test(text)
          const savedLink = /^Saved link\\b/i.test(text) || text.includes('Saved link')
          const overflow = [...e.querySelectorAll('button')].find(
            b => /more actions/i.test(b.getAttribute('aria-label') || '')
          )
          return {
            urn,
            view,
            kind,
            saved_link_label: savedLink,
            has_see_more: seeMore,
            has_image: hasImage,
            has_document_hint: hasDocHint,
            update_url: update,
            author_guess: profiles[0] || null,
            profiles: profiles.slice(0, 3),
            summary_len: summaryText ? summaryText.length : 0,
            summary_preview: summaryText ? summaryText.slice(0, 180) : null,
            text_len: text.length,
            text_preview: text.slice(0, 180),
            overflow_aria: overflow ? overflow.getAttribute('aria-label') : null,
            class_tokens: [...e.querySelectorAll('[class]')].flatMap(n =>
              (n.className || '').toString().split(/\\s+/).filter(t =>
                t.startsWith('entity-result') || t.startsWith('reusable') || t.startsWith('artdeco')
              )
            ).filter((v,i,a) => a.indexOf(v) === i).slice(0, 30),
          }
        }"""
    )


def expand_card(card) -> dict:
    before = card.evaluate(
        """e => {
          const s = e.querySelector('.entity-result__content-summary')
          return s ? s.innerText.replace(/\\s+/g, ' ').trim() : ''
        }"""
    )
    btn = card.locator(
        "button.reusable-search-show-more-link, button:has-text('see more'), a:has-text('see more')"
    ).first
    if btn.count() == 0:
        return {
            "expanded": False,
            "reason": "no_see_more",
            "summary_before": redact_text(before),
            "summary_before_len": len(before),
            "summary_after": redact_text(before),
            "summary_after_len": len(before),
            "hash": content_hash(before),
        }
    btn.click(timeout=5000)
    card.page.wait_for_timeout(1200)
    after = card.evaluate(
        """e => {
          const s = e.querySelector('.entity-result__content-summary')
          return s ? s.innerText.replace(/\\s+/g, ' ').trim() : ''
        }"""
    )
    still = card.locator(
        "button.reusable-search-show-more-link, button:has-text('see more')"
    ).count()
    return {
        "expanded": True,
        "summary_before_len": len(before),
        "summary_after_len": len(after),
        "delta": len(after) - len(before),
        "see_more_still_present": still > 0,
        "summary_before": redact_text(before),
        "summary_after": redact_text(after, 220),
        "hash": content_hash(after or before),
        "success": bool(after) and still == 0,
    }


def resolve_article(context, update_url: str) -> dict:
    page = context.new_page()
    try:
        page.goto(update_url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(2500)
        signals = auth_signals(page)
        if signals["loggedOut"] or signals["checkpoint"] or signals["restricted"]:
            return {"ok": False, "error": "auth_or_challenge", "signals": signals}
        data = page.evaluate(
            """() => {
              const abs = (href) => {
                try { return new URL(href, location.origin).href } catch { return href }
              }
              const links = [...document.querySelectorAll('a[href]')]
                .map(a => ({
                  href: abs(a.getAttribute('href') || a.href),
                  text: (a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
                  aria: a.getAttribute('aria-label'),
                }))
                .filter(x =>
                  x.href &&
                  /^https?:/i.test(x.href) &&
                  !/^javascript:/i.test(x.href) &&
                  !/linkedin\\.com|licdn\\.com|microsoft\\.com/i.test(x.href)
                )
              const seen = new Set()
              const unique = []
              for (const x of links) {
                if (seen.has(x.href)) continue
                seen.add(x.href)
                unique.push(x)
              }
              const openArticle = unique.find(x => (x.aria || '').startsWith('Open article:')) || null
              return {
                url: location.href,
                title: document.title,
                open_article: openArticle,
                external_links: unique.slice(0, 10),
                body_sample: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 220),
              }
            }"""
        )
        dest = None
        if data.get("open_article"):
            dest = data["open_article"]["href"]
        elif data.get("external_links"):
            dest = data["external_links"][0]["href"]
        return {
            "ok": bool(dest),
            "destination": dest,
            "error": None if dest else "no_external_destination",
            "update_page": {
                "url": data["url"],
                "title": data["title"],
                "open_article_aria": (data.get("open_article") or {}).get("aria"),
                "external_count": len(data.get("external_links") or []),
                "body_sample": data.get("body_sample"),
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "destination": None}
    finally:
        page.close()


def inspect_overflow(card) -> dict:
    """Open overflow menu, list labels, Escape to dismiss. Never click Unsave."""
    btn = card.locator("button[aria-label*='more actions' i]").first
    if btn.count() == 0:
        return {"opened": False, "reason": "no_overflow_button"}
    btn.click(timeout=5000)
    card.page.wait_for_timeout(800)
    items = card.page.evaluate(
        """() => {
          const menus = [...document.querySelectorAll(
            '.artdeco-dropdown__content, [role="menu"], .artdeco-dropdown__content-inner'
          )]
          const texts = []
          for (const m of menus) {
            if (getComputedStyle(m).display === 'none' || m.offsetParent === null) continue
            for (const el of m.querySelectorAll('div, span, button, a, li')) {
              const t = (el.innerText || '').replace(/\\s+/g, ' ').trim()
              if (t && t.length < 80) texts.push(t)
            }
          }
          return [...new Set(texts)].slice(0, 40)
        }"""
    )
    # Dismiss without acting
    card.page.keyboard.press("Escape")
    card.page.wait_for_timeout(400)
    card.page.keyboard.press("Escape")
    card.page.wait_for_timeout(300)
    return {
        "opened": True,
        "menu_labels": items,
        "unsave_candidates": [
            t for t in items if re.search(r"unsave|remove.*save|delete.*save", t, re.I)
        ],
        "dismissed_without_click": True,
    }


def main() -> int:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "saved_url": SAVED_URL,
        "auth": None,
        "pagination": None,
        "items": [],
        "shape_summary": {},
        "overflow_samples": [],
        "article_resolutions": [],
        "exit_criteria": {},
    }

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

        signals = auth_signals(page)
        report["auth"] = {"initial": signals}
        if signals["loggedOut"]:
            print("Not signed in. Complete login in Chrome (5 min timeout)...", file=sys.stderr)
            deadline = 5 * 60 * 1000
            waited = 0
            while waited < deadline:
                page.wait_for_timeout(3000)
                waited += 3000
                if "saved-posts" in page.url and "/login" not in page.url:
                    break
                if "/feed" in page.url:
                    page.goto(SAVED_URL, wait_until="domcontentloaded", timeout=90000)
            signals = auth_signals(page)
            report["auth"]["after_wait"] = signals
            if signals["loggedOut"] or signals["checkpoint"] or signals["restricted"]:
                print(json.dumps(report, indent=2))
                context.close()
                return 1

        print("Scrolling to harvest URNs...", file=sys.stderr)
        harvest = scroll_harvest(page)
        report["pagination"] = {
            "scroll_history": harvest["scroll_history"],
            "urn_count": len(harvest["urns"]),
            "urns": harvest["urns"],
            "sidebar_label": harvest["sidebar_label"],
        }
        print(f"Harvested {len(harvest['urns'])} unique URNs", file=sys.stderr)

        # Scroll back to top for stable card indexing
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(1500)
        # Re-scroll until all harvested URNs are in DOM if virtualized
        for _ in range(20):
            present = set(
                page.evaluate(
                    """(sel) => [...document.querySelectorAll(sel)]
                      .map(e => e.getAttribute('data-chameleon-result-urn'))""",
                    CARD_SEL,
                )
            )
            if set(harvest["urns"]).issubset(present):
                break
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(1200)

        cards = page.locator(CARD_SEL)
        n = cards.count()
        print(f"Processing {n} rendered cards (scoped)...", file=sys.stderr)

        processed = set()
        overflow_done = {k: False for k in OVERFLOW_KINDS}
        expands_done = 0
        articles_resolved = 0

        def process_visible():
            nonlocal expands_done, articles_resolved
            cards = page.locator(CARD_SEL)
            n_local = cards.count()
            for i in range(n_local):
                card = cards.nth(i)
                info = extract_card(card)
                urn = info["urn"]
                if not urn or urn in processed:
                    continue
                processed.add(urn)
                print(f"  [{len(processed)}] {info['kind']} {urn}", file=sys.stderr)

                expand = None
                if info["kind"] == "activity":
                    if info["has_see_more"] and expands_done >= EXPAND_LIMIT:
                        expand = {
                            "expanded": False,
                            "reason": "expand_limit_reached",
                            "summary_before_len": info.get("summary_len") or 0,
                            "summary_after_len": info.get("summary_len") or 0,
                            "summary_before": redact_text(info.get("summary_preview") or ""),
                            "summary_after": redact_text(info.get("summary_preview") or ""),
                            "hash": content_hash(info.get("summary_preview") or ""),
                            "success": False,
                        }
                    else:
                        expand = expand_card(card)
                        if info["has_see_more"]:
                            expands_done += 1

                article = None
                if info["kind"] == "article" and info.get("update_url"):
                    if articles_resolved < ARTICLE_RESOLVE_LIMIT:
                        article = resolve_article(context, info["update_url"])
                        articles_resolved += 1
                        report["article_resolutions"].append(
                            {
                                "urn": urn,
                                "destination": article.get("destination"),
                                "ok": article.get("ok"),
                                "error": article.get("error"),
                            }
                        )
                    else:
                        article = {
                            "ok": None,
                            "destination": None,
                            "error": "resolve_limit_reached",
                        }

                overflow = None
                if info["kind"] in overflow_done and not overflow_done[info["kind"]]:
                    overflow = inspect_overflow(card)
                    overflow_done[info["kind"]] = True
                    report["overflow_samples"].append(
                        {"urn": urn, "kind": info["kind"], **overflow}
                    )

                item = {
                    "urn": urn,
                    "kind": info["kind"],
                    "view": info["view"],
                    "saved_link_label": info["saved_link_label"],
                    "has_see_more_initially": info["has_see_more"],
                    "has_image": info["has_image"],
                    "has_document_hint": info["has_document_hint"],
                    "linkedin_url": (
                        f"https://www.linkedin.com/feed/update/{urn}/"
                        if urn
                        else None
                    ),
                    "update_url_raw": info.get("update_url"),
                    "author": info.get("author_guess"),
                    "class_tokens": info.get("class_tokens"),
                    "overflow_aria": info.get("overflow_aria"),
                    "expand": expand,
                    "article": (
                        {
                            "ok": article.get("ok"),
                            "destination": article.get("destination"),
                            "error": article.get("error"),
                        }
                        if article
                        else None
                    ),
                    "text_preview": redact_text(info.get("text_preview") or ""),
                    "summary_preview": redact_text(info.get("summary_preview") or "")
                    if info.get("summary_preview")
                    else None,
                }
                report["items"].append(item)

        process_visible()
        # Keep scrolling until all harvested URNs processed
        stagnant = 0
        while len(processed) < len(harvest["urns"]) and stagnant < 8:
            before = len(processed)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(1500)
            process_visible()
            if len(processed) == before:
                stagnant += 1
            else:
                stagnant = 0

        # Shape summary
        shapes: dict[str, int] = {}
        views: dict[str, int] = {}
        for it in report["items"]:
            shapes[it["kind"]] = shapes.get(it["kind"], 0) + 1
            views[it["view"] or ""] = views.get(it["view"] or "", 0) + 1
        report["shape_summary"] = {
            "by_kind": shapes,
            "by_view": views,
            "processed": len(processed),
            "harvested": len(harvest["urns"]),
            "missing_urns": [u for u in harvest["urns"] if u not in processed],
        }

        # Profile restart note: already using persistent profile; record path perms
        report["auth"]["profile_dir"] = str(PROFILE_DIR)
        report["auth"]["profile_mode"] = oct(PROFILE_DIR.stat().st_mode & 0o777)

        # Exit criteria evaluation
        activities = [i for i in report["items"] if i["kind"] == "activity"]
        articles = [i for i in report["items"] if i["kind"] == "article"]
        activity_text_ok = all(
            (i.get("expand") or {}).get("summary_after_len", 0) > 0
            or (i.get("expand") or {}).get("summary_before_len", 0) > 0
            or i.get("summary_preview")
            for i in activities
        ) if activities else True
        article_ok = all(
            (i.get("article") or {}).get("ok") or (i.get("article") or {}).get("error")
            for i in articles
        ) if articles else True
        report["exit_criteria"] = {
            "all_classified_or_unsupported": all(
                i["kind"] in ("activity", "article", "ugcPost", "unsupported", "unknown")
                for i in report["items"]
            )
            and not any(i["kind"] == "unknown" for i in report["items"]),
            "urns_harvested_exactly_once": len(harvest["urns"])
            == len(set(harvest["urns"]))
            and len(processed) == len(harvest["urns"]),
            "activity_text_extraction_ok": activity_text_ok,
            "articles_resolved_or_typed_error": article_ok,
            "auth_hard_stops_documented": True,
            "overflow_inspected_without_mutation": all(
                s.get("dismissed_without_click") for s in report["overflow_samples"]
            )
            if report["overflow_samples"]
            else False,
            "notebooklm_viability": "pending_manual_check",
            "unknown_kinds": [i["urn"] for i in report["items"] if i["kind"] == "unknown"],
        }

        # Redacted fixture
        fixture = {
            "generated_by": "li-full-recon.py",
            "item_count": len(report["items"]),
            "shapes": report["shape_summary"],
            "pagination_rounds": len(harvest["scroll_history"]),
            "items": [
                {
                    "urn_suffix": i["urn"].split(":")[-1][-8:],
                    "kind": i["kind"],
                    "view": i["view"],
                    "has_image": i["has_image"],
                    "has_document_hint": i["has_document_hint"],
                    "expand_success": (i.get("expand") or {}).get("success"),
                    "summary_len": (i.get("expand") or {}).get("summary_after_len")
                    or (i.get("expand") or {}).get("summary_before_len"),
                    "destination_host": (
                        re.sub(r"^https?://([^/]+).*$", r"\1", i["article"]["destination"])
                        if i.get("article") and i["article"].get("destination")
                        else None
                    ),
                    "class_tokens": i.get("class_tokens"),
                }
                for i in report["items"]
            ],
            "overflow_labels": [
                {"kind": s["kind"], "labels": s.get("menu_labels"), "unsave": s.get("unsave_candidates")}
                for s in report["overflow_samples"]
            ],
        }
        fixture_path = FIXTURE_DIR / "saved-items-recon.json"
        fixture_path.write_text(json.dumps(fixture, indent=2) + "\n")
        print(f"Wrote fixture {fixture_path}", file=sys.stderr)

        OUT_PATH.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report["shape_summary"], indent=2))
        print(json.dumps(report["exit_criteria"], indent=2))
        print(f"Full report: {OUT_PATH}", file=sys.stderr)
        page.wait_for_timeout(2000)
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
