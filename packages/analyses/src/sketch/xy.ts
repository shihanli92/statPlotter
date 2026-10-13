import type { NormalizedDataSet, SketchContext, SketchPanel, SketchSpec } from '@ps/model'
import { midranks } from '@ps/stats'
import { equationMeta } from '../explain/equations.ts'
import { type Constraint, effectiveConstraint, resolveEquation } from '../nonlinear.ts'
import { type SketchSet, sampledRows, xyTable } from './tables.ts'
import { dataSketch } from './twoGroups.ts'
import { countsLine, nameList, plain, q } from './words.ts'

// Roadmap 51b (design §5.6, §9.5): regression, correlation and curves — the XY points, the model's
// shape (the least-squares line through them, through the origin or a point; a curve model's
// starting shape from its automatic initial values: never a fit), ranks for Spearman. No slope,
// r, R², P or fitted parameter is shown.

type Params = Record<string, unknown>
type Point = { x: number; y: number }

/** A data set's points (every replicate at its X), at the sampled rows. */
function pointsOf(d: NormalizedDataSet, rows: readonly number[], means: boolean): Point[] {
  const out: Point[] = []
  if (!d.x) return out
  const arrays = d.data.shape === 'replicates' ? d.data.reps : [d.data.mean]
  for (const r of rows) {
    const x = d.x[r] ?? Number.NaN
    if (!Number.isFinite(x)) continue
    const ys = arrays.map((a) => a[r] ?? Number.NaN).filter(Number.isFinite)
    if (!ys.length) continue
    if (means) out.push({ x, y: ys.reduce((s, v) => s + v, 0) / ys.length })
    else for (const y of ys) out.push({ x, y })
  }
  return out
}

/** The XY points of the data sets as one table (one row per point), with `lines` added. */
export function pointsTable(
  id: string,
  sets: readonly { key: string; title: string; points: readonly Point[] }[],
  xTitle: string,
): ReturnType<typeof xyTable> {
  const x: number[] = []
  const reps: SketchSet[] = sets.map((s) => ({ key: s.key, title: s.title, reps: [[]] }))
  sets.forEach((s, k) => {
    for (const p of s.points) {
      x.push(p.x)
      reps.forEach((r, j) => {
        ;(r.reps[0] as (number | null)[]).push(j === k ? p.y : null)
      })
    }
  })
  return xyTable(id, x, reps, xTitle)
}

/** The least-squares line of y on x (free, through the origin, or through a point). */
function leastSquares(points: readonly Point[], through?: Point): ((x: number) => number) | null {
  if (points.length < 2) return null
  if (through) {
    let sxy = 0
    let sxx = 0
    for (const p of points) {
      sxy += (p.x - through.x) * (p.y - through.y)
      sxx += (p.x - through.x) ** 2
    }
    if (!(sxx > 0)) return null
    const b = sxy / sxx
    return (x) => through.y + b * (x - through.x)
  }
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  let sxy = 0
  let sxx = 0
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my)
    sxx += (p.x - mx) ** 2
  }
  if (!(sxx > 0)) return null
  const b = sxy / sxx
  return (x) => my + b * (x - mx)
}

/** X values to draw a shape at, spaced evenly (geometrically for wide positive ranges). */
function grid(lo: number, hi: number, n = 40): number[] {
  if (!(hi > lo)) return [lo]
  const geometric = lo > 0 && hi / lo >= 100
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return geometric ? lo * (hi / lo) ** t : lo + (hi - lo) * t
  })
}

const extentOf = (pts: readonly Point[]) => {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    if (p.x < lo) lo = p.x
    if (p.x > hi) hi = p.x
  }
  return { lo, hi }
}

function sampled(input: readonly NormalizedDataSet[], ctx: SketchContext) {
  const total = input.reduce((m, d) => Math.max(m, d.rowCount), 0)
  const rows = sampledRows(total, ctx.maxRows)
  return { rows, ...(rows.length < total ? { sampled: { shown: rows.length, total } } : {}) }
}

/** Linear (and Deming) regression: the points, and the least-squares line's shape. */
export function lineSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
  deming = false,
): SketchSpec {
  if (!input.length || !input.some((d) => d.x))
    return dataSketch(input, ctx, 'Regression needs an XY table.')
  const s = sampled(input, ctx)
  const means = params.replicates === 'mean'
  const origin = !deming && params.throughOrigin === true
  const point =
    !deming && !origin && params.throughPoint === true
      ? { x: Number(params.pointX ?? 0), y: Number(params.pointY ?? 0) }
      : undefined
  const sets = input.map((d) => ({
    key: d.ref.key,
    title: d.title,
    points: pointsOf(d, s.rows, means),
  }))
  const lines = sets.flatMap((set, i) => {
    const f = deming ? null : leastSquares(set.points, origin ? { x: 0, y: 0 } : point)
    if (!f) return []
    const { lo, hi } = extentOf(set.points)
    const xs = grid(origin ? Math.min(0, lo) : lo, hi, 2)
    return [
      { key: `line${i}`, title: `${set.title}: model`, points: xs.map((x) => ({ x, y: f(x) })) },
    ]
  })
  const table = pointsTable('line', [...sets, ...lines], ctx.xTitle ?? 'X')
  const shape = deming
    ? params.errors === 'sd'
      ? 'a straight line, with X and Y errors weighted by the SDs you enter'
      : 'a straight line, with equal errors in X and Y (perpendicular distances)'
    : origin
      ? 'a straight line through (0, 0)'
      : point
        ? `a straight line through (${plain(point.x)}, ${plain(point.y)})`
        : 'a straight line'
  const n = sets.reduce((t, x) => t + x.points.length, 0)
  const notes: string[] = []
  if (means) notes.push('Only the mean Y at each X is fitted: replicates count once.')
  else notes.push('Each replicate is a point of its own: they should be independent.')
  if (params.compare === true && input.length > 1) notes.push('One line per data set, compared.')
  const panel: SketchPanel = {
    id: 'line',
    table,
    preset: 'each',
    lineSets: lines.map((l) => l.key),
    ...(point ? { lines: [{ at: point.x, axis: 'x' as const }] } : {}),
  }
  return {
    panels: [panel],
    caption: `The model: ${shape}.`,
    description: `${input.length} data set${input.length === 1 ? '' : 's'} (${nameList(input.map((d) => d.title))}), ${n} points; the model is ${shape}.`,
    counts: countsLine([
      `${input.length} data set${input.length === 1 ? '' : 's'}`,
      `${n} points`,
      means ? 'means' : 'each replicate',
    ]),
    notes,
    ...(s.sampled ? { sampled: s.sampled } : {}),
  }
}

/** Correlation: the pairs as a scatter (Spearman: ranks on both axes). */
export function correlationSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  const spearman = params.method === 'spearman'
  const s = sampled(input, ctx)
  let pts: Point[] = []
  let names: [string, string] = ['X', 'Y']
  if (input.every((d) => d.x)) {
    pts = input.flatMap((d) => pointsOf(d, s.rows, false))
    names = [ctx.xTitle ?? 'X', input.map((d) => d.title).join(', ')]
  } else if (input.length >= 2) {
    const [a, b] = input as [NormalizedDataSet, NormalizedDataSet]
    const xa = a.data.shape === 'replicates' ? a.data.reps[0]! : a.data.mean
    const xb = b.data.shape === 'replicates' ? b.data.reps[0]! : b.data.mean
    for (const r of s.rows) {
      const x = xa[r] ?? Number.NaN
      const y = xb[r] ?? Number.NaN
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y })
    }
    names = [a.title, b.title]
  } else return dataSketch(input, ctx, 'Correlation needs two columns (or an XY table).')
  if (spearman && pts.length) {
    const rx = midranks(pts.map((p) => p.x)).ranks
    const ry = midranks(pts.map((p) => p.y)).ranks
    pts = pts.map((_, i) => ({ x: rx[i]!, y: ry[i]! }))
  }
  const pairs =
    input.length > 2 && !input.every((d) => d.x) ? (input.length * (input.length - 1)) / 2 : 1
  return {
    panels: [
      {
        id: 'pairs',
        title: input.length > 2 && pairs > 1 ? `The first pair of ${pairs}` : undefined,
        table: pointsTable(
          'pairs',
          [{ key: 'pairs', title: names[1], points: pts }],
          spearman ? `Rank of ${names[0]}` : names[0],
        ),
        preset: 'each',
        axes: {
          xTitle: spearman ? `Rank of ${names[0]}` : names[0],
          yTitle: spearman ? `Rank of ${names[1]}` : names[1],
        },
      },
    ],
    caption: spearman
      ? 'Spearman’s correlation looks at the ranks: each axis is the values’ order.'
      : 'Pearson’s correlation looks at how close the points are to a straight line.',
    description: `${pts.length} pairs of ${q(names[0])} and ${q(names[1])}${spearman ? ', as ranks' : ''}${pairs > 1 ? `; ${pairs} pairs of variables in all` : ''}.`,
    counts: countsLine([
      `${pts.length} points`,
      pairs > 1 ? `${pairs} pairs of variables` : null,
      spearman ? 'ranks' : 'values',
    ]),
    ...(s.sampled ? { sampled: s.sampled } : {}),
  }
}

/** Simple logistic regression: the 0/1 outcomes at their X. */
export function logisticSketch(
  input: readonly NormalizedDataSet[],
  _params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (!input.some((d) => d.x))
    return dataSketch(input, ctx, 'Logistic regression needs an XY table.')
  const s = sampled(input, ctx)
  const sets = input.map((d) => ({
    key: d.ref.key,
    title: d.title,
    points: pointsOf(d, s.rows, false),
  }))
  const n = sets.reduce((t, x) => t + x.points.length, 0)
  const ones = sets.reduce((t, x) => t + x.points.filter((p) => p.y === 1).length, 0)
  return {
    panels: [{ id: 'data', table: pointsTable('data', sets, ctx.xTitle ?? 'X'), preset: 'each' }],
    caption:
      'Each point is a subject: Y is 1 (yes) or 0 (no); the model is an S-shaped probability.',
    description: `${n} subjects, ${ones} with Y = 1 and ${n - ones} with Y = 0, against ${ctx.xTitle ?? 'X'}.`,
    counts: countsLine([`${n} subjects`, `${ones} ones`, `${n - ones} zeros`]),
    ...(s.sampled ? { sampled: s.sampled } : {}),
  }
}

/** A data set's title as a number (a data set constant's value), NaN if it isn't one. */
const titleNumber = (t: string) => (t.trim() === '' ? Number.NaN : Number(t))

/**
 * A curve fit (§9.5, the user's answer to §10.4 question 3): the data and the model's starting
 * shape — the equation's automatic initial values (or those typed), constants and data set
 * constants held, a shared parameter one value across the data sets (as the fit starts) —
 * labelled as such, never the fit, no parameter value. Constants on a plateau or the midpoint
 * are dashed lines ("Bottom = 0", typed by the user); the model compared with, its own shape.
 */
export function curveSketch(
  input: readonly NormalizedDataSet[],
  params: Params,
  ctx: SketchContext,
): SketchSpec {
  if (!input.some((d) => d.x)) return dataSketch(input, ctx, 'A curve fit needs an XY table.')
  const s = sampled(input, ctx)
  const means = params.replicates === 'mean'
  const sets = input.map((d) => ({
    key: d.ref.key,
    title: d.title,
    points: pointsOf(d, s.rows, means),
  }))
  const resolved = resolveEquation(params as Parameters<typeof resolveEquation>[0])
  const notes: string[] = []
  const shapes: { key: string; title: string; points: Point[] }[] = []
  const lines: { at: number; axis: 'x' | 'y'; label: string; dashed: true }[] = []
  const constraints = (params.constraints ?? {}) as Record<string, Constraint>
  if (resolved.ok) {
    const model = resolved.model
    const starts = startingValues(model, sets, constraints, true)
    sets.forEach((set, i) => {
      const p0 = starts[i]
      if (!p0) return
      const pts = shapeOver(model, p0, set.points)
      if (pts.length > 1)
        shapes.push({ key: `start${i}`, title: `${set.title}: starting shape`, points: pts })
    })
    // The model compared with: its own starting shape (no verdict).
    const other = typeof params.compareWith === 'string' ? params.compareWith : 'none'
    if (other !== 'none' && other !== params.equation) {
      const alt = resolveEquation({ equation: other, userEquation: '', initialValues: {} })
      if (alt.ok) {
        const altStarts = startingValues(alt.model, sets, {}, false)
        sets.forEach((set, i) => {
          const p0 = altStarts[i]
          if (!p0) return
          const pts = shapeOver(alt.model, p0, set.points)
          if (pts.length > 1)
            shapes.push({ key: `alt${i}`, title: `${set.title}: ${alt.model.name}`, points: pts })
        })
        notes.push(`Also drawn: the starting shape of ${alt.model.name}, the model compared with.`)
      }
    }
    // Constants on a plateau or the midpoint, as dashed lines (the values typed).
    const meta = equationMeta(String(params.equation))
    for (const name of model.params) {
      const c = effectiveConstraint(model, name, { constraints })
      if (c.kind !== 'constant' || !meta) continue
      if (name === meta.top || name === meta.bottom)
        lines.push({ at: c.value, axis: 'y', label: `${name} = ${plain(c.value)}`, dashed: true })
      else if (name === meta.midpoint)
        lines.push({ at: c.value, axis: 'x', label: `${name} = ${plain(c.value)}`, dashed: true })
    }
    const sharedNames = model.params.filter(
      (n) => effectiveConstraint(model, n, { constraints }).kind === 'shared',
    )
    if (sharedNames.length && sets.length > 1)
      notes.push(
        `${nameList(sharedNames)} ${sharedNames.length === 1 ? 'is' : 'are'} shared: one value for all ${sets.length} data sets, fit together.`,
      )
    const weighting = params.weighting
    if (weighting && weighting !== 'none')
      notes.push(
        weighting === 'sd'
          ? 'Weighted by 1/SD²: points where replicates scatter more count less.'
          : weighting === 'x' || weighting === 'x2'
            ? 'Weighted by X: points at large X count less.'
            : 'Weighted by Y: points with large Y count less.',
      )
  } else notes.push(resolved.message)
  // Each dashed line's label beside it, inside the data's extent.
  const all = sets.flatMap((x) => x.points)
  const labels: { x: number; y: number; text: string }[] = []
  if (all.length) {
    const { lo } = extentOf(all)
    let yHi = Number.NEGATIVE_INFINITY
    for (const p of all) if (p.y > yHi) yHi = p.y
    for (const l of lines)
      labels.push(
        l.axis === 'y' ? { x: lo, y: l.at, text: l.label } : { x: l.at, y: yHi, text: l.label },
      )
  }
  const name = resolved.ok ? resolved.model.name : 'the model'
  const n = sets.reduce((t, x) => t + x.points.length, 0)
  return {
    panels: [
      {
        id: 'curve',
        title: 'Starting shape, not the fit',
        table: pointsTable('curve', [...sets, ...shapes], ctx.xTitle ?? 'X'),
        preset: 'each',
        lineSets: shapes.map((x) => x.key),
        ...(lines.length ? { lines, labels } : {}),
      },
    ],
    caption: `${name}: the line is its starting shape from the initial values, not the fitted curve.`,
    description: `${input.length} data set${input.length === 1 ? '' : 's'}, ${n} points, with the starting shape of ${name} (before fitting; no parameter is estimated here).`,
    counts: countsLine([
      `${input.length} data set${input.length === 1 ? '' : 's'}`,
      `${n} points`,
      means ? 'means' : 'each replicate',
    ]),
    notes,
    ...(s.sampled ? { sampled: s.sampled } : {}),
  }
}

/**
 * The values a fit starts from in each data set: the model's initial values (typed or automatic),
 * constants and data set constants held, shared parameters the mean over the data sets (as
 * `nonlinearFit` lays them out). Null for a data set whose values can't be computed.
 */
function startingValues(
  model: FitModelLike,
  sets: readonly { title: string; points: readonly Point[] }[],
  constraints: Record<string, Constraint>,
  own: boolean,
): (number[] | null)[] {
  const cons = model.params.map((n) =>
    own
      ? effectiveConstraint(model, n, { constraints })
      : effectiveConstraint(model, n, { constraints: {} }),
  )
  const fixedOf = (set: { title: string; points: readonly Point[] }) =>
    cons.map((c) =>
      c.kind === 'constant'
        ? c.value
        : c.kind === 'dataSetConstant'
          ? titleNumber(set.title)
          : c.kind === 'meanX'
            ? set.points.reduce((t, p) => t + p.x, 0) / Math.max(1, set.points.length)
            : undefined,
    )
  const raw = sets.map((set) => {
    if (set.points.length < 2) return null
    try {
      const fixed = fixedOf(set)
      const v = model.initial(
        set.points.map((p) => p.x),
        set.points.map((p) => p.y),
        fixed,
      )
      return v.map((x, j) => fixed[j] ?? x)
    } catch {
      return null
    }
  })
  cons.forEach((c, j) => {
    if (c.kind !== 'shared') return
    const vals = raw.flatMap((v) => (v && Number.isFinite(v[j]!) ? [v[j]!] : []))
    if (!vals.length) return
    const m = vals.reduce((t, x) => t + x, 0) / vals.length
    for (const v of raw) if (v) v[j] = m
  })
  return raw
}

type FitModelLike = Parameters<typeof effectiveConstraint>[0] & {
  params: readonly string[]
  initial: (x: number[], y: number[], fixed?: readonly (number | undefined)[]) => number[]
  f: (x: number, p: ArrayLike<number>) => number
}

/** A model's curve at values `p` over the X extent of some points. */
function shapeOver(model: FitModelLike, p: readonly number[], points: readonly Point[]): Point[] {
  const { lo, hi } = extentOf(points)
  return grid(lo, hi)
    .map((gx) => ({ x: gx, y: model.f(gx, p) }))
    .filter((q) => Number.isFinite(q.y))
}
