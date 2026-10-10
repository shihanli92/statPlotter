import type {
  DataSetKey,
  FieldFormat,
  ResultField,
  ResultRef,
  ResultTemplate,
  RichText,
  TableKind,
} from '@ps/model'
import { pct } from './common.ts'
import { resolveEquation } from './nonlinear.ts'

// Results on graphs (roadmap 35): what each analysis offers to draw on a graph, ready to add — its
// curated values as labels ("r = 0.82, P = 0.003"), reference lines and bands, with the symbols in
// italics and sensible number formats. Every field names its value by keys the plugin writes (a
// value's key, a sheet's key, a block's title or the start of it, a row's label, a column's
// title; `{dataSet}` / `{key}`: the data set the label is drawn for), so they follow recomputes.

/** What the templates may depend on: the parameters, the source's kind, the data sets analyzed. */
export interface GraphResultContext {
  tableKind: TableKind
  dataSets: readonly DataSetKey[]
}

type Templates<P> = (params: P, ctx: GraphResultContext) => ResultTemplate[]

const italic = (text: string) => ({ text, italic: true })
const P: RichText = [italic('P')]
const R2: RichText = [italic('R'), { text: '2', sup: true }]
const sub = (text: string, s: string): RichText => [{ text }, { text: s, sub: true }]

const value = (key: string, format?: FieldFormat): ResultField => ({
  ref: { from: 'value', key },
  ...(format ? { format } : {}),
})
const cell = (
  ref: Omit<Extract<ResultRef, { from: 'cell' }>, 'from'>,
  format?: FieldFormat,
): ResultField => ({ ref: { from: 'cell', ...ref }, ...(format ? { format } : {}) })

const P_FORMAT: FieldFormat = { p: 'below' }
const DIGITS3: FieldFormat = { digits: 3 }

/** A label: its runs (fields in braces), fields and options. */
function label(
  id: string,
  title: string,
  template: RichText,
  fields: Record<string, ResultField>,
  more: Partial<ResultTemplate> & Partial<ResultTemplate['stat']> = {},
): ResultTemplate {
  const { offer, frames, ...stat } = more
  return {
    id,
    title,
    kind: 'label',
    stat: { template, fields, place: { at: 'corner', corner: 'topLeft' }, ...stat },
    ...(offer ? { offer } : {}),
    ...(frames ? { frames } : {}),
  }
}

const runs = (...parts: (string | RichText)[]): RichText =>
  parts.flatMap((p) => (typeof p === 'string' ? [{ text: p }] : p))

// --- Correlation -------------------------------------------------------------------------------

const correlation: Templates<{
  method: 'pearson' | 'spearman'
  tails: 'two' | 'one'
  confidenceLevel: number
}> = (p, ctx) => {
  const xy = ctx.tableKind === 'xy'
  const sym: RichText =
    p.method === 'spearman' ? [italic('r'), { text: 's', sub: true }] : [italic('r')]
  const col = p.method === 'spearman' ? 'Spearman r' : 'Pearson r'
  const sheet = 'results'
  const block = p.method === 'spearman' ? 'Spearman correlation' : 'Pearson correlation'
  const pCol = p.tails === 'one' ? 'P value (one-tailed)' : 'P value (two-tailed)'
  // XY tables: X against each data set (a label per data set); column tables: the one pair.
  const row = 'X vs. {dataSet}'
  const at = (column: string, format?: FieldFormat) =>
    xy ? cell({ sheet, block, row, column }, format) : undefined
  const r = at(col, { digits: 2 }) ?? value('r', { digits: 2 })
  const pv = at(pCol, P_FORMAT) ?? value('p', P_FORMAT)
  const per = xy ? { per: 'dataSet' as const } : {}
  const out = [
    label(
      'rP',
      `${p.method === 'spearman' ? 'rs' : 'r'} and P`,
      runs(sym, ' = {r}, ', P, ' = {P}'),
      { r, P: pv },
      {
        offer: `Show ${p.method === 'spearman' ? 'rs' : 'r'} and P on the graph`,
        ...per,
      },
    ),
  ]
  if (xy)
    out.push(
      label(
        'rPn',
        `${p.method === 'spearman' ? 'rs' : 'r'}, P and n`,
        runs(sym, ' = {r}, ', P, ' = {P}, ', [italic('n')], ' = {n}'),
        {
          r,
          P: pv,
          n: cell({ sheet, block, row, column: 'Number of XY pairs' }),
        },
        per,
      ),
      label(
        'rCI',
        `${p.method === 'spearman' ? 'rs' : 'r'} with its CI`,
        runs(sym, ` = {r} (${pct(p.confidenceLevel)} CI {ci})`),
        {
          r,
          ci: cell({ sheet, block, row, column: `${pct(p.confidenceLevel)} CI` }, { digits: 2 }),
        },
        per,
      ),
    )
  return out
}

// --- Linear regression ---------------------------------------------------------------------------

const linear: Templates<Record<string, unknown>> = () => {
  const sheet = 'results'
  const f = (block: string, row: string, format?: FieldFormat) =>
    cell({ sheet, block, row, column: '{dataSet}' }, format)
  const eq = f('Equation', '')
  const r2 = f('Goodness of Fit', 'R squared', DIGITS3)
  const per = { per: 'dataSet' as const, frames: ['xy'] as const }
  return [
    label(
      'eqR2',
      'Equation and R²',
      runs('{eq}, ', R2, ' = {R2}'),
      { eq, R2: r2 },
      {
        ...per,
        offer: 'Show the equation and R² on the graph',
      },
    ),
    label('eq', 'Equation', runs('{eq}'), { eq }, per),
    label('r2', 'R²', runs(R2, ' = {R2}'), { R2: r2 }, per),
    label(
      'slope',
      'Slope ± SE',
      runs('Slope = {slope} ± {se}'),
      {
        slope: f('Best-fit values', 'Slope', DIGITS3),
        se: f('Std. Error', 'Slope', DIGITS3),
      },
      per,
    ),
    label(
      'p',
      'P (slope ≠ 0)',
      runs(P, ' = {P}'),
      {
        P: f('Is slope significantly non-zero?', 'P value', P_FORMAT),
      },
      per,
    ),
  ]
}

// --- Nonlinear regression ------------------------------------------------------------------------

/** The fit's parameters and derived values (IC50 of a log form, Span…) as its rows name them. */
function fitNames(params: Record<string, unknown>): { fitted: string[]; all: string[] } {
  const r = resolveEquation(params as Parameters<typeof resolveEquation>[0])
  if (!r.ok) return { fitted: [], all: [] }
  const derived = r.model.derived ? Object.keys(r.model.derived(r.model.params.map(() => 1))) : []
  return { fitted: [...r.model.params], all: [...r.model.params, ...derived] }
}

const nonlinear: Templates<Record<string, unknown> & { confidenceLevel?: number }> = (p) => {
  const names = fitNames(p)
  const has = (n: string) => names.all.includes(n)
  const sheet = 'results'
  const f = (block: string, row: string, format?: FieldFormat) =>
    cell({ sheet, block, row, column: '{dataSet}' }, format)
  const best = (row: string, format: FieldFormat = DIGITS3) => f('Best-fit values', row, format)
  const per = { per: 'dataSet' as const, frames: ['xy'] as const }
  const out: ResultTemplate[] = []
  // The midpoint: IC50 or EC50 (a log form fits LogIC50: its X is the log, drop lines go there).
  const mid = ['IC50', 'EC50'].find(has)
  if (mid) {
    const sym = sub(mid.slice(0, 2), mid.slice(2))
    out.push(
      label(
        mid,
        mid,
        runs(sym, ` = {${mid}}`),
        { [mid]: best(mid, { digits: 3, axisUnit: 'x' }) },
        {
          ...per,
          place: { at: 'curve' },
          offer: `Show ${mid} on the graph`,
        },
      ),
    )
    // The X the curve is fitted against: the log of the midpoint when that is what it fits.
    const at = names.fitted.includes(`Log${mid}`) ? `Log${mid}` : mid
    // A midpoint derived from other parameters (one site, fit Ki: IC50 from logKi, in
    // concentration on a log X) has neither a CI on the sheet nor an X to drop lines at
    // (audit 2, S5): only its value is offered.
    if (names.fitted.includes(at)) {
      out.push({
        id: `${mid}drop`,
        title: `${mid} drop lines`,
        kind: 'line',
        stat: { fields: { [at]: best(at, {}) }, at, axis: 'x', drop: 'both', per: 'dataSet' },
        offer: `Drop lines at ${mid}`,
        frames: ['xy'],
      })
      const level = pct(p.confidenceLevel ?? 0.95)
      // The CI of the fitted midpoint (free parameters only: a log form's is of LogIC50).
      out.push(
        label(
          `${mid}CI`,
          `${at} with its CI`,
          runs(at === mid ? sym : [{ text: at }], ` = {v} (${level} CI {ci})`),
          {
            v: best(at),
            ci: f(`${level} CI`, at, DIGITS3),
          },
          per,
        ),
      )
    }
  }
  if (has('HillSlope'))
    out.push(label('hill', 'Hill slope', runs('Hill slope = {h}'), { h: best('HillSlope') }, per))
  if (has('Kd'))
    out.push(
      label(
        'kd',
        has('Bmax') ? 'Kd and Bmax' : 'Kd',
        runs(
          sub('K', 'd'),
          ' = {Kd}',
          ...(has('Bmax') ? [', ', sub('B', 'max'), ' = {Bmax}'] : []),
        ),
        {
          Kd: best('Kd', { digits: 3, axisUnit: 'x' }),
          ...(has('Bmax') ? { Bmax: best('Bmax') } : {}),
        },
        { ...per, offer: 'Show Kd on the graph' },
      ),
    )
  if (has('Top') && has('Bottom'))
    out.push(
      label(
        'topBottom',
        'Top and bottom',
        runs('Top = {top}, bottom = {bottom}'),
        {
          top: best('Top'),
          bottom: best('Bottom'),
        },
        per,
      ),
    )
  out.push(
    label(
      'r2',
      'R²',
      runs(R2, ' = {R2}'),
      { R2: f('Goodness of Fit', 'R squared', { digits: 4 }) },
      per,
    ),
  )
  return out
}

/** The same, fitted per level of a table's variables (`nonlinearFitMV`): a label per level. */
const nonlinearMV: Templates<Record<string, unknown>> = (p, ctx) => nonlinear(p, ctx)

// --- Comparisons of groups ----------------------------------------------------------------------

const pLabel = (offer = 'Show P on the graph'): ResultTemplate =>
  label(
    'p',
    'P value',
    runs(P, ' = {P}'),
    { P: value('p', P_FORMAT) },
    { offer, place: { at: 'corner', corner: 'topRight' } },
  )
const pStars = (): ResultTemplate =>
  label(
    'stars',
    'P as stars',
    runs('{P}'),
    { P: value('p', { p: 'stars' }) },
    { place: { at: 'corner', corner: 'topRight' } },
  )

const ttest: Templates<{
  design: 'unpaired' | 'paired'
  unpaired: { assumeEqualSD: boolean }
  paired: { measure: 'difference' | 'ratio' }
}> = (p) => {
  const paired = p.design === 'paired'
  const t = !paired && !p.unpaired.assumeEqualSD ? 'Welch-corrected t' : 't'
  const d = paired ? 'Cohen’s d (d_z: mean difference / SD of differences)' : 'Cohen’s d'
  const sheet = 'results'
  return [
    pLabel(),
    label(
      'tdf',
      't, df and P',
      runs([italic('t')], ' = {t}, df = {df}, ', P, ' = {P}'),
      {
        t: cell({ sheet, row: t }, DIGITS3),
        // The sheet's df (paired: pairs − 1; Welch: fractional), never the number of pairs.
        df: cell({ sheet, row: 'df' }),
        P: value('p', P_FORMAT),
      },
      { place: { at: 'corner', corner: 'topRight' } },
    ),
    ...(p.paired.measure === 'ratio' && paired
      ? []
      : [
          label(
            'd',
            'Effect size (Cohen’s d)',
            runs([italic('d')], ' = {d}'),
            {
              d: cell({ sheet, block: 'How big is the difference?', row: d }, { digits: 2 }),
            },
            { place: { at: 'corner', corner: 'topRight' } },
          ),
        ]),
    pStars(),
  ]
}

const oneWay: Templates<{ gaussian: boolean; matched: boolean; equalSD: string }> = (p) => {
  const sheet = 'results'
  if (!p.gaussian && p.matched)
    // Matched and nonparametric: the Friedman test (its statistic is the value `stat`).
    return [
      pLabel(),
      label(
        'friedman',
        'Friedman statistic and P',
        runs('Friedman statistic = {stat}, ', P, ' = {P}'),
        {
          stat: value('stat', DIGITS3),
          P: value('p', P_FORMAT),
        },
        { place: { at: 'corner', corner: 'topRight' } },
      ),
      pStars(),
    ]
  if (!p.gaussian)
    return [
      pLabel(),
      label(
        'h',
        'Kruskal-Wallis statistic and P',
        runs('Kruskal-Wallis ', [italic('H')], ' = {H}, ', P, ' = {P}'),
        {
          H: cell({ sheet, row: 'Kruskal-Wallis statistic' }, DIGITS3),
          P: value('p', P_FORMAT),
        },
        { place: { at: 'corner', corner: 'topRight' } },
      ),
      pStars(),
    ]
  const out = [
    pLabel(),
    p.matched
      ? // Repeated measures (or the mixed-effects model): its sheet writes F with its df in one
        // row ('F (DFn, DFd)'), so the label reads the df from the values.
        label(
          'F',
          'F and P',
          runs([italic('F')], ' ({dfn}, {dfd}) = {F}, ', P, ' = {P}'),
          {
            F: value('F', DIGITS3),
            dfn: value('dfn', { digits: 4 }),
            dfd: value('dfd', { digits: 4 }),
            P: value('p', P_FORMAT),
          },
          { place: { at: 'corner', corner: 'topRight' } },
        )
      : label(
          'F',
          'F and P',
          runs([italic('F')], ' = {F} ({df}), ', P, ' = {P}'),
          {
            F: value('F', DIGITS3),
            df: cell({ sheet, row: 'DFn, DFd' }),
            P: value('p', P_FORMAT),
          },
          { place: { at: 'corner', corner: 'topRight' } },
        ),
  ]
  if (!p.matched && p.equalSD === 'yes')
    out.push(
      label(
        'eta',
        'Effect size (η²)',
        runs([italic('η')], [{ text: '2', sup: true }], ' = {eta}'),
        {
          eta: cell({ sheet, block: 'Effect size', row: 'Eta squared (R squared)' }, DIGITS3),
        },
        { place: { at: 'corner', corner: 'topRight' } },
      ),
    )
  out.push(pStars())
  return out
}

const mannWhitney: Templates<Record<string, unknown>> = () => [
  pLabel(),
  label(
    'U',
    'U and P',
    runs([italic('U')], ' = {U}, ', P, ' = {P}'),
    {
      U: value('U'),
      P: value('p', P_FORMAT),
    },
    { place: { at: 'corner', corner: 'topRight' } },
  ),
  label(
    'hl',
    'Hodges-Lehmann difference',
    runs('Difference (Hodges-Lehmann) = {hl}'),
    {
      hl: value('hl', DIGITS3),
    },
    { place: { at: 'corner', corner: 'topRight' } },
  ),
  pStars(),
]

const wilcoxon: Templates<Record<string, unknown>> = () => [
  pLabel(),
  label(
    'W',
    'W and P',
    runs([italic('W')], ' = {W}, ', P, ' = {P}'),
    {
      W: value('W'),
      P: value('p', P_FORMAT),
    },
    { place: { at: 'corner', corner: 'topRight' } },
  ),
  pStars(),
]

const simpleP: Templates<Record<string, unknown>> = () => [pLabel(), pStars()]

// --- Survival ------------------------------------------------------------------------------------

const survival: Templates<{ confidenceLevel: number }> = (p, ctx) => {
  const level = pct(p.confidenceLevel)
  const median = label(
    'median',
    'Median survival per group',
    runs('Median {m}'),
    {
      m: cell({ sheet: 'summary', row: 'Median survival', column: '{dataSet}' }, DIGITS3),
    },
    {
      per: 'dataSet',
      place: { at: 'corner', corner: 'topRight' },
      offer: 'Show the median survival of each group',
    },
  )
  if (ctx.dataSets.length < 2) return [median]
  const sheet = 'comparison'
  const logRank = cell({ sheet, block: 'Log-rank (Mantel-Cox) test', row: 'P value' }, P_FORMAT)
  return [
    label(
      'logrank',
      'Log-rank P',
      runs('Log-rank ', P, ' = {P}'),
      { P: logRank },
      {
        place: { at: 'corner', corner: 'topRight' },
        offer: 'Show the log-rank P on the graph',
      },
    ),
    median,
    ...(ctx.dataSets.length === 2
      ? [
          label(
            'hr',
            'Hazard ratio with its CI',
            runs(`HR = {hr} (${level} CI {lo}–{hi})`),
            {
              hr: value('hazardRatio', DIGITS3),
              lo: cell(
                {
                  sheet,
                  block: 'Hazard ratio (Mantel-Haenszel)',
                  row: `${level} CI of ratio`,
                  end: 'lo',
                },
                DIGITS3,
              ),
              hi: cell(
                {
                  sheet,
                  block: 'Hazard ratio (Mantel-Haenszel)',
                  row: `${level} CI of ratio`,
                  end: 'hi',
                },
                DIGITS3,
              ),
            },
            { place: { at: 'corner', corner: 'topRight' } },
          ),
        ]
      : []),
  ]
}

// --- Contingency ---------------------------------------------------------------------------------

const contingency: Templates<{
  test: 'fisher' | 'chiSquare'
  oddsRatio: boolean
  riskEstimates: boolean
  confidenceLevel: number
}> = (p) => {
  const sheet = 'results'
  const level = pct(p.confidenceLevel)
  const block = p.test === 'fisher' ? 'Fisher’s exact test' : 'Chi-square test'
  const name = p.test === 'fisher' ? 'Fisher’s exact ' : 'χ² '
  const out = [
    label(
      'p',
      `${p.test === 'fisher' ? 'Fisher’s exact' : 'Chi-square'} P`,
      runs(name, P, ' = {P}'),
      {
        P: cell({ sheet, block, row: 'P value' }, P_FORMAT),
      },
      { place: { at: 'corner', corner: 'topRight' }, offer: 'Show P on the graph' },
    ),
  ]
  if (p.oddsRatio)
    out.push(
      label(
        'or',
        'Odds ratio with its CI',
        runs(`OR = {or} (${level} CI {ci})`),
        {
          or: cell({ sheet, block: 'Odds ratio', row: 'Odds ratio' }, DIGITS3),
          ci: cell({ sheet, block: 'Odds ratio', row: `${level} CI` }, DIGITS3),
        },
        { place: { at: 'corner', corner: 'topRight' } },
      ),
    )
  if (p.riskEstimates)
    out.push(
      label(
        'rr',
        'Relative risk with its CI',
        runs(`RR = {rr} (${level} CI {ci})`),
        {
          rr: cell({ sheet, block: 'Relative risk', row: 'Relative risk' }, DIGITS3),
          ci: cell({ sheet, block: 'Relative risk', row: `${level} CI` }, DIGITS3),
        },
        { place: { at: 'corner', corner: 'topRight' } },
      ),
    )
  return out
}

// --- Descriptive statistics: reference lines and bands -------------------------------------------

const descriptive: Templates<{ ci: boolean; confidenceLevel: number }> = (p, ctx) => {
  const level = pct(p.confidenceLevel)
  const first = ctx.dataSets[0]
  const out: ResultTemplate[] = [
    {
      id: 'means',
      title: 'Mean of each data set (lines)',
      kind: 'line',
      stat: { fields: { mean: value('mean:{key}') }, at: 'mean', per: 'dataSet' },
      frames: ['category', 'grouped'],
    },
  ]
  if (first)
    out.push({
      id: 'control',
      title: 'Mean of the first data set (control)',
      kind: 'line',
      stat: { fields: { mean: value(`mean:${first}`) }, at: 'mean' },
    })
  if (p.ci) {
    const ci = (row: string) => cell({ sheet: 'descriptive', row, column: '{dataSet}' })
    out.push({
      id: 'ci',
      title: `${level} CI of each mean (bands)`,
      kind: 'band',
      stat: {
        fields: { lo: ci(`Lower ${level} CI of mean`), hi: ci(`Upper ${level} CI of mean`) },
        lo: 'lo',
        hi: 'hi',
        per: 'dataSet',
      },
      frames: ['category', 'grouped'],
    })
  }
  out.push(
    label(
      'meanSd',
      'Mean ± SD per data set',
      runs('{mean} ± {sd}'),
      {
        mean: value('mean:{key}', DIGITS3),
        sd: value('sd:{key}', DIGITS3),
      },
      { per: 'dataSet', place: { at: 'corner', corner: 'topRight' } },
    ),
  )
  return out
}

/** Every analysis' ready results on graphs, by plugin id. */
export const GRAPH_RESULTS: Readonly<Record<string, Templates<never>>> = {
  correlation: correlation as Templates<never>,
  linearRegression: linear as Templates<never>,
  nonlinearFit: nonlinear as Templates<never>,
  nonlinearFitMV: nonlinearMV as Templates<never>,
  ttest: ttest as Templates<never>,
  oneWayAnova: oneWay as Templates<never>,
  mannWhitney: mannWhitney as Templates<never>,
  wilcoxon: wilcoxon as Templates<never>,
  friedman: simpleP as Templates<never>,
  kolmogorovSmirnov: simpleP as Templates<never>,
  survival: survival as Templates<never>,
  contingency: contingency as Templates<never>,
  descriptive: descriptive as Templates<never>,
}
