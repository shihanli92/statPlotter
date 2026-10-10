import type { FontId, GraphNode, TextStyle } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  FONT_VARIANTS,
  FONTS,
  layoutGraph,
  layoutText,
  SCRIPT,
  scaleNode,
  sceneToSvg,
} from '../src/index.ts'
import { placeText } from '../src/layout/text.ts'
import { graphOf } from './graphs.ts'
import { byId, fonts, prim, projectOf, sampleTable } from './helpers.ts'

const style: TextStyle = {
  font: 'sans',
  size: 12,
  color: { rgb: '#000000' },
  bold: false,
  italic: false,
}

describe('layoutText', () => {
  it('matches Arial advance widths (Liberation Sans is metric-compatible)', () => {
    // Arial advance widths in units of 2048/em: 'H' = 1479, 'i' = 455, space = 569.
    expect(layoutText(fonts, [{ text: 'H' }], style).width).toBeCloseTo((1479 / 2048) * 12, 10)
    expect(layoutText(fonts, [{ text: 'i' }], style).width).toBeCloseTo((455 / 2048) * 12, 10)
    expect(layoutText(fonts, [{ text: ' ' }], style).width).toBeCloseTo((569 / 2048) * 12, 10)
  })

  it('is deterministic and scales linearly with size', () => {
    const a = layoutText(fonts, [{ text: 'Concentration (µM)' }], style)
    const b = layoutText(fonts, [{ text: 'Concentration (µM)' }], { ...style, size: 24 })
    expect(b.width).toBeCloseTo(a.width * 2, 10)
    expect(layoutText(fonts, [{ text: 'Concentration (µM)' }], style)).toEqual(a)
  })

  it('draws a run not bold in a bold style (bold: false)', () => {
    const t = layoutText(fonts, [{ text: 'a' }, { text: 'b', bold: false }], {
      ...style,
      bold: true,
    })
    expect(t.runs.map((r) => r.bold)).toEqual([true, false])
  })

  it('bold is wider than regular', () => {
    const regular = layoutText(fonts, [{ text: 'Response' }], style).width
    const bold = layoutText(fonts, [{ text: 'Response' }], { ...style, bold: true }).width
    expect(bold).toBeGreaterThan(regular)
  })

  it('positions runs end to end, with superscripts smaller and raised', () => {
    const t = layoutText(fonts, [{ text: '10' }, { text: '-6', sup: true }, { text: ' M' }], style)
    const [base, sup, tail] = t.runs
    expect(sup!.x).toBeCloseTo(base!.width, 10)
    expect(tail!.x).toBeCloseTo(base!.width + sup!.width, 10)
    expect(t.width).toBeCloseTo(base!.width + sup!.width + tail!.width, 10)
    expect(sup!.size).toBeCloseTo(12 * SCRIPT.scale, 10)
    expect(sup!.dy).toBeLessThan(0)
    // The raised superscript extends the line's ascent beyond the plain text.
    expect(t.ascent).toBeGreaterThan(layoutText(fonts, [{ text: '10' }], style).ascent)
  })

  it('handles Greek and symbols without falling back to zero width', () => {
    for (const ch of ['α', 'β', 'µ', '±', '°', '²']) {
      expect(layoutText(fonts, [{ text: ch }], style).width, ch).toBeGreaterThan(0)
    }
  })

  it('lays out lines a line pitch apart, aligned within the widest', () => {
    const one = layoutText(fonts, [{ text: 'Concentration' }], style)
    const short = layoutText(fonts, [{ text: '(µM)' }], style)
    const font = fonts.get('sans', 'regular')
    const pitch = ((font.ascent - font.descent + font.lineGap) / font.unitsPerEm) * 12
    const t = layoutText(fonts, [{ text: 'Concentration\n(µM)' }], style, 'middle')
    expect(t.width).toBeCloseTo(one.width, 10)
    expect(t.ascent).toBeCloseTo(one.ascent, 10)
    expect(t.descent).toBeCloseTo(pitch + short.descent, 10)
    const [a, b] = t.runs
    expect(a).toMatchObject({ text: 'Concentration', x: 0, dy: 0 })
    expect(b!.text).toBe('(µM)')
    expect(b!.dy).toBeCloseTo(pitch, 10)
    expect(b!.x).toBeCloseTo((one.width - short.width) / 2, 10)
    const right = layoutText(fonts, [{ text: 'Concentration\n(µM)' }], style, 'end')
    expect(right.runs[1]!.x).toBeCloseTo(one.width - short.width, 10)
    // Formatting carries across a break; a superscript on the second line rides on its baseline.
    const sup = layoutText(fonts, [{ text: 'a\nb' }, { text: '2', sup: true }], style)
    expect(sup.runs.map((r) => r.text)).toEqual(['a', 'b', '2'])
    expect(sup.runs[2]!.dy).toBeCloseTo(pitch + SCRIPT.supShift * 12, 10)
  })

  it('counts empty lines at the base font height', () => {
    const font = fonts.get('sans', 'regular')
    const unit = 12 / font.unitsPerEm
    const pitch = (font.ascent - font.descent + font.lineGap) * unit
    const t = layoutText(fonts, [{ text: '\nx\n' }], style)
    expect(t.ascent).toBeCloseTo(font.ascent * unit, 10)
    expect(t.descent).toBeCloseTo(2 * pitch - font.descent * unit, 10)
    expect(t.runs).toHaveLength(1)
    expect(layoutText(fonts, [], style)).toEqual({ width: 0, ascent: 0, descent: 0, runs: [] })
  })

  it('underlines runs with the regular face rule, continuous across adjacent runs', () => {
    const font = fonts.get('sans', 'regular')
    const unit = 12 / font.unitsPerEm
    const t = layoutText(
      fonts,
      [
        { text: 'plain ' },
        { text: 'under', underline: true },
        { text: '2', sup: true, underline: true },
        { text: ' gap ' },
        { text: 'again', underline: true, bold: true },
      ],
      style,
    )
    expect(t.underlines).toHaveLength(2)
    const [u, v] = t.underlines!
    expect(u!.x).toBeCloseTo(t.runs[1]!.x, 10)
    expect(u!.w).toBeCloseTo(t.runs[1]!.width + t.runs[2]!.width, 10)
    expect(u!.y).toBeCloseTo(-font.underlinePosition * unit, 10)
    expect(u!.h).toBeCloseTo(font.underlineThickness * unit, 10)
    expect(v!.x).toBeCloseTo(t.runs[4]!.x, 10)
    // Below the baseline and within the text's descent.
    expect(u!.y).toBeGreaterThan(0)
    expect(u!.y + u!.h).toBeLessThan(t.descent)
    // One per line.
    const two = layoutText(fonts, [{ text: 'a\nb', underline: true }], style)
    expect(two.underlines!.map((r) => r.y > 0)).toEqual([true, true])
    expect(two.underlines![1]!.y).toBeGreaterThan(two.underlines![0]!.y)
    expect(layoutText(fonts, [{ text: 'a' }], style).underlines).toBeUndefined()
  })

  it('serif and sans differ', () => {
    const sans = layoutText(fonts, [{ text: 'Time (min)' }], style).width
    const serif = layoutText(fonts, [{ text: 'Time (min)' }], { ...style, font: 'serif' }).width
    expect(serif).not.toBeCloseTo(sans, 3)
  })
})

describe('fonts (roadmap 28b)', () => {
  it('loads the four faces of every bundled family', () => {
    expect(Object.keys(FONTS)).toEqual(['sans', 'serif', 'mono', 'narrow'])
    for (const id of Object.keys(FONTS) as FontId[])
      for (const v of FONT_VARIANTS) {
        const f = fonts.get(id, v)
        expect(f.familyName, `${id}/${v}`).toMatch(/^Liberation (Sans|Serif|Mono|Sans Narrow)$/)
        expect(f.unitsPerEm).toBe(2048)
      }
  })

  it('measures mono like Courier New and narrow like Arial Narrow', () => {
    // Courier New: every character 1229 / 2048 em wide.
    const mono = { ...style, font: 'mono' as const }
    for (const t of ['i', 'W', '0.125', 'µ±α'])
      expect(layoutText(fonts, [{ text: t }], mono).width, t).toBeCloseTo(
        (1229 / 2048) * 12 * [...t].length,
        10,
      )
    // Arial Narrow is Arial condensed to 82%.
    const text = 'Concentration of agonist (µM)'
    const narrow = layoutText(fonts, [{ text }], { ...style, font: 'narrow' }).width
    expect(narrow / layoutText(fonts, [{ text }], style).width).toBeCloseTo(0.82, 2)
  })
})

describe('mixed sizes and colours (roadmap 28b)', () => {
  it('measures each run at its own size, a script relative to its run', () => {
    const t = layoutText(
      fonts,
      [{ text: 'ab' }, { text: 'ab', size: 24 }, { text: '2', sup: true, size: 24 }],
      style,
    )
    const [small, big, sup] = t.runs
    expect(big!.size).toBe(24)
    expect(big!.width).toBeCloseTo(small!.width * 2, 10)
    expect(sup!.size).toBeCloseTo(24 * SCRIPT.scale, 10)
    expect(sup!.dy).toBeCloseTo(24 * SCRIPT.supShift, 10)
    // The line is as tall as its largest run.
    expect(t.ascent).toBeGreaterThan(
      layoutText(fonts, [{ text: 'ab' }], { ...style, size: 24 }).ascent,
    )
  })

  it("takes each line's height from its largest run, keeping the pitch for one size", () => {
    const font = fonts.get('sans', 'regular')
    const em = (v: number, size: number) => (v / font.unitsPerEm) * size
    const pitch = em(font.ascent - font.descent + font.lineGap, 12)
    const plain = layoutText(fonts, [{ text: 'a\nb\nc' }], style)
    expect(plain.runs.map((r) => r.dy)).toEqual([0, pitch, 2 * pitch])
    // A 24 pt word on the second line pushes it down by its ascent and the third by its descent.
    const t = layoutText(fonts, [{ text: 'a\n' }, { text: 'B', size: 24 }, { text: 'b\nc' }], style)
    const [a, big, b, c] = t.runs
    expect(big!.dy).toBe(b!.dy)
    expect(big!.dy - a!.dy).toBeCloseTo(
      em(font.lineGap - font.descent, 12) + em(font.ascent, 24),
      10,
    )
    expect(c!.dy - b!.dy).toBeCloseTo(em(font.lineGap - font.descent, 24) + em(font.ascent, 12), 10)
    // Nothing overlaps: the big line's top is below the first line's bottom.
    expect(big!.dy - em(font.ascent, 24)).toBeGreaterThan(a!.dy + em(-font.descent, 12))
    expect(t.descent).toBeCloseTo(c!.dy - em(font.descent, 12), 10)
    // Smaller runs on a line make it tighter.
    const tight = layoutText(fonts, [{ text: 'a\n' }, { text: 'b', size: 6 }], style)
    expect(tight.runs[1]!.dy).toBeLessThan(pitch)
  })

  it("underlines at the run's size, a stretch per size and colour", () => {
    const font = fonts.get('sans', 'regular')
    const t = layoutText(
      fonts,
      [
        { text: 'a', underline: true },
        { text: 'b', underline: true, size: 24 },
        { text: 'c', underline: true, size: 24 },
        { text: 'd', underline: true, size: 24, color: { palette: 1 } },
      ],
      style,
    )
    const [u, v, w] = t.underlines!
    expect(t.underlines).toHaveLength(3)
    expect(u!.h).toBeCloseTo((font.underlineThickness / font.unitsPerEm) * 12, 10)
    expect(v!.h).toBeCloseTo((font.underlineThickness / font.unitsPerEm) * 24, 10)
    expect(v!.y).toBeCloseTo((-font.underlinePosition / font.unitsPerEm) * 24, 10)
    expect(v!.w).toBeCloseTo(t.runs[1]!.width + t.runs[2]!.width, 10)
    expect(w!.color).toEqual({ palette: 1 })
  })

  it("draws a run's own colour only where it differs from the text's, scaled with the graph", () => {
    const palette = ['#0072b2', '#d55e00']
    const content = [
      { text: 'plain ' },
      { text: 'red', color: { palette: 1 }, underline: true },
      { text: ' black', color: { rgb: '#000000' } },
      { text: ' series', color: { series: true as const } },
    ]
    const { node } = placeText(fonts, 't', content, style, palette, 0, 20, 'start', 'baseline')
    const p = prim(node, 'text')
    expect(p.color).toBe('#000000')
    expect(p.layout.runs.map((r) => r.fill)).toEqual([undefined, '#d55e00', undefined, undefined])
    expect(p.layout.underlines![0]!.fill).toBe('#d55e00')
    const svg = sceneToSvg({
      width: 100,
      height: 30,
      root: node,
      plot: { x: 0, y: 0, w: 1, h: 1 },
    } as never)
    expect(svg.match(/<tspan [^>]*>/g)!.map((t) => t.includes('fill='))).toEqual([
      false,
      true,
      false,
      false,
    ])
    expect(svg).toContain('fill="#d55e00">red</tspan>')
    expect(svg).toMatch(/<rect [^>]*fill="#d55e00"\/>/)
    // A scaled graph scales run sizes and keeps colours.
    const scaled = prim(scaleNode(node, 2), 'text')
    expect(scaled.layout.runs[1]!.size).toBe(24)
    expect(scaled.layout.underlines![0]!.fill).toBe('#d55e00')
  })
})

describe('multi-line and underlined text in graphs', () => {
  const xy = sampleTable('xy')
  const scene = (patch: (g: GraphNode) => Partial<GraphNode>) => {
    const graph = graphOf(xy, 'meanSd', patch)
    return layoutGraph({ project: projectOf(xy, graph), graph, fonts })
  }
  const yTitle = (text: string) => (g: GraphNode) => ({
    axes: { ...g.axes, y: { ...g.axes.y, title: { content: [{ text }] } } },
  })

  it('makes room for each line of a rotated Y title, keeping the plot size', () => {
    const one = scene(yTitle('Rate'))
    const two = scene(yTitle('Rate\n(µM)'))
    const font = fonts.get('sans', 'bold')
    const size = prim(byId(one, 'axis/y/title'), 'text').layout.runs[0]!.size
    const pitch = ((font.ascent - font.descent + font.lineGap) / font.unitsPerEm) * size
    expect(two.plot.w).toBeCloseTo(one.plot.w, 6)
    expect(two.plot.x - one.plot.x).toBeCloseTo(pitch, 1)
    // Its box (turned) grows by the line and stays clear of the plot.
    const box = byId(two, 'axis/y/title')!.bbox!
    expect(box.w).toBeGreaterThan(byId(one, 'axis/y/title')!.bbox!.w + pitch * 0.9)
    expect(box.x + box.w).toBeLessThan(two.plot.x)
  })

  it('moves the plot down for a two-line graph title', () => {
    const one = scene(() => ({ title: { content: [{ text: 'Title' }] } }))
    const two = scene(() => ({ title: { content: [{ text: 'Title\nsecond line' }] } }))
    expect(two.plot.y).toBeGreaterThan(one.plot.y + 10)
    expect(two.height).toBeGreaterThan(one.height + 10)
  })

  it('scales underlines with the graph and draws them as rects', () => {
    const under = () => ({ title: { content: [{ text: 'U', underline: true }] } })
    const base = prim(byId(scene(under), 'title'), 'text').layout.underlines![0]!
    const big = scene((g) => ({
      ...under(),
      size: { plotWidth: g.size.plotWidth * 2, plotHeight: g.size.plotHeight * 2, scale: 2 },
    }))
    const u = prim(byId(big, 'title'), 'text').layout.underlines![0]!
    expect(u.w).toBeCloseTo(base.w * 2, 6)
    expect(u.h).toBeCloseTo(base.h * 2, 6)
    expect(sceneToSvg(big)).toMatch(/<\/text><rect x="[\d.]+" y="[\d.]+" width="[\d.]+"/)
  })
})
