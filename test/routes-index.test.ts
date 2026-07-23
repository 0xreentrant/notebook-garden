import { describe, expect, it } from 'vitest'
import { clientLoader } from '../src/routes/_index'
import { HOME_PATH } from '../src/lib/app-tabs'

describe('index route', () => {
  it('redirects / to home path', () => {
    const res = clientLoader()
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('Location')).toBe(HOME_PATH)
  })
})
