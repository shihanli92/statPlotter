import {
  type DataTable,
  type Frame,
  type GraphNode,
  type Layer,
  type LayoutNode,
  type NodeId,
  newLayoutItemId,
  type VariableMapping,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  checkLayers,
  FRAMES,
  layoutGraph,
  layoutPage,
  MATRIX_KINDS,
  type MatrixKind,
  type MvKind,
  type Scene,
  type SceneNode,
  sceneToPdf,
  sceneToSvg,
} from '../src/index.ts'
import { fonts, projectOf, sampleMapping, sampleTable, sampleVariables } from './helpers.ts'
import { slopedLayer } from './identityLineCases.ts'
import { readPdf, streamText } from './pdfRead.ts'
import {
  layerOf,
  type Mark,
  paintOrder,
  pairGraph,
  seriesKeys,
  specsFor,
  ZORDER_ANALYSIS,
  ZORDER_RESULT,
} from './zorder.ts'

// Layer order (roadmap 33e, the z-order audit), generated from the compatibility matrix: for every
// table kind, every frame it allows and every pair of (geom, stat) layers the matrix allows
// together there, both orders of the pair are drawn, and the scene's paint order (document order)
// must follow the list — every mark of the layer behind before every mark of the layer in front.
// Everything that isn't a layer (axes, grid, legend, brackets, point labels, the difference axis,
// colour scales, dendrograms) keeps its place, and brackets and point labels stay on top.

/** Every pair of specs (each with itself too). */
function pairs<T>(xs: readonly T[]): [T, T][] {
  const out: [T, T][] = []
  for (let i = 0; i < xs.length; i++) for (let j = i; j < xs.length; j++) out.push([xs[i]!, xs[j]!])
  return out
}

interface Case {
  name: string
  /** The table kind, or a graph of variables' kind (roadmap 34a). */
  kind: MatrixKind
  table: DataTable
  /** A graph of variables' mapping. */
  mapping?: VariableMapping
  frame: Frame
  /** The two layers, ids `one` and `two`. */
  one: Layer
  two: Layer
  horizontal: boolean
}

/** Whether a layer can carry an attached one (error bars on bars; labels on bars, tiles, slices). */
function hosts(host: Layer, l: Layer): boolean {
  if (l.geom === 'errorbar') return host.geom === 'bar' && host.stat.kind === 'summary'
  if (l.geom === 'label') return ['bar', 'tile', 'wedge'].includes(host.geom)
  return false
}

/** A pair's variants: apart, attached either way where one can host the other, bars stacked. */
function variants(one: Layer, two: Layer, frame: Frame): [string, Layer, Layer][] {
  const out: [string, Layer, Layer][] = [['', one, two]]
  if (hosts(one, two)) out.push([', attached', one, { ...two, on: one.id } as Layer])
  if (hosts(two, one)) out.push([', attached', { ...one, on: two.id } as Layer, two])
  if (frame === 'grouped') {
    const stack = (l: Layer) =>
      l.geom === 'bar' ? ({ ...l, position: { kind: 'stack' } } as Layer) : l
    for (const [what, a, b] of [...out])
      if (a.geom === 'bar' || b.geom === 'bar') out.push([`${what}, stacked`, stack(a), stack(b)])
  }
  return out
}

const mvKind = (k: MatrixKind): k is MvKind => k.startsWith('mv')

/**
 * The cases: table kind (and graph of variables by its axes' types) × frame × pair × variant (×
 * orientation on category and grouped).
 */
function cases(): Case[] {
  const out: Case[] = []
  for (const kind of MATRIX_KINDS) {
    const table = mvKind(kind) ? sampleVariables() : sampleTable(kind)
    for (const frame of FRAMES[kind]) {
      const mapping = mvKind(kind) ? sampleMapping(kind, frame) : undefined
      const at = { kind, table, frame, ...(mapping ? { mapping } : {}) }
      for (const [a, b] of pairs(specsFor(kind, frame))) {
        const base = `${kind} ${frame}: ${a.geom}(${a.stat}) + ${b.geom}(${b.stat})`
        // A dot plot (roadmap 34g) needs a text variable to group by: the table with text ones.
        const dots = a.stat === 'dotplot' || b.stat === 'dotplot'
        const on = dots && !mvKind(kind) ? { ...at, table: sampleVariables() } : at
        const pair = variants(layerOf('one', a, kind, frame), layerOf('two', b, kind, frame), frame)
        for (const [what, one, two] of pair) {
          // Pairs the graph's own rules refuse (one difference or tile per graph, labels of a
          // heat map off its tiles, points on stacks…) aren't drawn together.
          const check = checkLayers({ frame, layers: [one, two] }, kind, { raw: true })
          if (![...check.values()].every((x) => x.allowed)) continue
          const name = base + what
          out.push({ ...on, name, one, two, horizontal: false })
          if (frame === 'category' || frame === 'grouped')
            out.push({ ...on, name: `${name}, horizontal`, one, two, horizontal: true })
        }
      }
    }
  }
  return out
}

const CASES = cases()

const lay = (table: DataTable, graph: GraphNode) =>
  layoutGraph({
    project: projectOf(table, graph),
    graph,
    fonts,
    // Roadmap 35: the values result layers read.
    result: (id) => (id === ZORDER_ANALYSIS ? ZORDER_RESULT : undefined),
  })

/** Not a layer's: the plot's furniture, in its fixed place. */
const furniture = (m: Mark) => m.layer === undefined

/** Groups always drawn over every layer's marks. */
const ON_TOP = ['annotations', 'pointLabels']

/** Checks one order: `back`'s marks all before `front`'s; the rest where it always is. */
function expectOrder(scene: Scene, back: string, front: string, what: string) {
  const marks = paintOrder(scene)
  const at = (id: string) => marks.flatMap((m, i) => (m.layer === id ? [i] : []))
  const b = at(back)
  const f = at(front)
  expect(b.length, `${what}: ${back} draws marks`).toBeGreaterThan(0)
  expect(f.length, `${what}: ${front} draws marks`).toBeGreaterThan(0)
  const lastBack = Math.max(...b)
  const firstFront = Math.min(...f)
  expect(
    lastBack < firstFront,
    `${what}: ${marks[lastBack]!.id} (${back}) is drawn after ${marks[firstFront]!.id} (${front})`,
  ).toBe(true)
  // Point labels and brackets over every layer's marks.
  const lastMark = Math.max(lastBack, ...f)
  marks.forEach((m, i) => {
    if (ON_TOP.some((t) => m.top === t || m.id.startsWith(`${t}/`)) && furniture(m))
      expect(i, `${what}: ${m.id} over the layers`).toBeGreaterThan(lastMark)
  })
}

/** The plot's furniture (everything not a layer's), in paint order. */
const furnitureOf = (scene: Scene) =>
  paintOrder(scene)
    .filter(furniture)
    .map((m) => m.id)

describe('layer order, generated from the matrix (drawing by layer)', () => {
  it('covers every frame of every table kind and graph of variables', () => {
    for (const kind of MATRIX_KINDS)
      for (const frame of FRAMES[kind])
        expect(
          CASES.some((c) => c.kind === kind && c.frame === frame),
          `${kind} ${frame}`,
        ).toBe(true)
  })

  it('xy: a function’s line and the table’s layers, both ways round', () => {
    const table = sampleTable('xy')
    const fn: Layer = {
      id: 'one',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'functions',
        functions: [
          { id: 'f1', equation: 'straight-line', params: { Slope: 2, YIntercept: 1 } },
        ] as never,
      },
    }
    for (const spec of specsFor('xy', 'xy')) {
      const two = layerOf('two', spec, 'xy', 'xy')
      const what = `function + ${spec.geom}(${spec.stat})`
      expectOrder(lay(table, pairGraph(table, 'xy', fn, two)), 'one', 'two', what)
      expectOrder(lay(table, pairGraph(table, 'xy', two, fn)), 'two', 'one', what)
    }
  })

  // Roadmap 36: lines and bands at typed values are the result stat's geoms with a `values`
  // source: in the list's order with every layer of every frame they are drawn on.
  it.each([
    ['column', 'category'],
    ['grouped', 'grouped'],
    ['xy', 'xy'],
  ] as const)(
    'typed-in lines and bands with the layers of %s tables (%s), both ways round',
    (kind, frame) => {
      const table = sampleTable(kind)
      const typed = (geom: 'refline' | 'band'): Layer =>
        ({
          id: 'one',
          geom,
          stat:
            geom === 'band'
              ? {
                  kind: 'result',
                  fields: {
                    lo: { ref: { from: 'number', v: 12 } },
                    hi: { ref: { from: 'number', v: 18 } },
                  },
                  lo: 'lo',
                  hi: 'hi',
                }
              : { kind: 'result', fields: { at: { ref: { from: 'number', v: 15 } } }, at: 'at' },
          data: { from: 'values' },
        }) as Layer
      for (const geom of ['refline', 'band'] as const)
        for (const spec of specsFor(kind, frame)) {
          if (spec.stat === 'result') continue
          const two = layerOf('two', spec, kind, frame)
          const one = typed(geom)
          if (
            ![...checkLayers({ frame, layers: [one, two] }, kind, { raw: true }).values()].every(
              (x) => x.allowed,
            )
          )
            continue
          for (const horizontal of frame === 'xy' ? [false] : [false, true]) {
            const what = `typed ${geom} + ${spec.geom}(${spec.stat})${horizontal ? ', horizontal' : ''}`
            expectOrder(
              lay(table, pairGraph(table, frame, one, two, { horizontal })),
              'one',
              'two',
              what,
            )
            expectOrder(
              lay(table, pairGraph(table, frame, two, one, { horizontal })),
              'two',
              'one',
              what,
            )
          }
        }
    },
  )

  // Roadmap 46b: an identity line (y = a·x + b, typed values) with every layer of every frame
  // with two continuous axes.
  it.each([
    ['xy', 'xy'],
    ['survival', 'xy'],
  ] as const)(
    'an identity line with the layers of %s tables (%s), both ways round',
    (kind, frame) => {
      const table = sampleTable(kind)
      // Through the sample data: y = x on the XY table, falling across the survival curves.
      const one = kind === 'xy' ? slopedLayer('one') : slopedLayer('one', -10, 100)
      for (const spec of specsFor(kind, frame)) {
        if (spec.stat === 'result') continue
        const two = layerOf('two', spec, kind, frame)
        if (
          ![...checkLayers({ frame, layers: [one, two] }, kind, { raw: true }).values()].every(
            (x) => x.allowed,
          )
        )
          continue
        const what = `identity line + ${spec.geom}(${spec.stat})`
        expectOrder(lay(table, pairGraph(table, frame, one, two)), 'one', 'two', what)
        expectOrder(lay(table, pairGraph(table, frame, two, one)), 'two', 'one', what)
      }
    },
  )

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (name, c) => {
    const { one, two } = c
    const opts = { horizontal: c.horizontal, ...(c.mapping ? { mapping: c.mapping } : {}) }
    const ab = lay(c.table, pairGraph(c.table, c.frame, one, two, opts))
    const ba = lay(c.table, pairGraph(c.table, c.frame, two, one, opts))
    expectOrder(ab, 'one', 'two', `${name}, ${one.geom} behind`)
    expectOrder(ba, 'two', 'one', `${name}, ${two.geom} behind`)
    // Swapping two layers moves only their marks: the furniture is the same, in the same order.
    expect(furnitureOf(ba)).toEqual(furnitureOf(ab))
  })
})

describe('every surface draws the scene’s order', () => {
  // A few reordered pairs, each frame's: the SVG writer and the PDF writer (alone and on a layout
  // page) must paint in the scene's order. The canvas, previews, raster export and copies draw
  // `sceneToSvg` / `SceneSvg` of the same scene, the desktop pasteboard `sceneToPdf`.
  const PAIRS = [
    'column category: points(identity) + connector(identity)',
    'column category: points(identity) + refline(summary)',
    'grouped grouped: points(identity) + bar(summary)',
    'xy xy: line(summary) + band(summary)',
    'survival xy: step(km) + band(km)',
    'contingency matrix: tile(cell) + label(cell), attached',
    'partsOfWhole polar: wedge(fraction) + label(fraction), attached',
  ]
  const RED = '#ff0000'
  const BLUE = '#0000ff'
  /** The scene with each layer's marks stroked and filled in its own colour (one red, two blue). */
  const recolour = (n: SceneNode, layer?: string): SceneNode => {
    const l = n.layer ?? layer
    const c = l === 'one' ? RED : l === 'two' ? BLUE : undefined
    let prim = n.prim
    if (prim && c) {
      const p = { ...prim } as Record<string, unknown>
      if (p.stroke) p.stroke = { ...(p.stroke as object), color: c }
      if (p.fill) p.fill = { ...(p.fill as object), color: c }
      if (p.type === 'text') p.color = c
      prim = p as SceneNode['prim']
    }
    return {
      ...n,
      ...(prim ? { prim } : {}),
      ...(n.children ? { children: n.children.map((k) => recolour(k, l)) } : {}),
    }
  }
  /** The layers' colours in a PDF's content streams, in order (repeats merged). */
  const pdfOrder = (bytes: Uint8Array) => {
    const out: string[] = []
    for (const o of readPdf(bytes).objects.values()) {
      if (!o.stream) continue
      for (const m of streamText(o).matchAll(/(1 0 0|0 0 1) (?:rg|RG)\b/g)) {
        const l = m[1] === '1 0 0' ? 'one' : 'two'
        if (out.at(-1) !== l) out.push(l)
      }
    }
    return out
  }
  /** The ids an SVG writes, in order. */
  const svgIds = (svg: string) => [...svg.matchAll(/data-id="([^"]*)"/g)].map((m) => m[1]!)

  it.each(PAIRS)('%s', (name) => {
    const c = CASES.find((x) => x.name === name)
    expect(c, name).toBeDefined()
    const { table, frame, one, two } = c!
    for (const [back, front, graph] of [
      ['one', 'two', pairGraph(table, frame, one, two)],
      ['two', 'one', pairGraph(table, frame, two, one)],
    ] as const) {
      const scene = lay(table, graph)
      const painted = paintOrder(scene)
      // SVG: every drawn node in the scene's order.
      const ids = svgIds(sceneToSvg(scene))
      const drawn = painted.map((m) => m.id).filter((id) => ids.includes(id))
      expect(ids.filter((id) => drawn.includes(id))).toEqual(drawn)
      // PDF: the layer behind painted first, then the one in front, never back again.
      const coloured = { ...scene, root: recolour(scene.root) }
      expect(pdfOrder(sceneToPdf(coloured, fonts, { compress: false }))).toEqual([back, front])
      // On a layout page.
      const layout: LayoutNode = {
        kind: 'layout',
        id: 'p1' as NodeId,
        name: 'Page',
        page: { width: 612, height: 792 },
        items: [{ type: 'graph', id: newLayoutItemId(), graph: graph.id, x: 36, y: 36, scale: 1 }],
        panelLabels: { show: false, style: 'A', size: 14 },
      }
      const page = layoutPage({ project: projectOf(table, graph, layout), layout, fonts })
      const pageColoured = { ...page, root: recolour(page.root) }
      expect(pdfOrder(sceneToPdf(pageColoured, fonts, { compress: false }))).toEqual([back, front])
      expect(
        paintOrder(page)
          .filter((m) => m.layer)
          .map((m) => m.layer),
      ).toEqual(painted.filter((m) => m.layer).map((m) => m.layer))
    }
  })
})

describe('layer order drawing by data set (migrated v1 graphs)', () => {
  /** The layers in each data set's group (`series/<key>`), in the order their marks are drawn. */
  const groups = (scene: Scene) => {
    const out = new Map<string, string[]>()
    for (const m of paintOrder(scene)) {
      if (!m.group || !m.layer) continue
      const list = out.get(m.group) ?? []
      if (list.at(-1) !== m.layer) list.push(m.layer)
      out.set(m.group, list)
    }
    return out
  }
  const both = (order: string[]) => order.includes('one') && order.includes('two')
  const flat = CASES.filter((c) => !c.horizontal)

  it.each(flat.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const { one, two } = c
    const mapped = c.mapping ? { mapping: c.mapping } : {}
    const plain = pairGraph(c.table, c.frame, one, two, { drawOrder: 'series', ...mapped })
    const first = `series/${seriesKeys(c.table, plain)[0]}`
    const lists = groups(lay(c.table, plain))
    // Without an order of its own, each data set draws its layers in the list's order (v1's 100%
    // bars: each segment, then its label inside it).
    const segments = c.table.tableKind === 'partsOfWhole' && c.frame === 'category'
    for (const [g, order] of lists)
      if (both(order)) expect(order.join(), g).toMatch(segments ? /^(one,two,?)+$/ : /^one,two$/)
    // The first data set's own order (front to back) puts `one` in front of `two`; the others
    // keep the list's.
    const graph = pairGraph(c.table, c.frame, one, two, {
      drawOrder: 'series',
      order: ['one', 'two'],
      ...mapped,
    })
    for (const [g, order] of groups(lay(c.table, graph)))
      if (both(order))
        expect(order.join(), g).toMatch(
          g === first ? /^two,one$/ : segments ? /^(one,two,?)+$/ : /^one,two$/,
        )
  })

  // The frame's own planes (bands, curves, before-after lines, the grand mean, differences, a
  // heat map's values) stay beneath the data sets' groups as v1 drew them, unless moved to the
  // top of the list: then they are drawn over them.
  const FRAME_DRAWN = [
    'column category: points(identity) + connector(identity)',
    'column category: points(identity) + refline(summary)',
    'column category: points(identity) + difference(difference)',
    'xy xy: points(summary) + area(summary)',
    'xy xy: line(summary) + band(summary)',
    'survival xy: step(km) + band(km)',
    'contingency matrix: tile(cell) + label(cell), attached',
  ]
  it.each(FRAME_DRAWN)('%s: beneath the data sets, or over them on top', (name) => {
    const c = CASES.find((x) => x.name === name)!
    expect(c, name).toBeDefined()
    const { table, frame, one, two } = c
    const series = { drawOrder: 'series' } as const
    expectOrder(lay(table, pairGraph(table, frame, one, two, series)), 'one', 'two', name)
    expectOrder(lay(table, pairGraph(table, frame, two, one, series)), 'two', 'one', name)
  })

  it('a function’s line beneath the data sets, or over them on top', () => {
    const table = sampleTable('xy')
    const fn: Layer = {
      id: 'one',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'functions',
        functions: [
          { id: 'f1', equation: 'straight-line', params: { Slope: 2, YIntercept: 1 } },
        ] as never,
      },
    }
    const points = layerOf('two', { geom: 'points', stat: 'summary' }, 'xy', 'xy')
    const series = { drawOrder: 'series' } as const
    expectOrder(lay(table, pairGraph(table, 'xy', fn, points, series)), 'one', 'two', 'under')
    expectOrder(lay(table, pairGraph(table, 'xy', points, fn, series)), 'two', 'one', 'over')
  })
})
