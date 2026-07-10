import { desc } from 'drizzle-orm'
import { db } from './client'
import { notebooks, summaryEntries } from './schema'

const entries = db
  .select()
  .from(summaryEntries)
  .orderBy(desc(summaryEntries.createdAt), desc(summaryEntries.id))
  .all()

const entryStatus = entries.reduce<Record<string, number>>((counts, row) => {
  counts[row.status] = (counts[row.status] ?? 0) + 1
  return counts
}, {})

const library = db
  .select()
  .from(notebooks)
  .orderBy(desc(notebooks.createdAt), desc(notebooks.id))
  .all()

console.log({ table: 'summary_entries', count: entries.length, byStatus: entryStatus })
console.log('entries sample:', entries.slice(0, 3).map((row) => ({
  videoId: row.videoId,
  title: row.title,
  status: row.status,
  notebooklmUrl: row.notebooklmUrl,
})))

console.log({ table: 'notebooks', count: library.length })
console.log('notebooks sample:', library.slice(0, 3).map((row) => ({
  notebooklmId: row.notebooklmId,
  title: row.title,
  sourceCount: row.sourceCount,
})))
