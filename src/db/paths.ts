import path from 'node:path'

export function getDbPath() {
  return (
    process.env.APP_DB
    ?? process.env.WATCH_LATERER_DB
    ?? path.resolve(process.cwd(), 'summaries.db')
  )
}
