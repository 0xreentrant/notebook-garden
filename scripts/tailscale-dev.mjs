import { spawn } from 'node:child_process'
import {
  ensureTailscaleServe,
  tailscalePort,
  tailscaleSelf,
  tailscaleServeTarget,
} from './tailscale-self.mjs'

const httpOnly = process.argv.includes('--http-only')

const { ip, serviceDns } = tailscaleSelf()
const target = tailscaleServeTarget(ip)

if (!httpOnly) {
  ensureTailscaleServe(target)
  console.log('')
  console.log(`Open (HTTPS, secure context): https://${serviceDns}`)
  console.log(`Proxy target: ${target}`)
  console.log(`HTTP http://${ip}:${tailscalePort} is NOT secure - mic and crypto APIs stay off`)
  console.log('')
} else {
  console.log(`Phone URL: http://${ip}:${tailscalePort}`)
  console.log(`For mic/crypto use npm run dev:tailscale (HTTPS via https://${serviceDns})`)
}

const env = {
  ...process.env,
  TAILSCALE_HOST: ip,
  VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
}
if (!httpOnly) env.TAILSCALE_SERVE_HOST = serviceDns

const child = spawn(
  'node_modules/.bin/react-router',
  ['dev', '--strictPort', '--port', tailscalePort],
  { stdio: 'inherit', env },
)

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
