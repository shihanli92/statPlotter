import {
  type Annotation,
  type AxisSpec,
  createTable,
  type GraphNode,
  type Project,
  type TextSpec,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { minstd } from '../../stats/test/rng.ts'
import {
  applyPreset,
  createGraphFor,
  decimalsFor,
  formatNumber,
  layoutGraph,
  makeAxisScale,
  matchGraphFormat,
  nodeBounds,
  presetGraph,
  presetsFor,
  richTextToString,
  type Scene,
  type SceneNode,
  scenePoint,
  sceneToSvg,
  swarmOffsets,
  tickFormatter,
} from '../src/index.ts'
import {
  byId,
  flatten,
  fonts,
  growthRatio,
  nodes,
  prim,
  projectOf,
  sampleTable,
  TABLE_KINDS,
} from './helpers.ts'

// --- Helpers -----------------------------------------------------------------------------------

const text = (n: SceneNode | undefined) =>
  prim(n, 'text')
    .layout.runs.map((r) => (r.dy < 0 ? `^${r.text}` : r.text))
    .join('')
const labels = (s: Scene, axis: 'x' | 'y') => nodes(s, `axis/${axis}/tickLabel/`).map(text)
const svgOf = (s: Scene) => sceneToSvg(s, { ids: true })

/** Every drawn element lies inside the scene (0.5 pt tolerance). */
function expectInside(scene: Scene) {
  for (const n of flatten(scene.root)) {
    if (!n.prim) continue
    const b = nodeBounds(n)
    if (!b) continue
    expect(b.x, n.id).toBeGreaterThanOrEqual(-0.5)
    expect(b.y, n.id).toBeGreaterThanOrEqual(-0.5)
    expect(b.x + b.w, n.id).toBeLessThanOrEqual(scene.width + 0.5)
    expect(b.y + b.h, n.id).toBeLessThanOrEqual(scene.height + 0.5)
  }
}

function expectClean(scene: Scene) {
  expect(sceneToSvg(scene)).not.toContain('NaN')
  expectInside(scene)
}

const plainText = (t: string): TextSpec => ({ content: [{ text: t }] })

/** A column table of these columns, graphed in a preset (default: scatter with mean ± SD). */
function column(cols: (number | null)[][], preset = 'points', titles?: string[]) {
  const rows = Math.max(...cols.map((c) => c.length))
  const table = createTable({ columns: cols.length, rows })
  cols.forEach((vals, i) => {
    table.dataSets[i]!.subcolumns[0]!.values = Array.from(
      { length: rows },
      (_, r) => vals[r] ?? null,
    )
    if (titles) table.dataSets[i]!.title = titles[i]!
  })
  const graph = presetGraph(table, preset)
  const project = projectOf(table, graph)
  return { project, table, graph }
}

function xy() {
  const table = createTable({ tableKind: 'xy', columns: 2, rows: 5 })
  table.x!.subcolumns[0]!.values = [0, 1, 2, 3, 4]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4, 5]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 4, 6, 8, 10]
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  return { project, table, graph }
}

function grouped() {
  const table = createTable({
    tableKind: 'grouped',
    yFormat: { type: 'replicates', count: 2 },
    columns: 2,
    rows: 3,
  })
  table.rowTitles = ['WT', 'KO', 'Het']
  table.dataSets.forEach((d, c) => {
    d.subcolumns.forEach((s, j) => {
      s.values = [10 + c + j, 20 + c + j, 15 + c + j]
    })
  })
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  return { project, table, graph }
}

function survival() {
  const table = createTable({ tableKind: 'survival', columns: 2, rows: 5 })
  table.x!.subcolumns[0]!.values = [2, 3, 4, 5, 6]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 0, 1, null, null]
  table.dataSets[1]!.subcolumns[0]!.values = [null, null, null, 1, 0]
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  return { project, table, graph }
}

const setAxis = (g: GraphNode, which: 'x' | 'y', patch: Record<string, unknown>): GraphNode => ({
  ...g,
  axes: { ...g.axes, [which]: { ...g.axes[which], ...patch } as AxisSpec },
})

const layout = (project: Project, graph: GraphNode) => layoutGraph({ project, graph, fonts })

// --- Number formats ----------------------------------------------------------------------------

describe('number formats', () => {
  const f = (v: number, mode: 'auto' | 'fixed' | 'scientific' | 'power10' | 'percent', o = {}) =>
    richTextToString(formatNumber(v, { mode, ...o }))

  it('formats every mode, with a true minus sign', () => {
    expect(f(1.5, 'auto')).toBe('1.5')
    expect(f(-2, 'auto')).toBe('−2')
    expect(f(2.4567, 'fixed', { digits: 2 })).toBe('2.46')
    expect(f(1500, 'scientific')).toBe('1.5e+3')
    expect(f(-0.00012, 'scientific', { digits: 2 })).toBe('−1.20e-4')
    expect(f(0.256, 'percent')).toBe('25.6%')
    expect(f(0.5, 'percent', { digits: 1 })).toBe('50.0%')
    expect(f(1234567.5, 'fixed', { digits: 1, thousands: true })).toBe('1,234,567.5')
    expect(f(-1234, 'auto', { thousands: true })).toBe('−1,234')
    expect(f(5, 'auto', { prefix: '$', suffix: ' mg' })).toBe('$5 mg')
  })

  it('power10 uses a real superscript run', () => {
    const rt = formatNumber(1200, { mode: 'power10' })
    expect(rt).toEqual([{ text: '1.2×10' }, { text: '3', sup: true }])
    expect(richTextToString(formatNumber(-0.05, { mode: 'power10', digits: 1 }))).toBe('−5.0×10^−2')
    expect(richTextToString(formatNumber(0, { mode: 'power10' }))).toBe('0')
    // On log axes an exact power prints as the bare power.
    expect(formatNumber(1000, { mode: 'power10' }, { log: 10 })).toEqual([
      { text: '10' },
      { text: '3', sup: true },
    ])
    expect(richTextToString(formatNumber(8, { mode: 'power10' }, { log: 2 }))).toBe('2^3')
  })

  it('tick formatters share decimals across ticks', () => {
    const fmt = tickFormatter({ mode: 'auto' }, [0, 0.5, 1])
    expect([0, 0.5, 1].map((v) => richTextToString(fmt(v)))).toEqual(['0.0', '0.5', '1.0'])
    const p10 = tickFormatter({ mode: 'power10' }, [1000, 1500, 2000])
    expect([1000, 1500].map((v) => richTextToString(p10(v)))).toEqual(['1.0×10^3', '1.5×10^3'])
    const pct = tickFormatter({ mode: 'percent' }, [0, 0.25, 0.5])
    expect(richTextToString(pct(0.25))).toBe('25%')
  })

  it('axis tick labels follow the format', () => {
    const { project, graph } = column([[1000, 2000, 3000]])
    const withFormat = (format: object) =>
      labels(layout(project, setAxis(graph, 'y', { format })), 'y')
    expect(withFormat({ mode: 'auto', thousands: true })).toContain('3,000')
    expect(withFormat({ mode: 'power10' })).toContain('3.0×10^3')
    expect(withFormat({ mode: 'auto', suffix: ' g' })).toContain('3000 g')
    const s = layout(project, setAxis(graph, 'y', { format: { mode: 'power10' } }))
    const sup = prim(nodes(s, 'axis/y/tickLabel/').at(-1), 'text').layout.runs[1]!
    expect(sup.dy).toBeLessThan(0)
    expect(sup.size).toBeLessThan(11)
  })

  it('a label power shows values in units of 10ⁿ', () => {
    const { project, graph } = column([[12000, 25000, 30000]])
    const at = (labelPower: number) =>
      labels(layout(project, setAxis(graph, 'y', { labelPower })), 'y')
    const plain = labels(layout(project, graph), 'y')
    expect(plain).toContain('30000')
    expect(at(4).map(Number)).toEqual(plain.map((t) => Number(t) / 1e4)) // same ticks, relabelled
    expect(at(3)).toContain('30')
    const small = column([[0.002, 0.004]])
    expect(
      labels(layout(small.project, setAxis(small.graph, 'y', { labelPower: -3 })), 'y'),
    ).toContain('4')
  })

  it('log axes print bare powers in power10 mode', () => {
    const { project, graph } = column([[1, 10, 1000, 100000]])
    const s = layout(project, setAxis(graph, 'y', { scale: 'log10', format: { mode: 'power10' } }))
    expect(labels(s, 'y')).toEqual(['10^0', '10^1', '10^2', '10^3', '10^4', '10^5'])
  })
})

// --- Scales ------------------------------------------------------------------------------------

describe('axis scales', () => {
  it('reverse flips the range', () => {
    const s = makeAxisScale('linear', [0, 10], [100, 0], { reverse: true })
    expect(s(0)).toBe(0)
    expect(s(10)).toBe(100)
    expect(s.invert(25)).toBeCloseTo(2.5, 12)
  })

  it('breaks remove an interval and leave a gap', () => {
    const s = makeAxisScale('linear', [0, 100], [210, 0], {
      breaks: [{ from: 20, to: 80, gap: 10 }],
    })
    // 40 visible units over 200 points → 5 pt per unit.
    expect(s(0)).toBeCloseTo(210, 9)
    expect(s(20)).toBeCloseTo(110, 9)
    expect(s(80)).toBeCloseTo(100, 9)
    expect(s(100)).toBeCloseTo(0, 9)
    expect(s(50)).toBeNaN()
    expect(s.edge(50)).toBeCloseTo(110, 9)
    expect(s.gaps).toEqual([[100, 110]])
    expect(s.pieces).toEqual([
      [0, 20],
      [80, 100],
    ])
    for (const v of [5, 20, 80, 95]) expect(s.invert(s(v))).toBeCloseTo(v, 9)
    // Invalid breaks are ignored.
    const plain = makeAxisScale('linear', [0, 100], [210, 0], {
      breaks: [{ from: 80, to: 20, gap: 10 }],
    })
    expect(plain.gaps).toEqual([])
  })
})

// --- Defaults ----------------------------------------------------------------------------------

describe('defaults', () => {
  it('explicit defaults render exactly like absent fields', () => {
    const cases = [
      column(
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        'bars',
      ),
      xy(),
      grouped(),
      survival(),
    ]
    for (const { project, graph } of cases) {
      const explicit: GraphNode = {
        ...graph,
        axes: {
          x: {
            ...graph.axes.x,
            show: true,
            showLabels: true,
            tickStyle: { direction: 'out', length: 4, minorLength: 2 },
            grid: {},
            titleGap: 0,
          } as AxisSpec,
          y: {
            ...graph.axes.y,
            show: true,
            tickStyle: { direction: 'out' },
            ...(graph.axes.y.type === 'continuous' ? { reverse: false } : {}),
          } as AxisSpec,
        },
        legend: { ...graph.legend, hidden: [], position: 'right' },
        style: { ...graph.style, frame: 'axes' },
      }
      expect(svgOf(layout(project, explicit))).toBe(svgOf(layout(project, graph)))
    }
  })

  it.each(TABLE_KINDS.flatMap((kind) => presetsFor(kind).map(({ id }) => ({ kind, id }))))(
    'a $kind table in the $id preset lays out cleanly',
    ({ kind, id }) => {
      const table = sampleTable(kind)
      const graph = presetGraph(table, id)
      const scene = layout(projectOf(table, graph), graph)
      expectClean(scene)
      expect(scene.warnings).toEqual([])
    },
  )
})

// --- Axes --------------------------------------------------------------------------------------

describe('axis options', () => {
  it('show: false hides line, ticks and labels but keeps the title', () => {
    const { project, graph } = xy()
    const g = setAxis(setAxis(graph, 'y', { show: false, title: plainText('Response') }), 'x', {})
    const s = layout(project, g)
    expect(nodes(s, 'axis/y/line')).toHaveLength(0)
    expect(nodes(s, 'axis/y/tick')).toHaveLength(0)
    expect(byId(s, 'axis/y/title')).toBeDefined()
    expect(s.plot.x).toBeLessThan(layout(project, setAxis(g, 'y', { show: true })).plot.x)
    expectClean(s)
  })

  it('tick direction, length and width', () => {
    const { project, graph } = xy()
    const scene = (tickStyle: object) => layout(project, setAxis(graph, 'y', { tickStyle }))
    const tick = (tickStyle: object) => {
      const s = scene(tickStyle)
      const t = prim(byId(s, 'axis/y/tick/0'), 'line')
      return { t, axisX: prim(byId(s, 'axis/y/line'), 'line').x1, s }
    }
    const out = tick({})
    expect(out.t.x2).toBeCloseTo(out.axisX - 4, 9)
    const inward = tick({ direction: 'in', length: 6, width: 2 })
    expect(inward.t.x2).toBeCloseTo(inward.axisX + 6, 9)
    expect(inward.t.stroke.width).toBe(2)
    const cross = tick({ direction: 'cross', length: 8 })
    expect(Math.min(cross.t.x1, cross.t.x2)).toBeCloseTo(cross.axisX - 4, 9)
    expect(Math.max(cross.t.x1, cross.t.x2)).toBeCloseTo(cross.axisX + 4, 9)
    expect(nodes(scene({ direction: 'none' }), 'axis/y/tick/')).toHaveLength(0)
    // Inward ticks free space outside the plot.
    expect(inward.s.plot.x).toBeLessThan(out.s.plot.x)
  })

  it('showLabels: false drops tick labels; titleGap moves the title out', () => {
    const { project, graph } = xy()
    const s = layout(project, setAxis(graph, 'y', { showLabels: false }))
    expect(labels(s, 'y')).toHaveLength(0)
    expect(nodes(s, 'axis/y/tick/').length).toBeGreaterThan(0)
    const base = layout(project, graph)
    const gapped = layout(project, setAxis(graph, 'x', { titleGap: 10 }))
    const ty = (sc: Scene) => byId(sc, 'axis/x/title')!.bbox!.y - sc.plot.y
    expect(ty(gapped) - ty(base)).toBeCloseTo(10, 9)
    expect(gapped.height - base.height).toBeCloseTo(10, 9)
  })

  it('axis line and tick-label style override the theme', () => {
    const { project, graph } = xy()
    const s = layout(
      project,
      setAxis(graph, 'x', {
        line: { color: { rgb: '#ff0000' }, width: 2 },
        tickLabels: { size: 16, bold: true },
      }),
    )
    const line = prim(byId(s, 'axis/x/line'), 'line')
    expect(line.stroke).toEqual({ color: '#ff0000', width: 2, dash: 'solid' })
    const run = prim(byId(s, 'axis/x/tickLabel/0'), 'text').layout.runs[0]!
    expect([run.size, run.bold]).toEqual([16, true])
  })

  it('rotated continuous tick labels grow the margin and stay in the scene', () => {
    const { project, graph } = xy()
    const g = setAxis(graph, 'x', { range: { min: 0, max: 100000 } })
    const flat = layout(project, g)
    for (const rotation of [45, 90]) {
      const s = layout(project, setAxis(g, 'x', { rotation }))
      expect(prim(byId(s, 'axis/x/tickLabel/1'), 'text').rotate?.angle).toBe(-rotation)
      expect(s.height).toBeGreaterThan(flat.height)
      expectClean(s)
    }
    const yRot = layout(project, setAxis(graph, 'y', { rotation: 90 }))
    expect(prim(byId(yRot, 'axis/y/tickLabel/0'), 'text').rotate?.angle).toBe(-90)
    expectClean(yRot)
  })

  it('grid lines sit behind the data at major and minor ticks', () => {
    const { project, graph } = xy()
    const stroke = { color: { rgb: '#cccccc' }, width: 0.5, dash: 'solid' as const }
    const g = setAxis(
      setAxis(graph, 'y', {
        grid: { major: stroke, minor: stroke },
        ticks: { interval: 2, minor: 1 },
      }),
      'x',
      { grid: { major: stroke } },
    )
    const s = layout(project, g)
    const ticks = nodes(s, 'axis/y/tick/')
    const majors = nodes(s, 'grid/y/major/')
    expect(majors).toHaveLength(ticks.length)
    expect(nodes(s, 'grid/y/minor/').length).toBe(nodes(s, 'axis/y/minorTick/').length)
    const gl = prim(majors[1], 'line')
    expect(gl.y1).toBeCloseTo(prim(ticks[1], 'line').y1, 9)
    expect([gl.x1, gl.x2]).toEqual([s.plot.x, s.plot.x + s.plot.w])
    expect(nodes(s, 'grid/x/major/')).toHaveLength(nodes(s, 'axis/x/tick/').length)
    const order = s.root.children!.map((c) => c.id)
    expect(order.indexOf('grid')).toBeLessThan(order.indexOf('series'))
    expect(byId(s, 'grid/y/major/0')!.target).toEqual(['axes', 'y', 'grid'])

    // Categorical axes: at category centres.
    const c = column([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
    const cs = layout(c.project, setAxis(c.graph, 'x', { grid: { major: stroke } }))
    const cg = nodes(cs, 'grid/x/major/').map((n) => prim(n, 'line').x1)
    expect(cg).toEqual(nodes(cs, 'axis/x/tick/').map((n) => prim(n, 'line').x1))
  })

  it('reverse flips the ordering', () => {
    const { project, graph, table } = xy()
    const key = table.dataSets[0]!.id
    const cy = (s: Scene, row: number) => prim(byId(s, `series/${key}/point/${row}`), 'symbol').cy
    const cx = (s: Scene, row: number) => prim(byId(s, `series/${key}/point/${row}`), 'symbol').cx
    const base = layout(project, graph)
    expect(cy(base, 4)).toBeLessThan(cy(base, 0))
    const rev = layout(
      project,
      setAxis(setAxis(graph, 'y', { reverse: true }), 'x', { reverse: true }),
    )
    expect(cy(rev, 4)).toBeGreaterThan(cy(rev, 0))
    expect(cx(rev, 4)).toBeLessThan(cx(rev, 0))
    expectClean(rev)

    const c = column(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      'bars',
    )
    const cs = layout(c.project, setAxis(c.graph, 'y', { reverse: true }))
    const bar = prim(byId(cs, `series/${c.table.dataSets[1]!.id}/bar`), 'rect')
    expect(bar.y).toBeCloseTo(cs.plot.y, 9) // bars hang from the top
    expectClean(cs)
  })

  it('anchor draws the axis where the other axis has that value', () => {
    const { project, graph } = xy()
    const s = layout(project, setAxis(setAxis(graph, 'y', { anchor: 2 }), 'x', { anchor: 5 }))
    const yLine = prim(byId(s, 'axis/y/line'), 'line')
    expect(yLine.x1).toBeCloseTo(s.axes!.x.toPx(2), 9)
    const xLine = prim(byId(s, 'axis/x/line'), 'line')
    expect(xLine.y1).toBeCloseTo(s.axes!.y.toPx(5), 9)
    // Ticks move with the line; titles stay outside the plot.
    expect(prim(byId(s, 'axis/y/tick/0'), 'line').x1).toBeCloseTo(yLine.x1, 9)
    // Out-of-range anchors are clamped to the plot.
    const far = layout(project, setAxis(graph, 'y', { anchor: 1e6 }))
    expect(prim(byId(far, 'axis/y/line'), 'line').x1).toBeCloseTo(far.plot.x + far.plot.w, 9)
    expectClean(s)
  })

  it('breaks hide data inside the break and draw break marks', () => {
    const { project, graph, table } = column(
      [
        [1, 2, 3, 50, 95, 96],
        [2, 97, 98],
      ],
      'points',
    )
    const g = setAxis(graph, 'y', { breaks: [{ from: 10, to: 90, gap: 12 }] })
    const s = layout(project, g)
    const key = table.dataSets[0]!.id
    expect(byId(s, `series/${key}/point/3`)).toBeUndefined() // 50 lies in the break
    expect(byId(s, `series/${key}/point/4`)).toBeDefined()
    expect(nodes(s, 'axis/y/break/')).toHaveLength(2)
    expect(nodes(s, 'axis/y/line/')).toHaveLength(2)
    const values = labels(s, 'y').map((l) => Number(l.replace('−', '-')))
    expect(values.every((v) => v <= 10 || v >= 90)).toBe(true)
    expect(values.filter((v) => v <= 10).length).toBeGreaterThan(1)
    expect(values.filter((v) => v >= 90).length).toBeGreaterThan(1)
    // The gap is empty along the axis.
    const [g0, g1] = [s.axes!.y.toPx(90), s.axes!.y.toPx(10)]
    expect(g1 - g0).toBeCloseTo(12, 9)
    expectClean(s)
    // Bars spanning the break stay drawn; XY X-axis breaks work too.
    expectClean(layout(project, applyPreset(g, 'bars', table)))
    const x = xy()
    const xs = layout(
      x.project,
      setAxis(x.graph, 'x', { breaks: [{ from: 1.5, to: 2.5, gap: 8 }] }),
    )
    expect(byId(xs, `series/${x.table.dataSets[0]!.id}/point/2`)).toBeUndefined()
    expect(nodes(xs, 'axis/x/break/')).toHaveLength(2)
    expectClean(xs)
  })
})

// --- Graph style -------------------------------------------------------------------------------

describe('graph style', () => {
  it('frame box adds the top and right sides; none removes axis lines', () => {
    const { project, graph } = xy()
    const box = layout(project, { ...graph, style: { frame: 'box' } })
    const top = prim(byId(box, 'frame/top'), 'line')
    expect([top.y1, top.y2]).toEqual([box.plot.y, box.plot.y])
    const right = prim(byId(box, 'frame/right'), 'line')
    expect(right.x1).toBe(box.plot.x + box.plot.w)
    expect(byId(box, 'frame/bottom')).toBeUndefined()
    const none = layout(project, { ...graph, style: { frame: 'none' } })
    expect(byId(none, 'axis/x/line')).toBeUndefined()
    expect(nodes(none, 'axis/x/tick/').length).toBeGreaterThan(0)
  })

  it('backgrounds are the first nodes', () => {
    const { project, graph } = grouped()
    const fill = (rgb: string) => ({ type: 'solid' as const, color: { rgb }, opacity: 1 })
    const s = layout(project, {
      ...graph,
      style: { background: fill('#fafafa'), plotBackground: fill('#eeeeee') },
    })
    const [bg, plotBg] = s.root.children!
    expect(prim(bg, 'rect')).toMatchObject({ x: 0, y: 0, w: s.width, h: s.height })
    expect(prim(bg, 'rect').fill?.color).toBe('#fafafa')
    expect(prim(plotBg, 'rect')).toMatchObject(s.plot)
    expect(sceneToSvg(s)).toContain('fill="#fafafa"')
  })

  it('bracket style overrides the theme', () => {
    const { project, graph, table } = column([
      [1, 2, 3],
      [4, 5, 6],
    ])
    const [a, b] = table.dataSets.map((d) => d.id)
    const bracket: Annotation = {
      type: 'bracket',
      id: 'br' as never,
      a: a!,
      b: b!,
      label: { source: 'manual', text: '**' },
      level: 'auto',
    }
    const g = { ...graph, annotations: [bracket] }
    const base = layout(project, g)
    const styled = layout(project, {
      ...g,
      style: {
        bracket: {
          line: { width: 2, color: { rgb: '#ff0000' } },
          label: { size: 16 },
          tick: 0,
          gap: 20,
        },
      },
    })
    const line = prim(byId(styled, 'annotation/br/line'), 'polyline')
    expect(line.stroke).toMatchObject({ width: 2, color: '#ff0000' })
    expect(line.points[0]![1]).toBe(line.points[1]![1]) // no end ticks
    expect(prim(byId(styled, 'annotation/br/label'), 'text').layout.runs[0]!.size).toBe(16)
    const lineY = (s: Scene) =>
      prim(byId(s, 'annotation/br/line'), 'polyline').points[1]![1] - s.plot.y
    expect(lineY(base) - lineY(styled)).toBeCloseTo(14, 9) // gap 6 → 20
    expectClean(styled)
  })

  it('categoryGap sets the space between groups', () => {
    const { project, graph, table } = grouped()
    const v = table.dataSets[0]!.id
    const d = table.dataSets[1]!.id
    const bars = (s: Scene) => [
      prim(byId(s, `series/${v}/bar/0`), 'rect'),
      prim(byId(s, `series/${d}/bar/0`), 'rect'),
      prim(byId(s, `series/${v}/bar/1`), 'rect'),
    ]
    const span = (s: Scene) => {
      const [a, , c] = bars(s)
      const [, bb] = bars(s)
      return { cluster: bb!.x + bb!.w - a!.x, pitch: c!.x - a!.x }
    }
    const wide = layout(project, { ...graph, style: { categoryGap: 0.5 } })
    const { cluster, pitch } = span(wide)
    // Cluster slot = pitch / (1 + gap); bars fill 0.8 of their sub-slot at each end.
    const slot = pitch / 1.5
    expect(cluster).toBeCloseTo(slot - (slot / 2) * 0.2, 6)
    expect(span(layout(project, graph)).cluster).toBeGreaterThan(cluster)
    // Column bars: width = slot / (1 + gap).
    const c = column(
      [
        [1, 2],
        [3, 4],
      ],
      'bars',
    )
    const cs = layout(c.project, { ...c.graph, style: { categoryGap: 1 } })
    const bar = prim(byId(cs, `series/${c.table.dataSets[0]!.id}/bar`), 'rect')
    expect(bar.w).toBeCloseTo(cs.plot.w / 2 / 2, 9)
  })

  it('the base text style reaches every text in the graph', () => {
    const cases: { project: Project; graph: GraphNode }[] = [xy(), grouped(), survival()]
    const c = column([
      [1, 2],
      [3, 4],
    ])
    const [a, b] = c.table.dataSets.map((d) => d.id)
    cases.push({
      project: c.project,
      graph: {
        ...c.graph,
        legend: { show: true, position: 'right' },
        annotations: [
          {
            type: 'bracket',
            id: 'b' as never,
            a: a!,
            b: b!,
            label: { source: 'manual', text: 'ns' },
            level: 'auto',
          },
          {
            type: 'text',
            id: 't' as never,
            anchor: { space: 'plot', x: 0.1, y: 0.1 },
            content: plainText('Note'),
          },
        ],
      },
    })
    for (const { project, graph } of cases) {
      const g = setAxis(
        { ...graph, style: { ...graph.style, text: { font: 'serif', color: { rgb: '#123456' } } } },
        'y',
        { title: plainText('Y title') },
      )
      const s = layout(project, g)
      const texts = flatten(s.root).filter((n) => n.prim?.type === 'text')
      expect(texts.length).toBeGreaterThan(5)
      for (const t of texts) {
        const p = prim(t, 'text')
        expect(p.color, t.id).toBe('#123456')
        for (const r of p.layout.runs) expect(r.font, t.id).toBe('serif')
      }
    }
  })
})

// --- Legend ------------------------------------------------------------------------------------

describe('legend', () => {
  it('right (default) sits beside the plot with a bbox and entry targets', () => {
    const { project, graph, table } = xy()
    const s = layout(project, graph)
    const legend = byId(s, 'legend')!
    expect(legend.target).toEqual(['legend'])
    expect(legend.bbox!.x).toBeGreaterThan(s.plot.x + s.plot.w)
    const label = byId(s, `legend/${table.dataSets[0]!.id}/label`)!
    expect(label.target).toEqual(['seriesOverrides', table.dataSets[0]!.id])
    expect(label.bbox).toBeDefined()
  })

  it('top: one row above the plot, or rows of `columns`', () => {
    const { project, graph, table } = xy()
    const base = layout(project, graph)
    const s = layout(project, { ...graph, legend: { show: true, position: 'top' } })
    const [l0, l1] = table.dataSets.map((d) => byId(s, `legend/${d.id}`)!.bbox!)
    expect(l0!.y).toBe(l1!.y)
    expect(l1!.x).toBeGreaterThan(l0!.x)
    expect(byId(s, 'legend')!.bbox!.y + byId(s, 'legend')!.bbox!.h).toBeLessThanOrEqual(s.plot.y)
    expect(s.plot.y).toBeGreaterThan(base.plot.y)
    expect(s.width).toBeLessThan(base.width) // no legend column on the right
    const stacked = layout(project, {
      ...graph,
      legend: { show: true, position: 'top', columns: 1 },
    })
    const [m0, m1] = table.dataSets.map((d) => byId(stacked, `legend/${d.id}`)!.bbox!)
    expect(m1!.y).toBeGreaterThan(m0!.y)
    expectClean(s)
  })

  it('inside: default top-right in the plot, or at given plot fractions', () => {
    const { project, graph } = xy()
    const s = layout(project, { ...graph, legend: { show: true, position: 'inside' } })
    const b = byId(s, 'legend')!.bbox!
    expect(b.x + b.w).toBeCloseTo(s.plot.x + s.plot.w - 6, 9)
    expect(b.y).toBeCloseTo(s.plot.y + 6, 9)
    const at = layout(project, {
      ...graph,
      legend: { show: true, position: 'inside', inside: { x: 0.25, y: 0.5 } },
    })
    const c = byId(at, 'legend')!.bbox!
    expect(c.x).toBeCloseTo(at.plot.x + 0.25 * at.plot.w, 9)
    expect(c.y).toBeCloseTo(at.plot.y + 0.5 * at.plot.h, 9)
    // Legend drawn over the data.
    const order = s.root.children!.map((n) => n.id)
    expect(order.indexOf('legend')).toBeGreaterThan(order.indexOf('series'))
    // Far outside the plot: the scene grows to contain it.
    expectClean(
      layout(project, {
        ...graph,
        legend: { show: true, position: 'inside', inside: { x: 1.5, y: -1 } },
      }),
    )
  })

  it('hidden, text style, border and background', () => {
    const { project, graph, table } = xy()
    const [a, b] = table.dataSets.map((d) => d.id)
    const s = layout(project, {
      ...graph,
      legend: {
        show: true,
        position: 'right',
        hidden: [a!],
        text: { size: 14, italic: true },
        border: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
        background: { type: 'solid', color: { rgb: '#ffffee' }, opacity: 1 },
      },
    })
    expect(byId(s, `legend/${a}`)).toBeUndefined()
    const run = prim(byId(s, `legend/${b}/label`), 'text').layout.runs[0]!
    expect([run.size, run.italic]).toEqual([14, true])
    const box = prim(byId(s, 'legend/box'), 'rect')
    const entry = byId(s, `legend/${b}`)!.bbox!
    expect(entry.x - box.x).toBeCloseTo(4, 9)
    expect(box.fill?.color).toBe('#ffffee')
  })

  it('works on every graph type, including column graphs when shown', () => {
    const c = column(
      [
        [1, 2],
        [3, 4],
      ],
      'bars',
    )
    expect(nodes(layout(c.project, c.graph), 'legend/')).toHaveLength(0)
    const shown = layout(c.project, { ...c.graph, legend: { show: true, position: 'top' } })
    expect(nodes(shown, 'legend/').filter((n) => n.id.endsWith('/swatch'))).toHaveLength(2)
    for (const { project, graph } of [grouped(), survival()]) {
      const s = layout(project, { ...graph, legend: { show: true, position: 'inside' } })
      expect(byId(s, 'legend')!.bbox).toBeDefined()
      expectClean(s)
    }
  })

  it('tall legends grow the scene', () => {
    const table = createTable({ tableKind: 'xy', columns: 20, rows: 2 })
    table.x!.subcolumns[0]!.values = [1, 2]
    table.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = [i, i + 1]
    })
    const graph = createGraphFor(table)
    const project = projectOf(table, graph)
    expectClean(layout(project, graph))
  })
})

// --- Annotations -------------------------------------------------------------------------------

describe('annotations', () => {
  const note = (
    anchor: { space: 'plot' | 'data'; x: number; y: number },
    extra = {},
  ): Annotation => ({
    type: 'text',
    id: 'n1' as never,
    anchor,
    content: plainText('Peak'),
    ...extra,
  })

  it('text in plot space: top-left at plot fractions', () => {
    const { project, graph } = xy()
    const s = layout(project, { ...graph, annotations: [note({ space: 'plot', x: 0.5, y: 0.25 })] })
    const n = byId(s, 'annotation/n1')!
    expect(n.target).toEqual(['annotations', 0])
    const t = byId(s, 'annotation/n1/text')!.bbox!
    expect(t.x).toBeCloseTo(s.plot.x + 0.5 * s.plot.w, 9)
    expect(t.y).toBeCloseTo(s.plot.y + 0.25 * s.plot.h, 9)
    expect(n.bbox).toEqual(t)
  })

  it('text in data space follows the axes, with an optional box', () => {
    const { project, graph } = xy()
    const s = layout(project, {
      ...graph,
      annotations: [
        note(
          { space: 'data', x: 3, y: 6 },
          {
            border: { color: { rgb: '#000000' }, width: 0.5, dash: 'solid' },
            background: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
          },
        ),
      ],
    })
    const t = byId(s, 'annotation/n1/text')!.bbox!
    expect(t.x).toBeCloseTo(s.axes!.x.toPx(3), 9)
    expect(t.y).toBeCloseTo(s.axes!.y.toPx(6), 9)
    const box = prim(byId(s, 'annotation/n1/box'), 'rect')
    expect(box.x).toBeCloseTo(t.x - 2, 9)
    expect(byId(s, 'annotation/n1')!.bbox).toMatchObject({ w: box.w, h: box.h })
  })

  it('lines with arrowheads, on every graph type', () => {
    const line = (arrow: 'none' | 'end' | 'both'): Annotation => ({
      type: 'line',
      id: 'l1' as never,
      space: 'plot',
      from: { x: 0.1, y: 0.9 },
      to: { x: 0.6, y: 0.2 },
      stroke: { color: { rgb: '#aa0000' }, width: 1.5, dash: 'solid' },
      arrow,
    })
    const { project, graph } = xy()
    const heads = (arrow: 'none' | 'end' | 'both') =>
      nodes(layout(project, { ...graph, annotations: [line(arrow)] }), 'annotation/l1/arrow/')
    expect(heads('none')).toHaveLength(0)
    expect(heads('end')).toHaveLength(1)
    expect(heads('both')).toHaveLength(2)
    const s = layout(project, { ...graph, annotations: [line('end')] })
    const tip = prim(byId(s, 'annotation/l1/arrow/0'), 'polygon').points[0]!
    expect(tip[0]).toBeCloseTo(s.plot.x + 0.6 * s.plot.w, 9)
    expect(tip[1]).toBeCloseTo(s.plot.y + 0.2 * s.plot.h, 9)
    expect(prim(byId(s, 'annotation/l1/arrow/0'), 'polygon').fill.color).toBe('#aa0000')
    expect(byId(s, 'annotation/l1')!.bbox).toBeDefined()

    const all = [
      column([
        [1, 2],
        [3, 4],
      ]),
      grouped(),
      survival(),
    ]
    for (const c of all) {
      const sc = layout(c.project, {
        ...c.graph,
        annotations: [line('both'), note({ space: 'data', x: 0, y: 5 })],
      })
      expect(byId(sc, 'annotation/l1')).toBeDefined()
      expect(byId(sc, 'annotation/n1')).toBeDefined()
      expectClean(sc)
    }
  })

  it('annotations outside the plot grow the scene', () => {
    const { project, graph } = xy()
    const s = layout(project, {
      ...graph,
      annotations: [
        note({ space: 'plot', x: 1.3, y: -0.4 }),
        note({ space: 'plot', x: -0.5, y: 1.2 }),
      ],
    })
    expectClean(s)
  })
})

// --- Editing info ------------------------------------------------------------------------------

describe('scene info for editing', () => {
  it('titles, axes, legend and annotations carry ids, targets and bboxes', () => {
    const { project, graph } = xy()
    const g = setAxis(graph, 'y', { title: plainText('Response') })
    const s = layout(project, g)
    expect(byId(s, 'title')).toMatchObject({ target: ['title'] })
    expect(byId(s, 'axis/x/title')).toMatchObject({ target: ['axes', 'x', 'title'] })
    const yTitle = byId(s, 'axis/y/title')!
    expect(yTitle.target).toEqual(['axes', 'y', 'title'])
    expect(yTitle.bbox!.h).toBeGreaterThan(yTitle.bbox!.w) // rotated bounds
    for (const w of ['x', 'y'] as const) {
      const axis = byId(s, `axis/${w}`)!
      expect(axis.target).toEqual(['axes', w])
      // Covers the line, ticks and labels.
      for (const n of nodes(s, `axis/${w}/tick`)) {
        const b = nodeBounds(n)!
        expect(b.x).toBeGreaterThanOrEqual(axis.bbox!.x - 1e-9)
        expect(b.y + b.h).toBeLessThanOrEqual(axis.bbox!.y + axis.bbox!.h + 1e-9)
      }
    }
    for (const n of flatten(s.root)) if (n.prim?.type === 'text') expect(n.bbox, n.id).toBeDefined()
  })

  it('scene axes convert both ways (log, reversed, broken)', () => {
    const { project, graph } = xy()
    const variants = [
      graph,
      setAxis(graph, 'x', { scale: 'log10' }),
      setAxis(graph, 'y', { reverse: true }),
      setAxis(graph, 'y', { breaks: [{ from: 4, to: 6, gap: 10 }] }),
    ]
    for (const g of variants) {
      const s = layout(project, g)
      for (const v of [1, 3, 8]) {
        expect(s.axes!.y.fromPx(s.axes!.y.toPx(v))).toBeCloseTo(v, 9)
        expect(s.axes!.x.fromPx(s.axes!.x.toPx(v))).toBeCloseTo(v, 9)
      }
    }
    const s = layout(project, graph)
    const p = scenePoint(s, s.plot.x + s.plot.w / 4, s.plot.y + s.plot.h / 2)
    expect(p.plot.x).toBeCloseTo(0.25, 12)
    expect(p.plot.y).toBeCloseTo(0.5, 12)
    expect(p.data!.x).toBeCloseTo(s.axes!.x.fromPx(s.plot.x + s.plot.w / 4), 12)
    // Categorical axes map category indices.
    const c = column([[1], [2], [3]])
    const cs = layout(c.project, c.graph)
    expect(cs.axes!.x.categorical).toBe(true)
    expect(cs.axes!.x.toPx(1)).toBeCloseTo(prim(byId(cs, 'axis/x/tick/1'), 'line').x1, 9)
  })
})

// --- Magic -------------------------------------------------------------------------------------

describe('match format with the new fields', () => {
  it('copies axis formatting and clears what the source lacks', () => {
    const { project, graph } = xy()
    const source = setAxis(graph, 'y', { tickStyle: { direction: 'in' }, grid: {}, show: true })
    const target = setAxis(graph, 'y', { showLabels: false })
    const out = matchGraphFormat(project, target, source)
    expect(out.axes.y).toMatchObject({ tickStyle: { direction: 'in' }, show: true })
    expect('showLabels' in out.axes.y).toBe(false)
    expect(Object.values(out.axes.y)).not.toContain(undefined)
  })
})

// --- Regressions (audit) -----------------------------------------------------------------------

describe('regressions', () => {
  it('log axis with a manual min ≤ 0, or min ≥ max, falls back to auto with a warning', () => {
    const { project, graph } = column([
      [1, 10, 100],
      [5, 50, 500],
    ])
    const log = layout(project, setAxis(graph, 'y', { scale: 'log10', range: { min: 0, max: 10 } }))
    expect(log.warnings.join(' ')).toMatch(/log axis range/)
    expectClean(log)
    const flipped = layout(project, setAxis(graph, 'y', { range: { min: 10, max: 0 } }))
    expect(flipped.warnings.join(' ')).toMatch(/minimum below its maximum/)
    expect(labels(flipped, 'y').length).toBeGreaterThan(2)
    expectClean(flipped)
  })

  it('manual log range keeps ticks inside the range', () => {
    const { project, graph } = column([
      [3, 10, 100],
      [5, 50, 300],
    ])
    const s = layout(project, setAxis(graph, 'y', { scale: 'log10', range: { min: 3, max: 300 } }))
    expect(labels(s, 'y')).toEqual(['10', '100'])
    expectClean(s)
  })

  it('tiny and huge values get readable tick labels', () => {
    expect(decimalsFor([2e-11])).toBe(10)
    expect(decimalsFor([0.25])).toBe(2)
    const tiny = column([[1e-11, 2e-11, 5e-11]])
    const t = labels(layout(tiny.project, tiny.graph), 'y')
    expect(new Set(t).size).toBe(t.length)
    expect(t.at(-1)).toMatch(/×10\^−11/)
    const t17 = column([[1e-17, 2e-17, 3e-17]])
    const s17 = layout(t17.project, t17.graph)
    expect(new Set(labels(s17, 'y')).size).toBe(labels(s17, 'y').length)
    expectClean(s17)
    const huge = column([[1e8, 3e8]])
    expect(labels(layout(huge.project, huge.graph), 'y').at(-1)).toMatch(/×10\^8/)
  })

  it('marks outside a manual range are clipped to the plot', () => {
    for (const preset of ['bars', 'points', 'box', 'beforeAfter']) {
      const { project, graph } = column(
        [
          [100, 120, 110],
          [5, 6, 7],
        ],
        preset,
      )
      expectClean(layout(project, setAxis(graph, 'y', { range: { min: 0, max: 10 } })))
    }
    const g = grouped()
    for (const preset of ['bars', 'points']) {
      const s = layout(
        g.project,
        setAxis(applyPreset(g.graph, preset, g.table), 'y', { range: { min: 0, max: 12 } }),
      )
      expectClean(s)
    }
  })

  it('long titles widen or heighten the scene', () => {
    const { project, graph } = column([
      [1, 2],
      [3, 4],
    ])
    const g = setAxis(
      setAxis(
        { ...graph, title: plainText('Experiment 2024-03-15 HEK293 knockdown, replicate 3') },
        'y',
        {
          title: plainText('Relative luciferase activity (normalized to control, %) of all cells'),
        },
      ),
      'x',
      { title: plainText('A rather long category axis title for a narrow graph') },
    )
    expectClean(layout(project, g))
  })

  it('column category labels rotate when they collide and never clip', () => {
    const long = column(
      [
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
      ],
      'points',
      ['Very long treatment group name A', 'B', 'C', 'D'],
    )
    const s = layout(long.project, long.graph)
    expect(prim(byId(s, 'axis/x/tickLabel/0'), 'text').rotate?.angle).toBe(-45)
    expectClean(s)
    const cols = Array.from({ length: 30 }, (_, i) => [i, i + 1])
    const many = column(
      cols,
      'bars',
      cols.map((_, i) => `Group ${i + 1}`),
    )
    const ms = layout(many.project, many.graph)
    expect(prim(byId(ms, 'axis/x/tickLabel/0'), 'text').rotate?.angle).toBe(-90)
    expectClean(ms)
  })

  it('a tiny manual interval is widened with a warning', () => {
    const { project, graph } = column([[1, 2, 3]])
    const s = layout(
      project,
      setAxis(graph, 'y', { range: { min: 0, max: 1000 }, ticks: { interval: 0.5, minor: 0 } }),
    )
    expect(labels(s, 'y').length).toBeLessThan(20)
    expect(s.warnings.join(' ')).toMatch(/tick interval/)
  })

  it('SVG export drops XML-forbidden control characters', () => {
    const { project, graph } = column([[1, 2]], 'points', ['A\u000bB'])
    const svg = sceneToSvg(layout(project, graph))
    expect(svg).not.toContain('\u000b')
    expect(svg).toContain('AB')
  })

  it('swarm offsets: no overlaps, nearest the centre line, equal values fan out evenly, fast', () => {
    const rand = minstd(7)
    const d = 6
    for (const n of [5, 40, 300]) {
      const ys = Array.from({ length: n }, () => Math.round(rand() * 60) / 2)
      const xs = swarmOffsets(ys, d, 1e6)
      // No two symbols overlap (they may touch).
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          expect(Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!)).toBeGreaterThan(d * 0.99 - 1e-6)
      // Deterministic, and compressed to the width it is given.
      expect(swarmOffsets(ys, d, 1e6)).toEqual(xs)
      expect(Math.max(...swarmOffsets(ys, d, 10).map(Math.abs))).toBeLessThanOrEqual(10 + 1e-9)
    }
    // Isolated points stay on the centre line; equal values alternate right and left.
    expect(swarmOffsets([0, 100, 200], d, 50)).toEqual([0, 0, 0])
    const tied = swarmOffsets([5, 5, 5, 5, 5], d, 1e6).map(
      (x) => Math.round((x / d / 0.99) * 1e6) / 1e6,
    )
    expect(tied).toEqual([0, 1, -1, 2, -2])
    // Two points a little apart in y sit closer than a diameter in x (a compact swarm).
    const [, x2] = swarmOffsets([0, 4], d, 1e6)
    expect(Math.abs(x2!)).toBeCloseTo(Math.sqrt((d * 0.99) ** 2 - 16), 9)
    // Fast even when every value is equal (the worst case): four times the points take about four
    // times as long, not sixteen. A ratio of CPU times, so it holds on a slow or busy machine.
    const equal = (n: number) => swarmOffsets(new Array<number>(n).fill(100), 6, 40)
    expect(growthRatio(equal, 1250)).toBeLessThan(10)
  })
})
