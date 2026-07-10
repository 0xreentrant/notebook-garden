import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  collectChromeBookmarks,
  parseChromeBookmarksFile,
} from '../src/server/chrome-bookmarks.ts'

const sample = {
  roots: {
    bookmark_bar: {
      name: 'Bookmarks bar',
      type: 'folder',
      children: [
        {
          name: 'Dev',
          type: 'folder',
          children: [
            {
              name: 'Tools',
              type: 'folder',
              children: [
                {
                  type: 'url',
                  name: 'MDN',
                  url: 'https://developer.mozilla.org/',
                },
              ],
            },
          ],
        },
        {
          type: 'url',
          name: 'skip me',
          url: 'javascript:void(0)',
        },
      ],
    },
    other: {
      name: 'Other bookmarks',
      type: 'folder',
      children: [
        {
          type: 'url',
          name: 'Example',
          url: 'https://example.com/',
        },
      ],
    },
  },
}

const flat = parseChromeBookmarksFile(JSON.stringify(sample), 'Profile 1')
assert.equal(flat.length, 2)
assert.deepEqual(
  flat.find((row) => row.url === 'https://developer.mozilla.org/'),
  {
    url: 'https://developer.mozilla.org/',
    title: 'MDN',
    folder_path: 'Bookmarks bar/Dev/Tools',
    chrome_profile: 'Profile 1',
  },
)
assert.equal(
  flat.find((row) => row.url === 'https://example.com/')?.folder_path,
  'Other bookmarks',
)

const root = mkdtempSync(path.join(tmpdir(), 'chrome-bookmarks-check-'))
try {
  const profileDir = path.join(root, 'Profile 1')
  mkdirSync(profileDir)
  writeFileSync(path.join(profileDir, 'Bookmarks'), JSON.stringify(sample))
  writeFileSync(
    path.join(root, 'Local State'),
    JSON.stringify({
      profile: {
        info_cache: {
          'Profile 1': { name: 'Me' },
        },
      },
    }),
  )
  mkdirSync(path.join(root, 'Guest Profile'))
  writeFileSync(
    path.join(root, 'Guest Profile', 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          name: 'Bookmarks bar',
          type: 'folder',
          children: [{ type: 'url', name: 'Guest', url: 'https://guest.example/' }],
        },
      },
    }),
  )

  const collected = collectChromeBookmarks(root)
  assert.deepEqual(collected.profiles, ['Me'])
  assert.equal(collected.bookmarks[0]?.chrome_profile, 'Me')
  assert.equal(collected.bookmarks.length, 2)

  const dbPath = path.join(root, 'test.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      folder_path TEXT NOT NULL DEFAULT '',
      chrome_profile TEXT NOT NULL,
      notebooklm_links TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO bookmarks (
      url, title, folder_path, chrome_profile, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  let inserted = 0
  for (const bookmark of collected.bookmarks) {
    const result = insert.run(
      bookmark.url,
      bookmark.title,
      bookmark.folder_path,
      bookmark.chrome_profile,
      now,
      now,
    )
    if (result.changes > 0) inserted += 1
  }
  assert.equal(inserted, 2)

  let secondPass = 0
  for (const bookmark of collected.bookmarks) {
    const result = insert.run(
      bookmark.url,
      bookmark.title,
      bookmark.folder_path,
      bookmark.chrome_profile,
      now,
      now,
    )
    if (result.changes > 0) secondPass += 1
  }
  assert.equal(secondPass, 0)
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get() as { n: number }).n,
    2,
  )
  db.close()
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('chrome-bookmarks check ok')
