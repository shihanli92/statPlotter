// Audit 4 (P6): the forms' dialog parts, explanations and sketches (as the dialog has them).
import '../src/dialogEntry.ts'
import {
  type AnalysisDef,
  createTable,
  type NormalizedDataSet,
  normalizeTable,
  type TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { analysisChecks, analysisFacts, countCheck } from '../src/dialog/index.ts'
import { registry } from '../src/index.ts'

// Roadmap 51b (design §4.6, U16): the dialog's checks before Analyze come from the same
// `validate` that `run` returns as its failure. For every analysis, on the degenerate tables of
// `degenerate.test.ts` and with each option on its own, `validate` blocks exactly when `run`
// fails before computing — with the same message and the same notes before it. Failures found
// only by computing (a model that can't be fitted, a row-by-row analysis with no row left) are
// listed here, by analysis, with the message.

/** Failures `run` reaches only after computing (no count or shape predicts them). */
const AFTER_COMPUTE: Readonly<Record<string, readonly RegExp[]>> = {
  // A row-by-row analysis: which rows can be tested is found testing them.
  multipleT: [/^No row could be tested/],
  multipleOneWay: [/^No row could be analyzed/],
  // Fits per data set: a data set is fitted, or left out, as the fit finds.
  linearRegression: [/^No data set has enough points for a line/],
  deming: [/^No data set has enough points for a line/],
  simpleLogistic: [/^No data set can be fit/],
  nonlinearFit: [/^No data set has enough points to fit/],
  nonlinearFitMV: [/^No row has both an X and a Y value/, /^No data set has enough points/],
  fitSpline: [/^No data set can be smoothed/],
  areaUnderCurve: [/needs at least two points with X and Y values/],
  // Repeated measures: the model fitted (complete subjects, the mixed model) decides.
  oneWayAnova: [/^Need at least two subjects/, /can’t be computed|could not be/i],
  twoWayAnova: [/could not be|can’t be estimated|no residual|too few values to estimate/i],
  threeWayAnova: [/could not be|no residual|needs more than one value/i],
  // The model's coefficients and its design decide.
  multifactorAnova: [/no data for|no degrees of freedom|need two factors/i],
  survivalFromVariables: [/^No subjects to analyze/],
  goodnessOfFit: [/needs counts in at least two categories/],
  // Tables made by a tool: empty in, a message out.
  rowStats: [/^There are no values/],
  fractionOfTotal: [/^There are no values/],
  frequencyDistribution: [/^There are no values/],
  transpose: [/^There are no values/],
  percentages: [/^There are no values/],
  nestedT: [/could not be fitted|no variation left/],
  nestedOneWay: [/could not be fitted|no variation left/],
}

type Fill = 'empty' | 'one value' | 'constant' | 'too few data sets' | 'values'

function makeTable(def: AnalysisDef<unknown>, kind: TableKind, fill: Fill) {
  const min = Math.max(def.inputs.min, 1)
  const columns =
    fill === 'too few data sets' ? min - 1 : Math.min(Math.max(min, 2), def.inputs.max)
  const t = createTable({ tableKind: kind, columns, rows: 4 })
  if (t.x && fill !== 'empty') t.x.subcolumns[0]!.values = [1, 2, 3, 4]
  for (const [i, ds] of t.dataSets.entries())
    for (const sub of ds.subcolumns) {
      if (fill === 'one value')
        sub.values =
          i === 0 && sub === ds.subcolumns[0] ? [1, null, null, null] : [null, null, null, null]
      else if (fill === 'constant') sub.values = [2, 2, 2, 2]
      else if (fill === 'too few data sets') sub.values = [1, 2, 4, 3]
      else if (fill === 'values') sub.values = [1 + i, 3 + i, 2 + 2 * i, 5]
    }
  return t
}

/** Each option of the analysis' form on its own (as a user would pick it), and the defaults. */
function variants(def: AnalysisDef<unknown>): [string, unknown][] {
  const out: [string, unknown][] = [['defaults', {}]]
  for (const f of def.form) {
    if (!('options' in f)) continue
    for (const o of f.options) {
      const raw: Record<string, unknown> = {}
      let at = raw
      f.path.forEach((k, i) => {
        if (i === f.path.length - 1) at[k] = o.value
        else at = at[k] = {} as Record<string, unknown>
      })
      out.push([`${f.path.join('.')}=${String(o.value)}`, raw])
    }
  }
  return out
}

const firstError = (diagnostics: readonly { level: string; message: string }[]) =>
  diagnostics.find((d) => d.level === 'error')?.message

describe('check ⇔ run (design §4.6)', () => {
  const defs = registry.list().filter((d) => !['monteCarlo'].includes(d.id))
  it.each(defs.map((d) => [d.id, d] as const))('%s', (id, def) => {
    const problems: string[] = []
    for (const kind of def.accepts)
      for (const fill of [
        'empty',
        'one value',
        'constant',
        'too few data sets',
        'values',
      ] as const) {
        if (fill === 'too few data sets' && def.inputs.min <= 1) continue
        const input: NormalizedDataSet[] = normalizeTable(makeTable(def, kind, fill))
        for (const [name, raw] of variants(def)) {
          const parsed = def.params.safeParse(raw)
          if (!parsed.success) continue
          const params = parsed.data
          const ctx = { tableKind: kind, xTitle: null }
          const r = def.run(input, params, ctx)
          const v = def.validate?.(input, params, ctx) ?? null
          const at = `${kind} / ${fill} / ${name}`
          if (v) {
            if (firstError(r.diagnostics) !== v.message)
              problems.push(`${at}: validate “${v.message}”, run “${firstError(r.diagnostics)}”`)
            else
              expect(r.diagnostics, at).toEqual([
                ...(v.diagnostics ?? []),
                { level: 'error', message: v.message },
              ])
            continue
          }
          const e = r.status === 'error' ? firstError(r.diagnostics) : undefined
          if (e && !(AFTER_COMPUTE[id] ?? []).some((re) => re.test(e)))
            problems.push(`${at}: run fails “${e}” and validate passes`)
        }
      }
    expect([...new Set(problems)]).toEqual([])
  })
})

describe('the dialog’s checks', () => {
  const ttest = registry.get('ttest')!
  const table = () => {
    const t = createTable({ tableKind: 'column', columns: 3, rows: 4 })
    t.dataSets[0]!.title = 'Control'
    t.dataSets[1]!.title = 'Treated'
    t.dataSets[0]!.subcolumns[0]!.values = [1, 2, 3, 4]
    t.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5, null]
    return t
  }
  const checks = (input: NormalizedDataSet[], params: Record<string, unknown>) =>
    analysisChecks({
      def: ttest,
      kind: 'column',
      input,
      params: ttest.params.parse(params) as Record<string, unknown>,
      facts: analysisFacts('column', input),
    })

  it('says how many groups to choose', () => {
    expect(countCheck(ttest, 'column', 3)).toEqual({
      level: 'block',
      message: 'Choose 2 groups (3 chosen).',
      where: 'params',
    })
    const input = normalizeTable(table())
    expect(checks(input, {})[0]).toMatchObject({ level: 'block', message: /3 chosen/ })
  })

  it('blocks with validate’s message, and notes the sizes', () => {
    const input = normalizeTable(table()).slice(0, 2)
    expect(checks(input, {}).map((c) => c.level)).toEqual(['note'])
    expect(checks(input, {})[0]!.message).toMatch(/“Treated” has 3 values/)
    const one = checks(input, { tails: 'one' })
    expect(one[0]).toEqual({
      level: 'block',
      message: expect.stringMatching(/^Say which direction you predicted/),
      where: 'params',
    })
  })

  it('names the values a ratio paired t test can’t take', () => {
    const t = table()
    t.dataSets[1]!.subcolumns[0]!.values = [2, -3, 5, 1]
    const input = normalizeTable(t).slice(0, 2)
    const c = checks(input, { design: 'paired', paired: { measure: 'ratio' } })
    expect(c[0]).toMatchObject({ level: 'block', where: 'table' })
    expect(c.find((x) => x.level === 'note')?.message).toMatch(/row 2 of “Treated” is -3/)
  })
})
