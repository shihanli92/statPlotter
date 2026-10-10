import { type DataTable, type GraphNode, levelKey, type NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  cellMeasure,
  checkLayers,
  FRAMES,
  geomAllowed,
  layoutGraph,
  mappedData,
  mappedNotes,
  mappedSeries,
  mappedVariable,
  matrixKindOf,
  presetGraph,
  resolveSeries,
  sortLevels,
} from '../src/index.ts'
import { fonts, projectOf, sampleVariables } from './helpers.ts'

// Graphs of a multiple-variables table's variables straight from the table (roadmap 34a): the
// adapter from rows to the category, grouped and matrix frames' series, the levels' order, what
// is left out, and the matrix's kinds by axis types.

const t = sampleVariables()
const graphOf = (mapping: GraphNode['mapping'], frame: GraphNode['frame'], more = {}) =>
  ({ frame, mapping, ...more }) as Pick<GraphNode, 'frame' | 'mapping' | 'levels'>

describe('the data adapter', () => {
  it('splits a number variable by a text variable’s levels, in the order they first appear', () => {
    const d = mappedData(t, { mapping: { x: 'a', y: 'c' } }, null)!
    expect(d.vars.axes).toBe('tn')
    expect(d.cats).toEqual(['Low', 'High', 'Mid'])
    expect(d.groups).toEqual([])
    // Row 12 has no Group, row 13 no Score: both left out (and counted).
    expect(d.cells.map((c) => c[0])).toEqual([
      [0, 3, 6, 9],
      [1, 4, 7, 10],
      [2, 5, 8, 11],
    ])
    expect(d.left).toEqual({ level: 1, value: 1 })
    expect(d.n).toBe(12)
  })

  it('splits each category by the colour variable’s levels', () => {
    const d = mappedData(t, { mapping: { x: 'a', y: 'c', color: 'b' } }, null)!
    expect(d.groups).toEqual(['F', 'M'])
    expect(d.cells).toEqual([
      [
        [0, 6],
        [3, 9],
      ],
      [
        [4, 10],
        [1, 7],
      ],
      [
        [2, 8],
        [5, 11],
      ],
    ])
    expect(d.firstCat).toEqual([0, 1, 2])
    expect(d.firstGroup).toEqual([0, 1])
  })

  it('counts each combination of two text variables, or its percent', () => {
    const d = mappedData(t, { mapping: { x: 'a', y: 'b' } }, null)!
    expect(d.vars.axes).toBe('tt')
    // Row 13 has a Group and a Sex (no Score is no matter): counted; row 12 has no Group.
    expect(cellMeasure(d)).toEqual([
      [3, 2],
      [2, 2],
      [2, 2],
    ])
    expect(cellMeasure(d, 'percentOfX')[0]).toEqual([60, 40])
    const total = cellMeasure(d, 'percentOfTotal')
    expect(total.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 12)
    expect(total[0]![0]).toBeCloseTo(300 / 13, 12)
    expect(d.left).toEqual({ level: 1, value: 0 })
  })

  it('makes a series per level for each frame, keyed by its level', () => {
    const cat = mappedSeries(t, graphOf({ x: 'a', y: 'c' }, 'category'), null)!
    expect(cat.map((s) => s.title)).toEqual(['Low', 'High', 'Mid'])
    expect(cat[0]!.key).toBe(levelKey('Low'))
    // A level's rows as a row slice: values in table order, their table rows.
    expect(cat[0]!.rows).toEqual([0, 3, 6, 9])
    expect([...(cat[0]!.ds.data as { reps: Float64Array[] }).reps[0]!]).toEqual([12, 10, 13, 11])
    const grouped = mappedSeries(t, graphOf({ x: 'a', y: 'c', color: 'b' }, 'grouped'), null)!
    expect(grouped.map((s) => s.title)).toEqual(['F', 'M'])
    expect(grouped[0]!.ds.rowTitles).toEqual(['Low', 'High', 'Mid'])
    expect(grouped[0]!.cells![1]!.map((p) => [p.row, p.value])).toEqual([
      [4, 21],
      [10, 22],
    ])
    // Text × text: a series per Y level, a cluster per X level, counts as values.
    const counts = mappedSeries(t, graphOf({ x: 'a', y: 'b' }, 'grouped'), null)!
    expect(counts.map((s) => s.title)).toEqual(['F', 'M'])
    expect([...(counts[0]!.ds.data as { reps: Float64Array[] }).reps[0]!]).toEqual([3, 2, 2])
    // A heat map: a column per X level, a row per Y level.
    const heat = mappedSeries(t, graphOf({ x: 'a', y: 'b' }, 'matrix'), null)!
    expect(heat.map((s) => s.title)).toEqual(['Low', 'High', 'Mid'])
    expect(heat[0]!.ds.rowTitles).toEqual(['F', 'M'])
    // A category frame draws no colour groups.
    const plain = mappedSeries(t, graphOf({ x: 'a', y: 'c', color: 'b' }, 'category'), null)!
    expect(plain.map((s) => s.title)).toEqual(['Low', 'High', 'Mid'])
    // Not a graph of variables.
    expect(mappedSeries(t, graphOf(undefined, 'category'), null)).toBeNull()
  })

  it('reads the number variable the other way round (number × text) and calculated variables', () => {
    const d = mappedData(t, { mapping: { x: 'c', y: 'a' } }, null)!
    expect(d.vars.axes).toBe('nt')
    expect(d.vars.cat.id).toBe('a')
    expect(d.vars.value?.id).toBe('c')
    const calc: DataTable = structuredClone(t)
    calc.dataSets.push({ ...structuredClone(calc.dataSets[3]!), id: 'e' as never, title: 'Twice' })
    calc.dataSets[4]!.subcolumns[0]!.values = calc.dataSets[4]!.subcolumns[0]!.values.map(
      () => null,
    )
    calc.dataSets[4]!.formula = '=Score * 2'
    const twice = mappedData(calc, { mapping: { x: 'a', y: 'e' } }, null)!
    expect(twice.cells[0]![0]!.map((r) => twice.values![r])).toEqual([24, 20, 26, 22])
  })

  it('follows the graph’s rows and the table’s exclusions', () => {
    const d = mappedData(t, { mapping: { x: 'a', y: 'c' } }, [4, 0, 1])!
    expect(d.cats).toEqual(['High', 'Low'])
    const excluded: DataTable = structuredClone(t)
    excluded.dataSets[2]!.subcolumns[0]!.excluded = Array.from({ length: 14 }, (_, r) => r === 0)
    excluded.dataSets[0]!.subcolumns[0]!.excluded = Array.from({ length: 14 }, (_, r) => r === 1)
    const e = mappedData(excluded, { mapping: { x: 'a', y: 'c' } }, null)!
    // Row 1's High excluded: Mid is now seen before High.
    expect(e.cats).toEqual(['Low', 'Mid', 'High'])
    expect(e.cells[0]![0]).toEqual([3, 6, 9])
    expect(e.cells[2]![0]).toEqual([4, 7, 10])
    expect(e.left).toEqual({ level: 2, value: 2 })
  })

  it('caches by the table object: an edit is seen at once', () => {
    const graph = { mapping: { x: 'a', y: 'c' } }
    expect(mappedData(t, graph, null)).toBe(mappedData(t, graph, null))
    const edited: DataTable = { ...t, dataSets: t.dataSets.map((d) => ({ ...d })) }
    edited.dataSets[0] = { ...edited.dataSets[0]!, text: [...edited.dataSets[0]!.text!] }
    edited.dataSets[0]!.text![0] = 'New'
    // In the table's order, a level first seen in row 0 comes first; after an order of the
    // graph's own, a new level goes at the end.
    expect(mappedData(edited, graph, null)!.cats).toEqual(['New', 'High', 'Mid', 'Low'])
    const ordered = { ...graph, levels: { a: ['Low', 'High', 'Mid'] } }
    expect(mappedData(edited, ordered, null)!.cats).toEqual(['Low', 'High', 'Mid', 'New'])
    expect(mappedData(t, graph, null)!.cats).toEqual(['Low', 'High', 'Mid'])
  })
})

describe('the order of levels', () => {
  const tn = { x: 'a', y: 'c' }
  it('is the graph’s own: new levels at the end, levels gone left out', () => {
    const d = mappedData(t, { mapping: tn, levels: { a: ['Mid', 'Gone', 'Low'] } }, null)!
    expect(d.cats).toEqual(['Mid', 'Low', 'High'])
    // The colour groups' order too, and the legend's.
    const g = mappedData(t, { mapping: { ...tn, color: 'b' }, levels: { b: ['M', 'F'] } }, null)!
    expect(g.groups).toEqual(['M', 'F'])
  })

  it('sorts A→Z, by mean or by count', () => {
    const graph = graphOf(tn, 'category')
    const levels = ['Low', 'High', 'Mid']
    expect(sortLevels(t, graph, 'a', levels, 'alpha')).toEqual(['High', 'Low', 'Mid'])
    expect(sortLevels(t, graph, 'a', levels, 'mean')).toEqual(['Low', 'Mid', 'High'])
    const tt = graphOf({ x: 'a', y: 'b' }, 'grouped')
    // Low has five rows with a Sex, the others four; ties keep their order.
    expect(sortLevels(t, tt, 'a', levels, 'count')).toEqual(['Low', 'High', 'Mid'])
    expect(sortLevels(t, tt, 'b', ['F', 'M'], 'count')).toEqual(['F', 'M'])
    expect(sortLevels(t, graphOf(tn, 'category'), 'a', ['B10', 'b2', 'A'], 'alpha')).toEqual([
      'A',
      'b2',
      'B10',
    ])
  })
})

describe('a variable as the scales read it (audit 3, P4, P6)', () => {
  it('reads a table’s rows once per variable and rows shown, its order the graph’s each time', () => {
    const t = sampleVariables()
    const a = mappedVariable(t, {}, 'a', null)!
    const again = mappedVariable(t, { levels: { a: ['Mid', 'High', 'Low'] } }, 'a', null)!
    expect(again.levels).toBe(a.levels)
    expect(a.order).toEqual(['Low', 'High', 'Mid'])
    expect(again.order).toEqual(['Mid', 'High', 'Low'])
    const rows = [1, 2]
    expect(mappedVariable(t, {}, 'a', rows)!.order).toEqual(['High', 'Mid'])
    expect(mappedVariable(t, {}, 'a', rows)!.levels).toBe(mappedVariable(t, {}, 'a', rows)!.levels)
    expect(mappedVariable(t, {}, 'c', null)!.values).toBe(mappedVariable(t, {}, 'c', null)!.values)
    // An edited table (a new object) is read again.
    const edited = {
      ...t,
      dataSets: t.dataSets.map((d, i) => (i ? d : { ...d, text: d.text!.map(() => 'One') })),
    }
    expect(mappedVariable(edited, {}, 'a', null)!.order).toEqual(['One'])
    expect(mappedVariable(t, {}, 'a', null)!.order).toEqual(['Low', 'High', 'Mid'])
  })
})

describe('notes in the graph’s warnings', () => {
  it('say how many rows were left out and why', () => {
    expect(mappedNotes(t, graphOf({ x: 'a', y: 'c' }, 'category'), null)).toEqual([
      '1 row without a level of Group left out.',
      '1 row without a value of Score (empty or excluded) left out.',
    ])
    expect(mappedNotes(t, graphOf({ x: 'a', y: 'b' }, 'grouped'), null)).toEqual([
      '1 row without a level of Group or Sex left out.',
    ])
    expect(mappedNotes(t, graphOf({ x: 'c', y: 'd' }, 'category'), null)[0]).toMatch(/both number/)
    expect(mappedNotes(t, graphOf({ x: 'a', y: 'zz' }, 'category'), null)[0]).toMatch(
      /no longer in the table/,
    )
  })

  it('reach the laid-out graph', () => {
    const g = { ...presetGraph(t, 'groupBoxPoints'), id: 'g1' as NodeId }
    const scene = layoutGraph({ project: projectOf(t, g), graph: g, fonts })
    expect(scene.warnings).toContain('1 row without a level of Group left out.')
    expect(resolveSeries(projectOf(t, g), g).map((s) => s.title)).toEqual(['Low', 'High', 'Mid'])
  })
})

describe('the matrix’s kinds of graphs of variables', () => {
  it('follow the types of the variables on the axes', () => {
    expect(matrixKindOf(t, { mapping: { x: 'a', y: 'c' } })).toBe('mvTextNumber')
    expect(matrixKindOf(t, { mapping: { x: 'c', y: 'a' } })).toBe('mvNumberText')
    expect(matrixKindOf(t, { mapping: { x: 'a', y: 'b' } })).toBe('mvTextText')
    expect(matrixKindOf(t, { mapping: { x: 'c', y: 'd' } })).toBe('multipleVariables')
    expect(matrixKindOf(t, {})).toBe('multipleVariables')
  })

  it('offer what draws: values by levels, counts of combinations', () => {
    expect(FRAMES.mvTextNumber).toEqual(['category', 'grouped'])
    expect(FRAMES.mvTextText).toEqual(['grouped', 'matrix'])
    expect(geomAllowed('mvTextNumber', 'violin', 'density').allowed).toBe(true)
    expect(geomAllowed('mvTextNumber', 'connector', 'identity').allowed).toBe(false)
    expect(geomAllowed('mvTextText', 'points', 'identity').reason).toBe(
      'not for two text variables',
    )
    expect(geomAllowed('mvTextText', 'tile', 'cell').allowed).toBe(true)
    const bars = { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } } as const
    const band = {
      id: 'band',
      geom: 'band',
      stat: { kind: 'summary', center: 'mean', error: 'SD' },
    } as const
    expect(
      checkLayers({ frame: 'category', layers: [band] }, 'mvTextNumber').get('band')?.allowed,
    ).toBe(false)
    expect(
      checkLayers({ frame: 'matrix', layers: [bars] }, 'mvTextNumber').get('bars')?.reason,
    ).toBe('not a matrix graph of a number variable by a text variable')
  })
})
