import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type PreviewServer, type ViteDevServer } from 'vite'
import { entriesMiddleware } from './src/server/entries-middleware'
import { bookmarksMiddleware } from './src/server/bookmarks-middleware'
import { notebooklmMiddleware } from './src/server/notebooklm-routes'
import { notebooksApiMiddleware } from './src/server/notebooks-api'

function apiPlugin() {
  return {
    name: 'notebook-garden-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/entries', entriesMiddleware)
      server.middlewares.use('/api/bookmarks', bookmarksMiddleware)
      server.middlewares.use('/api/notebooklm', notebooklmMiddleware)
      server.middlewares.use('/api/notebooks', notebooksApiMiddleware)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use('/api/entries', entriesMiddleware)
      server.middlewares.use('/api/bookmarks', bookmarksMiddleware)
      server.middlewares.use('/api/notebooklm', notebooklmMiddleware)
      server.middlewares.use('/api/notebooks', notebooksApiMiddleware)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.NOTEBOOKLM_COOKIE) process.env.NOTEBOOKLM_COOKIE = env.NOTEBOOKLM_COOKIE

  return {
    plugins: [react(), tailwindcss(), apiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: {
      exclude: ['better-sqlite3'],
    },
    ssr: {
      external: ['better-sqlite3', 'playwright'],
    },
  }
})
