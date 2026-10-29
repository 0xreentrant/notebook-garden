import {
  ensureTailscaleServe,
  tailscaleSelf,
  tailscaleServeTarget,
} from './tailscale-self.mjs'

const { ip, serviceDns } = tailscaleSelf()
const target = tailscaleServeTarget(ip)

ensureTailscaleServe(target)
console.log(`HTTPS: https://${serviceDns}`)
console.log(`Proxy target: ${target}`)
console.log(`Keep the app up with: npm run dev:tailscale`)
console.log(`Status: tailscale serve status`)
console.log(`Stop: npm run tailscale:reset`)
