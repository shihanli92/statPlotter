import { describe, expect, it } from 'vitest'
import { parseRichText } from '../src/examples/markup.ts'

describe('example builders’ rich text syntax', () => {
  it('parses scripts, emphasis and symbols', () => {
    expect(parseRichText('x^2 + y_{i,j}')).toEqual([
      { text: 'x' },
      { text: '2', sup: true },
      { text: ' + y' },
      { text: 'i,j', sub: true },
    ])
    expect(parseRichText('*k*_{off} (s^{-1})')).toEqual([
      { text: 'k', italic: true },
      { text: 'off', sub: true },
      { text: ' (s' },
      { text: '-1', sup: true },
      { text: ')' },
    ])
    expect(parseRichText('**Bold** \\alpha \\mu{}m \\pm 5\\deg')).toEqual([
      { text: 'Bold', bold: true },
      { text: ' α μm ± 5°' },
    ])
    expect(parseRichText('\\mu m')).toEqual([{ text: 'μm' }])
    expect(parseRichText('\\micro{}g')).toEqual([{ text: 'µg' }])
    expect(parseRichText('a\\^b \\_ \\* \\\\')).toEqual([{ text: 'a^b _ * \\' }])
    expect(parseRichText('10^{\\alpha}')).toEqual([{ text: '10' }, { text: 'α', sup: true }])
  })
})
