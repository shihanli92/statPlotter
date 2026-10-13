import { type FunctionCurve, type GraphableDataSet, labelPlain, newSeriesId } from '@ps/model'
import { EQUATIONS, parseEquation } from '@ps/stats'
import { Lru } from './lru.ts'

// "Plot a function": a built-in or user-defined equation drawn on an XY graph over an X
// range, from parameter values stored on the graph (`graph.functions`). Evaluated in the layout,
// like column statistics: nothing derived is stored.

/** Points along a function curve unless the curve sets its own number. */
export const FUNCTION_POINTS = 200

export interface FunctionModel {
  /** Parameter names, in order. */
  params: readonly string[]
  f: (x: number, p: ArrayLike<number>) => number
  /** The equation's name (built-in) or "User-defined equation". */
  name: string
}

/**
 * Parsed user equations by text (a graph re-lays out on every edit; parsing is cached), the 64
 * used last kept.
 */
const parsed = new Lru<string, FunctionModel | { error: string }>(64)

/** The model of a function curve's equation, or why it can't be drawn. */
export function functionModel(
  fc: Pick<FunctionCurve, 'equation' | 'userEquation'>,
): FunctionModel | { error: string } {
  if (fc.equation !== 'user') {
    const def = EQUATIONS.find((e) => e.id === fc.equation)
    if (!def) return { error: `Unknown equation “${fc.equation}”.` }
    return { params: def.params, f: (x, p) => def.f(x, p), name: def.name }
  }
  const text = fc.userEquation ?? ''
  const hit = parsed.get(text)
  if (hit) return hit
  // Audit 4 (T1): an unexpected failure is an error the graph shows, never one that escapes
  // the layout.
  let out: FunctionModel | { error: string }
  try {
    const r = parseEquation(text)
    out = r.ok
      ? { params: r.parameters, f: (x, p) => r.program.f(x, p), name: 'User-defined equation' }
      : { error: `Line ${r.line}, column ${r.column}: ${r.message}` }
  } catch (e) {
    out = { error: `The equation can’t be read: ${e instanceof Error ? e.message : String(e)}` }
  }
  parsed.set(text, out)
  return out
}

/**
 * Starting parameter values for an equation: a constant it declares, else 0 for Bottom and
 * baselines, 100 for Top and plateaus, 1 otherwise.
 */
export function defaultFunctionParams(
  fc: Pick<FunctionCurve, 'equation' | 'userEquation'>,
): Record<string, number> {
  const m = functionModel(fc)
  if ('error' in m) return {}
  const def = EQUATIONS.find((e) => e.id === fc.equation)
  return Object.fromEntries(
    m.params.map((name) => {
      const c = def?.paramInfo[name]?.defaultConstraint
      if (c && typeof c === 'object' && 'constant' in c) return [name, c.constant]
      if (/^(bottom|baseline|y0|nonspecific)$/i.test(name)) return [name, 0]
      if (/^(top|plateau|ymax|bmax|vmax)$/i.test(name)) return [name, 100]
      return [name, 1]
    }),
  )
}

/**
 * The curve of a function over [from, to] (log-spaced when `log` and both ends are positive):
 * X and Y arrays with NaN where the equation is undefined. `warnings` gets missing parameters and
 * equation errors.
 */
export function evaluateFunction(
  fc: FunctionCurve,
  range: [number, number],
  log: boolean,
  warnings: string[] = [],
): GraphableDataSet | null {
  const m = functionModel(fc)
  const label = labelPlain(fc.title) || ('error' in m ? fc.equation : m.name)
  if ('error' in m) {
    warnings.push(`${label}: ${m.error}`)
    return null
  }
  const missing = m.params.filter((p) => !Number.isFinite(fc.params[p]))
  if (missing.length) warnings.push(`${label}: no value for ${missing.join(', ')} (using 0).`)
  const p = m.params.map((name) => fc.params[name] ?? 0)
  const [a, b] = [fc.from ?? range[0], fc.to ?? range[1]]
  if (!(Number.isFinite(a) && Number.isFinite(b)) || a === b) return null
  const n = fc.points ?? FUNCTION_POINTS
  const logged = log && a > 0 && b > 0
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const v = logged ? a * (b / a) ** t : a + (b - a) * t
    x.push(v)
    let fy: number
    try {
      fy = m.f(v, p)
    } catch {
      fy = Number.NaN
    }
    y.push(Number.isFinite(fy) ? fy : Number.NaN)
  }
  return { title: label, x, y }
}

/**
 * A new function curve: a built-in equation (default: the four-parameter dose-response curve) with
 * starting parameter values, over `range` (absent: the whole X axis).
 */
export function newFunctionCurve(
  equation = 'agonist-response-variable-slope',
  range?: [number, number],
): FunctionCurve {
  const params = defaultFunctionParams({ equation })
  // A dose-response curve centred in its usual range of log concentrations.
  if (equation.startsWith('agonist-') || equation.startsWith('inhibitor-')) {
    for (const k of Object.keys(params)) if (/^Log/i.test(k)) params[k] = -6
  }
  return {
    id: newSeriesId(),
    equation,
    params,
    ...(range ? { from: range[0], to: range[1] } : {}),
  }
}
