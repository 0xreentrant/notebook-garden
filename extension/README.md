# notebook-garden NotebookLM Extension

Headless Chrome extension that creates one NotebookLM notebook per video when called by notebook-garden.

## Prerequisites

1. Google Chrome
2. Logged into [NotebookLM](https://notebooklm.google.com) in the same Chrome profile where you load this extension

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` directory in this repo

Extension ID (stable via manifest `key`): `paacnibobhcimjiadlfhbflfkdcfiabl`

## Usage

With notebook-garden running at `http://localhost:5173` (or another localhost port):

1. Expand an entry
2. Click **NotebookLM**
3. Extension creates a notebook titled after the video and adds the YouTube URL
4. The notebook link appears in the entry title section and is saved to `summaries.db`

No extension popup or icon - the extension only responds to messages from notebook-garden.

## Troubleshooting

- **"Could not establish connection"** - extension not loaded, or wrong extension ID
- **"Please login to NotebookLM first"** - open notebooklm.google.com in Chrome and sign in
- **"Origin not allowed"** - notebook-garden must run on `localhost` or `127.0.0.1`

## E2e tests

Requires Playwright profile with NotebookLM login (`YT_PROFILE_DIR`, same as YouTube scripts):

```bash
NOTEBOOKLM_E2E=1 npm run test:notebooklm-rpc
NOTEBOOKLM_E2E=1 npm run test:notebooklm-ext
```

Tests create a real notebook - delete manually afterward (URL printed on success).

## RPC IDs

Pinned in `background.js` (keep in sync with `scripts/notebooklm-rpc-e2e.py`):

| Constant | RPC ID | Purpose |
|----------|--------|---------|
| `RPC_CREATE` | `CCqFvf` | Create notebook |
| `RPC_ADD_SOURCES` | `izAoDd` | Add YouTube source |
| `RPC_LIST` | `wXbhsf` | List notebooks |

## Commands

| `cmd` | Caller | Purpose |
|-------|--------|---------|
| `create-and-import` | notebook-garden | Create notebook + add YouTube URL |
| `list-notebooks` | notebook-garden | Return account notebook list |
