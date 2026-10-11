import type { CurveModel } from './nonlinear.ts'
import { type EquationProgram, parseEquation } from './userEquation.ts'

/** f and grad of a formula, plus per-data-set variants when it has lines for data sets. */
export type FormulaModel = Pick<CurveModel, 'f' | 'grad'> & {
  /** For formulas with `<A>…` lines: the f / grad / uses of data set k (0 = A). */
  variant?: (k: number) => Pick<CurveModel, 'f' | 'grad' | 'uses'>
}

/**
 * A model's f and exact gradient from its formula in the user-equation language, with the
 * parameters in a declared order (built-in equations written in their published form).
 * Throws if the formula doesn't parse or its parameters differ from `params`.
 */
export function formulaModel(text: string, params: readonly string[]): FormulaModel {
  const r = parseEquation(text)
  if (!r.ok) throw new Error(`formulaModel: ${r.message} (line ${r.line}, column ${r.column})`)
  const P = params.length
  const map = params.map((n) => r.parameters.findIndex((q) => q.toLowerCase() === n.toLowerCase()))
  if (r.parameters.length !== P || map.some((i) => i < 0))
    throw new Error(`formulaModel: parameters ${r.parameters.join(', ')} ≠ ${params.join(', ')}`)
  const mapped = (prog: EquationProgram): Pick<CurveModel, 'f' | 'grad' | 'uses'> => {
    const q = new Float64Array(P)
    const g = new Float64Array(P)
    return {
      f(x, p) {
        for (let j = 0; j < P; j++) q[map[j]!] = p[j]!
        return prog.f(x, q)
      },
      grad(x, p, out) {
        for (let j = 0; j < P; j++) q[map[j]!] = p[j]!
        prog.grad(x, q, g)
        for (let j = 0; j < P; j++) out[j] = g[map[j]!]!
      },
      uses: (j) => prog.uses(map[j]!),
    }
  }
  const { f, grad } = mapped(r.program)
  const out: FormulaModel = { f, grad }
  if (r.program.perDataSet) {
    const cache = new Map<number, Pick<CurveModel, 'f' | 'grad' | 'uses'>>()
    out.variant = (k) => {
      let v = cache.get(k)
      if (!v) {
        v = mapped(r.program.forDataSet(k))
        cache.set(k, v)
      }
      return v
    }
  }
  return out
}

/** A formula for display: one line per statement, joined by "; ", with typographic operators. */
export function displayFormula(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/;.*$/, '').trim())
    .filter(Boolean)
    .join('; ')
    .replace(/\*/g, '·')
    .replace(/ - /g, ' − ')
    .replace(/\(-/g, '(−')
}
