import { registry } from '@ps/analyses'
import {
  type ColumnId,
  createTable,
  type DataTable,
  type NormalizedDataSet,
  normalizeDataSet,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { defaultSelection } from '../src/analysis/defaultSelection.ts'

// Phase 42: the Analyze dialog's first selection. Analyses of numbers (PCA, the curve fit of
// variables) start with the number variables only: a text variable ticked by default left PCA
// without a complete row ("PCA needs at least three complete rows") on a table such as the
// single-cell example's, whose text variables come first. Text variables stay offered.

/** Text variables first (Sample, Cluster), then three number variables, 6 rows. */
function cells(): DataTable {
  const t = createTable({ tableKind: 'multipleVariables', columns: 5, rows: 6 })
  const titles = ['Sample', 'Cluster', 'UMAP 1', 'UMAP 2', 'Counts']
  t.dataSets.forEach((d, i) => {
    d.id = String.fromCharCode(97 + i) as ColumnId
    d.title = titles[i]!
  })
  t.dataSets[0]!.text = ['d1', 'd1', 'd2', 'd2', 'd3', 'd3']
  t.dataSets[1]!.text = ['0', '1', '0', '1', '2', '2']
  t.dataSets[2]!.subcolumns[0]!.values = [1, 2, 4, 3, 6, 5]
  t.dataSets[3]!.subcolumns[0]!.values = [2, 1, 3, 5, 4, 7]
  t.dataSets[4]!.subcolumns[0]!.values = [10, 30, 20, 50, 40, 70]
  return t
}

const def = (id: string) => registry.get(id)!

describe('the Analyze dialog’s first selection', () => {
  it('is the number variables for PCA and the curve fit of variables', () => {
    const t = cells()
    expect(defaultSelection(def('pca'), t)).toEqual(['c', 'd', 'e'])
    expect(defaultSelection(def('nonlinearFitMV'), t)).toEqual(['c', 'd', 'e'])
  })

  it('keeps the text variables where they are variables of the model', () => {
    const t = cells()
    // Categorical predictors, factors, groups, rows to filter and aggregate.
    for (const id of [
      'multipleRegression',
      'logisticRegression',
      'poissonRegression',
      'coxRegression',
      'multifactorAnova',
      'survivalFromVariables',
      'filterRows',
      'aggregate',
    ])
      expect(defaultSelection(def(id), t), id).toEqual(['a', 'b', 'c', 'd', 'e'])
    // Never more than the analysis takes.
    expect(
      defaultSelection(def('ttest'), createTable({ tableKind: 'column', columns: 4 })),
    ).toHaveLength(2)
  })

  it('runs PCA with its first selection on a table with text variables first', () => {
    const t = cells()
    const pca = def('pca')
    const keys = defaultSelection(pca, t)
    const input: NormalizedDataSet[] = keys.map((k) =>
      normalizeDataSet(t, t.dataSets.find((d) => d.id === k)!),
    )
    const res = pca.run(input, pca.params.parse({ select: 'kaiser' }), {
      tableKind: t.tableKind,
      xTitle: null,
    })
    expect(res.status).toBe('ok')
    // Every text variable ticked, as before: no complete row.
    const all = t.dataSets.map((d) => normalizeDataSet(t, d))
    const before = pca.run(all, pca.params.parse({ select: 'kaiser' }), {
      tableKind: t.tableKind,
      xTitle: null,
    })
    expect(before.status).toBe('error')
  })
})
