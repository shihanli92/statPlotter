import { centralDiff } from '../numint/centralDiff.ts'
import { illinois } from '../numint/roots.ts'
import { SPECIAL_FUNCTIONS, type SpecialFn, TAIL_CODES } from './equationFunctions.ts'
import type { CurveModel } from './nonlinear.ts'
import { solveOde } from './ode.ts'

/**
 * User-defined equations for curve fitting, in the usual equation syntax (Y = …, one statement
 * per line; multiline models, different equations for different data sets, differential and
 * implicit equations):
 *
 *   ; a comment runs from a semicolon to the end of the line
 *   Span = Top - Bottom
 *   Y = Bottom + Span/(1 + 10^((LogEC50 - X)*HillSlope))
 *
 * - One statement per line, `name = expression`; a backslash at the end of a line continues it.
 *   The last assignment to Y defines the curve. A name first seen on the left of `=` is an
 *   intermediate variable (usable on later lines); a name first seen on the right that is not
 *   X, a function or a constant is a parameter to fit, in order of first appearance. Names are
 *   case-insensitive (the spelling first seen is kept): a letter or underscore, then letters,
 *   digits or underscores. (), [] and {} are interchangeable.
 * - Operators, loosest first (no precedence table is published; this is the usual one):
 *   OR; AND; NOT; comparisons (= == <> != < <= > >=, giving 1 or 0; not chained); + -; * / and
 *   MOD; unary - and +; ^ (right-associative and binding tighter than a leading minus, so
 *   -X^2 = -(X^2), and 2^-X is allowed). and(...), or(...), not(...) also work as functions.
 * - Functions: exp, ln, log (base 10), log10, log2, sqrt, sqr (square), abs, sin, cos, tan,
 *   arcsin, arccos, arctan, arctan2(y, x), sinh, cosh, tanh, arcsinh, arccosh, arctanh
 *   (asin, acos, atan, atan2, asinh, acosh, atanh as aliases), pow(a, b), min(a, b, ...),
 *   max(a, b, ...), if(condition, then, else), int (toward zero), floor, ceil, round(k) and
 *   round(k, j) (j decimals, half away from zero), sgn, deg, rad. Constant: pi. The special
 *   and distribution functions (gamma, gammaln, beta, ibeta, igamma, igammac, erf, erfc, psi,
 *   besselj/y/i/k, hypgeometricm/u/f, zdist, zinv, zpdf, normdist, norminv, normpdf, tdist,
 *   tinv, tpdf, fdist, finv, fpdf, chidist, chiinv, chisqc, binomial, fact, perc, logit, probit,
 *   is_defined; see equationFunctions.ts for their tails and argument orders). A distribution's
 *   optional tail is a quoted word: zdist(Z, "two").
 * - Lines for particular data sets (different data sets fitted to different equations):
 *   `<C>` data set C only, `<~B>` all but B, `<A:D>` A to D, `<~A:D>` all
 *   but A to D, `<A:J,3>` every third data set from A to J (A, D, G, J), `<~A:J,3>` all but
 *   those; also `<A,C>` (a list, our extension). Letters are positions among the data sets
 *   analyzed (A = the first), not table columns. Lines without a prefix apply to all. Each data
 *   set gets the program of the lines that apply to it; the parameters are the union over data
 *   sets, in order of first appearance in the text (`program.forDataSet(k)`).
 * - Implicit equations: when Y is used before any line
 *   assigns it, Y is unknown on the right side, and the last line `Y = g(X, Y)` is solved for Y
 *   at each X (Newton's method with a bracketing fallback; ∂Y/∂θ = (∂g/∂θ)/(1 − ∂g/∂Y) by the
 *   implicit function theorem).
 * - Differential equations: a line `Y' = f(X, Y)` (also
 *   accepted: `dY/dX = …`) makes Y the solution of the ODE from Y = Y[0] at X = X0. `Y[0]` is a
 *   parameter created automatically (it may also appear in the equation); X0 is 0 unless a line
 *   `X[0] = …` sets it (X0 belongs to the equation definition). Solved by Dormand–Prince
 *   5(4) with dense output and the sensitivity equations for ∂Y/∂θ (see ode.ts).
 *
 * The parser builds a tape (a list of operations in evaluation order); evaluation runs it with
 * forward-mode automatic differentiation, so the fitter gets exact partial derivatives
 * (dY/dparameter) through intermediate variables, if/min/max branches and every function.
 * Nothing is ever passed to `eval` or `Function`. The text, the selectors and the nesting have
 * limits (`EQUATION_LIMITS`): past them, an error, never a hang or a stack overflow.
 */

// ---- tokens --------------------------------------------------------------------------------------

type TokKind = 'num' | 'id' | 'str' | 'op' | '(' | ')' | ',' | 'nl' | 'sel' | 'end'

interface Token {
  kind: TokKind
  text: string
  value?: number
  pos: number
  /** A data set selector `<…>` at the start of a line. */
  sel?: Selector
}

/**
 * Data sets a line applies to: ranges of 0-based indices (`from` to `to`, every `step`), or all
 * but them (`not`). Kept as ranges (audit 4 T1): `<A:ZZ>` is one range, never a list.
 */
interface Selector {
  not: boolean
  ranges: { from: number; to: number; step: number }[]
}

/**
 * Audit 4 (T1): limits that keep a few characters from hanging or crashing the app. Data set
 * letters go up to ZZ (702 data sets); expressions nest at most `depth` deep (parentheses,
 * function calls, signs, NOT, powers); the text is at most `length` characters (as a graph's
 * function curve); lines for particular data sets are compiled at most `compiledLines` times
 * in all.
 */
export const EQUATION_LIMITS = {
  dataSets: 702,
  depth: 200,
  length: 20000,
  compiledLines: 200_000,
} as const

export class EquationError extends Error {
  /** 0-based character offset into the text. */
  readonly position: number
  constructor(message: string, position: number) {
    super(message)
    this.position = position
  }
}

const OPS = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '<', '>', '=']

/** A, B, …, Z, AA, AB… → 0, 1, …. */
function dataSetIndex(item: string): number {
  let k = 0
  for (const c of item.toUpperCase()) k = k * 26 + (c.charCodeAt(0) - 64)
  return k - 1
}

/** `A`, `~B`, `A:D`, `A:J,3` (every third), `A,C` (a list). */
function parseSelector(body: string, pos: number): Selector {
  const s = body.replace(/\s+/g, '')
  const not = s.startsWith('~')
  const list = (not ? s.slice(1) : s).split(',')
  const ranges: Selector['ranges'] = []
  const bad = () =>
    new EquationError(`“<${body}>” doesn’t name data sets (e.g. <A>, <~B>, <A:D>, <A:J,3>).`, pos)
  for (let i = 0; i < list.length; i++) {
    const m = /^([A-Za-z]+)(?::([A-Za-z]+))?$/.exec(list[i]!)
    if (!m) throw bad()
    // Past ZZ before it is even converted (no huge numbers).
    if (m[1]!.length > 2 || (m[2]?.length ?? 0) > 2)
      throw new EquationError(
        `“<${body}>”: data set letters go up to ${dataSetLetter(EQUATION_LIMITS.dataSets - 1)}.`,
        pos,
      )
    const a = dataSetIndex(m[1]!)
    const b = m[2] ? dataSetIndex(m[2]) : a
    let step = 1
    if (m[2] && /^\d+$/.test(list[i + 1] ?? '')) {
      step = Number(list[++i])
      if (!(step >= 1)) throw bad()
    }
    if (a < 0 || b < a) throw bad()
    ranges.push({ from: a, to: b, step })
  }
  return { not, ranges }
}

/** Whether data set `k` is in one of a selector's ranges. */
const inRanges = (sel: Selector, k: number) =>
  sel.ranges.some((r) => k >= r.from && k <= r.to && (k - r.from) % r.step === 0)

function tokenize(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === ';') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '\\') {
      // Line continuation: a backslash at the end of a line (before any comment).
      const m = /^\\[ \t\r]*(?:;[^\n]*)?(?:\n|$)/.exec(text.slice(i))
      if (!m) throw new EquationError('A backslash continues a line only at its end.', i)
      i += m[0].length
      continue
    }
    if (c === '\n') {
      out.push({ kind: 'nl', text: '\n', pos: i })
      i++
      continue
    }
    if (c === '<' && (out.length === 0 || out[out.length - 1]!.kind === 'nl')) {
      const m = /^<(~?[A-Za-z0-9:, ~]*)>/.exec(text.slice(i))
      if (m) {
        out.push({ kind: 'sel', text: m[0], pos: i, sel: parseSelector(m[1]!, i) })
        i += m[0].length
        continue
      }
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '"') {
      const end = text.indexOf(c, i + 1)
      if (end < 0 || text.slice(i, end).includes('\n'))
        throw new EquationError('Missing closing quote.', i)
      out.push({ kind: 'str', text: text.slice(i + 1, end), pos: i })
      i = end + 1
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i))
      if (!m) throw new EquationError(`Unexpected “${c}”.`, i)
      out.push({ kind: 'num', text: m[0], value: Number(m[0]), pos: i })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))![0]
      const rest = text.slice(i + name.length)
      // Y' (a derivative, at the start of a line) and Y[0] / X[0] (initial values of a
      // differential equation) are single names.
      const lineStart =
        out.length === 0 ||
        out[out.length - 1]!.kind === 'nl' ||
        out[out.length - 1]!.kind === 'sel'
      if (/^[yY]$/.test(name) && rest.startsWith("'") && lineStart) {
        out.push({ kind: 'id', text: `${name}'`, pos: i })
        i += name.length + 1
        continue
      }
      const init = /^[xXyY]$/.test(name) ? /^\[\s*0\s*\]/.exec(rest) : null
      if (init) {
        out.push({ kind: 'id', text: `${name}[0]`, pos: i })
        i += name.length + init[0].length
        continue
      }
      out.push({ kind: 'id', text: name, pos: i })
      i += name.length
      continue
    }
    // (), [] and {} are interchangeable.
    if (c === '(' || c === '[' || c === '{') {
      out.push({ kind: '(', text: c, pos: i })
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}' || c === ',') {
      out.push({ kind: c === ',' ? ',' : ')', text: c, pos: i })
      i++
      continue
    }
    const op = OPS.find((o) => text.startsWith(o, i))
    if (op) {
      out.push({ kind: 'op', text: op, pos: i })
      i += op.length
      continue
    }
    throw new EquationError(`Unexpected “${c}”.`, i)
  }
  out.push({ kind: 'end', text: '', pos: n })
  return out
}

// ---- tape ----------------------------------------------------------------------------------------

/** Operation codes of the tape. */
const Op = {
  Const: 0,
  X: 1,
  Param: 2,
  Add: 3,
  Sub: 4,
  Mul: 5,
  Div: 6,
  Pow: 7,
  Neg: 8,
  Mod: 9,
  Eq: 10,
  Ne: 11,
  Lt: 12,
  Le: 13,
  Gt: 14,
  Ge: 15,
  And: 16,
  Or: 17,
  Not: 18,
  If: 19,
  Min: 20,
  Max: 21,
  Exp: 22,
  Ln: 23,
  Log10: 24,
  Log2: 25,
  Sqrt: 26,
  Sqr: 27,
  Abs: 28,
  Sin: 29,
  Cos: 30,
  Tan: 31,
  Asin: 32,
  Acos: 33,
  Atan: 34,
  Atan2: 35,
  Asinh: 100,
  Acosh: 101,
  Atanh: 102,
  RoundTo: 103,
  /** The unknown Y of an implicit equation, or the state of a differential equation. */
  Y: 104,
  /** A special function (k = index into SPECIAL_LIST). */
  Special: 105,
  Sinh: 36,
  Cosh: 37,
  Tanh: 38,
  Int: 39,
  Floor: 40,
  Ceil: 41,
  Round: 42,
  Sgn: 43,
  Deg: 44,
  Rad: 45,
} as const
type Op = (typeof Op)[keyof typeof Op]

interface Instr {
  op: Op
  /** Operand slots (earlier instructions). */
  args: number[]
  /** Const: the value; Param: the parameter index; Special: the function's index. */
  k: number
}

/** Arity: a count, [min, max], or 'many' (one or more). */
const FUNCS: Record<string, { op: Op; arity: number | [number, number] | 'many' }> = {
  exp: { op: Op.Exp, arity: 1 },
  ln: { op: Op.Ln, arity: 1 },
  log: { op: Op.Log10, arity: 1 },
  log10: { op: Op.Log10, arity: 1 },
  log2: { op: Op.Log2, arity: 1 },
  sqrt: { op: Op.Sqrt, arity: 1 },
  sqr: { op: Op.Sqr, arity: 1 },
  abs: { op: Op.Abs, arity: 1 },
  sin: { op: Op.Sin, arity: 1 },
  cos: { op: Op.Cos, arity: 1 },
  tan: { op: Op.Tan, arity: 1 },
  arcsin: { op: Op.Asin, arity: 1 },
  asin: { op: Op.Asin, arity: 1 },
  arccos: { op: Op.Acos, arity: 1 },
  acos: { op: Op.Acos, arity: 1 },
  arctan: { op: Op.Atan, arity: 1 },
  atan: { op: Op.Atan, arity: 1 },
  arctan2: { op: Op.Atan2, arity: 2 },
  atan2: { op: Op.Atan2, arity: 2 },
  sinh: { op: Op.Sinh, arity: 1 },
  arcsinh: { op: Op.Asinh, arity: 1 },
  asinh: { op: Op.Asinh, arity: 1 },
  arccosh: { op: Op.Acosh, arity: 1 },
  acosh: { op: Op.Acosh, arity: 1 },
  arctanh: { op: Op.Atanh, arity: 1 },
  atanh: { op: Op.Atanh, arity: 1 },
  cosh: { op: Op.Cosh, arity: 1 },
  tanh: { op: Op.Tanh, arity: 1 },
  pow: { op: Op.Pow, arity: 2 },
  min: { op: Op.Min, arity: 'many' },
  max: { op: Op.Max, arity: 'many' },
  if: { op: Op.If, arity: 3 },
  int: { op: Op.Int, arity: 1 },
  floor: { op: Op.Floor, arity: 1 },
  ceil: { op: Op.Ceil, arity: 1 },
  round: { op: Op.Round, arity: [1, 2] },
  sgn: { op: Op.Sgn, arity: 1 },
  deg: { op: Op.Deg, arity: 1 },
  rad: { op: Op.Rad, arity: 1 },
}

const SPECIAL_NAMES = Object.keys(SPECIAL_FUNCTIONS)
const SPECIAL_LIST: SpecialFn[] = SPECIAL_NAMES.map((n) => SPECIAL_FUNCTIONS[n]!)
const SPECIAL_INDEX = new Map(SPECIAL_NAMES.map((n, i) => [n, i]))

const LOGIC_FUNCS: Record<string, { op: Op; arity: number | 'many' }> = {
  and: { op: Op.And, arity: 'many' },
  or: { op: Op.Or, arity: 'many' },
  not: { op: Op.Not, arity: 1 },
}

const CONSTANTS: Record<string, number> = { pi: Math.PI }

const KEYWORDS = new Set(['and', 'or', 'not', 'mod'])

const isFunction = (lower: string) => lower in FUNCS || SPECIAL_INDEX.has(lower)

const COMPARE: Record<string, Op> = {
  '=': Op.Eq,
  '==': Op.Eq,
  '<>': Op.Ne,
  '!=': Op.Ne,
  '<': Op.Lt,
  '<=': Op.Le,
  '>': Op.Gt,
  '>=': Op.Ge,
}

// ---- parser --------------------------------------------------------------------------------------

/** Parameters shared by every data set's program: name → index, with where each first appears. */
class Registry {
  readonly index = new Map<string, number>()
  readonly names: string[] = []
  readonly firstPos: number[] = []
  readonly variables = new Map<string, string>()
  get(lower: string, spelled: string, pos: number): number {
    let j = this.index.get(lower)
    if (j === undefined) {
      j = this.names.length
      this.index.set(lower, j)
      this.names.push(spelled)
      this.firstPos.push(pos)
    } else if (pos < this.firstPos[j]!) {
      this.firstPos[j] = pos
      this.names[j] = spelled
    }
    return j
  }
}

/** One line of the text: its tokens (without the newline) and its selector. */
interface Line {
  sel: Selector | null
  toks: Token[]
}

function splitLines(toks: Token[]): Line[] {
  const lines: Line[] = []
  let cur: Token[] = []
  let sel: Selector | null = null
  for (const t of toks) {
    if (t.kind === 'nl' || t.kind === 'end') {
      if (cur.length) lines.push({ sel, toks: cur })
      else if (sel)
        throw new EquationError('A data set selector needs a statement after it.', t.pos)
      cur = []
      sel = null
      continue
    }
    if (t.kind === 'sel') {
      if (cur.length || sel) throw new EquationError('Unexpected “<”.', t.pos)
      sel = t.sel!
      continue
    }
    cur.push(t)
  }
  return lines
}

const applies = (sel: Selector | null, k: number) =>
  sel === null || (sel.not ? !inRanges(sel, k) : inRanges(sel, k))

type Kind = 'explicit' | 'implicit' | 'differential'

/** The compiled program of one data set (or of every data set when there are no selectors). */
interface Variant {
  kind: Kind
  tape: Instr[]
  /** Explicit: Y's slot; implicit: g's slot (Y = g(X, Y)); differential: dY/dX's slot. */
  out: number
  /** Differential: the slots of Y0 and X0 (−1: X0 = 0). */
  y0: number
  x0: number
  /** Parameters appearing in this program (registry indices). */
  uses: Set<number>
}

class Parser {
  private i = 0
  readonly tape: Instr[] = []
  /** Lower-case name → slot of its current value. */
  private readonly vars = new Map<string, number>()
  /** Names assigned later in the text (to report use before definition). */
  private readonly assignedLater = new Set<string>()
  private readonly consts = new Map<number, number>()
  private xSlot = -1
  private ySlot = -1
  /** Y was used before being assigned: an implicit equation. */
  private implicitY = false
  private ode = false
  readonly uses = new Set<number>()
  private toks: Token[] = []
  private readonly lines: readonly Line[]
  private readonly reg: Registry

  constructor(lines: readonly Line[], reg: Registry) {
    this.lines = lines
    this.reg = reg
    for (const l of lines) {
      const t = l.toks
      if (t[0]?.kind === 'id' && t[1]?.text === '=') this.assignedLater.add(t[0].text.toLowerCase())
      if (odeStart(t) > 0) this.ode = true
    }
  }

  private peek(): Token {
    return this.toks[this.i]!
  }

  private next(): Token {
    return this.toks[this.i++]!
  }

  private emit(op: Op, args: number[] = [], k = 0): number {
    this.tape.push({ op, args, k })
    return this.tape.length - 1
  }

  private constant(v: number): number {
    const s = this.consts.get(v)
    if (s !== undefined) return s
    const slot = this.emit(Op.Const, [], v)
    this.consts.set(v, slot)
    return slot
  }

  program(): Variant {
    let out = -1
    let odeLine: Token | null = null
    for (const line of this.lines) {
      this.toks = [...line.toks, { kind: 'end', text: '', pos: endPos(line) }]
      this.i = 0
      const t = this.next()
      const odeAt = odeStart(line.toks)
      if (odeAt > 0) {
        if (odeLine) throw new EquationError('Only one line can give Y′ (dY/dX).', t.pos)
        this.i = odeAt
        odeLine = t
        out = this.expr()
        this.expectEnd()
        continue
      }
      if (t.kind !== 'id' || this.peek().text !== '=') {
        throw new EquationError(
          'Each line must assign a value to a name, as in “Y = …” or “Span = Top − Bottom”.',
          t.pos,
        )
      }
      const name = t.text
      const lower = name.toLowerCase()
      if (lower === 'x') throw new EquationError('X can’t be assigned a value.', t.pos)
      if (lower === 'y[0]')
        throw new EquationError(
          'Y[0] is the parameter of the value of Y at X0; it can’t be assigned.',
          t.pos,
        )
      if (lower === 'x[0]' && !this.ode)
        throw new EquationError('X[0] sets where a differential equation starts (Y′ = …).', t.pos)
      if (isFunction(lower) || lower in CONSTANTS || KEYWORDS.has(lower))
        throw new EquationError(`“${name}” is a reserved name.`, t.pos)
      if (this.reg.index.has(lower) && this.usesName(lower))
        throw new EquationError(
          `“${name}” is used as a parameter on an earlier line, so it can’t be assigned here.`,
          t.pos,
        )
      if (lower === 'y' && this.ode)
        throw new EquationError(
          'A differential equation defines Y through dY/dX; Y can’t also be assigned.',
          t.pos,
        )
      this.next() // '='
      const slot = this.expr()
      this.expectEnd()
      this.vars.set(lower, slot)
      if (lower === 'y') out = slot
      else if (!this.reg.variables.has(lower)) this.reg.variables.set(lower, name)
    }
    if (this.ode) {
      const y0 = this.initialParam()
      const x0v = this.vars.get('x[0]')
      if (x0v !== undefined && this.dependsOnXY(x0v))
        throw new EquationError('X[0] can’t depend on X or Y.', 0)
      const x0 = x0v ?? -1
      const uses = this.reach([out, y0, x0])
      return { kind: 'differential', tape: this.tape, out, y0, x0, uses }
    }
    if (out < 0) throw new EquationError('The equation must define Y (a line “Y = …”).', 0)
    return {
      kind: this.implicitY ? 'implicit' : 'explicit',
      tape: this.tape,
      out,
      y0: -1,
      x0: -1,
      uses: this.reach([out]),
    }
  }

  /** Parameters Y depends on (through these slots): a line that doesn't feed Y uses none. */
  private reach(slots: number[]): Set<number> {
    const out = new Set<number>()
    const seen = new Set<number>()
    const stack = slots.filter((s) => s >= 0)
    while (stack.length) {
      const s = stack.pop()!
      if (seen.has(s)) continue
      seen.add(s)
      const ins = this.tape[s]!
      if (ins.op === Op.Param) out.add(ins.k)
      for (const a of ins.args) stack.push(a)
    }
    return out
  }

  /** Parameter `lower` has been used by this program. */
  private usesName(lower: string): boolean {
    const j = this.reg.index.get(lower)
    return j !== undefined && this.uses.has(j)
  }

  /**
   * The slot of the parameter Y[0] of a differential equation (emitted here if the equation
   * never mentions it; it then comes first among the parameters).
   */
  private initialParam(): number {
    const j = this.reg.get('y[0]', 'Y[0]', -1)
    this.uses.add(j)
    return this.emit(Op.Param, [], j)
  }

  private dependsOnXY(slot: number): boolean {
    // A stack, not recursion (audit 4 T1: a long chain of intermediates is deep).
    const seen = new Set<number>()
    const stack = [slot]
    while (stack.length) {
      const s = stack.pop()!
      if (seen.has(s)) continue
      seen.add(s)
      const ins = this.tape[s]!
      if (ins.op === Op.X || ins.op === Op.Y) return true
      for (const a of ins.args) stack.push(a)
    }
    return false
  }

  private expectEnd(): void {
    const end = this.peek()
    if (end.kind !== 'end') throw new EquationError(`Unexpected “${end.text}”.`, end.pos)
  }

  /** How deep the expression being parsed is nested (audit 4 T1: limited). */
  private depth = 0

  /** `f` one level deeper: past EQUATION_LIMITS.depth an error, never a stack overflow. */
  private deeper(f: () => number): number {
    if (++this.depth > EQUATION_LIMITS.depth) {
      const t = this.peek()
      this.depth = 0
      throw new EquationError(
        `The expression is nested too deeply (more than ${EQUATION_LIMITS.depth} levels of parentheses, functions, signs or powers).`,
        t.pos,
      )
    }
    const out = f()
    this.depth--
    return out
  }

  private expr(): number {
    return this.deeper(() => this.or())
  }

  private or(): number {
    let a = this.and()
    while (this.isKeyword('or')) {
      this.next()
      a = this.emit(Op.Or, [a, this.and()])
    }
    return a
  }

  private and(): number {
    let a = this.not()
    while (this.isKeyword('and')) {
      this.next()
      a = this.emit(Op.And, [a, this.not()])
    }
    return a
  }

  private not(): number {
    if (this.isKeyword('not')) {
      this.next()
      return this.emit(Op.Not, [this.deeper(() => this.not())])
    }
    return this.compare()
  }

  private compare(): number {
    const a = this.additive()
    const t = this.peek()
    const op = t.kind === 'op' ? COMPARE[t.text] : undefined
    if (op === undefined) return a
    this.next()
    const b = this.additive()
    const t2 = this.peek()
    if (t2.kind === 'op' && COMPARE[t2.text] !== undefined)
      throw new EquationError('Comparisons can’t be chained; combine them with AND.', t2.pos)
    return this.emit(op, [a, b])
  }

  private additive(): number {
    let a = this.multiplicative()
    for (;;) {
      const t = this.peek()
      if (t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.next()
        a = this.emit(t.text === '+' ? Op.Add : Op.Sub, [a, this.multiplicative()])
      } else return a
    }
  }

  private multiplicative(): number {
    let a = this.unary()
    for (;;) {
      const t = this.peek()
      if (t.kind === 'op' && (t.text === '*' || t.text === '/')) {
        this.next()
        a = this.emit(t.text === '*' ? Op.Mul : Op.Div, [a, this.unary()])
      } else if (this.isKeyword('mod')) {
        this.next()
        a = this.emit(Op.Mod, [a, this.unary()])
      } else return a
    }
  }

  private unary(): number {
    const t = this.peek()
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.next()
      const a = this.deeper(() => this.unary())
      return t.text === '-' ? this.emit(Op.Neg, [a]) : a
    }
    return this.power()
  }

  private power(): number {
    const base = this.primary()
    const t = this.peek()
    if (t.kind === 'op' && t.text === '^') {
      this.next()
      return this.emit(Op.Pow, [base, this.deeper(() => this.unary())])
    }
    return base
  }

  private isKeyword(k: string): boolean {
    const t = this.peek()
    return t.kind === 'id' && t.text.toLowerCase() === k
  }

  private call(t: Token, lower: string): number {
    const special = SPECIAL_INDEX.get(lower)
    const logic = LOGIC_FUNCS[lower]
    const fn = logic ?? FUNCS[lower]
    if (!fn && special === undefined)
      throw new EquationError(`Unknown function “${t.text}”.`, t.pos)
    this.next() // '('
    const args: number[] = []
    let tail: number | undefined
    const sfn = special !== undefined ? SPECIAL_LIST[special]! : undefined
    const arg = () => {
      const a = this.peek()
      if (a.kind === 'str') {
        this.next()
        const code = TAIL_CODES[a.text.trim().toLowerCase()]
        if (sfn?.tail === undefined)
          throw new EquationError('Text in quotes is only allowed as a distribution’s tail.', a.pos)
        if (code === undefined)
          throw new EquationError(
            `The tail must be "left", "right" or "two", not "${a.text}".`,
            a.pos,
          )
        if (tail !== undefined) throw new EquationError('Only one tail can be given.', a.pos)
        tail = code
        return
      }
      if (tail !== undefined) throw new EquationError('The tail must be the last argument.', a.pos)
      args.push(this.expr())
    }
    if (this.peek().kind !== ')') {
      arg()
      while (this.peek().kind === ',') {
        this.next()
        arg()
      }
    }
    this.expect(')', 'Missing “)” after the function’s arguments.')
    const arity = sfn ? sfn.arity : fn!.arity
    const [lo, hi] =
      arity === 'many'
        ? [1, Number.POSITIVE_INFINITY]
        : typeof arity === 'number'
          ? [arity, arity]
          : arity
    if (args.length < lo || args.length > hi) {
      const want =
        arity === 'many'
          ? 'at least 1 argument'
          : lo === hi
            ? `${lo} argument${lo === 1 ? '' : 's'}`
            : `${lo} or ${hi} arguments`
      throw new EquationError(`${t.text} takes ${want}, not ${args.length}.`, t.pos)
    }
    if (sfn) {
      if (sfn.tail !== undefined) args.push(this.constant(tail ?? sfn.tail))
      return this.emit(Op.Special, args, special!)
    }
    if (fn!.op === Op.Round && args.length === 2) return this.emit(Op.RoundTo, args)
    if (fn!.op === Op.Min || fn!.op === Op.Max || fn!.op === Op.And || fn!.op === Op.Or) {
      let a = args[0]!
      for (let j = 1; j < args.length; j++) a = this.emit(fn!.op, [a, args[j]!])
      return a
    }
    return this.emit(fn!.op, args)
  }

  private primary(): number {
    const t = this.next()
    if (t.kind === 'num') {
      if (!Number.isFinite(t.value!)) throw new EquationError('Number out of range.', t.pos)
      return this.constant(t.value!)
    }
    if (t.kind === '(') {
      const a = this.expr()
      this.expect(')', 'Missing “)”.')
      return a
    }
    if (t.kind === 'str')
      throw new EquationError('Text in quotes is only allowed as a distribution’s tail.', t.pos)
    if (t.kind === 'id') {
      const lower = t.text.toLowerCase()
      if (KEYWORDS.has(lower) && !(lower !== 'mod' && this.peek().kind === '('))
        throw new EquationError(`Unexpected “${t.text}”.`, t.pos)
      if (this.peek().kind === '(') return this.call(t, lower)
      if (lower === 'x') {
        if (this.xSlot < 0) this.xSlot = this.emit(Op.X)
        return this.xSlot
      }
      if (lower in CONSTANTS) return this.constant(CONSTANTS[lower]!)
      const v = this.vars.get(lower)
      if (v !== undefined) return v
      if (lower === 'y') {
        // Y before any line assigns it: the state of a differential equation, or the unknown of
        // an implicit one.
        if (!this.ode && !this.assignedLater.has('y'))
          throw new EquationError('The equation must define Y (a line “Y = …”).', t.pos)
        if (!this.ode) this.implicitY = true
        if (this.ySlot < 0) this.ySlot = this.emit(Op.Y)
        return this.ySlot
      }
      if (isFunction(lower)) throw new EquationError(`${t.text} is a function: add “(…)”.`, t.pos)
      if (lower === 'x[0]')
        throw new EquationError('X[0] is used before a line “X[0] = …” sets it.', t.pos)
      if (lower === 'y[0]' && !this.ode)
        throw new EquationError('Y[0] is only for differential equations (Y′ = …).', t.pos)
      if (lower === "y'") throw new EquationError('Y′ can only start a line “Y′ = …”.', t.pos)
      if (this.assignedLater.has(lower))
        throw new EquationError(`“${t.text}” is used before the line that defines it.`, t.pos)
      const j = this.reg.get(lower, t.text, t.pos)
      this.uses.add(j)
      return this.emit(Op.Param, [], j)
    }
    if (t.kind === 'end' || t.kind === 'nl')
      throw new EquationError('The expression ends too early.', t.pos)
    throw new EquationError(`Unexpected “${t.text}”.`, t.pos)
  }

  private expect(kind: TokKind, message: string): void {
    const t = this.peek()
    if (t.kind !== kind) throw new EquationError(message, t.pos)
    this.next()
  }
}

function endPos(line: Line): number {
  const last = line.toks[line.toks.length - 1]!
  return last.pos + last.text.length
}

/** `Y' = …` or `dY/dX = …`: the index where the expression starts, else −1. */
function odeStart(t: readonly Token[]): number {
  if (
    t.length >= 2 &&
    t[0]!.kind === 'id' &&
    t[0]!.text.toLowerCase() === "y'" &&
    t[1]!.text === '='
  )
    return 2
  if (
    t.length >= 4 &&
    t[0]!.kind === 'id' &&
    t[0]!.text.toLowerCase() === 'dy' &&
    t[1]!.text === '/' &&
    t[2]!.kind === 'id' &&
    t[2]!.text.toLowerCase() === 'dx' &&
    t[3]!.text === '='
  )
    return 4
  return -1
}

// ---- evaluation ----------------------------------------------------------------------------------

/** A compiled user equation. */
export interface EquationProgram {
  /** Parameters in order of first appearance, spelled as first written. */
  readonly parameters: readonly string[]
  /** Intermediate variables (assigned names other than Y). */
  readonly variables: readonly string[]
  /** 'implicit' (Y on both sides) or 'differential' (dY/dX = …); else 'explicit'. */
  readonly kind: Kind
  /** The text has lines for particular data sets (`<A>…`). */
  readonly perDataSet: boolean
  /** Y at x. */
  f(x: number, p: ArrayLike<number>): number
  /** ∂Y/∂pⱼ into out[0..parameters.length); returns Y. */
  grad(x: number, p: ArrayLike<number>, out: Float64Array): number
  /**
   * The program of the k-th data set fit (0 = A), for equations with lines for particular data
   * sets (the program itself otherwise). Throws EquationError if no line defines Y for it.
   */
  forDataSet(k: number): EquationProgram
  /** Whether this program uses parameter j (false for another data set's own parameters). */
  uses(j: number): boolean
}

export type ParsedEquation =
  | {
      ok: true
      parameters: readonly string[]
      variables: readonly string[]
      program: EquationProgram
    }
  | {
      ok: false
      message: string
      /** 0-based character offset of the problem. */
      position: number
      /** 1-based line and column of `position`. */
      line: number
      column: number
    }

const truthy = (v: number) => v !== 0 && !Number.isNaN(v)

/** Central-difference partial of a special function in argument i. */
const numericPartial = (fn: SpecialFn, a: number[], i: number) => centralDiff(a, i, () => fn.f(a))

/**
 * Runs a tape with forward-mode AD. Derivatives are with respect to the P parameters and, when
 * the tape reads Y, to Y as a (P+1)-th input. `val` and `dv` keep every slot's value and
 * derivatives from the last run.
 */
class Machine {
  readonly n: number
  readonly D: number
  readonly val: Float64Array
  readonly dv: Float64Array
  readonly tape: readonly Instr[]
  readonly P: number
  private readonly args: number[] = []

  constructor(tape: readonly Instr[], P: number, withY: boolean) {
    this.tape = tape
    this.P = P
    this.n = tape.length
    this.D = P + (withY ? 1 : 0)
    this.val = new Float64Array(this.n)
    this.dv = new Float64Array(this.n * this.D)
  }

  run(x: number, y: number, p: ArrayLike<number>, withGrad: boolean): void {
    const { tape, val, dv, D, P } = this
    for (let s = 0; s < this.n; s++) {
      const ins = tape[s]!
      const a = ins.args[0] ?? 0
      const b = ins.args[1] ?? 0
      const va = val[a]!
      const vb = val[b]!
      let v: number
      // Local derivative factors: dv[s] = fa·dv[a] + fb·dv[b] (+ the branch copies below).
      let fa = 0
      let fb = 0
      let copy = -1
      let special = false
      switch (ins.op) {
        case Op.Const:
          v = ins.k
          break
        case Op.X:
          v = x
          break
        case Op.Y:
          v = y
          break
        case Op.Param:
          v = p[ins.k]!
          break
        case Op.Add:
          v = va + vb
          fa = 1
          fb = 1
          break
        case Op.Sub:
          v = va - vb
          fa = 1
          fb = -1
          break
        case Op.Mul:
          v = va * vb
          fa = vb
          fb = va
          break
        case Op.Div:
          v = va / vb
          fa = 1 / vb
          fb = -v / vb
          break
        case Op.Pow: {
          v = va ** vb
          fa = vb === 0 ? 0 : vb * va ** (vb - 1)
          // d(a^b)/db = a^b·ln a, needed only when b depends on the parameters.
          fb = va > 0 && v !== 0 ? v * Math.log(va) : 0
          break
        }
        case Op.Neg:
          v = -va
          fa = -1
          break
        case Op.Mod:
          v = va % vb
          fa = 1
          fb = -Math.trunc(va / vb)
          break
        case Op.Eq:
          v = va === vb ? 1 : 0
          break
        case Op.Ne:
          v = va !== vb ? 1 : 0
          break
        case Op.Lt:
          v = va < vb ? 1 : 0
          break
        case Op.Le:
          v = va <= vb ? 1 : 0
          break
        case Op.Gt:
          v = va > vb ? 1 : 0
          break
        case Op.Ge:
          v = va >= vb ? 1 : 0
          break
        case Op.And:
          v = truthy(va) && truthy(vb) ? 1 : 0
          break
        case Op.Or:
          v = truthy(va) || truthy(vb) ? 1 : 0
          break
        case Op.Not:
          v = truthy(va) ? 0 : 1
          break
        case Op.If:
          copy = truthy(va) ? b : ins.args[2]!
          v = val[copy]!
          break
        case Op.Min:
          copy = vb < va ? b : a
          v = val[copy]!
          break
        case Op.Max:
          copy = vb > va ? b : a
          v = val[copy]!
          break
        case Op.Exp:
          v = Math.exp(va)
          fa = v
          break
        case Op.Ln:
          v = Math.log(va)
          fa = 1 / va
          break
        case Op.Log10:
          v = Math.log10(va)
          fa = 1 / (va * Math.LN10)
          break
        case Op.Log2:
          v = Math.log2(va)
          fa = 1 / (va * Math.LN2)
          break
        case Op.Sqrt:
          v = Math.sqrt(va)
          fa = 0.5 / v
          break
        case Op.Sqr:
          v = va * va
          fa = 2 * va
          break
        case Op.Abs:
          v = Math.abs(va)
          fa = va < 0 ? -1 : va > 0 ? 1 : 0
          break
        case Op.Sin:
          v = Math.sin(va)
          fa = Math.cos(va)
          break
        case Op.Cos:
          v = Math.cos(va)
          fa = -Math.sin(va)
          break
        case Op.Tan: {
          v = Math.tan(va)
          fa = 1 + v * v
          break
        }
        case Op.Asin:
          v = Math.asin(va)
          fa = 1 / Math.sqrt(1 - va * va)
          break
        case Op.Acos:
          v = Math.acos(va)
          fa = -1 / Math.sqrt(1 - va * va)
          break
        case Op.Atan:
          v = Math.atan(va)
          fa = 1 / (1 + va * va)
          break
        case Op.Atan2: {
          // atan2(y, x): ∂/∂y = x/(x² + y²), ∂/∂x = −y/(x² + y²).
          v = Math.atan2(va, vb)
          const r2 = va * va + vb * vb
          fa = vb / r2
          fb = -va / r2
          break
        }
        case Op.Asinh:
          v = Math.asinh(va)
          fa = 1 / Math.sqrt(va * va + 1)
          break
        case Op.Acosh:
          v = Math.acosh(va)
          fa = 1 / Math.sqrt(va * va - 1)
          break
        case Op.Atanh:
          v = Math.atanh(va)
          fa = 1 / (1 - va * va)
          break
        case Op.RoundTo: {
          // Round to j decimal places, half away from zero.
          const m = 10 ** Math.trunc(vb)
          v = (Math.sign(va) * Math.round(Math.abs(va) * m)) / m
          break
        }
        case Op.Sinh:
          v = Math.sinh(va)
          fa = Math.cosh(va)
          break
        case Op.Cosh:
          v = Math.cosh(va)
          fa = Math.sinh(va)
          break
        case Op.Tanh:
          v = Math.tanh(va)
          fa = 1 - v * v
          break
        case Op.Int:
          v = Math.trunc(va)
          break
        case Op.Floor:
          v = Math.floor(va)
          break
        case Op.Ceil:
          v = Math.ceil(va)
          break
        case Op.Round:
          // Half away from zero.
          v = Math.sign(va) * Math.round(Math.abs(va))
          break
        case Op.Sgn:
          v = Math.sign(va)
          break
        case Op.Deg:
          v = (va * 180) / Math.PI
          fa = 180 / Math.PI
          break
        case Op.Rad:
          v = (va * Math.PI) / 180
          fa = Math.PI / 180
          break
        case Op.Special: {
          const fn = SPECIAL_LIST[ins.k]!
          const av = this.args
          av.length = ins.args.length
          for (let i = 0; i < av.length; i++) av[i] = val[ins.args[i]!]!
          v = fn.f(av)
          special = true
          break
        }
        default:
          v = Number.NaN
      }
      val[s] = v
      if (!withGrad) continue
      const o = s * D
      if (ins.op === Op.Param) {
        for (let j = 0; j < D; j++) dv[o + j] = j === ins.k ? 1 : 0
      } else if (ins.op === Op.Y) {
        for (let j = 0; j < D; j++) dv[o + j] = j === P ? 1 : 0
      } else if (copy >= 0) {
        for (let j = 0; j < D; j++) dv[o + j] = dv[copy * D + j]!
      } else if (special) {
        for (let j = 0; j < D; j++) dv[o + j] = 0
        const fn = SPECIAL_LIST[ins.k]!
        const av = [...this.args]
        for (let i = 0; i < ins.args.length; i++) {
          const oa = ins.args[i]! * D
          let any = false
          for (let j = 0; j < D; j++) if (dv[oa + j] !== 0) any = true
          if (!any) continue
          const part = fn.d?.(av, i, v) ?? numericPartial(fn, av, i)
          for (let j = 0; j < D; j++) {
            const da = dv[oa + j]!
            if (da !== 0) dv[o + j] = dv[o + j]! + part * da
          }
        }
      } else {
        const oa = a * D
        const ob = b * D
        for (let j = 0; j < D; j++) {
          // Skip zero partials so an infinite local factor (√ at 0) times 0 stays 0.
          let d = 0
          const da = dv[oa + j]!
          const db = dv[ob + j]!
          if (fa !== 0 && da !== 0) d += fa * da
          if (fb !== 0 && db !== 0) d += fb * db
          dv[o + j] = d
        }
      }
    }
  }
}

/** f and grad of an explicit equation. */
function explicitFns(v: Variant, P: number): Pick<EquationProgram, 'f' | 'grad'> {
  const m = new Machine(v.tape.slice(0, v.out + 1), P, false)
  return {
    f(x, p) {
      m.run(x, Number.NaN, p, false)
      return m.val[v.out]!
    },
    grad(x, p, out) {
      m.run(x, Number.NaN, p, true)
      const o = v.out * m.D
      for (let j = 0; j < P; j++) out[j] = m.dv[o + j]!
      return m.val[v.out]!
    },
  }
}

/**
 * f and grad of an implicit equation Y = g(X, Y): h(Y) = Y − g(X, Y) = 0 by Newton's method,
 * started from the solution at the same X for the previous parameters (continuation, as a fit
 * moves the parameters a little at a time), else from g(X, 0), 0 and 1; if Newton fails, a
 * bracketing search and the Illinois method. When h has several roots, continuation keeps the
 * one the fit started on.
 */
function implicitFns(v: Variant, P: number): Pick<EquationProgram, 'f' | 'grad'> {
  const m = new Machine(v.tape.slice(0, v.out + 1), P, true)
  /** Last solution at each X. */
  const lastAt = new Map<number, number>()
  const h = (x: number, y: number, p: ArrayLike<number>, grad: boolean): number => {
    m.run(x, y, p, grad)
    return y - m.val[v.out]!
  }
  const solve = (x: number, p: ArrayLike<number>): number => {
    const starts: number[] = []
    const prev = lastAt.get(x)
    if (prev !== undefined) starts.push(prev)
    starts.push(0)
    m.run(x, 0, p, false)
    const g0 = m.val[v.out]!
    if (Number.isFinite(g0)) starts.push(g0)
    starts.push(1)
    for (const s of starts) {
      let y = s
      for (let it = 0; it < 60; it++) {
        const r = h(x, y, p, true)
        const d = 1 - m.dv[v.out * m.D + P]!
        if (!Number.isFinite(r) || !Number.isFinite(d) || d === 0) break
        const step = r / d
        y -= step
        if (Math.abs(step) <= 4e-16 * Math.max(1, Math.abs(y))) {
          if (Number.isFinite(y) && Math.abs(h(x, y, p, false)) <= 1e-12 * Math.max(1, Math.abs(y)))
            return y
          break
        }
      }
    }
    // Bracketing: expand around the first start until h changes sign.
    const c = starts[0]!
    const fc = h(x, c, p, false)
    if (!Number.isFinite(fc)) return Number.NaN
    let step = Math.max(1e-3, Math.abs(c) * 1e-3)
    for (let it = 0; it < 200; it++) {
      for (const dir of [1, -1]) {
        const b = c + dir * step
        const fb = h(x, b, p, false)
        if (Number.isFinite(fb) && Math.sign(fb) !== Math.sign(fc))
          return illinois((y) => h(x, y, p, false), c, fc, b, fb, {
            maxIter: 300,
            done: (a, b) => Math.abs(b - a) <= 4e-16 * Math.max(Math.abs(a), Math.abs(b)),
          })
      }
      step *= 2
    }
    return Number.NaN
  }

  const f = (x: number, p: ArrayLike<number>): number => {
    const y = solve(x, p)
    if (Number.isFinite(y)) {
      if (lastAt.size > 10000) lastAt.clear()
      lastAt.set(x, y)
    }
    return y
  }
  return {
    f,
    grad(x, p, out) {
      const y = f(x, p)
      m.run(x, y, p, true)
      const o = v.out * m.D
      const denom = 1 - m.dv[o + P]!
      for (let j = 0; j < P; j++) out[j] = m.dv[o + j]! / denom
      return y
    },
  }
}

/**
 * f and grad of a differential equation dY/dX = f(X, Y), Y(X0) = Y0: the ODE and its P
 * sensitivity equations dSⱼ/dX = f_Y·Sⱼ + f_θⱼ, Sⱼ(X0) = ∂Y0/∂θⱼ − f(X0, Y0)·∂X0/∂θⱼ, solved
 * once per parameter vector over the X range asked for (and extended as needed); values between
 * steps come from the dense output.
 */
function differentialFns(v: Variant, P: number): Pick<EquationProgram, 'f' | 'grad'> {
  const m = new Machine(v.tape, P, true)
  const D = m.D
  const init = new Machine(v.tape, P, true)
  let key: number[] | null = null
  let sol: ReturnType<typeof solveOde> | null = null
  const state = new Float64Array(P + 1)
  const setup = (p: ArrayLike<number>, x: number) => {
    const same = key !== null && key.length === P && key.every((q, j) => q === p[j])
    if (same && sol?.covers(x)) return sol
    if (!same) {
      key = Array.from(p)
      init.run(Number.NaN, Number.NaN, p, true)
      const y0 = init.val[v.y0]!
      const x0 = v.x0 >= 0 ? init.val[v.x0]! : 0
      // f at the start, for the X0 term of the initial sensitivities.
      m.run(x0, y0, p, true)
      const f0 = m.val[v.out]!
      state[0] = y0
      for (let j = 0; j < P; j++) {
        const dY0 = init.dv[v.y0 * D + j]!
        const dX0 = v.x0 >= 0 ? init.dv[v.x0 * D + j]! : 0
        state[j + 1] = dY0 - (dX0 !== 0 ? f0 * dX0 : 0)
      }
      const pc = Float64Array.from(key)
      sol = solveOde(
        {
          dim: P + 1,
          rhs(xx, s, ds) {
            m.run(xx, s[0]!, pc, true)
            const o = v.out * D
            ds[0] = m.val[v.out]!
            const fy = m.dv[o + P]!
            for (let j = 0; j < P; j++) ds[j + 1] = fy * s[j + 1]! + m.dv[o + j]!
          },
          scale: (j) => (j === 0 ? 1 : 1 / Math.max(Math.abs(pc[j - 1]!), 1e-6)),
        },
        x0,
        state,
      )
    }
    sol!.extendTo(x)
    return sol!
  }
  const out1 = new Float64Array(P + 1)
  return {
    f(x, p) {
      const s = setup(p, x)
      s.at(x, out1)
      return out1[0]!
    },
    grad(x, p, out) {
      const s = setup(p, x)
      s.at(x, out1)
      for (let j = 0; j < P; j++) out[j] = out1[j + 1]!
      return out1[0]!
    },
  }
}

function lineColumn(text: string, pos: number): { line: number; column: number } {
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  return { line, column: pos - before.lastIndexOf('\n') }
}

/** Remaps parameter indices in a tape (registry order → order of first appearance). */
function remap(v: Variant, map: number[]): void {
  for (const ins of v.tape) if (ins.op === Op.Param) ins.k = map[ins.k]!
  const uses = [...v.uses].map((j) => map[j]!)
  v.uses.clear()
  for (const j of uses) v.uses.add(j)
}

function programOf(
  v: Variant,
  parameters: readonly string[],
  variables: readonly string[],
  perDataSet: boolean,
  forDataSet: (k: number) => EquationProgram,
): EquationProgram {
  const P = parameters.length
  const fns =
    v.kind === 'explicit'
      ? explicitFns(v, P)
      : v.kind === 'implicit'
        ? implicitFns(v, P)
        : differentialFns(v, P)
  return {
    parameters,
    variables,
    kind: v.kind,
    perDataSet,
    ...fns,
    forDataSet,
    uses: (j) => v.uses.has(j),
  }
}

/**
 * Parses a user-defined equation (see the module comment for the syntax). On failure returns
 * the message and where the problem is, for an editor to point at.
 */
export function parseEquation(text: string): ParsedEquation {
  try {
    if (text.length > EQUATION_LIMITS.length)
      throw new EquationError(
        `The equation is too long (${text.length.toLocaleString('en-US')} characters; at most ${EQUATION_LIMITS.length.toLocaleString('en-US')}).`,
        EQUATION_LIMITS.length,
      )
    const lines = splitLines(tokenize(text))
    const reg = new Registry()
    // Data set letters stop at ZZ, so the data sets named are at most EQUATION_LIMITS.dataSets.
    const named = new Array<boolean>(EQUATION_LIMITS.dataSets).fill(false)
    for (const l of lines)
      for (const r of l.sel?.ranges ?? [])
        for (let k = r.from; k <= r.to; k += r.step) named[k] = true
    const mentioned = named.flatMap((on, k) => (on ? [k] : []))
    const mentionedSet = new Set(mentioned)
    const perDataSet = mentioned.length > 0
    // Every data set named in a selector gets its program; "others" (-1) those not named. Data
    // sets with the same lines share one (compiled once; audit 4 T1).
    const keys = perDataSet ? [...mentioned, -1] : [-1]
    const variants = new Map<number, Variant | EquationError>()
    const bySignature = new Map<string, Variant | EquationError>()
    let compiled = 0
    for (const k of keys) {
      const own: Line[] = []
      const at: number[] = []
      lines.forEach((l, i) => {
        if (k < 0 ? applies(l.sel, Number.MAX_SAFE_INTEGER) : applies(l.sel, k)) {
          own.push(l)
          at.push(i)
        }
      })
      const signature = at.join(',')
      const shared = bySignature.get(signature)
      if (shared) {
        variants.set(k, shared)
        continue
      }
      compiled += own.length
      if (compiled > EQUATION_LIMITS.compiledLines)
        throw new EquationError(
          'Too many lines for particular data sets: give fewer data sets their own lines.',
          0,
        )
      let v: Variant | EquationError
      try {
        v = new Parser(own, reg).program()
      } catch (e) {
        if (!(e instanceof EquationError) || !perDataSet) throw e
        v = e
      }
      variants.set(k, v)
      bySignature.set(signature, v)
    }
    // Every named data set must compile; "others" may lack Y (only named data sets fit).
    for (const k of mentioned) {
      const v = variants.get(k)
      if (v instanceof EquationError) throw v
    }
    const order = reg.names.map((_, j) => j).sort((a, b) => reg.firstPos[a]! - reg.firstPos[b]!)
    const map: number[] = []
    order.forEach((j, pos) => {
      map[j] = pos
    })
    const parameters = order.map((j) => reg.names[j]!)
    const variables = [...reg.variables.values()]
    // Each program once (data sets share them).
    for (const v of bySignature.values()) if (!(v instanceof EquationError)) remap(v, map)
    const programs = new Map<number, EquationProgram>()
    const forDataSet = (k: number): EquationProgram => {
      const key = perDataSet && mentionedSet.has(k) ? k : -1
      let prog = programs.get(key)
      if (!prog) {
        const v = variants.get(key)!
        if (v instanceof EquationError)
          throw new EquationError(
            `No line defines Y for data set ${dataSetLetter(k)} (${v.message.replace(/\.$/, '')}).`,
            v.position,
          )
        prog = programOf(v, parameters, variables, perDataSet, forDataSet)
        programs.set(key, prog)
      }
      return prog
    }
    const others = variants.get(-1)!
    const program = others instanceof EquationError ? forDataSet(mentioned[0]!) : forDataSet(-1)
    return { ok: true, parameters, variables, program }
  } catch (e) {
    if (e instanceof EquationError) {
      const pos = Math.max(0, Math.min(e.position, text.length))
      return { ok: false, message: e.message, position: pos, ...lineColumn(text, pos) }
    }
    throw e
  }
}

/** A, B, … Z, AA … for a 0-based data set index. */
export function dataSetLetter(k: number): string {
  let s = ''
  let n = k + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * A CurveModel for the fitter from a parsed equation. `initial` gives the starting values (the
 * fitter has no automatic rule for an arbitrary equation); a function receives the data set.
 * With lines for particular data sets, `forDataSet(k)` gives the model of the k-th data set
 * (0 = A) and `uses(j)` whether it uses parameter j.
 */
export function userCurveModel(
  program: EquationProgram,
  initial: CurveModel['initial'],
  id = 'user',
): CurveModel {
  const make = (prog: EquationProgram): CurveModel => {
    const m: CurveModel = {
      id,
      params: prog.parameters,
      f: prog.f,
      grad(x, p, out) {
        prog.grad(x, p, out)
      },
      initial,
    }
    if (program.perDataSet) {
      m.forDataSet = (k) => make(program.forDataSet(k))
      m.uses = (j) => prog.uses(j)
    }
    return m
  }
  return make(program)
}
