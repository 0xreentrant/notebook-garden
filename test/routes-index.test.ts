import { describe, expect, it } from 'vitest'
import { clientLoader } from '../src/routes/_index'
import { clientLoader as summariesRedirect } from '../src/routes/summaries'
import { HOME_PATH } from '../src/lib/app-tabs'

function expectRedirectToHome(res: Response) {
  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBeGreaterThanOrEqual(300)
  expect(res.status).toBeLessThan(400)
  expect(res.headers.get('Location')).toBe(HOME_PATH)
}

describe('index route', () => {
  it('redirects / to home path', () => {
    expectRedirectToHome(clientLoader())
  })

  it('redirects /summaries to /youtube', () => {
    expect(HOME_PATH).toBe('/youtube')
    expectRedirectToHome(summariesRedirect())
  })
})
