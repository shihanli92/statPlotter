import type { AnalysisDef, GraphableDataSet, NormalizedDataSet, OutputDecl } from '@ps/model'
import { z } from 'zod'
import { failure, firstCol } from './common.ts'
import {
  migrateNonlinear,
  NonlinearParamsSchema,
  nonlinearFitDef,
  runNonlinear,
} from './nonlinear.ts'
import { stableId } from './resultTable.ts'

// Nonlinear regression from a multiple-variables table (roadmap item 20): choose the X and Y
// variables and, optionally, a grouping variable (numeric, or a text variable); each group is
// fit as a data set of its own with every option of the XY analysis (shared parameters across
// groups, data set constants from numeric group values, comparisons…). The data and curves are
// drawn on an output graph of the analysis, with a slot per group (up to MAX_GROUPS).

/** Groups that get a slot on the output graph (more are fit but not drawn). */
const MV_MAX_GROUPS = 12

const MVParams = NonlinearParamsSchema.extend({
  /** Data set keys of the X and Y variables ('' = the first / second analyzed variable). */
  x: z.string().default(''),
  y: z.string().default(''),
  /** Grouping variable ('' = none): one fit (data set) per distinct value. */
  group: z.string().default(''),
})
type NonlinearMVParams = z.infer<typeof MVParams>

const GRAPH = { id: 'mvfit', name: 'Curve fit' }

export const nonlinearFitMVDef: AnalysisDef<NonlinearMVParams> = {
  id: 'nonlinearFitMV',
  version: 2,
  title: 'Nonlinear regression (curve fit)',
  category: 'Multiple variable analyses',
  description:
    'Fit a curve of one variable against another — any built-in or user-defined equation — optionally one curve per value of a grouping variable (numbers or text), with the options of XY nonlinear regression.',
  accepts: ['multipleVariables'],
  inputs: { min: 2, max: 64 },
  // Phase 42: X and Y default to the first two data sets chosen, which must be numbers.
  numbersByDefault: true,
  params: MVParams,
  migrateParams: migrateNonlinear,
  form: [
    { path: ['x'], label: 'X variable', kind: 'custom', component: 'dataset.pick' },
    { path: ['y'], label: 'Y variable', kind: 'custom', component: 'dataset.pick:1' },
    { path: ['group'], label: 'Grouping variable', kind: 'custom', component: 'dataset.pickNone' },
    ...nonlinearFitDef.form.filter(
      (f) => f.path[0] !== 'equationByDataSet' && f.path[0] !== 'interpolate',
    ),
  ],
  outputs: (_keys, params) => {
    const n = params.group ? MV_MAX_GROUPS : 1
    const out: OutputDecl[] = []
    for (let i = 0; i < n; i++) {
      out.push(
        { key: `mv:points:${i}`, graph: GRAPH, mark: 'points' },
        {
          key: `mv:curve:${i}`,
          graph: GRAPH,
          mark: 'line',
          // Roadmap 35: each group's fit on graphs of the variables, too.
          ...(params.x && params.y ? { onGraphsOf: { x: params.x, y: params.y } } : {}),
        },
      )
    }
    return out
  },
  run(input, params, _context, progress) {
    const pick = (key: string, fallback: number) =>
      input.find((d) => d.ref.key === key) ?? input[fallback]
    const xv = pick(params.x, 0)
    const yv = pick(params.y, 1)
    if (!xv || !yv) return failure('Choose an X and a Y variable.')
    if (xv === yv) return failure('X and Y must be different variables.')
    for (const v of [xv, yv])
      if (v.text) return failure(`“${v.title}” is a text variable; X and Y must be numbers.`)
    const gv = params.group ? input.find((d) => d.ref.key === params.group) : undefined
    if (gv && (gv === xv || gv === yv))
      return failure('The grouping variable must differ from X and Y.')
    const xs = firstCol(xv)
    const ys = firstCol(yv)
    const gs = gv && !gv.text ? firstCol(gv) : null
    // Rows by group, groups in order: numeric values ascending, text in order of appearance.
    const rows = new Map<string, number[]>()
    let skipped = 0
    for (let r = 0; r < xv.rowCount; r++) {
      if (!Number.isFinite(xs[r]!) || !Number.isFinite(ys[r]!)) continue
      let level = ''
      if (gv) {
        const t = gv.text ? gv.text[r] : Number.isFinite(gs![r]!) ? String(gs![r]) : null
        if (t === null || t === undefined || t === '') {
          skipped++
          continue
        }
        level = t
      }
      const list = rows.get(level)
      if (list) list.push(r)
      else rows.set(level, [r])
    }
    let levels = [...rows.keys()]
    if (gv && !gv.text) levels = levels.sort((a, b) => Number(a) - Number(b))
    if (!levels.length) return failure('No row has both an X and a Y value.')
    const node = xv.ref.node
    const sets: NormalizedDataSet[] = levels.map((level) => {
      const rs = rows.get(level)!
      return {
        ref: { node, key: stableId('mvfit', xv.ref.key, yv.ref.key, level) },
        title: gv ? level : yv.title,
        rowCount: rs.length,
        rowTitles: xv.rowTitles ? rs.map((r) => xv.rowTitles![r] ?? `Row ${r + 1}`) : null,
        x: Float64Array.from(rs, (r) => xs[r]!),
        data: { shape: 'replicates', reps: [Float64Array.from(rs, (r) => ys[r]!)] },
        counts: { empty: 0, excluded: 0 },
      }
    })
    const res = runNonlinear(
      sets,
      { ...params, equationByDataSet: {}, interpolate: false },
      { tableKind: 'xy', xTitle: xv.title },
      progress,
    )
    const outputs: Record<string, GraphableDataSet> = {}
    sets.forEach((s, i) => {
      if (i >= MV_MAX_GROUPS) return
      outputs[`mv:points:${i}`] = {
        title: s.title,
        x: Array.from(s.x!),
        y: Array.from((s.data as { reps: Float64Array[] }).reps[0]!),
      }
      const c = res.outputs[`curve:${s.ref.key}`]
      // A group's fit carries its level (roadmap 35): drawn in the group's colour.
      if (c)
        outputs[`mv:curve:${i}`] = {
          ...c,
          title: `${s.title} (fit)`,
          ...(gv ? { group: s.title } : {}),
        }
    })
    return {
      ...res,
      outputs,
      sheets: [
        ...res.sheets.map((sh) =>
          sh.key === 'results'
            ? {
                ...sh,
                blocks: [
                  {
                    type: 'note' as const,
                    text: `Y = ${yv.title}, X = ${xv.title}${gv ? `, one fit per value of ${gv.title}` : ''}.`,
                  },
                  ...sh.blocks,
                ],
              }
            : sh,
        ),
      ],
      diagnostics: [
        ...res.diagnostics,
        ...(skipped
          ? [
              {
                level: 'info' as const,
                message: `${skipped} row${skipped === 1 ? '' : 's'} without a value of ${gv!.title} left out.`,
              },
            ]
          : []),
        ...(levels.length > MV_MAX_GROUPS
          ? [
              {
                level: 'info' as const,
                message: `Only the first ${MV_MAX_GROUPS} groups are drawn on the graph.`,
              },
            ]
          : []),
      ],
    }
  },
}
