import { describe, expect, it } from 'vitest'
import {
  type AnalysisResult,
  axisUnit,
  fillTemplate,
  formatField,
  formatFieldNumber,
  formatFieldP,
  modifyInput,
  type NodeId,
  type NormalizedDataSet,
  parseTemplate,
  ResultStat,
  resolveResultRef,
  richPlain,
  templateFields,
} from '../src/index.ts'

// Results on graphs (roadmap 35): templates with fields, number and P formats, references to
// results by keys, and the analysis input's modifiers (values at one X, pools).

const SETTINGS = { pValueStyle: 'GP' as const, pValueDigits: 4 }

const RESULT: AnalysisResult = {
  status: 'ok',
  diagnostics: [],
  values: { r: { kind: 'number', v: 0.8234 }, 'slope:a': { kind: 'number', v: 2.5 } },
  comparisons: [
    {
      key: 'a|b',
      a: { node: 'n' as NodeId, key: 'a' },
      b: { node: 'n' as NodeId, key: 'b' },
      p: 0.01,
      pAdjusted: 0.03,
    },
  ],
  outputs: {},
  sheets: [
    {
      key: 'results',
      title: 'Table of results',
      blocks: [
        { type: 'note', text: 'Y = …' },
        {
          type: 'table',
          title: 'Best-fit values',
          columns: ['', 'Control', 'Treated'],
          rows: [
            [
              { kind: 'text', v: 'IC50' },
              { kind: 'number', v: 1.234 },
              { kind: 'number', v: 5.678 },
            ],
            [
              { kind: 'text', v: 'HillSlope' },
              { kind: 'number', v: -1 },
              { kind: 'number', v: -1.5 },
            ],
          ],
        },
        {
          type: 'keyValue',
          title: 'Odds ratio, A vs. B',
          rows: [
            { label: 'Odds ratio', value: { kind: 'number', v: 3.2 } },
            { label: '95% CI', value: { kind: 'interval', lo: 1.1, hi: 9.4, level: 0.95 } },
          ],
        },
        {
          type: 'keyValue',
          title: 'Test',
          rows: [{ label: 'P value', value: { kind: 'pvalue', v: 0.00002 } }],
        },
      ],
    },
  ],
}

describe('templates', () => {
  it('finds fields across runs and keeps the text’s formats', () => {
    const parts = parseTemplate([
      { text: 'r', italic: true },
      { text: ' = {r}, ' },
      { text: 'P', italic: true },
      { text: ' = {P}' },
    ])
    expect(parts.map((p) => ('field' in p ? `[${p.field}]` : p.text)).join('')).toBe(
      'r = [r], P = [P]',
    )
    expect(parts[0]).toEqual({ text: 'r', run: { italic: true } })
    expect(templateFields('{a} and {b} and {a}')).toEqual(['a', 'b'])
    // A field split over runs (its brace opening in the first) still counts; braces escaped.
    expect(templateFields([{ text: '{I' }, { text: 'C50}', bold: true }])).toEqual(['IC50'])
    expect(templateFields('{{not}} a field')).toEqual([])
    expect(richPlain(fillTemplate('{{x}}', () => null).runs)).toBe('{x}')
  })

  it('fills fields in, unknown ones as "—", and reads "P < 0.0001" (not "P = < 0.0001")', () => {
    const value = (f: string) =>
      f === 'r' ? [{ text: '0.82' }] : f === 'P' ? [{ text: '< 0.0001' }] : null
    const { runs, unknown } = fillTemplate(
      [
        { text: 'r', italic: true },
        { text: ' = {r}, ' },
        { text: 'P', italic: true },
        { text: ' = {P}, n = {n}' },
      ],
      value,
    )
    expect(richPlain(runs)).toBe('r = 0.82, P < 0.0001, n = —')
    expect(runs[0]).toEqual({ text: 'r', italic: true })
    expect(unknown).toEqual(['n'])
    // A field's own formatting (a superscript) over the text's.
    const sup = fillTemplate([{ text: '{P}', bold: true }], () => [
      { text: '1.2 × 10' },
      { text: '−5', sup: true },
    ]).runs
    expect(sup).toEqual([
      { text: '1.2 × 10', bold: true },
      { text: '−5', bold: true, sup: true },
    ])
  })
})

describe('number and P formats', () => {
  it('numbers by significant digits or decimals, with a unit', () => {
    expect(formatFieldNumber(1.23456)).toBe('1.23')
    expect(formatFieldNumber(1234.56)).toBe('1235')
    expect(formatFieldNumber(0.0123456, { digits: 2 })).toBe('0.012')
    expect(formatFieldNumber(1.23456, { decimals: 1 })).toBe('1.2')
    expect(formatFieldNumber(-0.001, { decimals: 2 })).toBe('0.00')
    const v = { kind: 'number' as const, v: 1.2345 }
    expect(richPlain(formatField(v, { unit: 'µM' }, SETTINGS))).toBe('1.23 µM')
    expect(richPlain(formatField(v, {}, SETTINGS, 'nM'))).toBe('1.23 nM')
    expect(richPlain(formatField({ kind: 'integer', v: 12 }, {}, SETTINGS))).toBe('12')
    expect(richPlain(formatField(null, {}, SETTINGS))).toBe('—')
    expect(
      richPlain(
        formatField(
          { kind: 'interval', lo: 1.111, hi: 2.222, level: 0.95 },
          { digits: 2 },
          SETTINGS,
        ),
      ),
    ).toBe('1.1 to 2.2')
  })

  it('P values: exact, below a threshold, scientific, stars, the project’s style', () => {
    const p = (v: number, f = {}) => richPlain(formatFieldP(v, f, SETTINGS))
    expect(p(0.01234)).toBe('0.012')
    expect(p(0.00001234)).toBe('< 0.0001')
    expect(p(0.0004, { below: 0.001 })).toBe('< 0.001')
    expect(p(0.01234, { p: 'exact', digits: 3 })).toBe('0.0123')
    expect(formatFieldP(0.0000123, { p: 'scientific' }, SETTINGS)).toEqual([
      { text: '1.2 × 10' },
      { text: '−5', sup: true },
    ])
    expect(p(0.003, { p: 'stars' })).toBe('**')
    expect(p(0.3, { p: 'stars' })).toBe('ns')
    expect(p(0.3, { p: 'stars', ns: false })).toBe('')
    expect(p(0.00001, { p: 'project' })).toBe('<0.0001')
    expect(p(Number.NaN)).toBe('—')
  })

  it('reads a unit from an axis title', () => {
    expect(axisUnit('Concentration (µM)')).toBe('µM')
    expect(axisUnit('log[Inhibitor], M')).toBe('M')
    expect(axisUnit('Time')).toBeNull()
    expect(axisUnit(null)).toBeNull()
  })
})

describe('references to results', () => {
  const at = (ref: Parameters<typeof resolveResultRef>[1], ds?: { key: string; title: string }) =>
    resolveResultRef(RESULT, ref, SETTINGS, ds)

  it('values, cells by block, row and column, comparisons', () => {
    expect(at({ from: 'value', key: 'r' })).toEqual({ kind: 'number', v: 0.8234 })
    expect(at({ from: 'value', key: 'slope:{key}' }, { key: 'a', title: 'A' })).toEqual({
      kind: 'number',
      v: 2.5,
    })
    expect(
      at({
        from: 'cell',
        sheet: 'results',
        block: 'Best-fit values',
        row: 'IC50',
        column: 'Treated',
      }),
    ).toEqual({ kind: 'number', v: 5.678 })
    // Per data set: the column of its title.
    expect(
      at(
        { from: 'cell', sheet: 'results', row: 'IC50', column: '{dataSet}' },
        { key: 'a', title: 'Control' },
      ),
    ).toEqual({ kind: 'number', v: 1.234 })
    // Blocks by the start of their title; the first block with the row.
    expect(
      at({ from: 'cell', sheet: 'results', block: 'Odds ratio', row: '95% CI', end: 'hi' }),
    ).toEqual({ kind: 'number', v: 9.4 })
    expect(at({ from: 'cell', sheet: 'results', row: 'P value' })).toEqual({
      kind: 'pvalue',
      v: 0.00002,
    })
    expect(at({ from: 'comparison', key: 'a|b' })).toEqual({ kind: 'pvalue', v: 0.03 })
  })

  it('says null when a value is gone', () => {
    expect(at({ from: 'value', key: 'rs' })).toBeNull()
    expect(at({ from: 'cell', sheet: 'gone', row: 'IC50' })).toBeNull()
    expect(at({ from: 'cell', sheet: 'results', row: 'IC50', column: 'Nobody' })).toBeNull()
    expect(at({ from: 'comparison', key: 'a|c' })).toBeNull()
    expect(resolveResultRef(undefined, { from: 'value', key: 'r' }, SETTINGS)).toBeNull()
  })

  it('the stat validates', () => {
    expect(
      ResultStat.safeParse({
        kind: 'result',
        fields: { IC50: { ref: { from: 'value', key: 'x' }, format: { axisUnit: 'x' } } },
        template: '{IC50}',
        place: { at: 'corner', corner: 'topRight' },
      }).success,
    ).toBe(true)
    expect(
      ResultStat.safeParse({
        kind: 'result',
        fields: { '1x': { ref: { from: 'value', key: 'x' } } },
      }).success,
    ).toBe(false)
  })
})

describe('analysis input modifiers', () => {
  const ds = (key: string, x: number[], reps: number[][]): NormalizedDataSet => ({
    ref: { node: 't' as NodeId, key },
    title: key.toUpperCase(),
    rowCount: x.length,
    rowTitles: null,
    x: Float64Array.from(x),
    data: { shape: 'replicates', reps: reps.map((r) => Float64Array.from(r)) },
    counts: { empty: 0, excluded: 0 },
  })
  const a = ds(
    'a',
    [0, 24, 72],
    [
      [1, 2, 3],
      [1.5, 2.5, 3.5],
    ],
  )
  const b = ds(
    'b',
    [0, 24, 72],
    [
      [4, 5, 6],
      [4.5, Number.NaN, 6.5],
    ],
  )

  it('values at one X become a column table’s data sets', () => {
    const out = modifyInput([a, b], { atX: 72 }, 'xy')
    if ('error' in out) throw new Error(out.error)
    expect(out.tableKind).toBe('column')
    expect(out.input.map((d) => [...(d.data as { reps: Float64Array[] }).reps[0]!])).toEqual([
      [3, 3.5],
      [6, 6.5],
    ])
    expect(out.input[0]!.x).toBeNull()
    expect(modifyInput([a], { atX: 5 }, 'xy')).toEqual({ error: 'No values at X = 5.' })
  })

  it('pools data sets under the first one’s key, in its place', () => {
    const c = ds('c', [0, 24, 72], [[7, 8, 9]])
    const out = modifyInput([a, b, c], { pools: [['a', 'c']] }, 'grouped')
    if ('error' in out) throw new Error(out.error)
    expect(out.input.map((d) => d.title)).toEqual(['A + C', 'B'])
    expect(out.input[0]!.ref.key).toBe('a')
    expect((out.input[0]!.data as { reps: Float64Array[] }).reps).toHaveLength(3)
    expect(out.tableKind).toBe('grouped')
    // At one X, then pooled: one column of every value.
    const both = modifyInput([a, b, c], { atX: 72, pools: [['a', 'b']] }, 'xy')
    if ('error' in both) throw new Error(both.error)
    expect(both.input.map((d) => d.title)).toEqual(['A + B', 'C'])
  })
})
