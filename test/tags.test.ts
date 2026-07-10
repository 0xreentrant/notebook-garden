import { describe, expect, it } from 'vitest'
import { normalizeTag, parseTags, serializeTags } from '../src/lib/tags'

describe('tags', () => {
  it('normalizes and dedupes', () => {
    expect(normalizeTag('  Foo Bar  ')).toBe('foo bar')
    expect(serializeTags(['b', 'a', 'b'])).toBe('["a","b"]')
    expect(parseTags('["x","y"]')).toEqual(['x', 'y'])
  })
})
