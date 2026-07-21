#!/usr/bin/env python3
"""LinkedIn Saved DOM helpers (selectors from RECON.md)."""

from __future__ import annotations

import hashlib
import re
from typing import Any

CARD_SEL = (
    "main div[data-chameleon-result-urn], "
    ".scaffold-finite-scroll__content div[data-chameleon-result-urn]"
)
SUMMARY_SEL = '[class*="entity-result__content-summary"]'
SEE_MORE_SEL = (
    "button.reusable-search-show-more-link, "
    "button:has-text('see more'), a:has-text('see more')"
)
OVERFLOW_SEL = "button[aria-label*='more actions' i]"
SAVED_URL = "https://www.linkedin.com/my-items/saved-posts/"


def normalize_content(text: str | None) -> str:
    """Keep paragraph/line breaks; tidy horizontal whitespace only."""
    if not text:
        return ""
    # Normalize newlines, drop trailing "see more" chrome LinkedIn leaves in text
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"(?:…|\.\.\.)?\s*see more\s*$", "", cleaned, flags=re.I)
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in cleaned.split("\n")]
    # Drop empty lines at edges; collapse 3+ blank lines to one blank line
    body = "\n".join(lines).strip()
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body


def content_hash(text: str | None) -> str | None:
    body = normalize_content(text)
    if not body:
        return None
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def linkedin_url_for_urn(urn: str) -> str:
    return f"https://www.linkedin.com/feed/update/{urn}/"


def kind_from_urn(urn: str) -> str:
    if ":article:" in urn:
        return "article"
    if ":activity:" in urn:
        return "activity"
    return "unknown"


def auth_signals(page) -> dict[str, Any]:
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
          }
        }"""
    )


def hard_stop_reason(signals: dict[str, Any]) -> str | None:
    if signals.get("loggedOut"):
        return "logged_out"
    if signals.get("checkpoint"):
        return "checkpoint"
    if signals.get("restricted"):
        return "restricted"
    return None


def scroll_collect_urns(page, max_rounds: int = 40) -> list[str]:
    seen: list[str] = []
    seen_set: set[str] = set()
    stagnant = 0
    for _ in range(max_rounds):
        urns = page.evaluate(
            """(sel) => [...document.querySelectorAll(sel)]
              .map(e => e.getAttribute('data-chameleon-result-urn'))
              .filter(Boolean)""",
            CARD_SEL,
        )
        new = 0
        for urn in urns:
            if urn not in seen_set:
                seen_set.add(urn)
                seen.append(urn)
                new += 1
        if new == 0:
            stagnant += 1
        else:
            stagnant = 0
        if stagnant >= 3:
            break
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1400)
        page.evaluate(
            """() => {
              const scrollers = [...document.querySelectorAll('*')].filter(e => {
                const s = getComputedStyle(e)
                return (s.overflowY === 'auto' || s.overflowY === 'scroll')
                  && e.scrollHeight > e.clientHeight + 100
              }).slice(0, 4)
              for (const el of scrollers) el.scrollTop = el.scrollHeight
            }"""
        )
        page.wait_for_timeout(900)
    return seen


def extract_card_fields(card) -> dict[str, Any]:
    return card.evaluate(
        """(el, summarySel) => {
          const urn = el.getAttribute('data-chameleon-result-urn') || ''
          const view = el.getAttribute('data-view-name') || ''
          const kind = urn.includes(':article:') ? 'article'
            : urn.includes(':activity:') ? 'activity' : 'unknown'
          const summary = el.querySelector(summarySel)
          // Prefer structured text so <br>/blocks keep line breaks (innerText already does).
          // Do not collapse whitespace here - Python normalize_content preserves newlines.
          const summaryText = summary ? (summary.innerText || '').trim() : ''
          const hasSeeMore = [...el.querySelectorAll('button, a')].some(
            n => /see more/i.test(n.innerText || '')
              || /see more/i.test(n.getAttribute('aria-label') || '')
          )
          const update = [...el.querySelectorAll('a[href*="/feed/update/"]')]
            .map(a => a.href)[0] || null
          const profiles = [...el.querySelectorAll('a[href*="/in/"]')]
            .map(a => ({
              href: a.href.split('?')[0],
              text: (a.innerText || '').replace(/\\s+/g, ' ').trim(),
            }))
            .filter(x => x.text)
          const actor = el.querySelector('.entity-result__content-actor')
          const actorText = actor
            ? actor.innerText.replace(/\\s+/g, ' ').trim()
            : ''
          const embedded = el.querySelector('.entity-result__embedded-object')
          const embeddedTitle = embedded
            ? embedded.innerText.replace(/\\s+/g, ' ').trim()
            : ''
          const text = (el.innerText || '').replace(/\\s+/g, ' ').trim()
          const savedLink = /\\bSaved link\\b/i.test(text)
          const authorName = profiles[0]
            ? profiles[0].text.split('\\n')[0].replace(/\\s+View\\b.*$/, '').trim()
            : null
          return {
            urn,
            view,
            kind,
            summary_text: summaryText,
            has_see_more: hasSeeMore,
            update_url: update,
            author_name: authorName,
            author_url: profiles[0]?.href || null,
            author_headline: null,
            actor_text: actorText,
            embedded_title: embeddedTitle,
            saved_link_label: savedLink,
            has_image: !!el.querySelector('img'),
          }
        }""",
        SUMMARY_SEL,
    )


def read_summary(card) -> str:
    loc = card.locator(SUMMARY_SEL).first
    if loc.count() == 0:
        return ""
    return normalize_content(loc.inner_text())


def expand_see_more(card) -> dict[str, Any]:
    before = read_summary(card)
    btn = card.locator(SEE_MORE_SEL).first
    if btn.count() == 0:
        return {
            "expanded": False,
            "summary": before,
            "see_more_gone": True,
        }
    btn.click(timeout=5000)
    card.page.wait_for_timeout(1100)
    after = read_summary(card)
    still = card.locator(SEE_MORE_SEL).count()
    return {
        "expanded": True,
        "summary": after or before,
        "see_more_gone": still == 0,
        "before_len": len(before),
        "after_len": len(after),
    }


def resolve_article_destination(context, update_url: str) -> dict[str, Any]:
    page = context.new_page()
    try:
        page.goto(update_url, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(2200)
        reason = hard_stop_reason(auth_signals(page))
        if reason:
            return {"ok": False, "error": reason, "destination": None}
        data = page.evaluate(
            """() => {
              const abs = (href) => {
                try { return new URL(href, location.origin).href } catch { return href }
              }
              const links = [...document.querySelectorAll('a[href]')]
                .map(a => ({
                  href: abs(a.getAttribute('href') || a.href),
                  aria: a.getAttribute('aria-label') || '',
                }))
                .filter(x =>
                  x.href
                  && /^https?:/i.test(x.href)
                  && !/linkedin\\.com|licdn\\.com|microsoft\\.com/i.test(x.href)
                )
              const openArticle = links.find(x => x.aria.startsWith('Open article:'))
              return {
                destination: openArticle?.href || links[0]?.href || null,
                open_article_aria: openArticle?.aria || null,
              }
            }"""
        )
        dest = data.get("destination")
        return {
            "ok": bool(dest),
            "destination": dest,
            "error": None if dest else "no_external_destination",
            "open_article_aria": data.get("open_article_aria"),
        }
    except Exception as exc:
        return {"ok": False, "destination": None, "error": str(exc)}
    finally:
        page.close()


def find_card_by_urn(page, urn: str):
    return page.locator(f'div[data-chameleon-result-urn="{urn}"]').first
