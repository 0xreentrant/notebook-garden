"""Resolve Obsidian vault path for agent prompts.

Order: OBSIDIAN_VAULT env, then notebook-garden-settings.json next to the DB.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def resolve_obsidian_vault(db: Path | None = None) -> str:
    vault = (os.environ.get("OBSIDIAN_VAULT") or "").strip()
    if vault:
        return vault
    if db is None:
        return ""
    settings = Path(db).resolve().parent / "notebook-garden-settings.json"
    try:
        raw = json.loads(settings.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    value = raw.get("obsidianVault") if isinstance(raw, dict) else None
    return value.strip() if isinstance(value, str) else ""


def workspace_switch_directive(db: Path | None = None) -> str | None:
    vault = resolve_obsidian_vault(db)
    if not vault:
        return None
    return f"Switch the workspace to the {vault}."


def with_workspace_switch(prompt: str, db: Path | None = None) -> str:
    directive = workspace_switch_directive(db)
    return f"{directive}\n{prompt}" if directive else prompt


if __name__ == "__main__":
    os.environ["OBSIDIAN_VAULT"] = "/tmp/MyVault"
    assert workspace_switch_directive() == "Switch the workspace to the /tmp/MyVault."
    assert with_workspace_switch("body") == "Switch the workspace to the /tmp/MyVault.\nbody"
    del os.environ["OBSIDIAN_VAULT"]
    assert workspace_switch_directive() is None
    print("ok")
