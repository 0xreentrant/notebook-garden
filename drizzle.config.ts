import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.APP_DB ?? process.env.WATCH_LATERER_DB ?? 'summaries.db',
  },
})
