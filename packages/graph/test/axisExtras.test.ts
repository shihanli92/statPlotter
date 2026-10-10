import {
  type ColumnId,
  type ContinuousAxisSpec,
  type DataTable,
  type GraphNode,
  type Layer,
  levelKey,
  rowCategoryKey,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  axisCategories,
  continuousTickLabels,
  fitted,
  isEmbeddingPair,
  layoutLayers,
  makeAxisScale,
  parseCombination,
  pieceScales,
  type Scene,
  type SceneNode,
  scaleBarSpan,
  seedFromNames,
  seedFromVariables,
} from '../src/index.ts'
import {
  brokenTable,
  doseTable,
  genotypeTable,
  manualLayers,
  oligomerTable,
  TYPED_GRID,
  treatmentTable,
  umapGraph,
  withCategoryAxis,
  withValueAxis,
} from './axisExtrasCases.ts'
import { graphOf } from './graphs.ts'
import { byId, flatten, fonts, nodes, projectOf, sampleTable, sampleVariables } from './helpers.ts'

// Roadmap 36: axis extras — treatment grids (seeded from names and variables, aligned with the
// categories whichever way the graph is turned, keyed so they survive reordering, slices and new
// categories), spans from the data, broken axes' piece lengths, ticks at listed values and text,
// scale bars in data units, corner arrows, and typed-in lines and bands.

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutLayers({ project: projectOf(table), graph, fonts })

/** The centre of a scene node's bounds. */
const centre = (n: SceneNode | undefined): [number, number] => {
  const all = flatten(n!).flatMap((c) => (c.bbox ? [c.bbox] : []))
  const p = n?.prim
  if (p?.type === 'text') {
    const b = n!.bbox!
    return [b.x + b.w / 2, b.y + b.h / 2]
  }
  if (p?.type === 'symbol') return [p.cx, p.cy]
  const b = all[0]!
  return [b.x + b.w / 2, b.y + b.h / 2]
}

describe('reading category names as treatments', () => {
  it.each([
    [
      'TNF+CHX',
      [
        ['TNF', '+'],
        ['CHX', '+'],
      ],
      [],
    ],
    [
      'TNF + zVAD',
      [
        ['TNF', '+'],
        ['zVAD', '+'],
      ],
      [],
    ],
    [
      'TNF + CHX + Z-VAD-FMK',
      [
        ['TNF', '+'],
        ['CHX', '+'],
        ['Z-VAD-FMK', '+'],
      ],
      [],
    ],
    [
      'WT TNF',
      [
        ['WT', '+'],
        ['TNF', '+'],
      ],
      [],
    ],
    ['TNF−', [['TNF', '-']], []],
    ['TNF −', [['TNF', '-']], []],
    [
      'TNF – CHX +',
      [
        ['TNF', '-'],
        ['CHX', '+'],
      ],
      [],
    ],
    [
      'TNF/CHX',
      [
        ['TNF', '+'],
        ['CHX', '+'],
      ],
      [],
    ],
    [
      'IFN-γ & LPS',
      [
        ['IFN-γ', '+'],
        ['LPS', '+'],
      ],
      [],
    ],
    [
      'TNF and CHX',
      [
        ['TNF', '+'],
        ['CHX', '+'],
      ],
      [],
    ],
    ['Drug A', [['Drug A', '+']], []],
    [
      'siRNA 2 + H1N1',
      [
        ['siRNA 2', '+'],
        ['H1N1', '+'],
      ],
      [],
    ],
    ['+/−', [], ['+', '-']],
    ['−/+', [], ['-', '+']],
    ['− −', [], ['-', '-']],
    ['+-', [], ['+', '-']],
    ['−', [], ['-']],
  ])('%s', (name, named, signs) => {
    const p = parseCombination(name)
    expect(p.named).toEqual(named)
    expect(p.signs).toEqual(signs)
  })

  it('reads controls as no treatment', () => {
    for (const c of ['Ctrl', 'Control', 'vehicle', 'DMSO', 'Untreated', 'PBS', 'mock'])
      expect(parseCombination(c)).toEqual({ named: [], signs: [], control: true })
  })

  it('seeds a row per treatment in the order named, matching spellings', () => {
    const cats = ['Ctrl', 'TNF', 'TNF+CHX', 'TNF + CHX + zVAD', 'Z-VAD + TNF'].map((t, i) => ({
      key: `k${i}`,
      title: t,
    }))
    const rows = seedFromNames(cats)!
    expect(rows.map((r) => r.title)).toEqual(['TNF', 'CHX', 'zVAD'])
    expect(rows.map((r) => Object.values(r.cells).join(''))).toEqual(['-++++', '--++-', '---++'])
  })

  it('seeds a genotype row of text from first words taking turns', () => {
    const cats = ['WT', 'WT TNF', 'KO', 'KO TNF'].map((t, i) => ({ key: `k${i}`, title: t }))
    // "WT" alone has one word: no genotype row; WT, TNF, KO as treatments.
    expect(seedFromNames(cats)!.map((r) => r.title)).toEqual(['WT', 'TNF', 'KO'])
    const two = ['WT ctrl', 'WT TNF', 'KO ctrl', 'KO TNF'].map((t, i) => ({
      key: `k${i}`,
      title: t,
    }))
    const rows = seedFromNames(two)!
    expect(rows[0]).toEqual({ title: '', cells: { k0: 'WT', k1: 'WT', k2: 'KO', k3: 'KO' } })
    expect(rows[1]).toEqual({ title: 'TNF', cells: { k0: '-', k1: '+', k2: '-', k3: '+' } })
  })

  it('seeds rows by position from signs alone', () => {
    const cats = ['−/−', '+/−', '−/+', '+/+'].map((t, i) => ({ key: `k${i}`, title: t }))
    const rows = seedFromNames(cats)!
    expect(rows.map((r) => r.title)).toEqual(['Treatment 1', 'Treatment 2'])
    expect(Object.values(rows[0]!.cells)).toEqual(['-', '+', '-', '+'])
    expect(Object.values(rows[1]!.cells)).toEqual(['-', '-', '+', '+'])
  })

  it('proposes nothing for names that are not combinations', () => {
    const plain = ['Control', 'Drug A', 'Drug B'].map((t, i) => ({ key: `k${i}`, title: t }))
    expect(seedFromNames(plain)).toBeNull()
    expect(seedFromNames([{ key: 'a', title: 'TNF+CHX' }])).toBeNull()
  })
})

describe('seeding from a table’s text variables', () => {
  /** `sampleVariables` with a yes/no variable (Treated: Low and Mid no, High yes) and a site. */
  function withTreated(): DataTable {
    const t = sampleVariables()
    const treated = structuredClone(t.dataSets[0]!)
    treated.id = 'e' as ColumnId
    treated.title = 'Treated'
    treated.text = t.dataSets[0]!.text!.map((g) =>
      g === null ? null : g === 'High' ? 'yes' : 'no',
    )
    const site = structuredClone(t.dataSets[0]!)
    site.id = 'f' as ColumnId
    site.title = 'Site'
    site.text = t.dataSets[0]!.text!.map((_, r) => (r % 2 ? 'North' : 'South'))
    return { ...t, dataSets: [...t.dataSets, treated, site] }
  }

  it('makes a yes/no variable +/− and leaves out variables that differ within a category', () => {
    const t = withTreated()
    const real = { ...graphOf(t, 'groupBoxPoints'), mapping: { x: 'a', y: 'c' } } as GraphNode
    const rows = seedFromVariables(projectOf(t, real), real)!
    // Sex and Site take both values in every group: left out.
    expect(rows.map((r) => r.title)).toEqual(['Treated'])
    expect(rows[0]!.cells).toEqual({
      [levelKey('Low')]: '-',
      [levelKey('High')]: '+',
      [levelKey('Mid')]: '-',
    })
  })

  it('seeds per bar on a grouped graph of variables', () => {
    const t = withTreated()
    const g = {
      ...graphOf(t, 'barsPoints'),
      mapping: { x: 'a', y: 'c', color: 'b' },
      frame: 'grouped' as const,
    } as GraphNode
    const rows = seedFromVariables(projectOf(t, g), g, 'bar')!
    // Site is the same within each bar here (it takes turns as Sex does): a row of its own.
    expect(rows.map((r) => r.title)).toEqual(['Treated', 'Site'])
    expect(rows[0]!.cells[`${levelKey('High')}/${levelKey('F')}`]).toBe('+')
    expect(rows[0]!.cells[`${levelKey('Low')}/${levelKey('M')}`]).toBe('-')
    // Not a graph of variables: nothing to seed from.
    const column = sampleTable('column')
    expect(seedFromVariables(projectOf(column), graphOf(column, 'bars'))).toBeNull()
  })
})

describe('categories by key', () => {
  it('names a category graph’s data sets, a grouped graph’s rows and bars', () => {
    const column = sampleTable('column')
    expect(
      axisCategories(projectOf(column), graphOf(column, 'bars')).groups.map((c) => c.key),
    ).toEqual(['a', 'b', 'c'])
    const gt = genotypeTable()
    const cats = axisCategories(projectOf(gt), graphOf(gt, 'barsPoints'))
    expect(cats.groups).toEqual([
      { key: '@0', title: 'BMDC WT' },
      { key: '@1', title: 'BMDC MyD88 KO' },
    ])
    expect(cats.bars.map((b) => b.key)).toEqual(['@0/a', '@0/b', '@0/c', '@1/a', '@1/b', '@1/c'])
    // A slice shows table row 1 alone: its key is still its table row.
    const sliced = graphOf(gt, 'barsPoints', (g) => ({
      seriesSource: { ...g.seriesSource, rows: [1] },
    }))
    expect(axisCategories(projectOf(gt), sliced).groups.map((g) => g.key)).toEqual([
      rowCategoryKey(1),
    ])
    const vars = sampleVariables()
    const mv = {
      ...graphOf(vars, 'barsPoints'),
      mapping: { x: 'a', y: 'c', color: 'b' },
      frame: 'grouped' as const,
    } as GraphNode
    expect(axisCategories(projectOf(vars), mv).groups.map((g) => g.title)).toEqual([
      'Low',
      'High',
      'Mid',
    ])
  })
})

describe('treatment grids along the categories', () => {
  const tt = treatmentTable()
  const bars = graphOf(tt, 'barsPoints')
  const grid = withCategoryAxis(bars, { treatments: TYPED_GRID })

  /** The grid's cells of a row, by key, and the centres of the categories' bars. */
  function cellsAndBars(scene: Scene, horizontal: boolean) {
    const along = (n: SceneNode | undefined) => centre(n)[horizontal ? 1 : 0]
    const cells = ['a', 'b', 'c', 'd'].map((k) => along(byId(scene, `axis/treatments/0/${k}`)))
    const barsAt = ['a', 'b', 'c', 'd'].map((k) => along(byId(scene, `series/${k}/bar`)))
    return { cells, barsAt }
  }

  it.each([false, true])('aligns a cell under each category (horizontal: %s)', (horizontal) => {
    const g = horizontal
      ? { ...grid, style: { ...grid.style, orientation: 'horizontal' as const } }
      : grid
    const scene = lay(tt, g)
    const { cells, barsAt } = cellsAndBars(scene, horizontal)
    cells.forEach((c, i) => {
      expect(c).toBeCloseTo(barsAt[i]!, 6)
    })
    // Titles before the first category; names hidden under the grid.
    expect(byId(scene, 'axis/treatments/0/title')).toBeDefined()
    expect(nodes(scene, 'axis/x/tickLabel/')).toEqual([])
    // The graph grows for the grid (the axis' depth), against the same graph without it (its
    // names hidden too).
    const nameless = withCategoryAxis(bars, { showLabels: false })
    const plain = lay(tt, { ...nameless, style: g.style })
    if (horizontal) expect(scene.width).toBeGreaterThan(plain.width)
    else expect(scene.height).toBeGreaterThan(plain.height)
  })

  it('cuts long text cells to their category, so neighbours never overlap (roadmap 41)', () => {
    const long = 'Cre-recombinase-expressing knockout'
    const rows = [{ title: 'Genotype', cells: { a: long, b: long, c: 'WT', d: long } }]
    const g = withCategoryAxis(bars, { treatments: { ...TYPED_GRID, rows } })
    const scene = lay(tt, g)
    const boxes = ['a', 'b', 'c', 'd'].map((k) => byId(scene, `axis/treatments/0/${k}`)!.bbox!)
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w)
    const text = (k: string) =>
      (
        byId(scene, `axis/treatments/0/${k}`)!.prim as { layout: { runs: { text: string }[] } }
      ).layout.runs
        .map((r) => r.text)
        .join('')
    expect(text('a')).toMatch(/^Cre.*…$/)
    expect(text('a').length).toBeLessThan(long.length)
    // Short text is drawn as typed.
    expect(text('c')).toBe('WT')
  })

  it('fits text to a width with whole characters and an ellipsis', () => {
    const style = {
      font: 'sans' as const,
      size: 10,
      bold: false,
      italic: false,
      color: { rgb: '#000000' },
    }
    expect(fitted(fonts, 'WT', style, 100)).toBe('WT')
    const cut = fitted(fonts, 'a long genotype name', style, 30)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThan(20)
    expect(fitted(fonts, 'abc', style, 0)).toBe('…')
  })

  it('keeps the names above the grid when asked', () => {
    const g = withCategoryAxis(bars, { treatments: { ...TYPED_GRID, names: 'above' } })
    const scene = lay(tt, g)
    expect(nodes(scene, 'axis/x/tickLabel/').length).toBe(4)
    const name = centre(byId(scene, 'axis/x/tickLabel/0'))[1]
    const cell = centre(byId(scene, 'axis/treatments/0/a'))[1]
    expect(cell).toBeGreaterThan(name)
  })

  it('follows the categories by key: reordered, sliced away, a new one blank', () => {
    const reordered = withCategoryAxis(
      graphOf(tt, 'barsPoints', (g) => ({
        seriesSource: { ...g.seriesSource, include: ['d', 'b', 'a'] },
      })),
      { treatments: TYPED_GRID },
    )
    const scene = lay(tt, reordered)
    const x = (k: string) => centre(byId(scene, `axis/treatments/2/${k}`))[0]
    expect(x('d')).toBeLessThan(x('b'))
    expect(x('b')).toBeLessThan(x('a'))
    expect(byId(scene, 'axis/treatments/2/c')).toBeUndefined()
    // Z-VAD-FMK is '+' only under d, wherever d is.
    expect(byId(scene, 'axis/treatments/2/d')?.prim).toMatchObject({ type: 'text' })
    const plus = (k: string) =>
      byId(scene, `axis/treatments/2/${k}`)?.prim?.type === 'text'
        ? (
            byId(scene, `axis/treatments/2/${k}`)!.prim as { layout: { runs: { text: string }[] } }
          ).layout.runs
            .map((r) => r.text)
            .join('')
        : ''
    expect([plus('d'), plus('b'), plus('a')]).toEqual(['+', '−', '−'])
    // A new data set has no cells: blank, the others in place.
    const more = structuredClone(tt)
    const extra = structuredClone(more.dataSets[0]!)
    extra.id = 'e' as ColumnId
    extra.title = 'New'
    more.dataSets.push(extra)
    const s2 = lay(more, grid)
    expect(byId(s2, 'axis/treatments/0/e')).toBeUndefined()
    expect(byId(s2, 'axis/treatments/0/b')).toBeDefined()
  })

  it('puts a grouped graph’s cells per group or per bar, by key', () => {
    const gt = genotypeTable()
    const g = graphOf(gt, 'barsPoints')
    const byGroup = withCategoryAxis(g, {
      treatments: { rows: [{ title: 'MyD88', cells: { '@0': '+', '@1': '-' } }] },
    })
    const s1 = lay(gt, byGroup)
    const groupCells = ['@0', '@1'].map((k) => centre(byId(s1, `axis/treatments/0/${k}`))[0])
    const plotLeft = s1.plot.x
    const w = s1.plot.w / 2
    groupCells.forEach((c, i) => {
      expect(c).toBeCloseTo(plotLeft + (i + 0.5) * w, 6)
    })
    const byBar = withCategoryAxis(g, {
      treatments: {
        by: 'bar',
        rows: [{ title: 'LPS', cells: { '@0/a': '-', '@0/b': '+', '@0/c': '+', '@1/a': '-' } }],
      },
    })
    const s2 = lay(gt, byBar)
    const keys = ['@0/a', '@0/b', '@0/c', '@1/a']
    const xs = keys.map((k) => centre(byId(s2, `axis/treatments/0/${k}`))[0])
    expect(xs[0]).toBeLessThan(xs[1]!)
    expect(xs[1]).toBeLessThan(xs[2]!)
    expect(xs[3]).toBeGreaterThan(s2.plot.x + s2.plot.w / 2)
    // A row slice (table row 1 only): its cells stay with it.
    const sliced = { ...byGroup, seriesSource: { ...byGroup.seriesSource, rows: [1] } }
    const s3 = lay(gt, sliced)
    expect(byId(s3, 'axis/treatments/0/@0')).toBeUndefined()
    expect(centre(byId(s3, 'axis/treatments/0/@1'))[0]).toBeCloseTo(s3.plot.x + s3.plot.w / 2, 6)
  })
})

describe('spans of categories', () => {
  it('spans a grouped table’s rows over their bars, the data sets named under the bars', () => {
    const gt = genotypeTable()
    const g = withCategoryAxis(graphOf(gt, 'barsPoints'), {
      spans: { rename: { '@1': 'MyD88 KO' } },
    })
    const scene = lay(gt, g)
    const labels = nodes(scene, 'axis/spans/1/').filter((n) => n.id.endsWith('/label'))
    expect(
      labels.map((n) => (n.prim as { layout: { runs: { text: string }[] } }).layout.runs[0]!.text),
    ).toEqual(['BMDC WT', 'MyD88 KO'])
    // The names under the axis are the bars' (six), not the rows'.
    expect(nodes(scene, 'axis/x/tickLabel/').length).toBe(6)
    // Each span's line covers its group's bars, inside the plot's width.
    const line = byId(scene, 'axis/spans/1/0/line')!.prim as { x1: number; x2: number }
    expect(line.x1).toBeGreaterThan(scene.plot.x)
    expect(line.x2).toBeLessThan(scene.plot.x + scene.plot.w / 2)
  })

  it('spans the X levels over the colour levels of a grouped graph of variables', () => {
    const vars = sampleVariables()
    const g = withCategoryAxis(
      {
        ...graphOf(vars, 'barsPoints'),
        mapping: { x: 'a', y: 'c', color: 'b' },
        frame: 'grouped',
      } as GraphNode,
      { spans: {} },
    )
    const scene = lay(vars, g)
    const labels = nodes(scene, 'axis/spans/1/')
      .filter((n) => n.id.endsWith('/label'))
      .map((n) => (n.prim as { layout: { runs: { text: string }[] } }).layout.runs[0]!.text)
    expect(labels).toEqual(['Low', 'High', 'Mid'])
  })

  it('draws typed spans on their own level, over the categories they name', () => {
    const tt = treatmentTable()
    const g = withCategoryAxis(graphOf(tt, 'barsPoints'), {
      spans: {
        list: [
          { label: 'TNF', keys: ['b', 'd'] },
          { label: 'All', keys: ['a', 'd'], level: 2 },
        ],
      },
    })
    const scene = lay(tt, g)
    const tnf = byId(scene, 'axis/spans/1/0/line')!.prim as { x1: number; x2: number; y1: number }
    const all = byId(scene, 'axis/spans/2/0/line')!.prim as { x1: number; x2: number; y1: number }
    expect(all.y1).toBeGreaterThan(tnf.y1)
    expect(all.x1).toBeLessThan(tnf.x1)
    expect(tnf.x2).toBeCloseTo(all.x2, 6)
  })
})

describe('broken axes with set piece lengths', () => {
  it('gives pieces their lengths and the rest in proportion', () => {
    // Spans 10 and 30 over 100 pt: the first set to half the axis.
    expect(pieceScales([10, 30], [{ value: 0.5, unit: 'fraction' }, null], 100, 100)).toEqual([
      5,
      50 / 30,
    ])
    expect(pieceScales([10, 30], [null, { value: 20, unit: 'pt' }], 100, 100)).toEqual([8, 20 / 30])
    // Every piece set but not adding up: scaled to the room.
    expect(
      pieceScales(
        [10, 30],
        [
          { value: 10, unit: 'pt' },
          { value: 30, unit: 'pt' },
        ],
        80,
        80,
      ),
    ).toEqual([2, 2])
    // No lengths, or more than the room: proportional (null).
    expect(pieceScales([10, 30], undefined, 100, 100)).toBeNull()
    expect(pieceScales([10, 30], [{ value: 2, unit: 'fraction' }, null], 100, 100)).toBeNull()
  })

  it('draws the low piece at its length and leaves scales without lengths as they were', () => {
    const breaks = [{ from: 7, to: 85, gap: 8 }]
    const plain = makeAxisScale('linear', [0, 120], [200, 0], { breaks })
    const set = makeAxisScale('linear', [0, 120], [200, 0], {
      breaks,
      pieces: [{ value: 0.6, unit: 'fraction' }, null],
    })
    // The low piece (0 to 7) is 0.6 of the axis: 120 pt.
    expect(set(0) - set(7)).toBeCloseTo(120, 9)
    expect(set(85) - set(120)).toBeCloseTo(200 - 120 - 8, 9)
    expect(set.invert(set(50 + 50))).toBeCloseTo(100, 9)
    // Values in the break are hidden; the edge maps to the break's start.
    expect(set(50)).toBeNaN()
    expect(set.edge(50)).toBeCloseTo(set(7), 9)
    // Without lengths: in proportion (as before).
    const k = (200 - 8) / (120 - 78)
    expect(plain(0) - plain(7)).toBeCloseTo(7 * k, 9)
    expect(makeAxisScale('linear', [0, 120], [200, 0], { breaks, pieces: [null, null] })(30)).toBe(
      plain(30),
    )
  })

  it('draws each mark style at the breaks', () => {
    const bt = brokenTable()
    const at = (style?: 'slash' | 'zigzag' | 'gap') =>
      lay(
        bt,
        withValueAxis(graphOf(bt, 'bars'), 'y', {
          breaks: [{ from: 7, to: 85, gap: 8 }],
          ...(style ? { breakMark: { style } } : {}),
        }),
      )
    expect(nodes(at(), 'axis/y/break/0/').map((n) => n.prim?.type)).toEqual(['line', 'line'])
    expect(byId(at('zigzag'), 'axis/y/break/0')?.prim?.type).toBe('polyline')
    expect(nodes(at('gap'), 'axis/y/break/')).toEqual([])
  })
})

describe('ticks at listed values and text at values', () => {
  it('labels ticks with their text, the ticks at the text’s values alone', () => {
    const ot = oligomerTable()
    const names = ['Monomer', 'Dimer', 'Trimer', 'Tetramer', 'Pentamer']
    const g = withValueAxis(graphOf(ot, 'meanSd'), 'x', {
      tickText: names.map((text, i) => ({ value: i + 1, text })),
      range: { min: 0.5, max: 5.5 },
    })
    const scene = lay(ot, g)
    const labels = nodes(scene, 'axis/x/tickLabel/').map(
      (n) => (n.prim as { layout: { runs: { text: string }[] } }).layout.runs[0]!.text,
    )
    expect(labels).toEqual(names)
    const spec = g.axes.x as ContinuousAxisSpec
    expect(continuousTickLabels(spec, [2, 2.5]).map((r) => r[0]!.text)).toEqual(['Dimer', '2.5'])
  })

  it('ticks a log axis at listed values (minor ticks too), leaving out those it can’t show', () => {
    const dt = doseTable()
    const g = withValueAxis(graphOf(dt, 'meanSd'), 'x', {
      scale: 'log10',
      tickValues: { major: [-1, 0, 0.01, 1, 100, 1e9], minor: [0.1, 10] },
    })
    const scene = lay(dt, g)
    const labels = nodes(scene, 'axis/x/tickLabel/').map((n) =>
      (n.prim as { layout: { runs: { text: string }[] } }).layout.runs.map((r) => r.text).join(''),
    )
    expect(labels).toEqual(['0.01', '1', '100'])
    expect(nodes(scene, 'axis/x/minorTick/').length).toBe(2)
  })

  it('ticks arcsinh and logicle axes at listed values', () => {
    const dt = doseTable()
    for (const scale of ['arcsinh', 'logicle'] as const) {
      const g = withValueAxis(graphOf(dt, 'meanSd'), 'x', {
        scale,
        tickValues: { major: [0, 10, 1000] },
      })
      expect(nodes(lay(dt, g), 'axis/x/tickLabel/').length).toBe(3)
    }
  })
})

describe('scale bars', () => {
  const plan = (scale: 'linear' | 'log10', domain: [number, number]) => {
    const s = makeAxisScale(scale, domain, [0, 200])
    return {
      which: 'x' as const,
      length: 200,
      toPx: (v: number) => s(v),
      fromPx: (p: number) => s.invert(p),
    }
  }

  it('is its length in data units on a linear axis wherever it is', () => {
    const p = plan('linear', [0, 100])
    for (const place of ['bottomLeft', 'bottomRight', { x: 30, y: 0 }] as const) {
      const [a, b] = scaleBarSpan(p, { length: 10, place })!
      expect(b - a).toBeCloseTo(20, 9)
    }
  })

  it('spans its data units where it stands on a log axis', () => {
    const p = plan('log10', [1, 10_000])
    // From a data position at 1: 1 to 10, one decade (50 pt of four).
    const [a, b] = scaleBarSpan(p, { length: 9, place: { x: 1, y: 0 } })!
    expect(a).toBeCloseTo(0, 9)
    expect(b).toBeCloseTo(50, 9)
    // In a corner: from the value at the corner's inset, into the plot.
    const [c, d] = scaleBarSpan(p, { length: 9, place: 'bottomLeft' })!
    expect(p.fromPx(d)).toBeCloseTo(p.fromPx(c) + 9, 6)
  })

  it('stands in for a hidden axis, labelled with the axis title’s unit', () => {
    const [cells, umap] = umapGraph()
    const x = umap.axes.x as ContinuousAxisSpec
    const g = {
      ...umap,
      axes: {
        ...umap.axes,
        x: {
          ...x,
          show: false,
          title: { content: [{ text: 'Distance (µm)' }] },
          scaleBar: { length: 5 },
        },
      },
    } as GraphNode
    const scene = lay(cells, g)
    expect(nodes(scene, 'axis/x/tick/')).toEqual([])
    const label = byId(scene, 'axis/x/scaleBar/label')!.prim as {
      layout: { runs: { text: string }[] }
    }
    expect(label.layout.runs[0]!.text).toBe('5 µm')
    const line = byId(scene, 'axis/x/scaleBar/line')!.prim as { x1: number; x2: number }
    expect(scene.axes!.x.fromPx(line.x2) - scene.axes!.x.fromPx(line.x1)).toBeCloseTo(5, 6)
  })
})

describe('corner arrows', () => {
  const [cells, umap] = umapGraph()
  it('draws arrows from the corner a fraction of the plot long, the titles beside them', () => {
    const scene = lay(cells, { ...umap, style: { ...umap.style, frame: 'arrows' } })
    expect(nodes(scene, 'axis/x/tick')).toEqual([])
    expect(nodes(scene, 'axis/y/tickLabel')).toEqual([])
    const x = byId(scene, 'arrows/x/line')!.prim as {
      x1: number
      y1: number
      x2: number
      y2: number
    }
    expect(x.x1).toBeCloseTo(scene.plot.x, 6)
    expect(x.y1).toBeCloseTo(scene.plot.y + scene.plot.h, 6)
    // The line stops short of the head's tip, the head reaching 0.2 of the plot's width.
    const head = byId(scene, 'arrows/x/head/0')!.prim as { points: [number, number][] }
    expect(head.points[0]![0] - scene.plot.x).toBeCloseTo(0.2 * scene.plot.w, 6)
    expect(byId(scene, 'axis/x/title')).toBeDefined()
    expect(byId(scene, 'axis/y/title')).toBeDefined()
    // The X title under the arrow, the Y title left of it.
    expect(centre(byId(scene, 'axis/x/title'))[1]).toBeGreaterThan(x.y1)
    expect(centre(byId(scene, 'axis/y/title'))[0]).toBeLessThan(x.x1)
  })

  it('is offered for an embedding’s two axes', () => {
    expect(isEmbeddingPair('UMAP_1', 'UMAP_2')).toBe(true)
    expect(isEmbeddingPair('umap1', 'UMAP 2')).toBe(true)
    expect(isEmbeddingPair('tSNE_1', 't-SNE_2')).toBe(true)
    expect(isEmbeddingPair('UMAP_2', 'UMAP_1')).toBe(false)
    expect(isEmbeddingPair('UMAP_1', 'tSNE_2')).toBe(false)
    expect(isEmbeddingPair('Age', 'Score')).toBe(false)
  })

  it('takes a length in points', () => {
    const scene = lay(cells, {
      ...umap,
      style: { ...umap.style, frame: 'arrows', arrows: { length: 30, unit: 'pt' } },
    })
    const head = byId(scene, 'arrows/y/head/0')!.prim as { points: [number, number][] }
    expect(scene.plot.y + scene.plot.h - head.points[0]![1]).toBeCloseTo(30, 6)
  })
})

describe('lines and bands at typed values', () => {
  const column = sampleTable('column')
  const base = graphOf(column, 'barsPoints')
  const [band, line] = manualLayers() as [Layer, Layer]

  it('draws them without an analysis, within the axis’ extent, with their labels', () => {
    const g = { ...base, layers: [band, ...base.layers, line] }
    const scene = lay(column, g)
    expect(scene.warnings).toEqual([])
    const rect = byId(scene, 'result/normal/all/band')!.prim as { y: number; h: number }
    const yOf = (v: number) => scene.axes!.y.toPx(v)
    expect(rect.y).toBeCloseTo(yOf(14), 6)
    expect(rect.y + rect.h).toBeCloseTo(yOf(10), 6)
    const at = byId(scene, 'result/cutoff/all/line')!.prim as { y1: number }
    expect(at.y1).toBeCloseTo(yOf(17.5), 6)
    expect(byId(scene, 'result/cutoff/all/lineLabel')).toBeDefined()
    expect(byId(scene, 'result/normal/all/lineLabel')).toBeDefined()
    // A line above every value still fits: the axis' extent includes it.
    const high = {
      ...line,
      stat: { ...line.stat, fields: { at: { ref: { from: 'number', v: 40 } } } },
    } as unknown as Layer
    const s2 = lay(column, { ...base, layers: [...base.layers, high] })
    expect(byId(s2, 'result/cutoff/all/line')).toBeDefined()
  })

  it('keeps their labels off the data, else where they were (roadmap 41)', () => {
    const xy = sampleTable('xy')
    const plot = graphOf(xy, 'meanSd')
    const lineAt = (v: number) =>
      ({
        ...line,
        stat: { ...line.stat, fields: { at: { ref: { from: 'number', v } } } },
      }) as unknown as Layer
    const labelBox = (scene: Scene) => byId(scene, 'result/cutoff/all/lineLabel')!.bbox!
    const pointsIn = (scene: Scene, b: { x: number; y: number; w: number; h: number }) =>
      flatten(scene.root)
        .filter((n) => /^series\/.+\/point\//.test(n.id) && n.prim?.type === 'symbol')
        .map((n) => n.prim as { cx: number; cy: number })
        .filter(
          (p) =>
            p.cx >= b.x - 3 && p.cx <= b.x + b.w + 3 && p.cy >= b.y - 3 && p.cy <= b.y + b.h + 3,
        )
    // Through the first points: its label at the start would sit on them; it moves off.
    const over = lay(xy, { ...plot, layers: [...plot.layers, lineAt(2.2)] })
    const free = lay(xy, { ...plot, layers: [...plot.layers, lineAt(20)] })
    const before = { ...labelBox(over), x: labelBox(free).x }
    expect(pointsIn(over, before).length).toBeGreaterThan(0)
    expect(pointsIn(over, labelBox(over))).toEqual([])
    // Far from the data: at the start, as before (2 pt in from the plot's left).
    expect(labelBox(free).x).toBeCloseTo(free.plot.x + 2, 6)
  })

  it('draws in the list’s order (a band behind the bars, in front once moved)', () => {
    const behind = lay(column, { ...base, layers: [band, ...base.layers] })
    const front = lay(column, { ...base, layers: [...base.layers, band] })
    const order = (s: Scene) => {
      const ids = flatten(s.root).map((n) => n.id)
      return ids.indexOf('result/normal/all/band') < ids.indexOf('series/a/bar')
    }
    expect(order(behind)).toBe(true)
    expect(order(front)).toBe(false)
  })

  it('names their legend entries by their label or values', () => {
    const shown: GraphNode = {
      ...base,
      legend: { ...base.legend, show: true },
      layers: [
        ...base.layers,
        band,
        { ...line, stat: { ...(line.stat as object), template: undefined } } as Layer,
      ],
    }
    const scene = lay(column, shown)
    expect(byId(scene, 'legend/result/normal')).toBeDefined()
    expect(byId(scene, 'legend/result/cutoff')).toBeDefined()
  })
})
