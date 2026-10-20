#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
db="$root/summaries.db"
remote="${DB_BACKUP_REPO:-https://github.com/0xreentrant/notebook-garden-db.git}"

if [[ ! -f "$db" ]]; then
  echo "missing $db" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init -q "$work"
git -C "$work" remote add origin "$remote"
if git -C "$work" fetch --depth 1 origin main; then
  git -C "$work" checkout -q -b main origin/main
else
  git -C "$work" checkout -q -b main
fi

python3 - "$db" "$work/summaries.db" <<'PY'
import sqlite3
import sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
src.close()
PY
git -C "$work" add summaries.db
if git -C "$work" diff --cached --quiet; then
  echo "backup already current"
  exit 0
fi

git -C "$work" commit -q -m "Backup summaries.db"
git -C "$work" push -u origin main
echo "backed up to $remote"
