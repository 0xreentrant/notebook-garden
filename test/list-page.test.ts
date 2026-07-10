import { describe, expect, it } from 'vitest'
import { buildListQueryString, parseListPageQuery } from '../src/lib/list-page'
import { decodeCursor, encodeCursor } from '../src/server/list-page'

describe('list page query helpers', () => {
  it('round-trips offset cursors', () => {
    const encoded = encodeCursor({ offset: 50 })
    expect(decodeCursor(encoded)).toEqual({ offset: 50 })
  })

  it('parses list query defaults and clamps limit', () => {
    const query = parseListPageQuery(new URLSearchParams('limit=999&view=viewed&pinsAtTop=false'))
    expect(query.limit).toBe(100)
    expect(query.view).toBe('viewed')
    expect(query.pinsAtTop).toBe(false)
    expect(query.sort).toBe('created_desc')
  })

  it('builds stable query strings for infinite reload keys', () => {
    const qs = buildListQueryString({
      sort: 'created_desc',
      view: 'all',
      notebook: 'all',
      tag: 'all',
      search: '',
      searchScope: 'all',
      pinsAtTop: true,
      limit: 50,
    })
    expect(qs).toContain('limit=50')
    expect(qs).toContain('pinsAtTop=true')
    expect(qs).not.toContain('cursor=')
  })
})
