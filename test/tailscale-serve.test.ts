import { describe, expect, it } from 'vitest'
import {
  parseServeProxiesFromStatus,
  serviceProxiesFromStatus,
} from '../scripts/tailscale-self.mjs'

describe('parseServeProxiesFromStatus', () => {
  it('collects proxy targets from serve status JSON', () => {
    expect(
      parseServeProxiesFromStatus({
        Web: {
          'host.ts.net:443': {
            Handlers: {
              '/': { Proxy: 'http://100.66.135.53:5174' },
            },
          },
          'host.ts.net:8443': {
            Handlers: {
              '/': { Proxy: 'http://127.0.0.1:5176' },
            },
          },
        },
      }),
    ).toEqual(['http://100.66.135.53:5174', 'http://127.0.0.1:5176'])
  })

  it('returns empty when serve is unset', () => {
    expect(parseServeProxiesFromStatus({})).toEqual([])
  })

  it('ignores another app proxy when reading the notebook-garden service', () => {
    const status = {
      Web: {
        'ubuntu.tail965c07.ts.net:443': {
          Handlers: { '/': { Proxy: 'http://100.66.135.53:5174' } },
        },
      },
      Services: {
        'svc:qalm': {
          Web: {
            'qalm.tail965c07.ts.net:443': {
              Handlers: { '/': { Proxy: 'http://100.66.135.53:5175' } },
            },
          },
        },
      },
    }
    expect(serviceProxiesFromStatus(status, 'notebook-garden')).toEqual([])
    expect(serviceProxiesFromStatus(status, 'qalm')).toEqual([
      'http://100.66.135.53:5175',
    ])
  })
})
