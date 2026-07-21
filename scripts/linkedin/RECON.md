# LinkedIn Saved recon findings

Date: 2026-07-21
Profile: `~/.config/linkedin-saved/chrome-profile` (mode 0700)
Scripts: `li-dom-spike.py`, `li-expand-spike.py`, `li-full-recon.py`, `li-btemplate-probe.py`
Full report: `/tmp/li-full-recon.json`
Fixture: `fixtures/saved-items-recon.json`

## Collection size and pagination

- Sidebar label is capped (`Saved posts and articles` / UI showed `10+`).
- Infinite scroll in primary content loads the full set.
- Observed: **138 unique** `data-chameleon-result-urn` values after 18 scroll rounds.
- Initial paint ~10 cards; ~10 new URNs per scroll until exhaustion.
- Harvested count matched processed count with no duplicates.

## Item shapes

| Kind | Count | Notes |
|------|------:|-------|
| `urn:li:activity:*` | 137 | Native posts |
| `urn:li:article:*` | 1 | Saved external link |

Templates:

- `search-entity-result-content-a-template`: 132 activities
- `search-entity-result-content-b-template`: 1 article + 5 activities

## Stable selectors

- Card: `main div[data-chameleon-result-urn]` (or `.scaffold-finite-scroll__content …`)
- Dedupe key: full `data-chameleon-result-urn`
- Body text: `[class*="entity-result__content-summary"]`  
  (a-template often has `.entity-result__content-summary`; b-template uses only `--3-lines` modifier)
- Expand: `button.reusable-search-show-more-link`
- Permalink: `/feed/update/{urn}/`
- Article destination: open update URL, then `a[aria-label^="Open article:"]` (ignore `javascript:`)
- Overflow: `button[aria-label*="more actions" i]` → menu item **Unsave** (no confirmation dialog observed in menu)

Ignore hashed class names.

## Expansion

- Expand works in place; control disappears on success.
- Whole-card text length is a bad success metric.
- Success predicate: summary node non-empty AND see-more absent.
- Short posts without see-more are already complete.
- Media/image posts still often have summary text; treat empty summary + media as `metadata_only`.

## Auth / challenge

Documented hard-stop signals (no bypass):

- URL contains `/login` or `/uas/login`
- Body/title indicates sign-in wall
- `checkpoint`, security verification, captcha, unusual activity
- Account restriction / action blocked copy

Persistent profile survived process restarts during spikes.

## NotebookLM viability

Current client [`addYouTubeSourcesViaApi`](../../src/server/notebooklm/notebooklm.ts) accepts **URL sources only**. There is no text/paste RPC in this repo.

Committed strategy:

- **Article**: plant resolved `source_url` (destination).
- **Activity**: durable source is captured `content_text`. Auto-plant of LinkedIn permalinks is best-effort only (often auth-gated). UI must show/copy stored text. Do not block collection on NotebookLM.

## Unsave (later command only)

Overflow labels include exact **Unsave** for activity and article. Inspected and dismissed with Escape; no mutation performed. Collection remains non-mutating by default.

## Recon exit criteria

| Criterion | Status |
|-----------|--------|
| All items classified | Pass (`activity` / `article` only) |
| Complete unique URN harvest | Pass (138) |
| Text extraction path known | Pass (summary selector fix for b-template) |
| Article destination resolve | Pass |
| Auth hard stops documented | Pass |
| Overflow/unsave labels known | Pass |
| NotebookLM strategy decided | Pass (URL for articles; local text for activities) |
