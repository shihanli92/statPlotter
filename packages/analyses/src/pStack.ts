import type { AnalysisDef, NormalizedDataSet, Problem, ResultValue } from '@ps/model'
import { correctFamily } from '@ps/stats'
import { z } from 'zod'
import {
  decided,
  exclusionNotes,
  failure,
  int,
  kv,
  num,
  problem,
  pval,
  result,
  table,
  text,
} from './common.ts'
import {
  FAMILY_FIELDS,
  FAMILY_TITLE,
  familyColumns,
  familyMethod,
  familyParams,
  pinFamilyQ,
  rowTitleOf,
} from './grouped.ts'

// ---------------------------------------------------------------------------------------------
// Analyze a stack of P values (column table: one P value per row), controlling the FDR or the
// family-wise error rate with the same choices (and code) as multiple t tests.
// ---------------------------------------------------------------------------------------------

const Params = z.object({ ...familyParams })
type Params = z.infer<typeof Params>

export const pStackDef: AnalysisDef<Params> = {
  id: 'pStack',
  version: 2,
  title: 'Analyze a stack of P values',
  category: 'Column analyses',
  description:
    'Decide which of many P values (one per row) are discoveries (false discovery rate) or below a multiplicity-corrected threshold; q values or adjusted P values, and a graph of P value vs rank.',
  accepts: ['column'],
  inputs: { min: 1, max: 1 },
  params: Params,
  // S34: Q was 1% by default before 0.3.9.
  migrateParams: (raw, from) => (from >= 2 ? raw : pinFamilyQ(raw)),
  form: [...FAMILY_FIELDS],
  outputs: () => [
    {
      key: 'ranked',
      graph: { id: 'ranked', name: 'Ranked P values', xTitle: 'Rank', yTitle: 'P value' },
      mark: 'points',
    },
  ],
  validate: validatePStack,
  run(input, params) {
    const diagnostics = exclusionNotes(input)
    const ds = input[0]!
    if (ds.data.shape !== 'replicates')
      return failure('Enter the P values as plain values, one per row.', diagnostics)
    const col = ds.data.reps[0]!
    const rows: number[] = []
    for (let r = 0; r < ds.rowCount; r++) if (Number.isFinite(col[r]!)) rows.push(r)
    if (!rows.length) return failure('There are no P values.', diagnostics)
    const bad = rows.find((r) => col[r]! < 0 || col[r]! > 1)
    if (bad !== undefined)
      return failure(
        `Every value must be a P value between 0 and 1 (${rowTitleOf(input, bad)} is ${col[bad]}).`,
        diagnostics,
      )
    const p = rows.map((r) => col[r]!)
    const method = familyMethod(params)
    const fam = correctFamily(p, { method, q: params.q / 100, alpha: params.alpha })
    const cols = familyColumns(params)
    const fdr = params.approach === 'fdr'
    const name = (i: number) => rowTitleOf(input, rows[i]!)
    const line = (i: number): ResultValue[] => [
      text(name(i)),
      decided(fam.flagged[i]!, p[i]!),
      pval(p[i]!),
      ...(cols.adjusted ? [pval(fam.adjusted[i]!)] : []),
    ]
    const columns = ['Row', cols.flag, 'P value', ...(cols.adjusted ? [cols.adjusted] : [])]
    const order = p.map((_, i) => i).sort((a, b) => p[a]! - p[b]! || a - b)
    const flagged = order.filter((i) => fam.flagged[i])
    const K = p.length
    const summary: [string, ResultValue][] = [
      ['Method', text(FAMILY_TITLE[method])],
      fdr ? ['Desired FDR (Q)', text(`${params.q}%`)] : ['Alpha', num(params.alpha)],
      ['Number of P values', int(K)],
      [fdr ? 'Number of discoveries' : 'Number below threshold', int(flagged.length)],
    ]
    if (fam.m0 !== undefined)
      summary.push(['Estimated number of true null hypotheses', int(fam.m0)])
    if (method === 'bonferroni')
      summary.push(['Threshold P value (alpha / K)', num(params.alpha / K)])
    if (method === 'sidak')
      summary.push([
        'Threshold P value (1 − (1 − alpha)^(1/K))',
        num(-Math.expm1(Math.log1p(-params.alpha) / K)),
      ])
    const sheets = [
      {
        key: 'results',
        title: 'Results',
        blocks: [
          kv('Analysis', summary),
          table(
            'P values',
            columns,
            p.map((_, i) => line(i)),
          ),
        ],
      },
      {
        key: 'flagged',
        title: fdr ? 'Discoveries' : 'Below threshold',
        blocks: flagged.length
          ? [table(fdr ? 'Discoveries' : 'Below threshold', columns, flagged.map(line))]
          : [
              {
                type: 'note' as const,
                text: fdr ? 'No discoveries.' : 'No P value is below the threshold.',
              },
            ],
      },
    ]
    return result({
      sheets,
      diagnostics,
      values: { flagged: int(flagged.length) },
      outputs: {
        ranked: { title: 'P value', x: order.map((_, k) => k + 1), y: order.map((i) => p[i]!) },
      },
    })
  },
}

/** Roadmap 51b (§4.6): a stack of P values' problems before computing. */
function validatePStack(input: readonly NormalizedDataSet[]): Problem | null {
  const diagnostics = exclusionNotes(input)
  const ds = input[0]
  if (!ds) return null
  if (ds.data.shape !== 'replicates')
    return problem('Enter the P values as plain values, one per row.', 'table', diagnostics)
  const col = ds.data.reps[0]!
  const rows: number[] = []
  for (let r = 0; r < ds.rowCount; r++) if (Number.isFinite(col[r]!)) rows.push(r)
  if (!rows.length) return problem('There are no P values.', 'table', diagnostics)
  const bad = rows.find((r) => col[r]! < 0 || col[r]! > 1)
  if (bad !== undefined)
    return problem(
      `Every value must be a P value between 0 and 1 (${rowTitleOf(input, bad)} is ${col[bad]}).`,
      'table',
      diagnostics,
    )
  return null
}
