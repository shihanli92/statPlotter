import type { DataTable, Frame, GraphNode, Layer, TableKind } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  checkLayers,
  FRAMES,
  layoutGraph,
  MATRIX_KINDS,
  type MatrixKind,
  type MvKind,
  type Scene,
} from '../src/index.ts'
import { GLYPH_PRECEDENCE, LEGEND_GLYPHS, type LegendGlyph } from '../src/layers/glyphs.ts'
import {
  flatten,
  fonts,
  projectOf,
  sampleMapping,
  sampleTable,
  sampleVariables,
} from './helpers.ts'
import {
  layerOf,
  pairGraph,
  seriesKeys,
  specsFor,
  ZORDER_ANALYSIS,
  ZORDER_RESULT,
} from './zorder.ts'

// Audit 2 (G4): a data set's legend sample is what a layer drawing it draws (`LEGEND_GLYPHS`).
// Generated from the matrix: for every kind, on category, grouped and XY graphs, every pair of
// layers the matrix allows together — each data set's sample is the glyph of a layer drawing it
// (never a symbol no layer draws), and a data set that a layer with a glyph draws has a sample.

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutGraph({
    project: projectOf(table, graph),
    graph: { ...graph, legend: { ...graph.legend, show: true } },
    fonts,
    result: (id) => (id === ZORDER_ANALYSIS ? ZORDER_RESULT : undefined),
  })

/** The glyphs a data set's legend sample shows, by its nodes' ids. */
function sampleGlyphs(scene: Scene, key: string): Set<string> {
  const pre = `legend/${key}/`
  const out = new Set<string>()
  for (const n of flatten(scene.root)) {
    if (!n.id.startsWith(pre) || !n.prim) continue
    const part = n.id.slice(pre.length).split('/')[0]!
    if (part !== 'label') out.add(part)
  }
  return out
}

/** The sample parts each glyph may draw. */
const PARTS: Record<LegendGlyph, string[]> = {
  bar: ['swatch'],
  box: ['swatch'],
  area: ['swatch'],
  band: ['swatch'],
  points: ['symbol'],
  censor: ['censor'],
  line: ['line'],
  center: ['line'],
  errorbar: ['error'],
  polygon: ['polygon'],
  arrow: ['line', 'head'],
}

const mv = (k: MatrixKind): k is MvKind => k.startsWith('mv')
const FRAMES_CHECKED: Frame[] = ['category', 'grouped', 'xy']

describe('legend samples are of layers drawing the data set (generated from the matrix)', () => {
  for (const kind of MATRIX_KINDS)
    for (const frame of FRAMES[kind].filter((f) => FRAMES_CHECKED.includes(f))) {
      // Graphs of variables' points are mapped (their legend is the variables'): left out on XY.
      if (frame === 'xy' && (kind === 'multipleVariables' || mv(kind))) continue
      const table = mv(kind) ? sampleVariables() : sampleTable(kind as TableKind)
      const mapping = mv(kind) ? sampleMapping(kind, frame) : undefined
      const specs = specsFor(kind, frame).filter((s) => s.stat !== 'result' && s.stat !== 'dotplot')
      it(`${kind} ${frame}`, () => {
        const wrong: string[] = []
        for (let i = 0; i < specs.length; i++)
          for (let j = i; j < specs.length; j++) {
            const [one, two] = [
              layerOf('one', specs[i]!, kind, frame),
              layerOf('two', specs[j]!, kind, frame),
            ]
            const check = checkLayers({ frame, layers: [one, two] }, kind, { raw: true })
            if (![...check.values()].every((x) => x.allowed)) continue
            const g = pairGraph(table, frame, one, two, mapping ? { mapping } : {})
            const scene = lay(table, g)
            const what = `${one.geom}(${one.stat.kind}) + ${two.geom}(${two.stat.kind})`
            const glyphs = [one, two].map((l) => LEGEND_GLYPHS[l.geom])
            for (const key of seriesKeys(table, g)) {
              if (!flatten(scene.root).some((n) => n.id === `legend/${key}/label`)) continue
              const parts = sampleGlyphs(scene, key)
              const allowed = new Set(glyphs.flatMap((x) => (x ? PARTS[x] : [])))
              for (const p of parts) if (!allowed.has(p)) wrong.push(`${what}: ${key}'s ${p}`)
              if (glyphs.some((x) => x) && !parts.size) wrong.push(`${what}: ${key} has none`)
            }
          }
        expect(wrong).toEqual([])
      })
    }
})

describe('picking the glyph', () => {
  const table = sampleTable('column')
  const layer = (id: string, geom: Layer['geom'], visible = true): Layer =>
    ({
      ...layerOf(
        id,
        { geom, stat: geom === 'points' ? 'identity' : 'summary' },
        'column',
        'category',
      ),
      ...(visible ? {} : { visible: false }),
    }) as Layer
  const of = (layers: Layer[]) => {
    const g = pairGraph(table, 'category', layers[0]!, layers[1]!)
    const graph = { ...g, layers }
    return sampleGlyphs(lay(table, graph), seriesKeys(table, graph)[0]!)
  }

  it('by kind, whatever the layers’ order: error bars before a centre line', () => {
    const glyph = of([layer('e', 'errorbar'), layer('c', 'center')])
    expect([...glyph]).toEqual(['error'])
    expect([...of([layer('c', 'center'), layer('e', 'errorbar')])]).toEqual(['error'])
  })

  it('a hidden points layer’s symbol only when no layer draws the data set', () => {
    expect([...of([layer('p', 'points', false), layer('c', 'center')])]).toEqual(['line'])
    expect([...of([layer('p', 'points', false), layer('c', 'center', false)])]).toEqual(['symbol'])
  })

  it('every glyph has a place in the precedence', () => {
    for (const g of Object.values(LEGEND_GLYPHS)) if (g) expect(GLYPH_PRECEDENCE).toContain(g)
  })
})
