import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { reactRouter } from '@react-router/dev/vite'
import { defineConfig, loadEnv, type PreviewServer, type ViteDevServer } from 'vite'
// ponytail: extensionless on purpose. The bundle config loader resolves this graph.
// Native config loader cannot. Scripts set VITE_CONFIG_NATIVE_IGNORE_WARNING.
import { apiMiddleware } from './src/server/api-middleware'

function apiPlugin() {
  return {
    name: 'notebook-garden-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(apiMiddleware)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(apiMiddleware)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.NOTEBOOKLM_COOKIE) process.env.NOTEBOOKLM_COOKIE = env.NOTEBOOKLM_COOKIE
  if (env.NOTEBOOKLM_BASE_URL) process.env.NOTEBOOKLM_BASE_URL = env.NOTEBOOKLM_BASE_URL

  return {
    plugins: [reactRouter(), tailwindcss(), apiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
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
