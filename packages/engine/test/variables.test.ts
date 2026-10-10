import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  createInfoSheet,
  createProject,
  createTable,
  type DataTable,
  newNodeId,
  normalizeTable,
  tableFormulas,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type AnalysisJob,
  type AnalysisRegistry,
  CommandError,
  DocumentStore,
  inlineRunner,
  type JobRunner,
} from '../src/index.ts'
import { startedEngine } from './helpers.ts'

function setup(kind: DataTable['tableKind'] = 'multipleVariables') {
  const table = createTable({ tableKind: kind, rows: 3, columns: 3 })
  table.dataSets.forEach((d, i) => {
    d.title = ['Weight', 'Height', 'Group'][i]!
  })
  table.dataSets[0]!.subcolumns[0]!.values = [80, 60, 90]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 1.5, null]
  table.dataSets[2]!.subcolumns[0]!.values = [1, 2, 1]
  const store = new DocumentStore(createProject())
  store.dispatch({ type: 'node.add', node: table })
  const t = () => store.getState().nodes[table.id] as DataTable
  const ids = table.dataSets.map((d) => d.id)
  return { store, table, t, ids }
}

describe('text variables', () => {
  it('converts a numeric variable to text and back, undoably', () => {
    const { store, table, t, ids } = setup()
    store.dispatch({ type: 'table.setVariableType', table: table.id, ids: [ids[2]!], to: 'text' })
    expect(t().dataSets[2]!.text).toEqual(['1', '2', '1'])
    expect(t().dataSets[2]!.subcolumns[0]!.values).toEqual([null, null, null])
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [
        { col: ids[2]!, row: 0, value: 'WT' },
        { col: ids[2]!, row: 1, value: ' ' },
      ],
    })
    expect(t().dataSets[2]!.text).toEqual(['WT', null, '1'])
    expect(normalizeTable(t())[2]!.text).toEqual(['WT', null, '1'])

    // Back to numbers: text that isn't a number is cleared.
    store.dispatch({ type: 'table.setVariableType', table: table.id, ids: [ids[2]!], to: 'number' })
    expect(t().dataSets[2]!.text).toBeUndefined()
    expect(t().dataSets[2]!.subcolumns[0]!.values).toEqual([null, null, 1])
    store.undo()
    expect(t().dataSets[2]!.text).toEqual(['WT', null, '1'])
    store.undo()
    store.undo()
    expect(t().dataSets[2]!.text).toBeUndefined()
    expect(t().dataSets[2]!.subcolumns[0]!.values).toEqual([1, 2, 1])
  })

  it('refuses numbers in text variables, text commands on numeric ones, other table kinds', () => {
    const { store, table, ids } = setup()
    store.dispatch({ type: 'table.setVariableType', table: table.id, ids: [ids[2]!], to: 'text' })
    expect(() =>
      store.dispatch({
        type: 'table.setCells',
        table: table.id,
        edits: [{ col: ids[2]!, sub: 0, row: 0, value: 3 }],
      }),
    ).toThrow('“Group” is a text variable')
    expect(() =>
      store.dispatch({
        type: 'table.setText',
        table: table.id,
        edits: [{ col: ids[0]!, row: 0, value: 'x' }],
      }),
    ).toThrow('not a text variable')
    const col = setup('column')
    expect(() =>
      col.store.dispatch({
        type: 'table.setVariableType',
        table: col.table.id,
        ids: [col.ids[0]!],
        to: 'text',
      }),
    ).toThrow(CommandError)
  })

  it('keeps text in step with row inserts, deletes and growth', () => {
    const { store, table, t, ids } = setup()
    store.dispatch({ type: 'table.setVariableType', table: table.id, ids: [ids[2]!], to: 'text' })
    store.dispatch({ type: 'table.insertRows', table: table.id, at: 1, count: 2 })
    expect(t().dataSets[2]!.text).toEqual(['1', null, null, '2', '1'])
    store.dispatch({ type: 'table.deleteRows', table: table.id, rows: [0, 2] })
    expect(t().dataSets[2]!.text).toEqual([null, '2', '1'])
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: ids[2]!, row: 4, value: 'KO' }],
    })
    expect(t().rowCount).toBe(5)
    expect(t().dataSets[2]!.text).toEqual([null, '2', '1', null, 'KO'])
    expect(t().dataSets[0]!.subcolumns[0]!.values).toHaveLength(5)
  })
})

describe('calculated variables', () => {
  it('sets, evaluates, freezes and clears formulas', () => {
    const { store, table, t, ids } = setup()
    store.dispatch({ type: 'table.addDataSet', table: table.id, id: 'bmi' as never, title: 'BMI' })
    store.dispatch({
      type: 'table.setFormula',
      table: table.id,
      id: 'bmi' as never,
      formula: 'Weight / Height^2',
    })
    const bmi = () => t().dataSets.find((d) => d.id === 'bmi')!
    expect(bmi().formula).toBe('=Weight / Height^2')
    expect([...tableFormulas(t()).get('bmi')!.values]).toEqual([20, 60 / 2.25, Number.NaN])

    // Values can't be typed into it.
    expect(() =>
      store.dispatch({
        type: 'table.setCells',
        table: table.id,
        edits: [{ col: 'bmi' as never, sub: 0, row: 0, value: 3 }],
      }),
    ).toThrow('calculated')
    // Syntax errors are refused; unknown names are kept (shown as the column's error).
    expect(() =>
      store.dispatch({
        type: 'table.setFormula',
        table: table.id,
        id: 'bmi' as never,
        formula: '=(',
      }),
    ).toThrow('Formula: ')

    // Freezing keeps the values as numbers.
    store.dispatch({ type: 'table.setFormula', table: table.id, id: 'bmi' as never, formula: null })
    expect(bmi().formula).toBeUndefined()
    expect(bmi().subcolumns[0]!.values).toEqual([20, 26.6666666666667, null])
    store.undo()
    expect(bmi().formula).toBe('=Weight / Height^2')

    // Converting to text keeps the values as text.
    store.dispatch({
      type: 'table.setVariableType',
      table: table.id,
      ids: ['bmi' as never],
      to: 'text',
    })
    expect(bmi().text).toEqual(['20', '26.6666666666667', null])
    expect(bmi().formula).toBeUndefined()
    expect(ids).toHaveLength(3)
  })

  // Audit 2 (M17): the values a conversion freezes, with formulas reading info fields and each
  // other (converted in turn: a later one reads the earlier one as it is now).
  it('converts calculated variables reading info fields and each other, in one command', () => {
    const { store, table, t } = setup()
    const info = { ...createInfoSheet(newNodeId(), 'Info'), fields: [{ label: 'k', value: '3' }] }
    store.dispatch({ type: 'node.add', node: info })
    const add = (id: string, title: string, formula: string) => {
      store.dispatch({ type: 'table.addDataSet', table: table.id, id: id as never, title })
      store.dispatch({ type: 'table.setFormula', table: table.id, id: id as never, formula })
    }
    add('a', 'A', '=Weight * [Info: k]')
    add('b', 'B', '=A + 1')
    add('c', 'C', '=if(Weight > 70, "heavy", "light")')
    add('d', 'D', '=C')
    const col = (id: string) => t().dataSets.find((d) => d.id === id)!
    const view = () =>
      ['a', 'b', 'c', 'd'].map((id) => ({
        formula: col(id).formula,
        values: col(id).subcolumns[0]!.values,
        text: col(id).text,
      }))
    const start = store.getState()
    const convert = (ids: string[], to: 'number' | 'text') =>
      store.dispatch({ type: 'table.setVariableType', table: table.id, ids: ids as never, to })
    convert(['a', 'b'], 'text')
    expect(view().slice(0, 2)).toEqual([
      { formula: undefined, values: [null, null, null], text: ['240', '180', '270'] },
      { formula: undefined, values: [null, null, null], text: [null, null, null] },
    ])
    store.undo()
    convert(['a', 'b', 'c', 'd'], 'number')
    expect(view()).toEqual([
      { formula: undefined, values: [240, 180, 270], text: undefined },
      { formula: undefined, values: [241, 181, 271], text: undefined },
      { formula: undefined, values: [null, null, null], text: undefined },
      { formula: undefined, values: [null, null, null], text: undefined },
    ])
    store.undo()
    convert(['c', 'd'], 'text')
    expect(view().slice(2)).toEqual([
      { formula: undefined, values: [null, null, null], text: ['heavy', 'light', 'heavy'] },
      { formula: undefined, values: [null, null, null], text: ['heavy', 'light', 'heavy'] },
    ])
    store.undo()
    store.dispatch({ type: 'table.setFormula', table: table.id, id: 'a' as never, formula: null })
    store.dispatch({ type: 'table.setFormula', table: table.id, id: 'c' as never, formula: null })
    expect(view().map((v) => [v.values, v.text])).toEqual([
      [[240, 180, 270], undefined],
      [[null, null, null], undefined],
      [
        [null, null, null],
        ['heavy', 'light', 'heavy'],
      ],
      [[null, null, null], undefined],
    ])
    store.undo()
    store.undo()
    expect(store.getState()).toEqual(start)
  })

  it('follows renamed variables', () => {
    const { store, table, t, ids } = setup()
    store.dispatch({ type: 'table.addDataSet', table: table.id, id: 'bmi' as never, title: 'BMI' })
    store.dispatch({
      type: 'table.setFormula',
      table: table.id,
      id: 'bmi' as never,
      formula: '=Weight / Height^2',
    })
    store.dispatch({
      type: 'table.renameDataSet',
      table: table.id,
      id: ids[0]!,
      title: 'Body mass (kg)',
    })
    expect(t().dataSets[3]!.formula).toBe('=[Body mass (kg)] / Height^2')
    expect(tableFormulas(t()).get('bmi')!.error).toBeNull()
  })
})

/** Test analysis: sums the first replicate of each input data set. */
const sumDef: AnalysisDef<Record<string, never>> = {
  id: 'sum',
  version: 1,
  title: 'Sum',
  category: 'Test',
  description: 'Sums values.',
  form: [],
  accepts: ['multipleVariables'],
  inputs: { min: 1, max: 3 },
  params: z.object({}),
  run(input) {
    let total = 0
    let text = 0
    for (const ds of input) {
      if (ds.data.shape !== 'replicates') continue
      for (const v of ds.data.reps[0]!) if (!Number.isNaN(v)) total += v
      text += ds.text?.filter((s) => s === 'WT').length ?? 0
    }
    return {
      status: 'ok',
      diagnostics: [],
      sheets: [],
      values: { total: { kind: 'number', v: total }, wt: { kind: 'number', v: text } },
      comparisons: [],
      outputs: {},
    }
  },
}
const registry: AnalysisRegistry = {
  engineVersion: 'test',
  get: (id) => (id === 'sum' ? (sumDef as AnalysisDef<unknown>) : undefined),
}
const value = (r: AnalysisResult | undefined, k: string) =>
  (r?.values[k] as { v: number } | undefined)?.v

describe('recompute through calculated and text variables', () => {
  it('reruns an analysis of a calculated variable when a variable it uses changes', async () => {
    const { store, table, ids } = setup()
    store.dispatch([
      { type: 'table.addDataSet', table: table.id, id: 'dbl' as never, title: 'Double' },
      { type: 'table.setFormula', table: table.id, id: 'dbl' as never, formula: '=Weight * 2' },
      { type: 'table.setVariableType', table: table.id, ids: [ids[2]!], to: 'text' },
    ])
    const analysis: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'Sum',
      analysisId: 'sum',
      pluginVersion: 1,
      input: { source: table.id, dataSets: ['dbl', ids[2]!] },
      params: {},
    }
    store.dispatch({ type: 'node.add', node: analysis })
    const calls: AnalysisJob[] = []
    const inner = inlineRunner(registry)
    const runner: JobRunner = (job) => {
      calls.push(job)
      return inner(job)
    }
    const engine = await startedEngine(store, registry, runner)
    expect(value(engine.latest(analysis.id), 'total')).toBe(2 * (80 + 60 + 90))

    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: ids[0]!, sub: 0, row: 0, value: 100 }],
    })
    await engine.idle()
    expect(value(engine.latest(analysis.id), 'total')).toBe(2 * (100 + 60 + 90))
    const n = calls.length

    // Height isn't used: no rerun.
    store.dispatch({
      type: 'table.setCells',
      table: table.id,
      edits: [{ col: ids[1]!, sub: 0, row: 0, value: 3 }],
    })
    await engine.idle()
    expect(calls).toHaveLength(n)

    // A text edit reruns it too.
    store.dispatch({
      type: 'table.setText',
      table: table.id,
      edits: [{ col: ids[2]!, row: 1, value: 'WT' }],
    })
    await engine.idle()
    expect(value(engine.latest(analysis.id), 'wt')).toBe(1)
    expect(calls).toHaveLength(n + 1)
  })
})
