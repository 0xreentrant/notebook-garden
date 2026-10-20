import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import {
  DEFAULT_REDIRECT_URI,
  RedditAuthError,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchIdentity,
  redditClientId,
  saveRedditToken,
} from '../src/server/reddit-client'

function openBrowser(url: string) {
  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.on('error', () => {
    console.error('Could not open a browser. Open the URL above.')
  })
  child.unref()
}

function waitForCode(redirectUri: string, state: string, onListening: () => void) {
  const target = new URL(redirectUri)
  if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
    throw new RedditAuthError('REDDIT_REDIRECT_URI must use 127.0.0.1 or localhost')
  }
  const port = Number(target.port || 80)
  const pathname = target.pathname || '/'
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let server: http.Server
    const finish = (error: Error | null, code?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.close()
      if (error) reject(error)
      else if (code) resolve(code)
    }
    const timeout = setTimeout(() => {
      finish(new RedditAuthError('Timed out waiting for the Reddit redirect'))
    }, 5 * 60 * 1000)
    server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (reqUrl.pathname !== pathname) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const oauthError = reqUrl.searchParams.get('error')
      const gotState = reqUrl.searchParams.get('state')
      const code = reqUrl.searchParams.get('code')
      if (oauthError) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`Reddit returned ${oauthError}. You can close this tab.`)
        finish(new RedditAuthError(`Reddit authorization error: ${oauthError}`))
        return
      }
      if (gotState !== state || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Authorization state did not match. You can close this tab.')
        finish(new RedditAuthError('OAuth state mismatch'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Reddit login OK. You can close this tab.')
      finish(null, code)
    })
    server.on('error', (error) => finish(error))
    server.listen(port, '127.0.0.1', () => onListening())
  })
}

const redirectUri = process.env.REDDIT_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI
let clientId: string
try {
  clientId = redditClientId()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const state = randomBytes(16).toString('hex')
const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state })

try {
  const code = await waitForCode(redirectUri, state, () => {
    console.log(authorizeUrl)
    openBrowser(authorizeUrl)
  })
  const token = await exchangeAuthorizationCode({ clientId, redirectUri, code })
  if (!token.refresh_token) {
    throw new RedditAuthError(
      'Reddit did not return a refresh token. Use duration=permanent and the registered redirect URI.',
    )
  }
  const username = await fetchIdentity(token.access_token)
  saveRedditToken({
    refresh_token: token.refresh_token,
    access_token: token.access_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scope: token.scope ?? 'identity history',
    username,
    client_id: clientId,
  })
  console.log(`Reddit login OK (${username})`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
