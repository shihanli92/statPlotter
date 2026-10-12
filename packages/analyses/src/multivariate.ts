import {
  type AnalysisDef,
  type AnalysisResult,
  type NormalizedDataSet,
  type OutputDecl,
  pairedRows,
  type ResultBlock,
  type ResultSheet,
  type ResultValue,
} from '@ps/model'
import {
  blandAltman,
  maxOf,
  pca,
  principalComponentRegression,
  rocCurve,
  valueRange,
} from '@ps/stats'
import { z } from 'zod'
import {
  CONFIDENCE_FIELD,
  completeCases,
  confidenceLevel,
  droppedNote,
  exclusionNotes,
  failure,
  firstCol,
  int,
  interval,
  kv,
  num,
  pct,
  pick,
  pSig,
  pval,
  rawValues,
  result,
  resultsSheet,
  table,
  text,
  tooFewDataSets,
  unpairedRowsNote,
  yesNo,
} from './common.ts'
import { coefColumns, coefRows } from './regression.ts'
import { buildTable } from './resultTable.ts'

// ---------------------------------------------------------------------------------------------
// Principal component analysis
// ---------------------------------------------------------------------------------------------

const PcaParams = z.object({
  standardize: z.boolean().default(true),
  select: z.enum(['parallel', 'kaiser', 'variance', 'fixed']).default('parallel'),
  /** Target cumulative variance for 'variance', in percent. */
  variancePercent: z.number().gt(0).max(100).default(75),
  /** Number of components for 'fixed'. */
  components: z.number().int().min(1).default(2),
  simulations: z.number().int().min(10).max(10000).default(1000),
  seed: z.number().int().default(1),
  /** Loadings plot of PC1 vs. PC2: each variable a vector from the origin. */
  loadingsPlot: z.boolean().default(false),
  /** Biplot: the score plot with the loading vectors scaled to 90% of the scores' extent. */
  biplot: z.boolean().default(false),
  /** Principal component regression of `pcrY` on the retained components. */
  pcr: z.boolean().default(false),
  /** Data set key of the outcome for PCR ('' = the first analyzed variable); not in the PCA. */
  pcrY: z.string().default(''),
  confidenceLevel,
  /**
   * Roadmap 34c: a text variable among the analyzed data sets ('' = none), left out of the PCA,
   * whose groups the score plot and biplot colour (the result's table of scores carries it).
   * Optional (absent = none), so analyses saved before keep their parameters as they were.
   */
  groupBy: z.string().optional(),
  /** Roadmap 34c: the score plot (and biplot) draws a 95% ellipse per group (absent = no). */
  ellipses: z.boolean().optional(),
})
type PcaParams = z.infer<typeof PcaParams>

/** The PCA's variables: every analyzed data set but PCR's outcome and the grouping variable. */
function pcaKeys(keys: readonly string[], params: PcaParams): string[] {
  const ks = keys.filter((k) => k !== params.groupBy)
  if (!params.pcr) return ks
  const y = ks.includes(params.pcrY) ? params.pcrY : ks[0]
  return ks.filter((k) => k !== y)
}

/** Ids of the score table's variables (roadmap 34c): stable across runs. */
const SCORE_ID = (c: number) => `pc${c + 1}`
const GROUP_ID = 'group'

/** The score plot's (and biplot's) graph of the score table, grouped (roadmap 34c). */
const groupedScores = (params: PcaParams) => ({
  x: SCORE_ID(0),
  y: SCORE_ID(1),
  color: GROUP_ID,
  ellipses: !!params.ellipses,
})

export const pcaDef: AnalysisDef<PcaParams> = {
  id: 'pca',
  version: 1,
  title: 'Principal component analysis',
  category: 'Multiple variable analyses',
  description:
    'Summarize correlated variables by principal components: eigenvalues, variance explained, loadings and scores, with component selection by parallel analysis.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 256 },
  // Phase 42: ungrouped, a text variable has no numbers and leaves every row out of the PCA.
  numbersByDefault: true,
  params: PcaParams,
  form: [
    {
      path: ['standardize'],
      label: 'Standardize the variables (PCA on the correlation matrix; recommended)',
      kind: 'checkbox',
    },
    {
      path: ['select'],
      label: 'Components to keep',
      kind: 'radio',
      options: [
        { value: 'parallel', label: 'Parallel analysis (recommended)' },
        { value: 'kaiser', label: 'Eigenvalue greater than 1 (Kaiser)' },
        { value: 'variance', label: 'Enough to explain a share of the variance' },
        { value: 'fixed', label: 'A fixed number' },
      ],
    },
    {
      path: ['variancePercent'],
      label: 'Percent of total variance',
      kind: 'number',
      min: 1,
      max: 100,
      step: 5,
      showIf: { path: ['select'], in: ['variance'] },
    },
    {
      path: ['components'],
      label: 'Number of components',
      kind: 'number',
      min: 1,
      step: 1,
      showIf: { path: ['select'], in: ['fixed'] },
    },
    {
      path: ['simulations'],
      label: 'Simulations',
      kind: 'number',
      min: 10,
      max: 10000,
      step: 100,
      showIf: { path: ['select'], in: ['parallel'] },
    },
    {
      path: ['seed'],
      label: 'Random seed',
      kind: 'number',
      step: 1,
      showIf: { path: ['select'], in: ['parallel'] },
    },
    { path: ['loadingsPlot'], label: 'Loadings plot (PC1 vs. PC2)', kind: 'checkbox' },
    { path: ['biplot'], label: 'Biplot (scores and loading vectors)', kind: 'checkbox' },
    {
      path: ['pcr'],
      label: 'Principal component regression (PCR)',
      kind: 'checkbox',
    },
    {
      path: ['pcrY'],
      label: 'Outcome (dependent) variable',
      kind: 'custom',
      component: 'dataset.pick',
      showIf: { path: ['pcr'], in: [true] },
    },
    { ...CONFIDENCE_FIELD, showIf: { path: ['pcr'], in: [true] } },
    {
      path: ['groupBy'],
      label: 'Group by',
      kind: 'custom',
      component: 'dataset.pickText',
    },
    {
      path: ['ellipses'],
      label: 'Ellipses per group (95%, on the score plot and biplot)',
      kind: 'checkbox',
    },
  ],
  outputs: (_keys, params) => [
    {
      key: 'scree',
      graph: {
        id: 'scree',
        name: 'Scree plot',
        xTitle: 'Principal component',
        yTitle: 'Eigenvalue',
      },
      mark: 'linePoints',
    },
    ...(params.select === 'parallel'
      ? [{ key: 'parallel', graph: { id: 'scree', name: 'Scree plot' } }]
      : []),
    {
      key: 'scores',
      graph: {
        id: 'scores',
        name: 'PC scores',
        xTitle: 'PC1',
        yTitle: 'PC2',
        ...(params.groupBy ? { variables: groupedScores(params) } : {}),
      },
      mark: 'points' as const,
    },
    ...(params.loadingsPlot
      ? [
          ...pcaKeys(_keys, params).map(
            (k): OutputDecl => ({ key: `loading:${k}`, forDataSet: k, graph: LOADINGS }),
          ),
          { key: 'loadings', graph: LOADINGS, mark: 'points' as const },
        ]
      : []),
    ...(params.biplot
      ? [
          {
            key: 'biplot:scores',
            graph: params.groupBy ? { ...BIPLOT, variables: groupedScores(params) } : BIPLOT,
            mark: 'points' as const,
          },
          ...pcaKeys(_keys, params).map(
            (k): OutputDecl => ({ key: `biplot:${k}`, forDataSet: k, graph: BIPLOT }),
          ),
        ]
      : []),
  ],
  run(withGroup, params, _context, progress) {
    // The grouping variable (roadmap 34c) is analyzed with the variables but not in the PCA.
    const group = params.groupBy ? withGroup.find((d) => d.ref.key === params.groupBy) : undefined
    if (params.groupBy && !group)
      return failure('Choose the grouping variable among the data sets analyzed.')
    if (group && !group.text)
      return failure(`“${group.title}” is not a text variable; group by a text variable.`)
    // Grouped, other text variables are left out too (they have no numbers to analyze).
    const others = group ? withGroup.filter((d) => d !== group && d.text) : []
    const allInput = withGroup.filter((d) => d !== group && !others.includes(d))
    const yIndex = params.pcr ? pick(allInput, params.pcrY) : -1
    const input = allInput.filter((_, i) => i !== yIndex)
    if (params.pcr && input.length < 2)
      return failure('PCR needs an outcome and at least two predictor variables.')
    const cc = completeCases(params.pcr ? [allInput[yIndex]!, ...input] : input)
    if (params.pcr) cc.columns.shift()
    const diagnostics = [...exclusionNotes(allInput), ...droppedNote(cc.dropped)]
    if (others.length)
      diagnostics.push({
        level: 'info',
        message: `Text variables left out of the PCA: ${others.map((d) => `“${d.title}”`).join(', ')}.`,
      })
    const names = input.map((d) => d.title)
    const n = cc.rows.length
    const p = names.length
    // The grouped score plot maps PC1 against PC2 (`groupedScores`): one variable has only PC1.
    if (group && p < 2)
      return failure(
        `Grouping by “${group.title}” needs at least two number variables in the PCA: with one, there is only PC1 and no PC2 to plot the groups against.`,
        diagnostics,
      )
    if (n < 3) return failure('PCA needs at least three complete rows.', diagnostics)
    // A variable with no variation can't be standardized (its correlations are 0/0).
    const constant = names.filter((_, v) => cc.columns[v]!.every((x) => x === cc.columns[v]![0]))
    if (constant.length && (params.standardize || constant.length === p)) {
      return failure(
        `${constant.map((t) => `“${t}”`).join(', ')} ${constant.length > 1 ? 'have' : 'has'} the same value in every row; remove ${constant.length > 1 ? 'these variables' : 'this variable'} to run PCA.`,
        diagnostics,
      )
    }
    const X = cc.rows.map((_, r) => cc.columns.map((c) => c[r]!))
    const value =
      params.select === 'fixed'
        ? params.components
        : params.select === 'variance'
          ? params.variancePercent
          : undefined
    // Roadmap 42: parallel analysis' simulations are the time it takes (twice with a PCR, which
    // runs the PCA again: each run half the progress).
    const twice = params.pcr && params.select === 'parallel'
    const res = pca(X, {
      standardize: params.standardize,
      select: { method: params.select, value, simulations: params.simulations, seed: params.seed },
      ...(progress && { progress: twice ? (d, t) => progress(d, 2 * t) : progress }),
    })
    const pcs = res.eigenvalues.map((_, i) => `PC${i + 1}`)
    // With no component selected, the tables still show PC1 (marked not retained).
    if (res.selected === 0)
      diagnostics.push({
        level: 'info',
        message: 'No component passed the selection rule; showing the first component.',
      })
    const kept = pcs.slice(0, Math.max(1, res.selected))
    const blocks: ResultBlock[] = [
      table(
        'Eigenvalues',
        [
          'Component',
          'Eigenvalue',
          'Proportion of variance',
          'Cumulative proportion',
          ...(res.parallel ? ['Parallel analysis (95th percentile)'] : []),
          'Retained?',
        ],
        res.eigenvalues.map((ev, i) => [
          text(pcs[i]!),
          num(ev),
          num(res.proportion[i]!),
          num(res.cumulative[i]!),
          ...(res.parallel ? [num(res.parallel.percentile[i]!)] : []),
          yesNo(i < res.selected),
        ]),
      ),
      table(
        'Loadings',
        ['Variable', ...kept],
        names.map((name, v) => [text(name), ...kept.map((_, c) => num(res.loadings[v]![c]!))]),
      ),
      table(
        'Eigenvectors',
        ['Variable', ...kept],
        names.map((name, v) => [text(name), ...kept.map((_, c) => num(res.eigenvectors[v]![c]!))]),
      ),
      kv('Data analyzed', [
        ['Number of variables', int(p)],
        ['Number of rows analyzed', int(n)],
        ['Standardized', yesNo(params.standardize)],
        ['Components retained', int(res.selected)],
      ]),
    ]
    const scoreRows = res.scores.map((row, r) => [
      int(cc.rows[r]! + 1),
      ...kept.map((_, c) => num(row[c]!)),
    ])
    const idx = res.eigenvalues.map((_, i) => i + 1)
    const sheets: ResultSheet[] = [
      resultsSheet(blocks),
      {
        key: 'scores',
        title: 'PC scores',
        blocks: [table('PC scores', ['Row', ...kept], scoreRows)],
      },
    ]
    const extra: AnalysisResult['outputs'] = {}
    const l2 = (v: number) => res.loadings[v]![1] ?? 0
    if (params.loadingsPlot) {
      input.forEach((d, v) => {
        extra[`loading:${d.ref.key}`] = {
          title: d.title,
          x: [0, res.loadings[v]![0]!],
          y: [0, l2(v)],
        }
      })
      extra.loadings = {
        title: 'Loadings',
        x: input.map((_, v) => res.loadings[v]![0]!),
        y: input.map((_, v) => l2(v)),
      }
    }
    if (params.biplot) {
      // The loadings are scaled to 90% of the PC scores — here the largest loading
      // coordinate on PC1/PC2 becomes 90% of the largest absolute score on them.
      const sMax = maxOf(res.scores.flatMap((r) => [Math.abs(r[0]!), Math.abs(r[1] ?? 0)]))
      const lMax = Math.max(
        ...input.flatMap((_, v) => [Math.abs(res.loadings[v]![0]!), Math.abs(l2(v))]),
      )
      const m = lMax > 0 ? (0.9 * sMax) / lMax : 1
      extra['biplot:scores'] = {
        title: 'Scores',
        x: res.scores.map((r) => r[0]!),
        y: res.scores.map((r) => r[1] ?? 0),
      }
      input.forEach((d, v) => {
        extra[`biplot:${d.ref.key}`] = {
          title: d.title,
          x: [0, m * res.loadings[v]![0]!],
          y: [0, m * l2(v)],
        }
      })
      blocks.push({
        type: 'note',
        text: `Biplot: the loading vectors are multiplied by ${+m.toPrecision(4)} to share the score plot's axes; read their angles, not their lengths.`,
      })
    }
    const values: AnalysisResult['values'] = { selected: int(res.selected) }
    // Grouped (roadmap 34c): the scores as a table with the group of each row analyzed, which the
    // score plot and biplot draw coloured by group.
    const scoreTable = group
      ? buildTable(withGroup, {
          name: 'PC scores',
          tableKind: 'multipleVariables',
          rowCount: n,
          rowTitles: cc.rows.map((r) => input[0]?.rowTitles?.[r] ?? `Row ${r + 1}`),
          x: null,
          dataSets: [
            ...res.eigenvalues.slice(0, Math.max(2, kept.length)).map((_, c) => ({
              id: SCORE_ID(c),
              title: pcs[c]!,
              subcolumns: [res.scores.map((row) => row[c] ?? 0)],
            })),
            {
              id: GROUP_ID,
              title: group.title,
              subcolumns: [[]],
              text: cc.rows.map((r) => group.text![r]?.trim() || null),
            },
          ],
        })
      : undefined
    if (params.pcr) {
      const y = pcrOutcome(allInput[yIndex]!, cc.rows)
      const r = principalComponentRegression(y, X, names, {
        standardize: params.standardize,
        select: {
          method: params.select,
          value,
          simulations: params.simulations,
          seed: params.seed,
        },
        confLevel: params.confidenceLevel,
        ...(progress && twice && { progress: (d, t) => progress(t + d, 2 * t) }),
      })
      sheets.push(pcrSheet(r, allInput[yIndex]!.title, params.confidenceLevel))
      values.pcrRSquared = num(r.regression.rSquared)
    }
    return result({
      diagnostics,
      sheets,
      values,
      outputs: {
        ...extra,
        scree: { title: 'Eigenvalue', x: idx, y: res.eigenvalues },
        ...(res.parallel
          ? { parallel: { title: 'Parallel analysis', x: idx, y: res.parallel.percentile } }
          : {}),
        scores: {
          title: 'Scores',
          x: res.scores.map((r) => r[0]!),
          y: res.scores.map((r) => r[1] ?? 0),
        },
      },
      ...(scoreTable ? { table: scoreTable } : {}),
    })
  },
}

const LOADINGS = { id: 'loadings', name: 'Loadings plot', xTitle: 'PC1', yTitle: 'PC2' }
const BIPLOT = { id: 'biplot', name: 'Biplot', xTitle: 'PC1', yTitle: 'PC2' }

/** The outcome's values in the complete rows. */
function pcrOutcome(ds: NormalizedDataSet, rows: readonly number[]): number[] {
  const col = firstCol(ds)
  return rows.map((r) => col[r]!)
}

function pcrSheet(
  r: ReturnType<typeof principalComponentRegression>,
  yName: string,
  level: number,
): ResultSheet {
  const cols = coefColumns('|t|', level)
  const g = r.regression
  return {
    key: 'pcr',
    title: 'Principal component regression',
    blocks: [
      table(
        `Regression of ${yName} on the principal components`,
        cols,
        coefRows(g.coefficients, level),
      ),
      table(`The same model in terms of the original variables`, cols, coefRows(r.original, level)),
      kv('Goodness of fit', [
        ['R squared', num(g.rSquared)],
        ['Adjusted R squared', num(g.adjRSquared)],
        ['Sy.x', num(g.syx)],
        ['F', num(g.F)],
        ['DFn, DFd', text(`${g.dfn}, ${g.dfd}`)],
        ...pSig(g.p),
      ]),
      kv('Data analyzed', [
        ['Outcome', text(yName)],
        ['Components used', int(r.k)],
        ['Number of rows analyzed', int(g.n)],
      ]),
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// ROC curve
// ---------------------------------------------------------------------------------------------

const RocParams = z.object({
  direction: z.enum(['auto', 'higher', 'lower']).default('auto'),
  ciMethod: z.enum(['clopperPearson', 'wilsonBrown']).default('clopperPearson'),
  confidenceLevel,
})
type RocParams = z.infer<typeof RocParams>

export const rocDef: AnalysisDef<RocParams> = {
  id: 'roc',
  version: 1,
  title: 'ROC curve',
  category: 'Column analyses',
  description:
    'Receiver operating characteristic curve comparing a control column with a patient column: sensitivity and specificity at each cutoff, and the area under the curve.',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: RocParams,
  form: [
    {
      path: ['direction'],
      label: 'Patients have',
      kind: 'radio',
      options: [
        { value: 'auto', label: 'Decide from the data' },
        { value: 'higher', label: 'Higher values than controls' },
        { value: 'lower', label: 'Lower values than controls' },
      ],
    },
    {
      path: ['ciMethod'],
      label: 'CIs of sensitivity and specificity',
      kind: 'radio',
      options: [
        { value: 'clopperPearson', label: 'Clopper-Pearson (exact)' },
        { value: 'wilsonBrown', label: 'Wilson/Brown' },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  outputs: () => [
    {
      key: 'roc',
      graph: {
        id: 'roc',
        name: 'ROC curve',
        xTitle: '100% − Specificity%',
        yTitle: 'Sensitivity%',
        xRange: [0, 100],
        yRange: [0, 100],
        square: true,
      },
    },
    { key: 'identity', graph: { id: 'roc', name: 'ROC curve' } },
  ],
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'A ROC curve needs two data sets: controls and patients.')
    if (few) return few
    const [C, P] = input as [(typeof input)[0], (typeof input)[0]]
    const diagnostics = exclusionNotes(input)
    const controls = rawValues(C)
    const patients = rawValues(P)
    if (!controls || !patients)
      return failure('A ROC curve needs raw values, not summary data.', diagnostics)
    if (!controls.length || !patients.length)
      return failure('Both columns need values.', diagnostics)
    const level = params.confidenceLevel
    const res = rocCurve([...controls], [...patients], {
      confLevel: level,
      direction: params.direction,
      ciMethod: params.ciMethod,
    })
    const blocks: ResultBlock[] = [
      kv('Area under the ROC curve', [
        ['Area', num(res.auc)],
        ['Standard error', num(res.se)],
        [`${pct(level)} CI`, interval(res.lower, res.upper, level)],
        ...pSig(res.p, 'Different from 0.5'),
      ]),
      kv('Data', [
        ['Controls', text(C.title)],
        ['Patients', text(P.title)],
        ['Number of controls', int(res.nControls)],
        ['Number of patients', int(res.nPatients)],
        [
          'Patients have',
          text(res.direction === 'higher' ? 'Higher values than controls' : 'Lower values'),
        ],
      ]),
    ]
    const cutoffs = table(
      'Sensitivity and specificity at each cutoff',
      [
        res.direction === 'higher' ? 'Cutoff (patient if >)' : 'Cutoff (patient if <)',
        'Sensitivity%',
        `${pct(level)} CI`,
        'Specificity%',
        `${pct(level)} CI`,
        'Likelihood ratio',
      ],
      res.points.map((q) => [
        num(q.threshold),
        num(100 * q.sensitivity),
        interval(100 * q.sensLower, 100 * q.sensUpper, level),
        num(100 * q.specificity),
        interval(100 * q.specLower, 100 * q.specUpper, level),
        num(q.likelihoodRatio),
      ]),
    )
    return result({
      diagnostics,
      sheets: [
        resultsSheet(blocks),
        { key: 'cutoffs', title: 'Sensitivity and specificity', blocks: [cutoffs] },
      ],
      values: { auc: num(res.auc), p: pval(res.p) },
      outputs: {
        roc: {
          title: 'ROC curve',
          x: res.curve.map((q) => 100 * q.x),
          y: res.curve.map((q) => 100 * q.y),
        },
        identity: { title: 'Line of identity', x: [0, 100], y: [0, 100] },
      },
    })
  },
}

// ---------------------------------------------------------------------------------------------
// Bland-Altman
// ---------------------------------------------------------------------------------------------

const BAParams = z.object({
  measure: z.enum(['difference', 'ratio', 'percent']).default('difference'),
  order: z.enum(['aMinusB', 'bMinusA']).default('aMinusB'),
  confidenceLevel,
})
type BAParams = z.infer<typeof BAParams>

export const blandAltmanDef: AnalysisDef<BAParams> = {
  id: 'blandAltman',
  version: 1,
  title: 'Bland-Altman method comparison',
  category: 'Column analyses',
  description:
    'Agreement between two methods measuring the same subjects (values matched by row): bias and 95% limits of agreement.',
  accepts: ['column'],
  inputs: { min: 2, max: 2 },
  params: BAParams,
  form: [
    {
      path: ['measure'],
      label: 'Plot',
      kind: 'radio',
      options: [
        { value: 'difference', label: 'Difference vs. average' },
        { value: 'ratio', label: 'Ratio vs. average' },
        { value: 'percent', label: '% difference vs. average' },
      ],
    },
    {
      path: ['order'],
      label: 'Compute',
      kind: 'radio',
      options: [
        { value: 'aMinusB', label: 'Method A − Method B (A / B)' },
        { value: 'bMinusA', label: 'Method B − Method A (B / A)' },
      ],
    },
    CONFIDENCE_FIELD,
  ],
  outputs: (_keys, params) => {
    const y =
      params.measure === 'ratio'
        ? 'Ratio'
        : params.measure === 'percent'
          ? '% difference'
          : 'Difference'
    const g = { id: 'ba', name: 'Bland-Altman plot', xTitle: 'Average', yTitle: y }
    return [
      { key: 'pairs', graph: g, mark: 'points' },
      { key: 'bias', graph: g },
      { key: 'upper', graph: g },
      { key: 'lower', graph: g },
    ]
  },
  run(input, params) {
    const few = tooFewDataSets(input, 2, 'Bland-Altman compares two data sets.')
    if (few) return few
    const [A, B] = input as [(typeof input)[0], (typeof input)[0]]
    const diagnostics = exclusionNotes(input)
    if (A.data.shape !== 'replicates' || B.data.shape !== 'replicates')
      return failure('Bland-Altman needs raw values, not summary data.', diagnostics)
    const pairs = pairedRows(A.data.reps[0]!, B.data.reps[0]!)
    diagnostics.push(...unpairedRowsNote(A.data.reps[0]!, B.data.reps[0]!))
    if (pairs.a.length < 2) return failure('Need at least two complete pairs.', diagnostics)
    if (params.measure !== 'difference' && [...pairs.a, ...pairs.b].some((v) => v <= 0))
      return failure('Ratios and % differences need positive values.', diagnostics)
    const level = params.confidenceLevel
    const res = blandAltman([...pairs.a], [...pairs.b], {
      measure: params.measure,
      order: params.order,
      confLevel: level,
    })
    const label =
      params.measure === 'ratio'
        ? 'ratio'
        : params.measure === 'percent'
          ? '% difference'
          : 'difference'
    const ci = (name: string, c?: [number, number]): [string, ResultValue][] =>
      c ? [[`${pct(level)} CI of ${name}`, interval(c[0], c[1], level)]] : []
    const blocks: ResultBlock[] = [
      kv('Bias', [
        ['Bias', num(res.bias)],
        [`SD of ${label}`, num(res.sd)],
        ...ci('bias', res.biasCI),
      ]),
      kv(`${pct(level)} limits of agreement`, [
        ['From', num(res.lower)],
        ['To', num(res.upper)],
        ...ci('lower limit', res.lowerCI),
        ...ci('upper limit', res.upperCI),
      ]),
      kv('Data', [
        ['Method A', text(A.title)],
        ['Method B', text(B.title)],
        ['Number of pairs', int(res.n)],
      ]),
    ]
    const [lo, hi] = valueRange(res.x)
    const hline = (title: string, v: number) => ({ title, x: [lo, hi], y: [v, v] })
    return result({
      diagnostics,
      sheets: [
        resultsSheet(blocks),
        {
          key: 'pairs',
          title: 'Difference vs. average',
          blocks: [
            table(
              'Difference vs. average',
              ['Row', 'Average', label[0]!.toUpperCase() + label.slice(1)],
              res.x.map((x, i) => [int(pairs.rows[i]! + 1), num(x), num(res.y[i]!)]),
            ),
          ],
        },
      ],
      values: { bias: num(res.bias) },
      outputs: {
        pairs: { title: label[0]!.toUpperCase() + label.slice(1), x: res.x, y: res.y },
        bias: hline('Bias', res.bias),
        upper: hline('Upper limit of agreement', res.upper),
        lower: hline('Lower limit of agreement', res.lower),
      },
    })
  },
}
