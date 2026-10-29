import { execSync } from 'node:child_process'

// Shared with local `npm run dev`. Qalm owns 5175, warmups owns 5174.
export const tailscalePort = '5176'
export const tailscaleService = 'notebook-garden'

export function tailscaleSelf() {
  const status = JSON.parse(execSync('tailscale status --json', { encoding: 'utf8' }))
  const self = status.Self
  const ip = self.TailscaleIPs?.find((addr) => addr.includes('.'))
  if (!ip) throw new Error('No Tailscale IPv4 address (is tailscale up?)')
  const dns = self.DNSName?.replace(/\.$/, '')
  if (!dns) throw new Error('No Tailscale DNSName')
  const suffix = status.MagicDNSSuffix
  const serviceDns = suffix ? `${tailscaleService}.${suffix}` : dns
  return { ip, dns, serviceDns }
}

export function tailscaleServeTarget(ip) {
  return process.env.TAILSCALE_SERVE_TARGET ?? `http://${ip}:${tailscalePort}`
}

/** Parse proxy targets from `tailscale serve status --json`. */
export function parseServeProxiesFromStatus(status) {
  const proxies = []
  for (const site of Object.values(status?.Web ?? {})) {
    for (const handler of Object.values(site?.Handlers ?? {})) {
      if (handler?.Proxy) proxies.push(handler.Proxy)
    }
  }
  return proxies
}

/** Proxies for one Tailscale Service. Node-level Web proxies do not count. */
export function serviceProxiesFromStatus(status, service) {
  const svc = status?.Services?.[`svc:${service}`]
  const proxies = []
  for (const site of Object.values(svc?.Web ?? {})) {
    for (const handler of Object.values(site?.Handlers ?? {})) {
      if (handler?.Proxy) proxies.push(handler.Proxy)
    }
  }
  return proxies
}

export function readServiceProxies() {
  try {
    const raw = execSync('tailscale serve status --json', { encoding: 'utf8' })
    return serviceProxiesFromStatus(JSON.parse(raw), tailscaleService)
  } catch {
    return []
  }
}

export function ensureTailscaleServe(target) {
  if (readServiceProxies().includes(target)) {
    console.log(`Tailscale serve already proxies ${target} for svc:${tailscaleService}`)
    return
  }
  const cmd = `tailscale serve --service=svc:${tailscaleService} --https=443 ${target}`
  try {
    execSync(cmd, { stdio: 'inherit' })
  } catch {
    if (readServiceProxies().includes(target)) {
      console.log(`Tailscale serve already proxies ${target} for svc:${tailscaleService}`)
      return
    }
    console.error('Serve config denied or failed. Fix once: sudo tailscale set --operator=$USER')
    console.error(`Or: sudo ${cmd}`)
    process.exit(1)
  }
}
