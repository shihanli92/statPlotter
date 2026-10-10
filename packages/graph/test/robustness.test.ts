import type {
  ContinuousAxisSpec,
  DataTable,
  Frame,
  GraphNode,
  Layer,
  NodeId,
  TableKind,
  VariableMapping,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import {
  checkLayers,
  FRAMES,
  layoutGraph,
  lookFor,
  MATRIX_KINDS,
  type MatrixKind,
  type MvKind,
  newGraphNode,
  presetGraph,
  type Scene,
  type SceneNode,
  sceneToPdf,
  sceneToSvg,
} from '../src/index.ts'
import {
  appearanceTable,
  fonts,
  projectOf,
  sampleMapping,
  sampleTable,
  sampleVariables,
} from './helpers.ts'
import { slopedLayer } from './identityLineCases.ts'
import { readPdf } from './pdfRead.ts'
import {
  layerOf,
  type Spec,
  seriesKeys,
  specsFor,
  ZORDER_ANALYSIS,
  ZORDER_RESULT,
} from './zorder.ts'

// Audit 2 (G18): robustness, generated from the matrix. Every (geom, stat) the matrix allows on
// every frame of every table kind (and graph of variables) is laid out with degenerate data (no
// rows, one row, every value equal, every value empty, ±huge values) and degenerate axes (a log
// axis over zeros and negatives, a break inside the data, a reversed range, a range of no width),
// and written as SVG and PDF. Nothing may throw, and no number in the scene, the SVG or the PDF
// may be NaN or infinite. The scene is checked as laid out, before the writers' filter
// (`render/finite.ts`) drops what isn't finite, so a mark letting a NaN through fails here
// instead of silently disappearing from the export.
//
// The layers of a frame are drawn together, as many to a graph as the graph's rules allow
// (`checkLayers`), to keep the run short; a failing graph is then laid out a layer at a time to
// name the layer at fault.

const mvKind = (k: MatrixKind): k is MvKind => k.startsWith('mv')

// --- degenerate data ------------------------------------------------------------------------

type Role = 'x' | 'y'
type NumberMap = (v: number, role: Role, row: number) => number | null

/** A table with only `rows` of its rows (in that order), its numbers mapped by `num`. */
function reshape(
  t: DataTable,
  rows: readonly number[],
  num: NumberMap = (v) => v,
  text: (s: string, row: number) => string | null = (s) => s,
): DataTable {
  // Survival tables' Y are event codes (1 event, 0 censored): kept as codes.
  const yMap: NumberMap =
    t.tableKind === 'survival' ? (v, _role, r) => (num(v, 'y', r) === null ? null : v) : num
  const pick = <T, U>(xs: readonly T[], f: (v: T, r: number) => U): U[] =>
    rows.map((r) => f(xs[r] as T, r))
  const cells = (values: readonly (number | null)[], m: NumberMap, role: Role) =>
    pick(values, (v, r) => (v === null || v === undefined ? null : m(v, role, r)))
  return {
    ...t,
    rowCount: rows.length,
    rowTitles: t.rowTitles ? pick(t.rowTitles, (v) => v ?? null) : t.rowTitles,
    x: t.x
      ? {
          ...t.x,
          subcolumns: t.x.subcolumns.map((c) => ({ ...c, values: cells(c.values, num, 'x') })),
        }
      : t.x,
    dataSets: t.dataSets.map((d) => ({
      ...d,
      subcolumns: d.subcolumns.map((c) => ({ ...c, values: cells(c.values, yMap, 'y') })),
      ...(d.text ? { text: pick(d.text, (s, r) => (s === null ? null : text(s, r))) } : {}),
    })),
  }
}

const allRows = (t: DataTable) => Array.from({ length: t.rowCount }, (_, r) => r)

interface DataVariant {
  name: string
  table: (t: DataTable) => DataTable
}

const DATA: DataVariant[] = [
  { name: 'no rows', table: (t) => reshape(t, []) },
  { name: 'one row', table: (t) => reshape(t, [0]) },
  { name: 'every value equal', table: (t) => reshape(t, allRows(t), () => 5) },
  {
    name: 'every value empty',
    table: (t) =>
      reshape(
        t,
        allRows(t),
        () => null,
        () => null,
      ),
  },
  {
    name: 'one value, the rest empty',
    table: (t) => reshape(t, allRows(t), (v, _role, r) => (r === 0 ? v : null)),
  },
  {
    name: '±huge values',
    table: (t) => reshape(t, allRows(t), (v, _role, r) => (r % 2 ? -1 : 1) * (1 + v) * 1e300),
  },
  {
    name: 'tiny values',
    table: (t) => reshape(t, allRows(t), (v, _role, r) => (r % 2 ? -1 : 1) * (1 + v) * 1e-300),
  },
]

// --- degenerate axes ------------------------------------------------------------------------

interface AxisVariant {
  name: string
  /** The table drawn (default: as it is). */
  table?: (t: DataTable) => DataTable
  /** A continuous axis changed, given its automatic range as drawn. */
  axis: (a: ContinuousAxisSpec, lo: number, hi: number) => ContinuousAxisSpec
}

const AXES: AxisVariant[] = [
  {
    name: 'a log axis over zeros and negatives',
    // Every third value 0, every third negative.
    table: (t) => reshape(t, allRows(t), (v, _role, r) => (r % 3 === 0 ? 0 : r % 3 === 1 ? -v : v)),
    axis: (a) => ({ ...a, scale: 'log10' }),
  },
  {
    name: 'a break inside the data',
    axis: (a, lo, hi) => ({
      ...a,
      breaks: [{ from: lo + 0.4 * (hi - lo), to: lo + 0.6 * (hi - lo), gap: 8 }],
    }),
  },
  { name: 'a reversed range', axis: (a, lo, hi) => ({ ...a, range: { min: hi, max: lo } }) },
  { name: 'a range of no width', axis: (a, lo) => ({ ...a, range: { min: lo, max: lo } }) },
]

/** The automatic range of a scene's axis, as drawn (null: no continuous axis). */
function drawnRange(scene: Scene, which: 'x' | 'y'): [number, number] | null {
  const axis = scene.axes?.[which]
  if (!axis || axis.categorical) return null
  const p = scene.plot
  const [a, b] =
    which === 'x'
      ? [axis.fromPx(p.x), axis.fromPx(p.x + p.w)]
      : [axis.fromPx(p.y + p.h), axis.fromPx(p.y)]
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)]
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

/**
 * The continuous axes of a graph with their ranges as drawn in a scene of it. Off XY, the graph's
 * one value axis is the scene's continuous one (across the scene when the graph is turned).
 */
function valueAxes(g: GraphNode, scene: Scene): [keyof GraphNode['axes'], number, number][] {
  const across = scene.axes?.x.categorical === false ? 'x' : 'y'
  return (['x', 'y'] as const).flatMap((which) => {
    const range = drawnRange(scene, g.frame === 'xy' ? which : across)
    return g.axes[which].type === 'continuous' && range ? [[which, ...range]] : []
  })
}

/** A graph with `variant` applied to each of its continuous axes, given a scene of it. */
function withAxes(g: GraphNode, scene: Scene, variant: AxisVariant): GraphNode {
  const axes = { ...g.axes }
  for (const [which, lo, hi] of valueAxes(g, scene))
    axes[which] = variant.axis(axes[which] as ContinuousAxisSpec, lo, hi)
  return { ...g, axes }
}

// --- the checks -----------------------------------------------------------------------------

/** Where a value holds a number that isn't finite (paths into it), typed arrays included. */
function nonFinite(v: unknown, at: string, out: string[]): void {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(`${at} = ${v}`)
  } else if (v instanceof Float64Array || v instanceof Float32Array) {
    const i = v.findIndex((x) => !Number.isFinite(x))
    if (i >= 0) out.push(`${at}[${i}] = ${v[i]}`)
  } else if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) nonFinite(x, `${at}[${i}]`, out)
  } else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
    // An image's asset is bytes and their description, not geometry.
    for (const [k, x] of Object.entries(v)) if (k !== 'asset') nonFinite(x, `${at}.${k}`, out)
  }
}

/** Every non-finite number of a scene as laid out: its size, plot, nodes' places and marks. */
function sceneNonFinite(scene: Scene): string[] {
  const out: string[] = []
  nonFinite({ width: scene.width, height: scene.height, plot: scene.plot }, 'scene', out)
  const walk = (n: SceneNode) => {
    const { bbox, transform, labelOffset, prim } = n
    nonFinite({ bbox, transform, labelOffset, prim }, n.id, out)
    for (const c of n.children ?? []) walk(c)
  }
  walk(scene.root)
  return out
}

const BAD = /NaN|Infinity/
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

/** The PDF's objects and content holding "NaN" or "Infinity" (font programs and images not read). */
function pdfNonFinite(bytes: Uint8Array): string[] {
  const out: string[] = []
  for (const [id, o] of readPdf(bytes).objects) {
    if (BAD.test(o.dict)) out.push(`object ${id}'s dictionary`)
    const binary = /\/Length1 |\/Subtype \/Image/.test(o.dict)
    if (o.stream && !binary && BAD.test(latin1(o.stream))) out.push(`object ${id}'s stream`)
  }
  return out
}

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutGraph({
    project: projectOf(table, graph),
    graph,
    fonts,
    result: (id) => (id === ZORDER_ANALYSIS ? ZORDER_RESULT : undefined),
  })

/** What is wrong with drawing a graph of a table: a throw, or numbers that aren't finite. */
function problems(table: DataTable, graph: GraphNode): string[] {
  // The writers report a primitive they drop in development: none may be dropped.
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const scene = lay(table, graph)
    const out = sceneNonFinite(scene).map((s) => `scene: ${s}`)
    if (BAD.test(sceneToSvg(scene))) out.push('the SVG holds NaN or Infinity')
    out.push(...pdfNonFinite(sceneToPdf(scene, fonts, { compress: false })).map((s) => `PDF: ${s}`))
    for (const [m] of report.mock.calls) out.push(`reported: ${m}`)
    return out
  } catch (e) {
    return [`threw ${(e as Error).stack?.split('\n').slice(0, 3).join(' ← ')}`]
  } finally {
    report.mockRestore()
  }
}

// --- the graphs -----------------------------------------------------------------------------

/** The specs of a frame in groups the graph's rules allow drawn together. */
function packs(kind: MatrixKind, frame: Frame, specs: readonly Spec[]): Layer[][] {
  const out: Layer[][] = []
  specs.forEach((spec, i) => {
    const layer = layerOf(`l${i}`, spec, kind, frame)
    const fits = (pack: Layer[]) =>
      [...checkLayers({ frame, layers: [...pack, layer] }, kind, { raw: true }).values()].every(
        (x) => x.allowed,
      )
    const pack = out.find(fits)
    if (pack) pack.push(layer)
    else out.push([layer])
  })
  return out
}

interface Case {
  name: string
  table: DataTable
  graph: GraphNode
}

/** A graph of the sample table drawing these layers, with a legend and point labels. */
function graphOf(kind: MatrixKind, frame: Frame, table: DataTable, layers: Layer[]): GraphNode {
  const mapping = mvKind(kind) ? sampleMapping(kind, frame) : undefined
  const g = newGraphNode(table, {
    frame,
    look: lookFor(frame, layers),
    layers,
    ...(mapping ? { mapping } : {}),
  })
  const first = seriesKeys(table, g)[0]
  return {
    ...g,
    id: 'g1' as NodeId,
    legend: { ...g.legend, show: true },
    seriesOverrides: first ? { [first]: { pointLabels: { source: 'y', which: 'all' } } } : {},
  }
}

/** Every frame of every kind: its graphs of packed layers, upright and (category, grouped) turned. */
function cases(): Case[] {
  const out: Case[] = []
  for (const kind of MATRIX_KINDS)
    for (const frame of FRAMES[kind]) {
      const specs = specsFor(kind, frame)
      // A dot plot (roadmap 34g) groups by a text variable: on the table with text ones.
      const dots = specs.filter((s) => s.stat === 'dotplot')
      const rest = specs.filter((s) => s.stat !== 'dotplot')
      const sample = mvKind(kind) ? sampleVariables() : sampleTable(kind as TableKind)
      const groups: [DataTable, Spec[]][] = [[sample, rest]]
      if (dots.length) groups.push([mvKind(kind) ? sample : sampleVariables(), dots])
      let n = 0
      for (const [table, group] of groups)
        for (const layers of packs(kind, frame, group)) {
          const graph = graphOf(kind, frame, table, layers)
          const name = `${kind} ${frame} #${++n}`
          out.push({ name, table, graph })
          if (frame === 'category' || frame === 'grouped')
            out.push({
              name: `${name}, horizontal`,
              table,
              graph: { ...graph, style: { ...graph.style, orientation: 'horizontal' } },
            })
        }
    }
  return out
}

/**
 * Variables mapped to the points' appearance (roadmap 34b): colour and size by numbers, colour
 * and shape by text, with labels; on an XY graph of variables and by group (category, grouped).
 */
function appearanceCases(): Case[] {
  const table = appearanceTable()
  const xy = (aes: NonNullable<Layer['aes']>): GraphNode => {
    const g = presetGraph(table, 'bubble')
    const layers = g.layers.map((l) =>
      l.aes ? ({ ...l, aes: { x: 'c', y: 'd', ...aes } } as Layer) : l,
    )
    return { ...g, id: 'g1' as NodeId, layers, legend: { ...g.legend, show: true } }
  }
  const byGroup = (preset: string, mapping: VariableMapping): GraphNode => {
    const g = presetGraph(table, preset, undefined, { mapping })
    return { ...g, id: 'g1' as NodeId, legend: { ...g.legend, show: true } }
  }
  return [
    ['XY, colour and size by numbers', xy({ color: 'e', size: 'e', label: 'e' })],
    ['XY, colour and shape by text', xy({ color: 'f', shape: 'f', size: 'd', label: 'f' })],
    [
      'by group, colour and size by numbers',
      byGroup('groupBoxPoints', { x: 'a', y: 'c', color: 'e', size: 'd', label: 'e' }),
    ],
    [
      'grouped, shape by text',
      byGroup('barsPoints', { x: 'a', y: 'c', color: 'b', shape: 'f', size: 'e' }),
    ],
  ].map(([name, graph]) => ({ name: `appearance: ${name}`, table, graph: graph as GraphNode }))
}

/**
 * Roadmap 46b: identity and reference lines (y = x, y = −2x + 3) on every frame with two
 * continuous axes, with the frame's points, labelled at their end and in the legend.
 */
function identityCases(): Case[] {
  const lines = [
    slopedLayer('identity', 1, 0, { template: 'y = x', lineLabel: 'end', legend: 'auto' }),
    slopedLayer('ref', -2, 3, { template: 'Ref', lineLabel: 'start', legend: 'auto' }),
  ]
  return (
    [
      ['xy', sampleTable('xy'), 'meanSd'],
      ['survival', sampleTable('survival'), 'survival'],
      ['variables', sampleVariables(), 'bubble'],
    ] as const
  ).map(([name, table, preset]) => {
    const g = presetGraph(table, preset)
    return {
      name: `identity lines: ${name}`,
      table,
      graph: {
        ...g,
        id: 'g1' as NodeId,
        legend: { ...g.legend, show: true },
        layers: [...lines, ...g.layers],
      },
    }
  })
}

const CASES = [...cases(), ...appearanceCases(), ...identityCases()]

/**
 * Roadmap 47b: a legend ordered, labelled and laid out oddly — unknown and repeated keys, an empty
 * key, its entries backwards, labels empty, long or of no entry, columns filled downwards.
 */
function oddLegend(graph: GraphNode, scene: Scene): GraphNode {
  const keys = (scene.legend ?? []).map((e) => e.key)
  const [first, second] = keys
  return {
    ...graph,
    legend: {
      ...graph.legend,
      order: ['zz', ...[...keys].reverse(), ...keys, '', first ?? 'a'],
      labels: {
        nothing: [],
        ...(first ? { [first]: [] } : {}),
        ...(second ? { [second]: [{ text: 'A legend label '.repeat(8), bold: true }] } : {}),
      },
      columns: 3,
      fill: 'columns',
      reverse: true,
    },
  }
}

/** The layers at fault in a graph with problems: each laid out alone. */
function culprits(table: DataTable, graph: GraphNode): string[] {
  return graph.layers.flatMap((l) => {
    const p = problems(table, { ...graph, layers: [l] })
    return p.length ? [`${l.geom}(${l.stat.kind}): ${p.slice(0, 3).join('; ')}`] : []
  })
}

describe('robustness, generated from the matrix: degenerate data and axes', () => {
  it('covers every (geom, stat) of every frame of every kind', () => {
    for (const kind of MATRIX_KINDS)
      for (const frame of FRAMES[kind])
        for (const spec of specsFor(kind, frame))
          expect(
            CASES.some(
              (c) =>
                c.name.startsWith(`${kind} ${frame} `) &&
                c.graph.layers.some((l) => l.geom === spec.geom && l.stat.kind === spec.stat),
            ),
            `${kind} ${frame} ${spec.geom}(${spec.stat})`,
          ).toBe(true)
  })

  for (const c of CASES)
    it(c.name, () => {
      const wrong: string[] = []
      const check = (what: string, table: DataTable, graph: GraphNode) => {
        const p = problems(table, graph)
        if (!p.length) return
        const at = culprits(table, graph)
        wrong.push(`${what}: ${at.length ? at.join(' | ') : p.slice(0, 3).join('; ')}`)
      }
      check('as it is', c.table, c.graph)
      for (const v of DATA) check(v.name, v.table(c.table), c.graph)
      const scene = lay(c.table, c.graph)
      // Graphs with a value axis have it changed (both, on XY).
      const axes = valueAxes(c.graph, scene).map(([which]) => which)
      const frame = c.graph.frame
      if (frame === 'xy') expect(axes).toEqual(['x', 'y'])
      else if (frame === 'category' || frame === 'grouped') expect(axes).toEqual(['y'])
      for (const v of AXES) {
        const table = v.table ? v.table(c.table) : c.table
        check(v.name, table, withAxes(c.graph, scene, v))
      }
      check('an odd legend', c.table, oddLegend(c.graph, scene))
      expect(wrong).toEqual([])
    })
})
