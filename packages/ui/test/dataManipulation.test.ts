import { createTable, type DataTable, type GraphNode, tableFormulas, tableIssues } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { conditionFormula, parseCondition } from '../src/analysis/condition.ts'
import { swapMappedXY } from '../src/graph/swapXY.ts'
import { frozenCopy } from '../src/resultTables.ts'
import { suggestionsAt } from '../src/table/FormulaBar.tsx'
import {
  binFormula,
  parseBreaks,
  parseRecode,
  recodeFormula,
  transformFormula,
  transformTitle,
  VARIABLE_TRANSFORMS,
} from '../src/table/variableFormulas.ts'

// Roadmap 38's UI logic: the formulas the data-manipulation dialogs write, Filter rows'
// condition editor, the formula bar's suggestions, Swap X and Y of graphs of variables, Freeze.

function mv(cols: Record<string, (number | null)[] | (string | null)[] | string>): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(1, ...Object.values(cols).map((v) => (Array.isArray(v) ? v.length : 0)))
  const t = createTable({ tableKind: 'multipleVariables', columns: titles.length, rows })
  titles.forEach((title, i) => {
    const ds = t.dataSets[i]!
    ds.title = title
    const v = cols[title]!
    if (typeof v === 'string') ds.formula = v
    else if (v.some((x) => typeof x === 'string')) ds.text = v as (string | null)[]
    else ds.subcolumns[0]!.values = v as (number | null)[]
  })
  return t
}
const values = (t: DataTable, title: string) => {
  const f = tableFormulas(t).get(t.dataSets.find((d) => d.title === title)!.id)!
  expect(f.error).toBeNull()
  return f.text ?? [...f.values].map((v) => (Number.isNaN(v) ? null : +v.toPrecision(12)))
}

describe('Transform variables', () => {
  it('writes a formula for every transform, valid on a table, within groups when asked', () => {
    for (const c of VARIABLE_TRANSFORMS) {
      for (const group of [null, 'sample']) {
        const t = mv({
          'CD4 count': [1, 2, 4, 8],
          sample: ['a', 'a', 'b', 'b'],
          F: transformFormula(c.id, 'CD4 count', c.k?.value ?? 1, group),
        })
        expect(tableIssues(t)).toEqual([])
        const f = tableFormulas(t).get(t.dataSets[2]!.id)!
        expect(f.error, `${c.id} ${group}`).toBeNull()
      }
    }
    const t = mv({
      x: [1, 2, 4, 8],
      g: ['a', 'a', 'b', 'b'],
      Z: transformFormula('zscore', 'x', 1, 'g'),
      U: transformFormula('unit', 'x', 1, 'g'),
      P: transformFormula('percent', 'x', 1, null),
      M: transformFormula('minusMedian', 'x', 1, 'g'),
      D: transformFormula('overMean', 'x', 1, null),
      L: transformFormula('logK', 'x', 2, null),
      A: transformFormula('asinh', 'x', 5, null),
    })
    // ±1/√2: each group's two values, one SD (n − 1) either side of their mean.
    const h = +Math.SQRT1_2.toPrecision(12)
    expect(values(t, 'Z')).toEqual([-h, h, -h, h])
    expect(values(t, 'U')).toEqual([0, 1, 0, 1])
    expect(values(t, 'P')).toEqual([0, 14.2857142857, 42.8571428571, 100])
    expect(values(t, 'M')).toEqual([-0.5, 0.5, -2, 2])
    expect(values(t, 'D')).toEqual([0.266666666667, 0.533333333333, 1.06666666667, 2.13333333333])
    expect(values(t, 'L')).toEqual([0, 1, 2, 3])
    expect(values(t, 'A')).toEqual([0.198690110349, 0.390035319771, 0.732668256045, 1.2489833279])
    expect(transformTitle('zscore', 'CD4', 1, 'sample')).toBe('CD4 z by sample')
    expect(transformTitle('log2', 'CD4', 1, 'sample')).toBe('CD4 log2')
    expect(transformTitle('asinh', 'CD4', 150, null)).toBe('CD4 asinh/150')
  })
})

describe('Recode and bin', () => {
  it('recodes levels, keeping or blanking the others, and reads its formula back', () => {
    const f = recodeFormula(
      'cell type',
      [
        ['CD4 T', 'T'],
        ['CD8 T', 'T'],
        ['B', 'B'],
      ],
      'keep',
    )
    expect(f).toBe('=recode([cell type], "CD4 T", "T", "CD8 T", "T")')
    const t = mv({ 'cell type': ['CD4 T', 'CD8 T', 'B', 'NK'], R: f })
    expect(values(t, 'R')).toEqual(['T', 'T', 'B', 'NK'])
    const blank = recodeFormula(
      'cell type',
      [
        ['CD4 T', 'T'],
        ['B', 'B'],
      ],
      'blank',
    )
    const u = mv({ 'cell type': ['CD4 T', 'CD8 T', 'B'], R: blank })
    expect(values(u, 'R')).toEqual(['T', null, 'B'])
    expect(parseRecode(blank)).toEqual({
      source: 'cell type',
      pairs: [
        ['CD4 T', 'T'],
        ['B', 'B'],
      ],
      unmapped: 'blank',
    })
    expect(parseRecode(f)!.unmapped).toBe('keep')
    expect(parseRecode('=x + 1')).toBeNull()
    expect(recodeFormula('g', [['a', 'a']], 'keep')).toBe('=recode(g, "", "")')
  })

  it('bins at cut points, equal widths or quantiles, with labels', () => {
    expect(
      binFormula('nCount', { method: 'breaks', breaks: [0, 500, 2000], closure: 'right' }),
    ).toBe('=cut(nCount, 0, 500, 2000)')
    expect(
      binFormula('nCount', {
        method: 'quantile',
        n: 4,
        closure: 'left',
        labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      }),
    ).toBe('=cutquantile(nCount, "[)", 4, "Q1", "Q2", "Q3", "Q4")')
    const t = mv({
      n: [100, 600, 1500, 3000],
      B: binFormula('n', {
        method: 'breaks',
        breaks: [0, 500, 2000, 5000],
        closure: 'right',
        labels: ['low', 'mid', 'high'],
      }),
      W: binFormula('n', { method: 'width', n: 2, closure: 'right' }),
    })
    expect(values(t, 'B')).toEqual(['low', 'mid', 'mid', 'high'])
    expect(values(t, 'W')).toEqual([
      '[97.1, 1.55e+03]',
      '[97.1, 1.55e+03]',
      '[97.1, 1.55e+03]',
      '(1.55e+03, 3e+03]',
    ])
    expect(parseBreaks('0, 10 100')).toEqual([0, 10, 100])
    expect(parseBreaks('1, 1')).toBeNull()
    expect(parseBreaks('5')).toBeNull()
  })
})

describe('Filter rows: the condition editor', () => {
  const isText = (v: string) => v === 'sample'
  it('builds AND within a group and OR between groups, and reads them back', () => {
    const f = conditionFormula(
      [
        [
          { variable: 'sample', op: '=', value: 'S1' },
          { variable: 'nCount', op: '>', value: '500' },
        ],
        [{ variable: 'sample', op: 'startswith', value: 'ctl' }],
      ],
      isText,
    )
    expect(f).toBe('(sample = "S1" and nCount > 500) or startswith(sample, "ctl")')
    expect(parseCondition(f!)).toEqual([
      [
        { variable: 'sample', op: '=', value: 'S1' },
        { variable: 'nCount', op: '>', value: '500' },
      ],
      [{ variable: 'sample', op: 'startswith', value: 'ctl' }],
    ])
    expect(parseCondition('sample == "S1" and nCount > -5')).toEqual([
      [
        { variable: 'sample', op: '=', value: 'S1' },
        { variable: 'nCount', op: '>', value: '-5' },
      ],
    ])
    expect(conditionFormula([[{ variable: 'nCount', op: 'blank', value: '' }]], isText)).toBe(
      'isblank(nCount)',
    )
    expect(parseCondition('not isblank(nCount)')).toEqual([
      [{ variable: 'nCount', op: 'notblank', value: '' }],
    ])
    // Incomplete: a number variable's value must be a number.
    expect(conditionFormula([[{ variable: 'nCount', op: '>', value: 'abc' }]], isText)).toBeNull()
    // Formulas of another shape are typed.
    expect(parseCondition('mod(Row, 2) = 0')).toBeNull()
    expect(parseCondition('')).toEqual([[]])
  })
})

describe('the formula bar’s suggestions', () => {
  it('suggests functions and variables for the name before the caret', () => {
    const s = suggestionsAt('=med', 4, ['Median count', 'x'])!
    expect(s.start).toBe(1)
    expect(s.items.map((i) => i.insert)).toEqual(['median(', 'medianby(', '[Median count]'])
    expect(suggestionsAt('="med', 5, [])).toBeNull()
    expect(suggestionsAt('=[med', 5, [])).toBeNull()
    expect(suggestionsAt('=1 + ', 5, [])).toBeNull()
    expect(suggestionsAt('=zscore(', 7, [])).toBeNull()
    expect(suggestionsAt('=cd', 3, ['CD4 count'])!.items[0]!.insert).toBe('[CD4 count]')
  })
})

describe('Swap X and Y of a graph of variables', () => {
  const t = mv({ a: [1], b: [2], g: ['x'] })
  const [a, b, g] = t.dataSets.map((d) => d.id)
  const graph = (x: string, y: string): GraphNode =>
    ({
      kind: 'graph',
      id: 'gr',
      mapping: { x, y },
      style: {},
      axes: { x: { type: 'continuous', title: 'X' }, y: { type: 'continuous', title: 'Y' } },
      links: { x: 'L1' },
    }) as unknown as GraphNode
  it('swaps the mapping, the axes and their links in one set of commands', () => {
    const cmds = swapMappedXY(graph(a!, b!), t)!
    expect(cmds[0]).toMatchObject({ path: ['mapping'], value: { x: b, y: a } })
    expect(cmds[1]).toMatchObject({
      path: ['axes'],
      value: { x: { title: 'Y' }, y: { title: 'X' } },
    })
    expect(cmds[2]).toMatchObject({ path: ['links'], value: { y: 'L1' } })
  })
  it('turns a number by a text variable', () => {
    const cmds = swapMappedXY(graph(g!, a!), t)!
    expect(cmds).toHaveLength(2)
    expect(cmds[1]).toMatchObject({ path: ['style', 'orientation'], value: 'horizontal' })
    expect(swapMappedXY(graph(a!, g!), t)![1]).toMatchObject({ value: undefined })
    expect(
      swapMappedXY({ ...graph(a!, b!), mapping: undefined, layers: [] } as unknown as GraphNode, t),
    ).toBeNull()
  })
  it('swaps an XY graph’s layers’ X and Y (and vectors’ ends)', () => {
    const xy = {
      ...graph(a!, b!),
      mapping: undefined,
      layers: [
        { id: 'p', geom: 'points', aes: { x: a, y: b, color: g } },
        { id: 's', geom: 'segment', aes: { x: a, y: b, xend: 'e1', yend: 'e2' } },
        { id: 'o', geom: 'line' },
      ],
    } as unknown as GraphNode
    const cmds = swapMappedXY(xy, t)!
    expect(cmds[0]).toMatchObject({
      path: ['layers'],
      value: [
        { aes: { x: b, y: a, color: g } },
        { aes: { x: b, y: a, xend: 'e2', yend: 'e1' } },
        { id: 'o' },
      ],
    })
    expect(cmds[1]).toMatchObject({ path: ['axes'] })
  })
})

describe('Freeze as data table', () => {
  it('copies the table under a new id and name, sharing nothing', () => {
    const t = mv({ a: [1, 2], g: ['x', 'y'] })
    const copy = frozenCopy(t, 'Frozen')
    expect(copy.id).not.toBe(t.id)
    expect(copy.name).toBe('Frozen')
    expect(copy.dataSets).toEqual(t.dataSets)
    expect(copy.dataSets[0]).not.toBe(t.dataSets[0])
    expect(tableIssues(copy)).toEqual([])
  })
})
