import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Roadmap 41: the app's colours as tokens (styles.css), light and dark. Text and the controls'
// colours meet WCAG AA (4.5:1 for text, 3:1 for borders of controls) against what they sit on in
// both; nothing else in the stylesheet names a colour of the chrome directly; graphs stay on
// white paper.

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

const block = (selector: string): Record<string, string> => {
  const at = css.indexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  const body = css.slice(at, css.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim()
  return out
}
const light = block(':root')
const dark = { ...light, ...block(':root[data-theme="dark"]') }

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** Text tokens and the backgrounds they are drawn on. */
const TEXT: [string, string[]][] = [
  ['text', ['bg', 'panel', 'panel-2', 'cell', 'cell-title', 'input-bg', 'grid-head', 'hover']],
  ['text', ['sel', 'sel-strong', 'accent-soft', 'match', 'match-sel', 'match-current']],
  ['text-2', ['panel', 'bg', 'panel-2']],
  ['label', ['panel', 'panel-2']],
  ['muted', ['bg', 'panel', 'panel-2', 'cell', 'grid-head', 'canvas', 'hover', 'sel']],
  ['accent', ['panel', 'bg', 'panel-2', 'accent-soft']],
  ['on-accent', ['accent-strong', 'accent-hover', 'danger-strong']],
  ['danger', ['panel']],
  ['error-text', ['panel', 'cell', 'badge-error-bg']],
  ['error-strong', ['error-bg']],
  ['warn-text', ['panel', 'bg']],
  ['warn-strong', ['warn-bg', 'panel']],
  ['info-text', ['info-bg']],
  ['calc-text', ['calc-bg']],
  ['badge-text', ['badge-bg']],
  ['badge-calc-text', ['badge-calc-bg', 'panel']],
  ['list-on', ['panel', 'accent-soft']],
  ['paper-text', ['paper']],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s colours', (_name, t) => {
  it.each(TEXT)('%s reads on its backgrounds (AA, 4.5:1)', (fg, bgs) => {
    for (const bg of bgs) {
      const c = contrast(t[fg]!, t[bg]!)
      expect(c, `${fg} on ${bg}: ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('shows controls’ edges and focus (3:1)', () => {
    for (const [fg, bg] of [
      ['focus', 'panel'],
      ['focus', 'bg'],
      ['accent', 'panel'],
    ] as const) {
      const c = contrast(t[fg]!, t[bg]!)
      expect(c, `${fg} on ${bg}: ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('tokens', () => {
  // Audit 4 (A8): --accent-strong is a fill (the primary button's, under white text); as text on
  // --accent-soft it read 2.55:1 in the dark colours (the model picker's chosen goal).
  it('never colours text with the accent’s fill (--accent-strong)', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /(^|[;{\s])color:\s*var\(--accent-strong\)/.test(m[2]!))
      .map((m) => m[1]!.trim())
    expect(rules).toEqual([])
    expect(contrast(dark.accent!, dark['accent-soft']!)).toBeGreaterThanOrEqual(4.5)
  })

  it('every dark token redefines a light one', () => {
    for (const k of Object.keys(block(':root[data-theme="dark"]')))
      expect(light, k).toHaveProperty(k)
  })

  it('keeps graphs and pages on white paper in both', () => {
    expect(light.paper).toBe('#ffffff')
    expect(dark.paper).toBe('#ffffff')
    expect(block(':root[data-theme="dark"]').paper).toBeUndefined()
  })

  it('names chrome colours only through tokens', () => {
    // Outside the token blocks, literal colours are only: white paper (graphs, thumbnails, the
    // printed page), the swatches and icons that show data colours, and pure overlays.
    const rest = css.slice(css.indexOf('}', css.indexOf(':root[data-theme="dark"]')) + 1)
    const literals = [...rest.matchAll(/(?<![\w-])(#[0-9a-fA-F]{3,8})\b/g)].map((m) => m[1])
    const allowed = new Set([
      // Data colours in icons and swatches (the Okabe–Ito palette), folder icon, mixed swatches.
      '#0072b2',
      '#d55e00',
      '#009e73',
      '#cc79a7',
      '#7a5bd6',
      '#8a94a3',
      '#b08a3e',
      '#e9c46a',
      '#f4d58d',
      '#ccc',
      '#fff',
      '#ffffff',
      // The family rings of the style picker (on their tints) and the toast's button.
      '#2a9d8f',
      '#e07a5f',
      '#7b5ea7',
      '#c9578c',
      '#59626e',
      '#c9ced6',
    ])
    expect(literals.filter((c) => !allowed.has(c.toLowerCase()))).toEqual([])
  })
})
