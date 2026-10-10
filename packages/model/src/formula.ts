import {
  binIndex,
  cutLabels,
  equalWidthBreaks,
  moments,
  quantileBreaks,
  quantileOfSorted,
  rankRows,
  sortedAt,
  TIE_METHODS,
  type TieMethod,
} from './formulaStats.ts'
import type { DataSetColumn, DataTable } from './table.ts'

/*
 * Calculated variables of multiple-variables tables (`DataSetColumn.formula`, e.g.
 * "=Weight/Height^2"): a small, safe expression language over the table's other variables, by
 * name, evaluated row by row when the table is read. Nothing is `eval`ed: formulas are parsed
 * into a tree by a recursive-descent parser and interpreted.
 *
 *   numbers        1, 2.5, .5, 1e-3; the constant pi
 *   variables      Weight, Body_weight (underscores match spaces), [Body weight (kg)]; names are
 *                  matched without case
 *   text           "WT" (a doubled "" is a quote)
 *   operators      + - * / ^ (power, right to left; -2^2 = -4), comparisons = <> < <= > >=
 *                  (also == and !=), which give 1 or 0; text compares with = and <> only,
 *                  ignoring case; `and`, `or`, `not` between conditions (roadmap 38)
 *   functions      `FORMULA_FUNCTIONS` (the reference the formula bar shows)
 *
 * A formula's result is a number or text (roadmap 38: a text result makes a text variable).
 * A row with an empty (or excluded) value that the formula needs gets no value; a value that is
 * not a finite number (ln of a negative, division by zero) gets none either and is reported as an
 * invalid cell. Statistics over a column or within groups (median, zscore, meanby…) leave out
 * empty values and are computed once per evaluation, so a formula stays O(n log n) in the rows.
 * Formulas may use other calculated variables; circular references are errors.
 *
 *   info constants [Info: dilution] — the first info sheet's field labelled "dilution" (navigator
 *                  order), or [Sheet name: dilution] that sheet's (roadmap 40); numbers only, a
 *                  name that is a variable's title stays the variable. The values come from the
 *                  project (`InfoConstants`, bound to the table by `withConstants`), so they are
 *                  live and never stored with the table.
 */

export type FormulaNode =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string; bare: boolean; start: number; end: number }
  | { k: 'neg'; a: FormulaNode }
  | { k: 'bin'; op: BinaryOp; a: FormulaNode; b: FormulaNode }
  | { k: 'call'; fn: string; args: FormulaNode[] }

type BinaryOp = '+' | '-' | '*' | '/' | '^' | '=' | '<>' | '<' | '<=' | '>' | '>='

export class FormulaError extends Error {
  constructor(
    message: string,
    /** Character offset in the formula text, when known. */
    readonly at?: number,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------------------------
// Function reference (the formula bar's help and autocomplete read it)
// ---------------------------------------------------------------------------------------------

export type FormulaCategory =
  | 'Maths'
  | 'Logic'
  | 'Statistics'
  | 'Groups'
  | 'Running'
  | 'Text'
  | 'Categories'

export interface FormulaFunction {
  name: string
  /** Fewest and most arguments (Infinity: a list). */
  args: readonly [number, number]
  signature: string
  description: string
  category: FormulaCategory
}

const INF = Number.POSITIVE_INFINITY
const fn = (
  name: string,
  args: readonly [number, number],
  signature: string,
  description: string,
  category: FormulaCategory,
): FormulaFunction => ({ name, args, signature, description, category })

/** Every function of the formula language, in the order the reference lists them. */
export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  fn('ln', [1, 1], 'ln(x)', 'Natural logarithm', 'Maths'),
  fn('log', [1, 2], 'log(x[, base])', 'Logarithm, base 10 unless a base is given', 'Maths'),
  fn('log10', [1, 1], 'log10(x)', 'Base-10 logarithm', 'Maths'),
  fn('log2', [1, 1], 'log2(x)', 'Base-2 logarithm', 'Maths'),
  fn('exp', [1, 1], 'exp(x)', 'e to the power x', 'Maths'),
  fn('sqrt', [1, 1], 'sqrt(x)', 'Square root', 'Maths'),
  fn('pow', [2, 2], 'pow(x, y)', 'x to the power y (as x ^ y)', 'Maths'),
  fn('abs', [1, 1], 'abs(x)', 'Absolute value', 'Maths'),
  fn('sign', [1, 1], 'sign(x)', '−1, 0 or 1', 'Maths'),
  fn('round', [1, 2], 'round(x[, digits])', 'Rounds half away from zero', 'Maths'),
  fn('floor', [1, 1], 'floor(x)', 'Largest whole number ≤ x', 'Maths'),
  fn('ceil', [1, 1], 'ceil(x)', 'Smallest whole number ≥ x', 'Maths'),
  fn('int', [1, 1], 'int(x)', 'Whole part (towards zero)', 'Maths'),
  fn('mod', [2, 2], 'mod(x, y)', 'Remainder of x / y, with the sign of y (R’s %%)', 'Maths'),
  fn('clamp', [3, 3], 'clamp(x, low, high)', 'x limited to low…high', 'Maths'),
  fn('min', [1, INF], 'min(a, b, …)', 'Smallest of the values in the row', 'Maths'),
  fn('max', [1, INF], 'max(a, b, …)', 'Largest of the values in the row', 'Maths'),
  fn('sum', [1, INF], 'sum(a, b, …)', 'Sum of the values in the row', 'Maths'),
  fn('mean', [1, INF], 'mean(a, b, …)', 'Mean of the values in the row', 'Maths'),
  fn('logit', [1, 1], 'logit(p)', 'ln(p / (1 − p))', 'Maths'),
  fn('expit', [1, 1], 'expit(x)', '1 / (1 + exp(−x)), the inverse of logit', 'Maths'),
  fn(
    'asinh',
    [1, 1],
    'asinh(x)',
    'Inverse hyperbolic sine (cytometry: asinh(x / cofactor))',
    'Maths',
  ),
  fn('sin', [1, 1], 'sin(x)', 'Sine (radians)', 'Maths'),
  fn('cos', [1, 1], 'cos(x)', 'Cosine (radians)', 'Maths'),
  fn('tan', [1, 1], 'tan(x)', 'Tangent (radians)', 'Maths'),
  fn('asin', [1, 1], 'asin(x)', 'Arcsine (radians)', 'Maths'),
  fn('acos', [1, 1], 'acos(x)', 'Arccosine (radians)', 'Maths'),
  fn('atan', [1, 1], 'atan(x)', 'Arctangent (radians)', 'Maths'),
  fn(
    'if',
    [3, 3],
    'if(test, then, else)',
    'then where test is true (not 0), else otherwise',
    'Logic',
  ),
  fn(
    'ifs',
    [2, INF],
    'ifs(test1, value1, test2, value2, …[, otherwise])',
    'The value of the first true test; otherwise (or blank)',
    'Logic',
  ),
  fn(
    'case',
    [3, INF],
    'case(x, match1, value1, …[, otherwise])',
    'The value whose match equals x; otherwise (or blank)',
    'Logic',
  ),
  fn(
    'iferror',
    [2, 2],
    'iferror(x, alternative)',
    'x, or the alternative where x is invalid (#NUM)',
    'Logic',
  ),
  fn('coalesce', [1, INF], 'coalesce(a, b, …)', 'The first value that isn’t blank', 'Logic'),
  fn('and', [1, INF], 'and(a, b, …)', '1 when every condition is true (also a and b)', 'Logic'),
  fn('or', [1, INF], 'or(a, b, …)', '1 when any condition is true (also a or b)', 'Logic'),
  fn('not', [1, 1], 'not(x)', '1 when x is false (0)', 'Logic'),
  fn('isblank', [1, 1], 'isblank(x)', '1 when x is empty', 'Logic'),
  fn('isnumber', [1, 1], 'isnumber(x)', '1 when x is a number', 'Logic'),
  fn('istext', [1, 1], 'istext(x)', '1 when x is text that isn’t blank', 'Logic'),
  fn(
    'median',
    [1, INF],
    'median(x[, group…])',
    'Median of the column (or of the row’s group)',
    'Statistics',
  ),
  fn(
    'sd',
    [1, INF],
    'sd(x[, group…])',
    'Standard deviation (n − 1) of the column or group',
    'Statistics',
  ),
  fn('var', [1, INF], 'var(x[, group…])', 'Variance (n − 1) of the column or group', 'Statistics'),
  fn(
    'quantile',
    [2, INF],
    'quantile(x, p[, type[, group…]])',
    'Quantile p (0–1); R’s types 1–9, 7 by default',
    'Statistics',
  ),
  fn(
    'rank',
    [1, INF],
    'rank(x[, ties[, group…]])',
    'Rank, 1 = smallest; ties "average" (default), "min", "max" or "first"',
    'Statistics',
  ),
  fn(
    'zscore',
    [1, INF],
    'zscore(x[, group…])',
    '(x − mean) / SD of the column or group',
    'Statistics',
  ),
  fn(
    'meanby',
    [1, INF],
    'meanby(x[, group…])',
    'Mean of x in the row’s group (no group: the column)',
    'Groups',
  ),
  fn('medianby', [1, INF], 'medianby(x[, group…])', 'Median of x in the row’s group', 'Groups'),
  fn('sumby', [1, INF], 'sumby(x[, group…])', 'Sum of x in the row’s group', 'Groups'),
  fn(
    'countby',
    [1, INF],
    'countby(x[, group…])',
    'Number of values of x in the row’s group',
    'Groups',
  ),
  fn('sdby', [1, INF], 'sdby(x[, group…])', 'SD of x in the row’s group', 'Groups'),
  fn('minby', [1, INF], 'minby(x[, group…])', 'Smallest x in the row’s group', 'Groups'),
  fn('maxby', [1, INF], 'maxby(x[, group…])', 'Largest x in the row’s group', 'Groups'),
  fn('cumsum', [1, 1], 'cumsum(x)', 'Running total down the rows (blanks skipped)', 'Running'),
  fn('lag', [1, 2], 'lag(x[, k])', 'The value k rows above (default 1)', 'Running'),
  fn('lead', [1, 2], 'lead(x[, k])', 'The value k rows below (default 1)', 'Running'),
  fn('diff', [1, 1], 'diff(x)', 'x minus the value in the row above', 'Running'),
  fn('concat', [1, INF], 'concat(a, b, …)', 'Joins text (and numbers) into one text', 'Text'),
  fn('upper', [1, 1], 'upper(t)', 'Text in capitals', 'Text'),
  fn('lower', [1, 1], 'lower(t)', 'Text in small letters', 'Text'),
  fn('left', [1, 2], 'left(t[, n])', 'The first n characters (default 1)', 'Text'),
  fn('right', [1, 2], 'right(t[, n])', 'The last n characters (default 1)', 'Text'),
  fn('mid', [3, 3], 'mid(t, start, n)', 'n characters from position start (1 = first)', 'Text'),
  fn('len', [1, 1], 'len(t)', 'Number of characters', 'Text'),
  fn(
    'trim',
    [1, 1],
    'trim(t)',
    'Text without spaces at its ends (and runs of spaces as one)',
    'Text',
  ),
  fn('replace', [3, 3], 'replace(t, find, with)', 'Every find in t replaced by with', 'Text'),
  fn('contains', [2, 2], 'contains(t, part)', '1 when t contains part (ignoring case)', 'Text'),
  fn(
    'startswith',
    [2, 2],
    'startswith(t, part)',
    '1 when t starts with part (ignoring case)',
    'Text',
  ),
  fn('endswith', [2, 2], 'endswith(t, part)', '1 when t ends with part (ignoring case)', 'Text'),
  fn('text', [1, 2], 'text(x[, digits])', 'A number as text, with digits after the point', 'Text'),
  fn('value', [1, 1], 'value(t)', 'Text read as a number', 'Text'),
  fn(
    'recode',
    [3, INF],
    'recode(x, "old", "new", …[, otherwise])',
    'Renames or merges levels; others kept (or otherwise)',
    'Categories',
  ),
  fn(
    'cut',
    [3, INF],
    'cut(x[, "(]" or "[)"], break1, break2, …[, "label", …])',
    'Intervals between breaks, as R’s cut (right-closed by default)',
    'Categories',
  ),
  fn(
    'cutwidth',
    [2, INF],
    'cutwidth(x[, "(]" or "[)"], n[, "label", …])',
    'n intervals of equal width over x’s range (R’s cut(x, n))',
    'Categories',
  ),
  fn(
    'cutquantile',
    [2, INF],
    'cutquantile(x[, "(]" or "[)"], n[, "label", …])',
    'n intervals holding equal numbers of values (quantiles)',
    'Categories',
  ),
]

/** Functions: name → [fewest, most] arguments. */
const FUNCTIONS: Record<string, readonly [number, number]> = Object.fromEntries(
  FORMULA_FUNCTIONS.map((f) => [f.name, f.args]),
)

/** Words that are operators between conditions (a variable of that name needs [ ]). */
const WORDS = new Set(['and', 'or', 'not'])

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

type Token =
  | { t: 'num'; v: number; at: number; end: number }
  | { t: 'str'; v: string; at: number; end: number }
  | { t: 'name'; v: string; bare: boolean; at: number; end: number }
  | { t: 'op'; v: string; at: number; end: number }
  | { t: 'end'; at: number; end: number }

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*/u
const OPS = ['<=', '>=', '<>', '==', '!=', '+', '-', '*', '/', '^', '=', '<', '>', '(', ')', ',']

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const rest = src.slice(i)
    const num = NUMBER.exec(rest)
    if (num) {
      out.push({ t: 'num', v: Number(num[0]), at: i, end: i + num[0].length })
      i += num[0].length
      continue
    }
    const id = IDENT.exec(rest)
    if (id) {
      out.push({ t: 'name', v: id[0], bare: true, at: i, end: i + id[0].length })
      i += id[0].length
      continue
    }
    if (ch === '[') {
      const close = src.indexOf(']', i + 1)
      if (close < 0) throw new FormulaError('a [name] is missing its closing ]', i)
      const name = src.slice(i + 1, close)
      if (!name.trim()) throw new FormulaError('empty [ ] name', i)
      out.push({ t: 'name', v: name, bare: false, at: i, end: close + 1 })
      i = close + 1
      continue
    }
    if (ch === '"' || ch === '“' || ch === '”') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= src.length) throw new FormulaError('text is missing its closing quote', i)
        const c = src[j]!
        if (c === '"' && src[j + 1] === '"') {
          s += '"'
          j += 2
        } else if (c === '"' || c === '”' || c === '“') {
          j++
          break
        } else {
          s += c
          j++
        }
      }
      out.push({ t: 'str', v: s, at: i, end: j })
      i = j
      continue
    }
    const op = OPS.find((o) => rest.startsWith(o))
    if (!op) throw new FormulaError(`unexpected “${ch}”`, i)
    const v = op === '==' ? '=' : op === '!=' ? '<>' : op
    out.push({ t: 'op', v, at: i, end: i + op.length })
    i += op.length
  }
  out.push({ t: 'end', at: src.length, end: src.length })
  return out
}

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

const COMPARISONS = new Set(['=', '<>', '<', '<=', '>', '>='])

/** The formula's text without its leading "=" (either form is accepted). */
export const formulaBody = (src: string) => src.replace(/^\s*=/, '')

/** Parses a formula (with or without its leading "="). Throws FormulaError. */
export function parseFormula(src: string): FormulaNode {
  const offset = src.length - formulaBody(src).length
  let tokens: Token[]
  try {
    tokens = tokenize(formulaBody(src))
  } catch (e) {
    if (e instanceof FormulaError) throw new FormulaError(e.message, (e.at ?? 0) + offset)
    throw e
  }
  let i = 0
  const peek = () => tokens[i]!
  const fail = (msg: string, tok = peek()): never => {
    throw new FormulaError(msg, tok.at + offset)
  }
  const isOp = (v: string) => {
    const t = peek()
    return t.t === 'op' && t.v === v
  }
  const isWord = (w: string) => {
    const t = peek()
    return t.t === 'name' && t.bare && t.v.toLowerCase() === w
  }
  const expect = (v: string) => {
    if (!isOp(v)) fail(peek().t === 'end' ? `missing “${v}”` : `expected “${v}”`)
    i++
  }

  // Conditions: a or b, a and b, not a (looser than comparisons; `and` binds tighter).
  const disjunction = (): FormulaNode => {
    const first = conjunction()
    if (!isWord('or')) return first
    const args = [first]
    while (isWord('or')) {
      i++
      args.push(conjunction())
    }
    return { k: 'call', fn: 'or', args }
  }
  const conjunction = (): FormulaNode => {
    const first = negation()
    if (!isWord('and')) return first
    const args = [first]
    while (isWord('and')) {
      i++
      args.push(negation())
    }
    return { k: 'call', fn: 'and', args }
  }
  const negation = (): FormulaNode => {
    const next = tokens[i + 1]
    if (isWord('not') && !(next?.t === 'op' && next.v === '(')) {
      i++
      return { k: 'call', fn: 'not', args: [negation()] }
    }
    return comparison()
  }
  const comparison = (): FormulaNode => {
    let a = additive()
    while (COMPARISONS.has((peek() as { v?: unknown }).v as string) && peek().t === 'op') {
      const op = (tokens[i++] as { v: string }).v as BinaryOp
      a = { k: 'bin', op, a, b: additive() }
    }
    return a
  }
  const additive = (): FormulaNode => {
    let a = multiplicative()
    while (isOp('+') || isOp('-')) {
      const op = (tokens[i++] as { v: string }).v as BinaryOp
      a = { k: 'bin', op, a, b: multiplicative() }
    }
    return a
  }
  const multiplicative = (): FormulaNode => {
    let a = unary()
    while (isOp('*') || isOp('/')) {
      const op = (tokens[i++] as { v: string }).v as BinaryOp
      a = { k: 'bin', op, a, b: unary() }
    }
    return a
  }
  const unary = (): FormulaNode => {
    if (isOp('-')) {
      i++
      return { k: 'neg', a: unary() }
    }
    if (isOp('+')) {
      i++
      return unary()
    }
    return power()
  }
  const power = (): FormulaNode => {
    const a = primary()
    if (isOp('^')) {
      i++
      // Right to left, and the exponent may carry a sign: 2^-1.
      return { k: 'bin', op: '^', a, b: unary() }
    }
    return a
  }
  const primary = (): FormulaNode => {
    const t = peek()
    if (t.t === 'num') {
      i++
      return { k: 'num', v: t.v }
    }
    if (t.t === 'str') {
      i++
      return { k: 'str', v: t.v }
    }
    if (t.t === 'op' && t.v === '(') {
      i++
      const e = disjunction()
      expect(')')
      return e
    }
    if (t.t === 'name') {
      i++
      if (t.bare && isOp('(')) {
        const fn = t.v.toLowerCase()
        const arity = FUNCTIONS[fn]
        if (!arity) return fail(`unknown function “${t.v}”`, t)
        i++
        const args: FormulaNode[] = []
        if (!isOp(')')) {
          args.push(disjunction())
          while (isOp(',')) {
            i++
            args.push(disjunction())
          }
        }
        expect(')')
        if (args.length < arity[0] || args.length > arity[1]) {
          const n =
            arity[0] === arity[1]
              ? `${arity[0]}`
              : arity[1] === INF
                ? `at least ${arity[0]}`
                : `${arity[0]} or ${arity[1]}`
          return fail(`${fn} takes ${n} value${n === '1' ? '' : 's'}`, t)
        }
        return { k: 'call', fn, args }
      }
      if (t.bare && WORDS.has(t.v.toLowerCase())) return fail(`unexpected “${t.v}”`, t)
      return {
        k: 'var',
        name: t.v,
        bare: t.bare,
        start: t.at + offset,
        end: t.end + offset,
      }
    }
    if (t.t === 'end') return fail('the formula is incomplete')
    return fail(`unexpected “${(t as { v: string }).v}”`)
  }

  if (peek().t === 'end') fail('the formula is empty')
  const tree = disjunction()
  if (peek().t !== 'end') fail(`unexpected “${(peek() as { v: string }).v}”`)
  return tree
}

/** The variable names a parsed formula refers to (as written), each once. */
export function formulaNames(node: FormulaNode): FormulaNode[] {
  const out: FormulaNode[] = []
  const walk = (n: FormulaNode) => {
    if (n.k === 'var') out.push(n)
    else if (n.k === 'neg') walk(n.a)
    else if (n.k === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.k === 'call') n.args.forEach(walk)
  }
  walk(node)
  return out
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** How a variable's title is matched: without case, spaces collapsed. */
const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

type Resolved<C> = { ok: C } | { error: string }

function nameResolver<C extends { title: string }>(dataSets: readonly C[]) {
  const byKey = new Map<string, C[]>()
  for (const ds of dataSets) {
    const k = nameKey(ds.title)
    if (!k) continue
    byKey.set(k, [...(byKey.get(k) ?? []), ds])
  }
  return (ref: Extract<FormulaNode, { k: 'var' }>): Resolved<C> => {
    let hits = byKey.get(nameKey(ref.name))
    // Body_weight names "Body weight".
    if (!hits && ref.bare && ref.name.includes('_'))
      hits = byKey.get(nameKey(ref.name.replace(/_/g, ' ')))
    if (!hits) {
      if (ref.bare && ref.name.toLowerCase() === 'pi') return { error: 'pi' }
      return { error: `no variable is called “${ref.name}”` }
    }
    if (hits.length > 1) return { error: `${hits.length} variables are called “${ref.name}”` }
    return { ok: hits[0]! }
  }
}

/** A reference to a variable as a formula writes it: bare when it can be, else in brackets. */
export function formulaReference(title: string): string {
  const t = title.trim()
  const lower = t.toLowerCase()
  return IDENT.exec(t)?.[0] === t && !FUNCTIONS[lower] && lower !== 'pi' && !WORDS.has(lower)
    ? t
    : `[${t.replace(/\]/g, '')}]`
}

/** Text as a formula writes it: in quotes, a quote doubled. */
export const formulaText = (s: string): string => `"${s.replace(/"/g, '""')}"`

/**
 * The formula with references to the variable called `from` renamed to `to` (the rest of the
 * text unchanged), or null when it has none or doesn't parse.
 */
export function renameInFormula(formula: string, from: string, to: string): string | null {
  let tree: FormulaNode
  try {
    tree = parseFormula(formula)
  } catch {
    return null
  }
  const key = nameKey(from)
  const refs = formulaNames(tree).filter(
    (n): n is Extract<FormulaNode, { k: 'var' }> =>
      n.k === 'var' &&
      (nameKey(n.name) === key || (n.bare && nameKey(n.name.replace(/_/g, ' ')) === key)),
  )
  if (!refs.length) return null
  let out = formula
  for (const r of [...refs].sort((a, b) => b.start - a.start))
    out = out.slice(0, r.start) + formulaReference(to) + out.slice(r.end)
  return out
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Info constants (roadmap 40)
// ---------------------------------------------------------------------------------------------

/** What an info reference gives: its number, or why it has none. */
export type ConstantValue = { value: number } | { error: string }

/**
 * The info fields formulas can name (built from a project's info sheets: `infoConstants`).
 * `lookup` answers a bracketed name with a colon: null when it names no info sheet (and isn't
 * `Info: …`), so the name stays an unknown variable.
 */
export interface InfoConstants {
  lookup(name: string): ConstantValue | null
}

const tableConstants = new WeakMap<object, InfoConstants>()
const boundTables = new WeakMap<DataTable, { constants: InfoConstants; table: DataTable }>()

/** Whether a table's formulas may name an info field (cheap: a colon in a bracketed name). */
export const mayNameInfo = (table: Pick<DataTable, 'dataSets'>) =>
  table.dataSets.some((d) => d.formula?.includes(':'))

/**
 * The table with the project's info constants bound, for its formulas to read (roadmap 40): the
 * table itself when no formula may name one, else a shallow copy (memoized per table and
 * constants) that `tableFormulas` evaluates with them. Derived: never stored.
 */
export function withConstants(table: DataTable, constants: InfoConstants): DataTable {
  if (!mayNameInfo(table)) return table
  const hit = boundTables.get(table)
  if (hit?.constants === constants) return hit.table
  const out: DataTable = { ...table }
  tableConstants.set(out, constants)
  boundTables.set(table, { constants, table: out })
  return out
}

/** The constants bound to a table by `withConstants` (undefined: none). */
export const constantsOf = (table: object): InfoConstants | undefined => tableConstants.get(table)

/** A calculated variable's values, derived from its formula (never stored). */
export interface FormulaValues {
  /** By row; NaN = no value (a needed value is empty, or the result isn't a finite number). */
  values: Float64Array
  /**
   * A formula whose result is text (roadmap 38): its values by row (null = blank); `values`
   * are then all NaN. Absent for a number result.
   */
  text?: (string | null)[]
  /** Why the formula can't be evaluated at all (syntax, unknown name, circular reference…). */
  error: string | null
  /** Rows whose inputs are all there but whose result isn't a finite number (e.g. ln(-1)). */
  invalidRows: number[]
  /** Ids of the variables the formula uses directly. */
  uses: string[]
}

type Val = number | string | null
type Kind = 'number' | 'text'

interface Compiled {
  kind: Kind
  /** Value at a row: a number (NaN = missing) or text (null = missing). */
  at: (row: number) => Val
  /** A text literal (options such as a tie method), when the argument is one. */
  literal?: string
  /** A number written in the formula, when the argument is one. */
  constant?: number
}

type NumAt = (r: number) => number
type TextAt = (r: number) => string | null

interface Context {
  rows: number
  /** Rows a function leaves blank by design (lag's first rows, a group of one…), not invalid. */
  blank: Uint8Array
  /** Whether a variable the formula reads is blank at a row (iferror keeps such rows blank). */
  inputsMissing: (r: number) => boolean
}

const isMissing = (v: Val) => v === null || (typeof v === 'number' && Number.isNaN(v))

/** Text as levels compare it: trimmed, blank = null. */
const levelText = (s: string | null): string | null => {
  if (s === null) return null
  const t = s.trim()
  return t === '' ? null : t
}

/** A number as text, at 15 significant digits. */
const numberText = (v: number): string => String(Number(v.toPrecision(15)))

function compile(
  node: FormulaNode,
  lookup: (ref: Extract<FormulaNode, { k: 'var' }>) => { kind: Kind; at: (r: number) => Val },
  ctx: Context,
): Compiled {
  const num = (c: Compiled, what: string): NumAt => {
    if (c.kind !== 'number') throw new FormulaError(`${what} needs a number, not text`)
    return c.at as NumAt
  }
  const txt = (c: Compiled, what: string): TextAt => {
    if (c.kind !== 'text') throw new FormulaError(`${what} needs text, not a number`)
    return c.at as TextAt
  }
  /** Text or a number as text (concat). */
  const asText = (c: Compiled): TextAt =>
    c.kind === 'text'
      ? (c.at as TextAt)
      : (r) => {
          const v = c.at(r) as number
          return Number.isNaN(v) ? null : numberText(v)
        }
  const sub = (n: FormulaNode) => compile(n, lookup, ctx)
  switch (node.k) {
    case 'num':
      return { kind: 'number', at: () => node.v, constant: node.v }
    case 'str':
      return { kind: 'text', at: () => node.v, literal: node.v }
    case 'var':
      return lookup(node)
    case 'neg': {
      const a = num(sub(node.a), '“-”')
      return { kind: 'number', at: (r) => -a(r) }
    }
    case 'bin': {
      const A = sub(node.a)
      const B = sub(node.b)
      if (COMPARISONS.has(node.op) && (A.kind === 'text' || B.kind === 'text')) {
        if (A.kind !== B.kind)
          throw new FormulaError(`“${node.op}” compares text with text, or numbers with numbers`)
        if (node.op !== '=' && node.op !== '<>')
          throw new FormulaError(`text is compared with = or <> only`)
        const same = node.op === '='
        return {
          kind: 'number',
          at: (r) => {
            const a = A.at(r) as string | null
            const b = B.at(r) as string | null
            if (a === null || b === null) return Number.NaN
            return (nameKey(a) === nameKey(b)) === same ? 1 : 0
          },
        }
      }
      const a = num(A, `“${node.op}”`)
      const b = num(B, `“${node.op}”`)
      const f: (x: number, y: number) => number = {
        '+': (x: number, y: number) => x + y,
        '-': (x: number, y: number) => x - y,
        '*': (x: number, y: number) => x * y,
        '/': (x: number, y: number) => x / y,
        '^': (x: number, y: number) => x ** y,
        '=': (x: number, y: number) => (x === y ? 1 : 0),
        '<>': (x: number, y: number) => (x !== y ? 1 : 0),
        '<': (x: number, y: number) => (x < y ? 1 : 0),
        '<=': (x: number, y: number) => (x <= y ? 1 : 0),
        '>': (x: number, y: number) => (x > y ? 1 : 0),
        '>=': (x: number, y: number) => (x >= y ? 1 : 0),
      }[node.op]
      return {
        kind: 'number',
        at: (r) => {
          const x = a(r)
          const y = b(r)
          return Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : f(x, y)
        },
      }
    }
    case 'call':
      return compileCall(node.fn, node.args.map(sub), { num, txt, asText }, ctx)
  }
}

interface Coerce {
  num: (c: Compiled, what: string) => NumAt
  txt: (c: Compiled, what: string) => TextAt
  asText: (c: Compiled) => TextAt
}

/** The values of an argument over every row, computed once (when first needed). */
function column(at: NumAt, rows: number): () => Float64Array {
  let out: Float64Array | null = null
  return () => {
    if (!out) {
      out = new Float64Array(rows)
      for (let r = 0; r < rows; r++) out[r] = at(r)
    }
    return out
  }
}

/**
 * Groups of rows by the values of the group arguments (text trimmed, numbers as numbers; a row
 * with a blank group value is in no group: -1). No arguments: every row is in group 0.
 */
function groupsOf(groups: readonly Compiled[], rows: number) {
  let done: { of: Int32Array; members: number[][] } | null = null
  return () => {
    if (done) return done
    const of = new Int32Array(rows)
    const members: number[][] = []
    if (!groups.length) {
      members.push(Array.from({ length: rows }, (_, r) => r))
      done = { of, members }
      return done
    }
    const index = new Map<string, number>()
    for (let r = 0; r < rows; r++) {
      let key = ''
      let blank = false
      for (const g of groups) {
        const v = g.at(r)
        if (g.kind === 'text') {
          const t = levelText(v as string | null)
          if (t === null) blank = true
          else key += `\u0001${t}`
        } else if (Number.isNaN(v as number)) blank = true
        else key += `\u0002${v as number}`
      }
      if (blank) {
        of[r] = -1
        continue
      }
      let g = index.get(key)
      if (g === undefined) {
        g = members.length
        index.set(key, g)
        members.push([])
      }
      members[g]!.push(r)
      of[r] = g
    }
    done = { of, members }
    return done
  }
}

/** Per group, a statistic; each row gets its group's (NaN for no group). */
function perGroup(
  x: () => Float64Array,
  groups: ReturnType<typeof groupsOf>,
  stat: (values: Float64Array, rows: readonly number[]) => number,
  rows: number,
  ctx: Context,
): NumAt {
  let out: Float64Array | null = null
  return (r) => {
    if (!out) {
      const v = x()
      const { of, members } = groups()
      const byGroup = members.map((m) => stat(v, m))
      out = new Float64Array(rows)
      for (let i = 0; i < rows; i++) {
        const g = of[i]!
        out[i] = g < 0 ? Number.NaN : byGroup[g]!
        // Too few values for the statistic: blank by design, not invalid.
        if (g >= 0 && Number.isNaN(out[i]!)) ctx.blank[i] = 1
      }
    }
    return out[r]!
  }
}

/** A text option that must be written as a literal ("average", "(]"…). */
function literalOf(c: Compiled | undefined): string | undefined {
  return c?.literal
}

/**
 * `x` rounded half away from zero to `digits` decimals (truncated to an integer; negative: tens,
 * hundreds…), as spreadsheets round: on the number as written in decimal (its shortest
 * representation that reads back as it, "1.005"), not on the binary double just below it
 * (1.00499999999999989…), so round(1.005, 2) = 1.01 (audit 2, decision 682).
 */
export function roundDecimal(x: number, digits = 0): number {
  const d = Math.trunc(digits)
  if (Number.isNaN(d)) return Number.NaN
  if (!Number.isFinite(x) || x === 0) return x
  // Shortest round-trip digits and exponent: "1.005e+0" → 1005, 0.
  const [mantissa, exp] = Math.abs(x).toExponential().split('e') as [string, string]
  const all = mantissa.replace('.', '')
  const e = Number(exp)
  /** Digits kept: the first stands for 10^e, the last kept for 10^-d. */
  const keep = e + 1 + d
  if (keep >= all.length) return x
  const sign = x < 0 ? -1 : 1
  // Rounded to zero: 0 (not −0).
  if (keep < 0) return 0
  let kept = all.slice(0, keep) || '0'
  if (all.charCodeAt(keep) >= 53 /* '5' */) {
    // Add one to the kept digits (as text: up to 17 of them).
    const chars = kept.split('')
    let i = chars.length - 1
    while (i >= 0 && chars[i] === '9') chars[i--] = '0'
    if (i < 0) chars.unshift('1')
    else chars[i] = String(Number(chars[i]) + 1)
    kept = chars.join('')
  }
  const r = Number(`${kept}e${-d}`)
  return r === 0 ? 0 : sign * r
}

function compileCall(name: string, args: Compiled[], co: Coerce, ctx: Context): Compiled {
  const { num, txt, asText } = co
  const rows = ctx.rows
  const NUM = (at: NumAt): Compiled => ({ kind: 'number', at })
  const TXT = (at: TextAt): Compiled => ({ kind: 'text', at })
  const one = (g: (x: number) => number) => {
    const x = num(args[0]!, name)
    return NUM((r) => g(x(r)))
  }
  const list = (g: (v: number[]) => number) => {
    const xs = args.map((c) => num(c, name))
    return NUM((r) => {
      const v = xs.map((x) => x(r))
      return v.some(Number.isNaN) ? Number.NaN : g(v)
    })
  }
  /** Branches of if / ifs / case / coalesce share a kind. */
  const sameKind = (cs: readonly Compiled[]): Kind => {
    const k = cs[0]!.kind
    if (cs.some((c) => c.kind !== k))
      throw new FormulaError(`${name}’s values are all numbers or all text`)
    return k
  }
  const missingOf = (k: Kind): Val => (k === 'number' ? Number.NaN : null)

  switch (name) {
    // --- Maths ------------------------------------------------------------------------------
    case 'ln':
      return one(Math.log)
    case 'log':
      if (args.length === 2) return list(([x, b]) => Math.log(x!) / Math.log(b!))
      return one(Math.log10)
    case 'log10':
      return one(Math.log10)
    case 'log2':
      return one(Math.log2)
    case 'exp':
      return one(Math.exp)
    case 'sqrt':
      return one(Math.sqrt)
    case 'abs':
      return one(Math.abs)
    case 'sign':
      return one((x) => (Number.isNaN(x) ? x : Math.sign(x)))
    case 'floor':
      return one(Math.floor)
    case 'ceil':
      return one(Math.ceil)
    case 'int':
      return one(Math.trunc)
    case 'sin':
      return one(Math.sin)
    case 'cos':
      return one(Math.cos)
    case 'tan':
      return one(Math.tan)
    case 'asin':
      return one(Math.asin)
    case 'acos':
      return one(Math.acos)
    case 'atan':
      return one(Math.atan)
    case 'asinh':
      return one(Math.asinh)
    case 'logit':
      return one((p) => Math.log(p / (1 - p)))
    case 'expit':
      return one((x) => 1 / (1 + Math.exp(-x)))
    case 'not':
      return one((x) => (Number.isNaN(x) ? x : x === 0 ? 1 : 0))
    case 'round':
      // Half away from zero on the decimal digits, as spreadsheets round.
      return list(([x, d = 0]) => roundDecimal(x!, d))
    case 'mod':
      return list(([x, y]) => x! - y! * Math.floor(x! / y!))
    case 'clamp':
      return list(([x, lo, hi]) => (lo! > hi! ? Number.NaN : Math.min(hi!, Math.max(lo!, x!))))
    case 'min':
      return list((v) => Math.min(...v))
    case 'max':
      return list((v) => Math.max(...v))
    case 'sum':
      return list((v) => v.reduce((s, x) => s + x, 0))
    case 'mean':
      return list((v) => v.reduce((s, x) => s + x, 0) / v.length)
    case 'pow':
      return list(([x, y]) => x! ** y!)
    case 'and':
      return list((v) => (v.every((x) => x !== 0) ? 1 : 0))
    case 'or':
      return list((v) => (v.some((x) => x !== 0) ? 1 : 0))

    // --- Logic ------------------------------------------------------------------------------
    case 'isblank': {
      const a = args[0]!
      return NUM((r) => (isMissing(a.at(r)) ? 1 : 0))
    }
    case 'isnumber': {
      const a = args[0]!
      return NUM((r) => (a.kind === 'number' && !isMissing(a.at(r)) ? 1 : 0))
    }
    case 'istext': {
      const a = args[0]!
      return NUM((r) => (a.kind === 'text' && levelText(a.at(r) as string | null) !== null ? 1 : 0))
    }
    case 'if': {
      const test = num(args[0]!, name)
      const kind = sameKind(args.slice(1))
      const [, then, other] = args as [Compiled, Compiled, Compiled]
      return {
        kind,
        at: (r) => {
          const t = test(r)
          return Number.isNaN(t) ? missingOf(kind) : t !== 0 ? then.at(r) : other.at(r)
        },
      }
    }
    case 'ifs': {
      const pairs = Math.floor(args.length / 2)
      const tests = Array.from({ length: pairs }, (_, i) => num(args[2 * i]!, name))
      const values = Array.from({ length: pairs }, (_, i) => args[2 * i + 1]!)
      const otherwise = args.length % 2 ? args[args.length - 1] : undefined
      const kind = sameKind(otherwise ? [...values, otherwise] : values)
      return {
        kind,
        at: (r) => {
          for (let i = 0; i < pairs; i++) {
            const t = tests[i]!(r)
            if (Number.isNaN(t)) return missingOf(kind)
            if (t !== 0) return values[i]!.at(r)
          }
          if (otherwise) return otherwise.at(r)
          ctx.blank[r] = 1
          return missingOf(kind)
        },
      }
    }
    case 'case':
    case 'recode': {
      const x = args[0]!
      const rest = args.slice(1)
      const pairs = Math.floor(rest.length / 2)
      const matches = Array.from({ length: pairs }, (_, i) => rest[2 * i]!)
      const values = Array.from({ length: pairs }, (_, i) => rest[2 * i + 1]!)
      if (matches.some((m) => m.kind !== x.kind))
        throw new FormulaError(
          `${name} matches ${x.kind === 'text' ? 'text' : 'numbers'} with ${x.kind === 'text' ? 'text' : 'numbers'}`,
        )
      const otherwise = rest.length % 2 ? rest[rest.length - 1] : undefined
      // recode keeps unmatched values (as text when it gives text).
      const keep: Compiled | undefined =
        otherwise ??
        (name === 'recode' ? (values[0]!.kind === 'text' ? TXT(asText(x)) : x) : undefined)
      const kind = sameKind(keep ? [...values, keep] : values)
      // recode matches levels exactly (trimmed, as graphs tell levels apart); case as `=` does.
      const key = (v: Val): string | number | null =>
        x.kind === 'text'
          ? name === 'recode'
            ? levelText(v as string | null)
            : v === null
              ? null
              : nameKey(v as string)
          : Number.isNaN(v as number)
            ? null
            : (v as number)
      // Constant matches (the usual case): one lookup per row.
      const constant = matches.every((m) => m.literal !== undefined || m.constant !== undefined)
      let table: Map<string | number, number> | null = null
      return {
        kind,
        at: (r) => {
          const v = key(x.at(r))
          if (v === null) return missingOf(kind)
          let hit = -1
          if (constant) {
            if (!table) {
              table = new Map()
              matches.forEach((m, i) => {
                const k = key(m.at(0))
                if (k !== null && !table!.has(k)) table!.set(k, i)
              })
            }
            hit = table.get(v) ?? -1
          } else hit = matches.findIndex((m) => key(m.at(r)) === v)
          if (hit >= 0) return values[hit]!.at(r)
          if (keep) return keep.at(r)
          ctx.blank[r] = 1
          return missingOf(kind)
        },
      }
    }
    case 'coalesce': {
      const kind = sameKind(args)
      return {
        kind,
        at: (r) => {
          for (const a of args) {
            const v = a.at(r)
            if (
              kind === 'number'
                ? !Number.isNaN(v as number)
                : levelText(v as string | null) !== null
            )
              return v
          }
          return missingOf(kind)
        },
      }
    }
    case 'iferror': {
      const kind = sameKind(args)
      const [x, alt] = args as [Compiled, Compiled]
      // Invalid: no value although the row has every input the formula reads.
      return {
        kind,
        at: (r) => {
          const v = x.at(r)
          if (!isMissing(v)) return v
          return ctx.blank[r] || ctx.inputsMissing(r) ? missingOf(kind) : alt.at(r)
        },
      }
    }

    // --- Statistics over a column or within groups ------------------------------------------
    case 'median':
    case 'medianby':
    case 'sd':
    case 'sdby':
    case 'var':
    case 'meanby':
    case 'sumby':
    case 'countby':
    case 'minby':
    case 'maxby': {
      const x = column(num(args[0]!, name), rows)
      const groups = groupsOf(args.slice(1), rows)
      const stat: (v: Float64Array, m: readonly number[]) => number =
        name === 'median' || name === 'medianby'
          ? (v, m) => quantileOfSorted(sortedAt(v, m), 0.5, 7)
          : name === 'sd' || name === 'sdby'
            ? (v, m) => Math.sqrt(moments(v, m).variance)
            : name === 'var'
              ? (v, m) => moments(v, m).variance
              : name === 'meanby'
                ? (v, m) => moments(v, m).mean
                : name === 'sumby'
                  ? (v, m) => moments(v, m).sum
                  : name === 'minby'
                    ? (v, m) => {
                        const s = sortedAt(v, m)
                        return s.length ? s[0]! : Number.NaN
                      }
                    : name === 'maxby'
                      ? (v, m) => {
                          const s = sortedAt(v, m)
                          return s.length ? s[s.length - 1]! : Number.NaN
                        }
                      : (v, m) => moments(v, m).n
      return NUM(perGroup(x, groups, stat, rows, ctx))
    }
    case 'quantile': {
      const x = column(num(args[0]!, name), rows)
      const p = num(args[1]!, name)
      const typeArg = args[2]
      const type = typeArg ? num(typeArg, name) : () => 7
      const groups = groupsOf(args.slice(3), rows)
      let sorted: Float64Array[] | null = null
      return NUM((r) => {
        const { of, members } = groups()
        if (!sorted) {
          const v = x()
          sorted = members.map((m) => sortedAt(v, m))
        }
        const g = of[r]!
        const t = type(r)
        if (g < 0 || !Number.isInteger(t) || t < 1 || t > 9) return Number.NaN
        const q = quantileOfSorted(sorted[g]!, p(r), t)
        if (Number.isNaN(q) && sorted[g]!.length === 0) ctx.blank[r] = 1
        return q
      })
    }
    case 'rank': {
      const x = column(num(args[0]!, name), rows)
      let ties: TieMethod = 'average'
      let groupArgs = args.slice(1)
      if (args[1]?.kind === 'text') {
        const lit = literalOf(args[1])
        if (lit === undefined || !TIE_METHODS.includes(lit as TieMethod))
          throw new FormulaError('rank’s ties are "average", "min", "max" or "first"')
        ties = lit as TieMethod
        groupArgs = args.slice(2)
      }
      const groups = groupsOf(groupArgs, rows)
      let out: Float64Array | null = null
      return NUM((r) => {
        if (!out) {
          const v = x()
          out = new Float64Array(rows).fill(Number.NaN)
          for (const m of groups().members) rankRows(v, m, ties, out)
        }
        return out[r]!
      })
    }
    case 'zscore': {
      const xat = num(args[0]!, name)
      const x = column(xat, rows)
      const groups = groupsOf(args.slice(1), rows)
      let stats: { mean: number; sd: number }[] | null = null
      return NUM((r) => {
        const { of, members } = groups()
        if (!stats) {
          const v = x()
          stats = members.map((m) => {
            const s = moments(v, m)
            return { mean: s.mean, sd: Math.sqrt(s.variance) }
          })
        }
        const g = of[r]!
        const v = x()[r]!
        if (g < 0 || Number.isNaN(v)) return Number.NaN
        const s = stats[g]!
        if (Number.isNaN(s.sd)) ctx.blank[r] = 1
        return (v - s.mean) / s.sd
      })
    }

    // --- Running down the rows --------------------------------------------------------------
    case 'cumsum': {
      const x = column(num(args[0]!, name), rows)
      let out: Float64Array | null = null
      return NUM((r) => {
        if (!out) {
          const v = x()
          out = new Float64Array(rows)
          let s = 0
          for (let i = 0; i < rows; i++) {
            const y = v[i]!
            if (Number.isNaN(y)) out[i] = Number.NaN
            else out[i] = s += y
          }
        }
        return out[r]!
      })
    }
    case 'lag':
    case 'lead': {
      const x = num(args[0]!, name)
      const k = args[1] ? num(args[1], name) : () => 1
      const sign = name === 'lag' ? -1 : 1
      return NUM((r) => {
        const n = k(r)
        if (!Number.isInteger(n)) return Number.NaN
        const j = r + sign * n
        if (j < 0 || j >= rows) {
          ctx.blank[r] = 1
          return Number.NaN
        }
        const v = x(j)
        if (Number.isNaN(v)) ctx.blank[r] = 1
        return v
      })
    }
    case 'diff': {
      const x = num(args[0]!, name)
      return NUM((r) => {
        if (r === 0) {
          ctx.blank[0] = 1
          return Number.NaN
        }
        const a = x(r)
        const b = x(r - 1)
        if (Number.isNaN(b)) ctx.blank[r] = 1
        return a - b
      })
    }

    // --- Text -------------------------------------------------------------------------------
    case 'concat': {
      const parts = args.map(asText)
      return TXT((r) => {
        let s = ''
        for (const p of parts) {
          const v = p(r)
          if (v === null) return null
          s += v
        }
        return s
      })
    }
    case 'upper': {
      const t = txt(args[0]!, name)
      return TXT((r) => t(r)?.toUpperCase() ?? null)
    }
    case 'lower': {
      const t = txt(args[0]!, name)
      return TXT((r) => t(r)?.toLowerCase() ?? null)
    }
    case 'trim': {
      const t = txt(args[0]!, name)
      return TXT((r) => t(r)?.trim().replace(/\s+/g, ' ') ?? null)
    }
    case 'left':
    case 'right': {
      const t = txt(args[0]!, name)
      const n = args[1] ? num(args[1], name) : () => 1
      return TXT((r) => {
        const s = t(r)
        const k = n(r)
        if (s === null || Number.isNaN(k) || k < 0) return null
        const chars = [...s]
        const m = Math.trunc(k)
        return (
          name === 'left' ? chars.slice(0, m) : chars.slice(Math.max(0, chars.length - m))
        ).join('')
      })
    }
    case 'mid': {
      const t = txt(args[0]!, name)
      const start = num(args[1]!, name)
      const n = num(args[2]!, name)
      return TXT((r) => {
        const s = t(r)
        const a = start(r)
        const k = n(r)
        if (s === null || Number.isNaN(a) || Number.isNaN(k) || a < 1 || k < 0) return null
        return [...s].slice(Math.trunc(a) - 1, Math.trunc(a) - 1 + Math.trunc(k)).join('')
      })
    }
    case 'len': {
      const t = txt(args[0]!, name)
      return NUM((r) => {
        const s = t(r)
        return s === null ? Number.NaN : [...s].length
      })
    }
    case 'replace': {
      const [t, find, by] = args.map((a) => txt(a, name)) as [TextAt, TextAt, TextAt]
      return TXT((r) => {
        const s = t(r)
        const f = find(r)
        const w = by(r)
        if (s === null || f === null || w === null) return null
        return f === '' ? s : s.split(f).join(w)
      })
    }
    case 'contains':
    case 'startswith':
    case 'endswith': {
      const t = txt(args[0]!, name)
      const part = txt(args[1]!, name)
      return NUM((r) => {
        const s = t(r)
        const p = part(r)
        if (s === null || p === null) return Number.NaN
        const a = s.toLowerCase()
        const b = p.toLowerCase()
        const hit =
          name === 'contains'
            ? a.includes(b)
            : name === 'startswith'
              ? a.startsWith(b)
              : a.endsWith(b)
        return hit ? 1 : 0
      })
    }
    case 'text': {
      const x = num(args[0]!, name)
      const d = args[1] ? num(args[1], name) : null
      return TXT((r) => {
        const v = x(r)
        if (Number.isNaN(v) || !Number.isFinite(v)) return null
        if (!d) return numberText(v)
        const k = d(r)
        if (Number.isNaN(k)) return null
        return v.toFixed(Math.max(0, Math.min(15, Math.trunc(k))))
      })
    }
    case 'value': {
      const t = txt(args[0]!, name)
      return NUM((r) => {
        const s = t(r)
        if (s === null || s.trim() === '') return Number.NaN
        return numberFromText(s) ?? Number.NaN
      })
    }

    // --- Categories from numbers: R's cut() ------------------------------------------------
    case 'cut':
    case 'cutwidth':
    case 'cutquantile': {
      const xat = num(args[0]!, name)
      let i = 1
      let right = true
      const closure = literalOf(args[1])
      if (args[1]?.kind === 'text') {
        if (closure !== '(]' && closure !== '[)')
          throw new FormulaError(
            `${name}’s intervals are "(]" (right-closed) or "[)" (left-closed)`,
          )
        right = closure === '(]'
        i = 2
      }
      const numbers: NumAt[] = []
      while (i < args.length && args[i]!.kind === 'number') numbers.push(args[i++]!.at as NumAt)
      const labels = args.slice(i)
      if (labels.some((l) => l.kind !== 'text'))
        throw new FormulaError(`${name}’s labels come after its numbers`)
      if (name === 'cut' && numbers.length < 2)
        throw new FormulaError('cut needs at least two breaks')
      if (name !== 'cut' && numbers.length !== 1)
        throw new FormulaError(`${name} takes one number of intervals`)
      const x = column(xat, rows)
      // Breaks: given (evaluated once), or from the data.
      let breaks: number[] | null = null
      let names: (string | null)[] | null = null
      const intervals = () => {
        if (breaks) return
        let b: number[]
        if (name === 'cut') b = numbers.map((f) => f(0)).sort((p, q) => p - q)
        else {
          const n = numbers[0]!(0)
          if (!Number.isInteger(n) || n < 1)
            throw new FormulaError(`${name} needs a whole number of intervals`)
          b = name === 'cutwidth' ? equalWidthBreaks(x(), n) : quantileBreaks(x(), n)
        }
        if (b.some((v) => !Number.isFinite(v)))
          throw new FormulaError(`${name}’s breaks aren’t numbers`)
        if (b.some((v, j) => j > 0 && v === b[j - 1]))
          throw new FormulaError(`${name}’s breaks are not unique`)
        breaks = b
        if (labels.length) {
          if (b.length && labels.length !== b.length - 1)
            throw new FormulaError(
              `${name} has ${b.length - 1} intervals but ${labels.length} labels`,
            )
          names = labels.map((l) => levelText(l.at(0) as string | null))
        } else names = b.length > 1 ? cutLabels(b, right) : []
      }
      return TXT((r) => {
        intervals()
        const v = x()[r]!
        if (Number.isNaN(v)) return null
        const j = binIndex(v, breaks!, right)
        if (j < 0) {
          ctx.blank[r] = 1
          return null
        }
        return names![j] ?? null
      })
    }
  }
  throw new FormulaError(`unknown function “${name}”`)
}

function numericValues(ds: DataSetColumn, rows: number): Float64Array {
  const col = ds.subcolumns[0]
  const out = new Float64Array(rows).fill(Number.NaN)
  if (!col) return out
  for (let r = 0; r < rows; r++) {
    const v = col.values[r]
    if (v !== null && v !== undefined && !col.excluded?.[r]) out[r] = v
  }
  return out
}

type Input = { kind: Kind; at: (r: number) => Val }

/** Evaluates a parsed formula over `rowCount` rows given its inputs (by resolved reference). */
function evaluateTree(
  tree: FormulaNode,
  input: (ref: Extract<FormulaNode, { k: 'var' }>) => Input,
  inputs: readonly Input[],
  rowCount: number,
  uses: string[],
): FormulaValues {
  const missingAt = (r: number) => inputs.some((c) => isMissing(c.at(r)))
  const ctx: Context = { rows: rowCount, blank: new Uint8Array(rowCount), inputsMissing: missingAt }
  const values = new Float64Array(rowCount)
  const invalidRows: number[] = []
  try {
    const compiled = compile(tree, input, ctx)
    if (compiled.kind === 'text') {
      values.fill(Number.NaN)
      const text: (string | null)[] = new Array(rowCount)
      for (let r = 0; r < rowCount; r++) {
        const v = compiled.at(r) as string | null
        text[r] = v === null || v.trim() === '' ? null : v
      }
      return { values, text, error: null, invalidRows, uses }
    }
    for (let r = 0; r < rowCount; r++) {
      const v = compiled.at(r) as number
      if (Number.isFinite(v)) values[r] = v
      else {
        values[r] = Number.NaN
        // No value because an input is missing (or by a function's design) is expected;
        // otherwise the maths failed.
        if (!ctx.blank[r] && !missingAt(r)) invalidRows.push(r)
      }
    }
  } catch (e) {
    return {
      values: new Float64Array(rowCount).fill(Number.NaN),
      error: e instanceof Error ? e.message : String(e),
      invalidRows: [],
      uses,
    }
  }
  return { values, error: null, invalidRows, uses }
}

/** A column a formula can read: numbers (NaN = missing) or text (null = missing). */
export interface FormulaColumn {
  id: string
  title: string
  values?: ArrayLike<number>
  text?: readonly (string | null)[]
}

/**
 * A formula evaluated over columns given directly (roadmap 38: Filter rows reads a source's
 * normalized data sets): names resolve to the columns' titles as in a table. Errors (syntax,
 * unknown names, types) come back in `error`.
 */
export function evaluateFormula(
  formula: string,
  columns: readonly FormulaColumn[],
  rowCount: number,
): FormulaValues {
  const failed = (error: string): FormulaValues => ({
    values: new Float64Array(rowCount).fill(Number.NaN),
    error,
    invalidRows: [],
    uses: [],
  })
  let tree: FormulaNode
  try {
    tree = parseFormula(formula)
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e))
  }
  const resolve = nameResolver(columns)
  const used = new Map<FormulaColumn, Input>()
  for (const ref of formulaNames(tree) as Extract<FormulaNode, { k: 'var' }>[]) {
    const r = resolve(ref)
    if ('error' in r) {
      if (r.error !== 'pi') return failed(r.error)
      continue
    }
    if (used.has(r.ok)) continue
    const c = r.ok
    const text = c.text
    const values = c.values
    used.set(
      c,
      text
        ? { kind: 'text', at: (row) => levelText(text[row] ?? null) }
        : { kind: 'number', at: (row) => values?.[row] ?? Number.NaN },
    )
  }
  return evaluateTree(
    tree,
    (ref) => {
      const r = resolve(ref)
      if ('ok' in r) return used.get(r.ok)!
      return { kind: 'number', at: () => Math.PI }
    },
    [...used.values()],
    rowCount,
    [...used.keys()].map((c) => c.id),
  )
}

interface Memo {
  deps: readonly DataSetColumn[]
  depResults: readonly (FormulaValues | undefined)[]
  names: string
  /** The info constants it read and their values (roadmap 40). */
  constants: string
  result: FormulaValues
}
/** Per calculated column: its result, reused while what it depends on is unchanged. */
const memo = new WeakMap<DataSetColumn, Memo>()
type TableMemo = WeakMap<readonly DataSetColumn[], ReadonlyMap<string, FormulaValues>>
const tableMemo: TableMemo = new WeakMap()
/** Per info constants: tables evaluated with them. */
const boundMemo = new WeakMap<InfoConstants, TableMemo>()
const NONE: ReadonlyMap<string, FormulaValues> = new Map()

/**
 * The values of every calculated variable of a table, by data set id. Memoized per `dataSets`
 * array (edits replace it), and per variable while the variables it uses are unchanged, so
 * normalized views and hashes stay stable across unrelated edits.
 */
export function tableFormulas(
  table: Pick<DataTable, 'dataSets' | 'rowCount'>,
): ReadonlyMap<string, FormulaValues> {
  const { dataSets, rowCount } = table
  if (!dataSets.some((d) => d.formula !== undefined)) return NONE
  const constants = constantsOf(table)
  let memoOf = tableMemo
  if (constants) {
    memoOf = boundMemo.get(constants) ?? new WeakMap()
    boundMemo.set(constants, memoOf)
  }
  const hit = memoOf.get(dataSets)
  if (hit) return hit
  const resolve = nameResolver(dataSets)
  const names = dataSets.map((d) => nameKey(d.title)).join('\u0000')
  const out = new Map<string, FormulaValues>()
  const state = new Map<string, 'busy' | 'done'>()

  const failed = (error: string, uses: string[] = []): FormulaValues => ({
    values: new Float64Array(rowCount).fill(Number.NaN),
    error,
    invalidRows: [],
    uses,
  })

  const evaluate = (ds: DataSetColumn, path: DataSetColumn[]): FormulaValues => {
    const done = out.get(ds.id)
    if (done) return done
    if (state.get(ds.id) === 'busy') {
      const cycle = [...path.slice(path.indexOf(ds)), ds].map((d) => `“${d.title}”`).join(' → ')
      return failed(`circular reference: ${cycle}`)
    }
    state.set(ds.id, 'busy')
    const result = evaluateOne(ds, [...path, ds])
    state.set(ds.id, 'done')
    out.set(ds.id, result)
    return result
  }

  const evaluateOne = (ds: DataSetColumn, path: DataSetColumn[]): FormulaValues => {
    let tree: FormulaNode
    try {
      tree = parseFormula(ds.formula!)
    } catch (e) {
      return failed(e instanceof Error ? e.message : String(e))
    }
    // Resolve names first: the variables used, and whether the cached result still holds.
    const deps: DataSetColumn[] = []
    // Roadmap 40: bracketed names that aren't variables may be info constants.
    const consts = new Map<string, number>()
    for (const ref of formulaNames(tree) as Extract<FormulaNode, { k: 'var' }>[]) {
      const r = resolve(ref)
      if ('ok' in r) {
        if (!deps.includes(r.ok)) deps.push(r.ok)
      } else if (r.error !== 'pi') {
        const c = !ref.bare && ref.name.includes(':') ? constants?.lookup(ref.name) : null
        if (!c) return failed(r.error)
        if ('error' in c) return failed(c.error)
        consts.set(ref.name, c.value)
      }
    }
    const constSig = [...consts].map(([k, v]) => `${k}\u0000${v}`).join('\u0001')
    const uses = deps.map((d) => d.id as string)
    const depResults: (FormulaValues | undefined)[] = []
    for (const d of deps) {
      if (d.formula === undefined) {
        depResults.push(undefined)
        continue
      }
      const sub = evaluate(d, path)
      if (sub.error) {
        const circular = sub.error.startsWith('circular reference')
        return failed(circular ? sub.error : `uses “${d.title}”, which has an error`, uses)
      }
      depResults.push(sub)
    }
    const prev = memo.get(ds)
    if (
      prev &&
      prev.names === names &&
      prev.constants === constSig &&
      prev.result.values.length === rowCount &&
      prev.deps.length === deps.length &&
      prev.deps.every((d, i) => d === deps[i] && prev.depResults[i] === depResults[i])
    )
      return prev.result

    const columns = new Map<DataSetColumn, Input>()
    deps.forEach((d, i) => {
      const calcText = depResults[i]?.text
      const text = d.text ?? calcText
      if (text !== undefined) {
        // Excluded text cells are missing, as levels leave them out.
        const excluded = calcText ? undefined : d.subcolumns[0]?.excluded
        columns.set(d, {
          kind: 'text',
          at: (r) => (excluded?.[r] ? null : levelText(text[r] ?? null)),
        })
      } else {
        const v = depResults[i]?.values ?? numericValues(d, rowCount)
        columns.set(d, { kind: 'number', at: (r) => v[r] ?? Number.NaN })
      }
    })
    const result = evaluateTree(
      tree,
      (ref) => {
        const r = resolve(ref)
        if ('ok' in r) return columns.get(r.ok)!
        const c = consts.get(ref.name)
        if (c !== undefined && !ref.bare) return { kind: 'number', at: () => c }
        return { kind: 'number', at: () => Math.PI }
      },
      [...columns.values()],
      rowCount,
      uses,
    )
    if (!result.error) memo.set(ds, { deps, depResults, names, constants: constSig, result })
    return result
  }

  for (const ds of dataSets) if (ds.formula !== undefined) evaluate(ds, [])
  memoOf.set(dataSets, out)
  return out
}

/** Checks a formula's syntax: null when it parses, else the message. */
export function formulaSyntaxError(formula: string): string | null {
  try {
    parseFormula(formula)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// ---------------------------------------------------------------------------------------------
// Text ↔ numbers
// ---------------------------------------------------------------------------------------------

/** A number written as text ("1.5", "-2", "1e3", "1,5"), or null when it isn't one. */
export function numberFromText(s: string): number | null {
  let t = s.trim()
  if (/^[+-]?\d+,\d+$/.test(t)) t = t.replace(',', '.')
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * A calculated value written into a table (converted to values, extracted): 15 significant
 * digits, so floating-point noise (30.703124999999993) doesn't become data.
 */
export const tidyNumber = (v: number): number => Number(v.toPrecision(15))

/** A number as a text value (full precision). */
export const textFromNumber = (v: number): string => String(v)

// ---------------------------------------------------------------------------------------------
// Calculated text variables as text variables (roadmap 38)
// ---------------------------------------------------------------------------------------------

const withText = new WeakMap<DataTable, DataTable>()
const columnWithText = new WeakMap<
  DataSetColumn,
  { text: readonly (string | null)[]; ds: DataSetColumn }
>()

/**
 * The table as graphs, levels and splits read it: a calculated variable whose formula gives
 * text (recode, cut, concat…) carries its values as `text` (and no formula), so it is a text
 * variable to everything that reads levels. The table itself when it has none (the same object,
 * so nothing else changes); memoized per table object. Derived data: never stored.
 */
export function resolvedTable(table: DataTable): DataTable {
  if (
    table.tableKind !== 'multipleVariables' ||
    !table.dataSets.some((d) => d.formula !== undefined)
  )
    return table
  const hit = withText.get(table)
  if (hit) return hit
  const formulas = tableFormulas(table)
  let changed = false
  const dataSets = table.dataSets.map((ds) => {
    const text = ds.formula !== undefined ? formulas.get(ds.id)?.text : undefined
    if (!text) return ds
    changed = true
    const prev = columnWithText.get(ds)
    if (prev && prev.text === text) return prev.ds
    const { formula: _formula, ...rest } = ds
    const out: DataSetColumn = { ...rest, text }
    columnWithText.set(ds, { text, ds: out })
    return out
  })
  const out = changed ? { ...table, dataSets } : table
  withText.set(table, out)
  return out
}
