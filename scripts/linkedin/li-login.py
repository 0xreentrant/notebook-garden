#!/usr/bin/env python3
"""Headed LinkedIn login into the dedicated Saved profile.

  python3 scripts/linkedin/li-login.py

Complete sign-in manually. Session persists under LI_PROFILE_DIR.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from li_dom import SAVED_URL, auth_signals, hard_stop_reason

PROFILE_DIR = Path(
    os.environ.get(
        "LI_PROFILE_DIR",
        Path.home() / ".config/linkedin-saved/chrome-profile",
    )
)


def main() -> int:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_DIR.chmod(0o700)
    print(f"Profile: {PROFILE_DIR}", file=sys.stderr)
    print("Complete LinkedIn login in Chrome if needed.", file=sys.stderr)

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
        signals = auth_signals(page)
        reason = hard_stop_reason(signals)
        if reason:
            print(
                f"Auth state: {reason}. Log in, reach Saved Posts, then wait.",
                file=sys.stderr,
            )
            deadline = 5 * 60 * 1000
            waited = 0
            while waited < deadline:
                page.wait_for_timeout(3000)
                waited += 3000
                signals = auth_signals(page)
                if not hard_stop_reason(signals) and "saved-posts" in page.url:
                    break
                if "/feed" in page.url and "saved-posts" not in page.url:
                    page.goto(SAVED_URL, wait_until="domcontentloaded", timeout=90000)
            signals = auth_signals(page)
            reason = hard_stop_reason(signals)

        if reason or "saved-posts" not in page.url:
            print(f"Login incomplete ({reason or page.url})", file=sys.stderr)
            context.close()
            return 1

        print(f"OK: {page.title()} @ {page.url}", file=sys.stderr)
        page.wait_for_timeout(2000)
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
