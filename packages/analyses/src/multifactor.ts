import type { AnalysisDef, Diagnostic, ResultBlock, ResultSheet, ResultValue } from '@ps/model'
import {
  compareMarginalMeans,
  type EmmComparison,
  levelCombinations,
  marginalMeans,
  multifactorAnova,
  tQuantile,
} from '@ps/stats'
import { z } from 'zod'
import {
  ALL_PAIRS_METHODS,
  allPairsMethod,
  anovaSummaryTable,
  anovaTable,
  comparisonTable,
  effectSizeTable,
  METHOD_TITLE,
} from './anovaCommon.ts'
import {
  ALPHA,
  CONFIDENCE_FIELD,
  confidenceLevel,
  droppedNote,
  exclusionNotes,
  failure,
  indicesOf,
  int,
  interval,
  kv,
  num,
  pct,
  pick,
  pval,
  result,
  resultsSheet,
  rowCountOf,
  table,
  text,
  yesNo,
} from './common.ts'
import { cellsOf, labelOf, levelsOf } from './mvVariables.ts'

// ---------------------------------------------------------------------------------------------
// Multifactor (N-way) ANOVA of a multiple-variables table ("Multifactor ANOVA"): a
// numeric response and any number of factors — text variables, or numeric variables whose
// distinct values are the levels — with all main effects and chosen interactions (by default
// every two- and three-way interaction; four-way and higher ones are left out).
// Type III sums of squares by least squares on the rows (unbalanced designs are
// fine; every combination of an interaction's levels needs data). Effect sizes η², partial η²,
// Cohen's f and % of total variation. Multiple comparisons of estimated marginal means: main
// effects (levels of one factor, averaged over the others), simple effects (levels of one factor
// within each level of another) or cells (every combination of two factors' levels).
// ---------------------------------------------------------------------------------------------

const method = allPairsMethod.exclude(['bky', 'newman-keuls'])

const Params = z.object({
  /** Data set key of the response; '' = the first analyzed variable. */
  y: z.string().default(''),
  /** Factors (data set keys); [] = every other analyzed variable. */
  factors: z.array(z.string()).default([]),
  /** Interactions (two or three factor keys each); null = every two- and three-way one. */
  interactions: z.array(z.array(z.string()).min(2).max(3)).nullable().default(null),
  comparisons: z.enum(['none', 'mainEffects', 'simpleEffects', 'cells']).default('none'),
  /** The factor whose levels are compared; '' = the first factor. */
  compareFactor: z.string().default(''),
  /** Simple effects: within each level of this factor; cells: the second factor ('' = next). */
  byFactor: z.string().default(''),
  method: method.default('tukey'),
  /** Simple effects: one family per level of the other factor (default) or one for all. */
  family: z.enum(['perLevel', 'all']).default('perLevel'),
  confidenceLevel,
})
type Params = z.infer<typeof Params>

const METHODS = ALL_PAIRS_METHODS.filter((m) =>
  ['tukey', 'sidak', 'bonferroni', 'holm-sidak', 'fisher'].includes(m.value),
)

/** Numeric factors with more levels than this get a warning (probably a continuous variable). */
const MANY_LEVELS = 20

export const multifactorAnovaDef: AnalysisDef<Params> = {
  id: 'multifactorAnova',
  version: 1,
  title: 'Multifactor ANOVA',
  category: 'Multiple variable analyses',
  description:
    'N-way ANOVA of a response on any number of categorical factors (text or numeric codes), with chosen interactions, Type III sums of squares for unbalanced data, effect sizes and multiple comparisons of marginal means.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 64 },
  params: Params,
  form: [
    { path: ['y'], label: 'Response (Y) variable', kind: 'custom', component: 'dataset.pick' },
    { path: ['factors'], label: 'Factors', kind: 'custom', component: 'mv.factors:y=0' },
    {
      path: ['interactions'],
      label: 'Interactions',
      kind: 'custom',
      component: 'mv.anovaTerms:y=0',
    },
    {
      path: ['comparisons'],
      label: 'Multiple comparisons',
      kind: 'radio',
      options: [
        { value: 'none', label: 'None' },
        {
          value: 'mainEffects',
          label: 'Main effects: levels of one factor, averaged over the others',
        },
        {
          value: 'simpleEffects',
          label: 'Simple effects: levels of one factor within each level of another',
        },
        { value: 'cells', label: 'Cells: every combination of two factors with every other' },
      ],
    },
    {
      path: ['compareFactor'],
      label: 'Compare the levels of',
      kind: 'custom',
      component: 'dataset.pick:1',
      showIf: { path: ['comparisons'], in: ['mainEffects', 'simpleEffects', 'cells'] },
    },
    {
      path: ['byFactor'],
      label: 'Within each level of (simple effects) / combined with (cells)',
      kind: 'custom',
      component: 'dataset.pick:2',
      showIf: { path: ['comparisons'], in: ['simpleEffects', 'cells'] },
    },
    {
      path: ['method'],
      label: 'Test',
      kind: 'select',
      options: METHODS,
      showIf: { path: ['comparisons'], in: ['mainEffects', 'simpleEffects', 'cells'] },
    },
    {
      path: ['family'],
      label: 'Family of comparisons',
      kind: 'radio',
      options: [
        { value: 'perLevel', label: 'One family per level of the other factor' },
        { value: 'all', label: 'One family for all comparisons (more conservative)' },
      ],
      showIf: { path: ['comparisons'], in: ['simpleEffects'] },
    },
    CONFIDENCE_FIELD,
  ],
  run(input, params) {
    const diagnostics: Diagnostic[] = exclusionNotes(input)
    const yi = pick(input, params.y)
    const chosen = indicesOf(input, params.factors, [yi])
    const factorIdx = chosen.length ? chosen : input.map((_, i) => i).filter((i) => i !== yi)
    if (!factorIdx.length) return failure('Choose at least one factor.', diagnostics)
    const cells = input.map(cellsOf)
    if (cells[yi]!.kind === 'text')
      return failure(`The response “${input[yi]!.title}” must hold numbers.`, diagnostics)
    const used = [yi, ...factorIdx]
    const n = rowCountOf(input)
    const has = (i: number, r: number) =>
      cells[i]!.kind === 'text'
        ? labelOf(cells[i]!, r) !== null
        : !Number.isNaN(cells[i]!.values[r] as number)
    const rows: number[] = []
    let dropped = 0
    for (let r = 0; r < n; r++) {
      const k = used.filter((i) => has(i, r)).length
      if (k === used.length) rows.push(r)
      else if (k > 0) dropped++
    }
    diagnostics.push(...droppedNote(dropped))
    const names = factorIdx.map((i) => input[i]!.title)
    const levels = factorIdx.map((i) => {
      const inRows = new Set(levelsOf(cells[i]!, rows))
      return levelsOf(cells[i]!).filter((l) => inRows.has(l))
    })
    const single = levels.findIndex((l) => l.length < 2)
    if (single >= 0)
      return failure(
        `The factor “${names[single]}” has ${levels[single]!.length ? `a single level (${levels[single]![0]})` : 'no values'} in the analyzed rows.`,
        diagnostics,
      )
    levels.forEach((l, f) => {
      if (cells[factorIdx[f]!]!.kind === 'numeric' && l.length > MANY_LEVELS)
        diagnostics.push({
          level: 'warning',
          message: `“${names[f]}” has ${l.length} different values, each a level of the factor. Is it a continuous variable?`,
        })
    })
    const codes = factorIdx.map((i, f) => {
      const pos = new Map(levels[f]!.map((l, k) => [l, k]))
      return rows.map((r) => pos.get(labelOf(cells[i]!, r)!)!)
    })
    const y = rows.map((r) => cells[yi]!.values[r] as number)

    // Terms: main effects, then the interactions (default: all two- and three-way).
    const k = factorIdx.length
    const keyIndex = new Map(factorIdx.map((i, f) => [input[i]!.ref.key, f]))
    const inter: number[][] = []
    if (params.interactions === null) {
      for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) inter.push([a, b])
      for (let a = 0; a < k; a++)
        for (let b = a + 1; b < k; b++) for (let c = b + 1; c < k; c++) inter.push([a, b, c])
    } else {
      const seen = new Set<string>()
      for (const t of params.interactions) {
        const idx = t.map((key) => keyIndex.get(key))
        if (idx.some((f) => f === undefined) || new Set(idx).size !== idx.length) continue
        const s = (idx as number[]).slice().sort((a, b) => a - b)
        if (seen.has(s.join())) continue
        seen.add(s.join())
        inter.push(s)
      }
      inter.sort((a, b) => a.length - b.length)
    }
    const terms = [...factorIdx.map((_, f) => [f]), ...inter]
    const termName = (t: readonly number[]) => t.map((f) => names[f]!).join(':')
    const nLevels = levels.map((l) => l.length)
    const res = multifactorAnova({ y, factors: codes, nLevels, terms })
    if (res.error === 'aliased') {
      const t = terms[res.aliasedTerms.find((x) => terms[x]!.length > 1) ?? res.aliasedTerms[0]!]!
      const present = new Set(rows.map((_, i) => t.map((f) => codes[f]![i]).join(',')))
      const missing = levelCombinations(nLevels, t).find((c) => !present.has(c.join(',')))
      const where = missing
        ? ` (no data for ${t.map((f, j) => `${names[f]} = ${levels[f]![missing[j]!]}`).join(', ')})`
        : ''
      return failure(
        `Some combinations of levels have no data${where}, so ${t.length > 1 ? `the interaction ${termName(t)}` : termName(t)} can’t be estimated. Leave that interaction out of the model.`,
        diagnostics,
      )
    }
    if (res.error === 'no-residual-df')
      return failure(
        'There are no degrees of freedom left for the residual: the model has as many parameters as there are values. Leave out some interactions or add data.',
        diagnostics,
      )

    const level = params.confidenceLevel
    const dfRes = res.residual.df
    const observed = new Map<string, number[]>()
    rows.forEach((_, i) => {
      const key = codes.map((c) => c[i]).join(',')
      const v = observed.get(key) ?? []
      v.push(y[i]!)
      observed.set(key, v)
    })
    const nCells = nLevels.reduce((a, b) => a * b, 1)
    const counts = [...observed.values()].map((v) => v.length)
    const balanced = observed.size === nCells && counts.every((c) => c === counts[0])
    const blocks: ResultBlock[] = [
      kv('Factors', [
        ['Response', text(input[yi]!.title)],
        ...names.map((nm, f): [string, ResultValue] => [
          nm,
          text(`${levels[f]!.length} levels (${levels[f]!.join(', ')})`),
        ]),
      ]),
      anovaSummaryTable(
        'Multifactor ANOVA (Type III)',
        res.sources.map((s) => ({ ...s, name: termName(s.factors) })),
      ),
      anovaTable(
        res.sources.map((s) => ({ ...s, name: termName(s.factors) })),
        res.residual,
        dfRes,
        { ssLabel: 'SS (Type III)', total: res.total },
      ),
      effectSizeTable(
        res.sources.map((s) => [termName(s.factors), s]),
        false,
      ),
      kv('Data summary', [
        ['Number of factors', int(k)],
        ['Number of values', int(res.N)],
        ['Combinations of levels with data', text(`${observed.size} of ${nCells}`)],
        ['Balanced design?', yesNo(balanced)],
        ['R squared', num(res.rSquared)],
      ]),
    ]
    const sheets: ResultSheet[] = [resultsSheet(blocks)]

    // Marginal means of every factor, and the observed cells.
    const tCrit = tQuantile((1 - level) / 2, dfRes, false)
    const meanBlocks: ResultBlock[] = factorIdx.map((_, f) =>
      table(
        `${names[f]}: estimated marginal means`,
        [names[f]!, 'Mean', 'Standard error', `${pct(level)} CI`, 'N'],
        marginalMeans(res, [f]).map((mm) => [
          text(levels[f]![mm.levels[0]!]!),
          num(mm.mean),
          num(mm.se),
          interval(mm.mean - tCrit * mm.se, mm.mean + tCrit * mm.se, level),
          int(codes[f]!.filter((c) => c === mm.levels[0]).length),
        ]),
      ),
    )
    const cellRows: ResultValue[][] = []
    for (const combo of levelCombinations(
      nLevels,
      factorIdx.map((_, f) => f),
    )) {
      const v = observed.get(combo.join(','))
      if (!v) continue
      const m = v.reduce((a, b) => a + b, 0) / v.length
      const sd =
        v.length > 1
          ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
          : Number.NaN
      cellRows.push([
        ...combo.map((l, f) => text(levels[f]![l]!)),
        int(v.length),
        num(m),
        num(sd),
        num(sd / Math.sqrt(v.length)),
      ])
    }
    meanBlocks.push(table('Observed cell means', [...names, 'N', 'Mean', 'SD', 'SEM'], cellRows), {
      type: 'note',
      text: 'Estimated marginal means average the model’s cell means with equal weight over the levels of the other factors (least-squares means), so unbalanced data don’t bias them.',
    })
    sheets.push({ key: 'means', title: 'Marginal means', blocks: meanBlocks })

    const values = Object.fromEntries(
      res.sources.map((s) => [`p.${termName(s.factors)}`, pval(s.p)]),
    )
    if (params.comparisons === 'none') return result({ sheets, diagnostics, values })

    // ---- Multiple comparisons of estimated marginal means ------------------------------------
    const fOf = (key: string, fallback: number) => {
      const f = keyIndex.get(key)
      return f !== undefined ? f : Math.min(fallback, k - 1)
    }
    const fA = fOf(params.compareFactor, 0)
    let fB = fOf(params.byFactor, fA === 0 ? 1 : 0)
    if (params.comparisons !== 'mainEffects' && (k < 2 || fB === fA)) {
      if (k < 2)
        return failure('Simple effects and cell comparisons need two factors.', [...diagnostics])
      fB = fA === 0 ? 1 : 0
    }
    const LA = nLevels[fA]!
    const LB = nLevels[fB]!
    const opts = { method: params.method, confLevel: level, alpha: ALPHA }
    const pairsOf = (idx: readonly number[]) => {
      const out: [number, number][] = []
      for (let a = 0; a < idx.length; a++)
        for (let b = a + 1; b < idx.length; b++) out.push([idx[a]!, idx[b]!])
      return out
    }
    let labels: string[] = []
    let rowsOut: EmmComparison[] = []
    let family = ''
    if (params.comparisons === 'mainEffects') {
      const pairs = pairsOf(Array.from({ length: LA }, (_, l) => l))
      rowsOut = compareMarginalMeans(res, [fA], pairs, { ...opts, nMeans: LA })
      labels = pairs.map(([a, b]) => `${levels[fA]![a]} vs. ${levels[fA]![b]}`)
      family = `levels of ${names[fA]} (main effect)`
    } else {
      // Means of (A, B) combinations, A varying fastest within B: index = a·LB + b in
      // levelCombinations([fA, fB]) order.
      const at = (a: number, b: number) => a * LB + b
      if (params.comparisons === 'simpleEffects') {
        const perLevel = params.family === 'perLevel'
        const all: [number, number][] = []
        for (let b = 0; b < LB; b++) {
          const pairs = pairsOf(Array.from({ length: LA }, (_, a) => at(a, b)))
          if (perLevel)
            rowsOut.push(...compareMarginalMeans(res, [fA, fB], pairs, { ...opts, nMeans: LA }))
          else all.push(...pairs)
          labels.push(
            ...pairsOf(Array.from({ length: LA }, (_, a) => a)).map(
              ([a, c]) =>
                `${names[fB]} = ${levels[fB]![b]}: ${levels[fA]![a]} vs. ${levels[fA]![c]}`,
            ),
          )
        }
        if (!perLevel)
          rowsOut = compareMarginalMeans(res, [fA, fB], all, { ...opts, nMeans: LA * LB })
        family = `levels of ${names[fA]} within each level of ${names[fB]}${perLevel ? ' (one family per level)' : ' (one family)'}`
      } else {
        const idx = Array.from({ length: LA * LB }, (_, q) => q)
        const pairs = pairsOf(idx)
        rowsOut = compareMarginalMeans(res, [fA, fB], pairs, { ...opts, nMeans: LA * LB })
        const cell = (q: number) => `${levels[fA]![Math.floor(q / LB)]}, ${levels[fB]![q % LB]}`
        labels = pairs.map(([a, b]) => `${cell(a)} vs. ${cell(b)}`)
        family = `every combination of ${names[fA]} and ${names[fB]} with every other`
      }
    }
    sheets.push({
      key: 'comparisons',
      title: 'Multiple comparisons',
      blocks: [
        comparisonTable(
          `${METHOD_TITLE[params.method] ?? params.method} — ${family}`,
          labels,
          rowsOut,
          level,
          params.method,
        ),
        table(
          'Test details',
          ['Comparison', 'Mean Diff.', 'SE of diff.', params.method === 'tukey' ? 'q' : 't', 'DF'],
          rowsOut.map((r, q) => [
            text(labels[q]!),
            num(r.diff),
            num(r.se),
            num(Math.abs(r.stat)),
            int(r.df),
          ]),
        ),
      ],
    })
    return result({ sheets, diagnostics, values })
  },
}
