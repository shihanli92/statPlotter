import { type FormulaNode, formulaReference, formulaText, parseFormula } from '@ps/model'

/*
 * Roadmap 38: the formulas the data-manipulation dialogs of multiple-variables tables write as
 * calculated variables (decision 551): transforms of number variables, optionally within the
 * groups of a text variable; recoded text levels; bins of a number variable. Live with their
 * sources (the formula language), renamed with them (decision 98), converted to values on request.
 */

export type VariableTransform =
  | 'log10'
  | 'log2'
  | 'ln'
  | 'logK'
  | 'sqrt'
  | 'reciprocal'
  | 'zscore'
  | 'unit'
  | 'percent'
  | 'rank'
  | 'logit'
  | 'asinh'
  | 'minusMean'
  | 'minusMedian'
  | 'overMean'
  | 'overMedian'

interface TransformChoice {
  id: VariableTransform
  label: string
  /** The number it takes: a logarithm's base, arcsinh's cofactor. */
  k?: { label: string; value: number }
  /** Computed within each group of a text variable when one is chosen. */
  grouped?: boolean
  /** A short name for the new variable's title. */
  short: string
}

export const VARIABLE_TRANSFORMS: readonly TransformChoice[] = [
  { id: 'log10', label: 'log10(x)', short: 'log10' },
  { id: 'log2', label: 'log2(x)', short: 'log2' },
  { id: 'ln', label: 'ln(x), natural logarithm', short: 'ln' },
  { id: 'logK', label: 'Logarithm to base K', k: { label: 'Base', value: 10 }, short: 'log' },
  { id: 'sqrt', label: 'Square root', short: 'sqrt' },
  { id: 'reciprocal', label: 'Reciprocal, 1 / x', short: '1/x' },
  { id: 'zscore', label: 'z-score, (x − mean) / SD', grouped: true, short: 'z' },
  { id: 'unit', label: 'Normalize to 0–1 (min to max)', grouped: true, short: '0–1' },
  { id: 'percent', label: 'Normalize to % (min to max)', grouped: true, short: '%' },
  { id: 'rank', label: 'Rank (ties averaged)', grouped: true, short: 'rank' },
  { id: 'logit', label: 'logit(x) = ln(x / (1 − x))', short: 'logit' },
  {
    id: 'asinh',
    label: 'arcsinh(x / cofactor)',
    k: { label: 'Cofactor', value: 150 },
    short: 'asinh',
  },
  { id: 'minusMean', label: 'Subtract the mean', grouped: true, short: '− mean' },
  { id: 'minusMedian', label: 'Subtract the median', grouped: true, short: '− median' },
  { id: 'overMean', label: 'Divide by the mean', grouped: true, short: '/ mean' },
  { id: 'overMedian', label: 'Divide by the median', grouped: true, short: '/ median' },
]

const choice = (id: VariableTransform) => VARIABLE_TRANSFORMS.find((c) => c.id === id)!

/** The formula transforming the variable titled `x` (within the groups of `group`, when given). */
export function transformFormula(
  id: VariableTransform,
  x: string,
  k: number,
  group: string | null,
): string {
  const v = formulaReference(x)
  const g = group && choice(id).grouped ? `, ${formulaReference(group)}` : ''
  const lo = `minby(${v}${g})`
  const hi = `maxby(${v}${g})`
  switch (id) {
    case 'log10':
      return `=log10(${v})`
    case 'log2':
      return `=log2(${v})`
    case 'ln':
      return `=ln(${v})`
    case 'logK':
      return `=log(${v}, ${k})`
    case 'sqrt':
      return `=sqrt(${v})`
    case 'reciprocal':
      return `=1 / ${v}`
    case 'zscore':
      return `=zscore(${v}${g})`
    case 'unit':
      return `=(${v} - ${lo}) / (${hi} - ${lo})`
    case 'percent':
      return `=100 * (${v} - ${lo}) / (${hi} - ${lo})`
    case 'rank':
      return g ? `=rank(${v}, "average"${g})` : `=rank(${v})`
    case 'logit':
      return `=logit(${v})`
    case 'asinh':
      return `=asinh(${v} / ${k})`
    case 'minusMean':
      return `=${v} - meanby(${v}${g})`
    case 'minusMedian':
      return `=${v} - medianby(${v}${g})`
    case 'overMean':
      return `=${v} / meanby(${v}${g})`
    case 'overMedian':
      return `=${v} / medianby(${v}${g})`
  }
}

/** The new variable's title: "CD4 log2", "CD4 z by sample". */
export function transformTitle(
  id: VariableTransform,
  x: string,
  k: number,
  group: string | null,
): string {
  const c = choice(id)
  const short = id === 'logK' ? `log${k}` : id === 'asinh' ? `asinh/${k}` : c.short
  return `${x} ${short}${group && c.grouped ? ` by ${group}` : ''}`
}

// ---------------------------------------------------------------------------------------------
// Recode
// ---------------------------------------------------------------------------------------------

/**
 * Recodes the levels of `source`: each [old, new] pair renames (or, with a shared new level,
 * merges) a level; levels not listed are kept, or left blank with `unmapped: 'blank'` (then
 * every level to keep must be listed).
 */
export function recodeFormula(
  source: string,
  pairs: readonly (readonly [string, string])[],
  unmapped: 'keep' | 'blank',
): string {
  const used = pairs.filter(([from, to]) => unmapped === 'blank' || from !== to)
  const args = used.flatMap(([from, to]) => [formulaText(from), formulaText(to)])
  if (unmapped === 'blank') args.push('""')
  if (!args.length) return `=recode(${formulaReference(source)}, "", "")`
  return `=recode(${formulaReference(source)}, ${args.join(', ')})`
}

interface RecodeSpec {
  source: string
  pairs: [string, string][]
  unmapped: 'keep' | 'blank'
}

/** The recode a formula written by `recodeFormula` describes (for editing it again), else null. */
export function parseRecode(formula: string): RecodeSpec | null {
  let tree: FormulaNode
  try {
    tree = parseFormula(formula)
  } catch {
    return null
  }
  if (tree.k !== 'call' || tree.fn !== 'recode') return null
  const [x, ...rest] = tree.args
  if (x?.k !== 'var' || rest.some((a) => a.k !== 'str')) return null
  const texts = rest.map((a) => (a as { v: string }).v)
  const blank = texts.length % 2 === 1
  if (blank && texts[texts.length - 1] !== '') return null
  const pairs: [string, string][] = []
  for (let i = 0; i + 1 < texts.length; i += 2) {
    if (texts[i] === '' && texts[i + 1] === '') continue
    pairs.push([texts[i]!, texts[i + 1]!])
  }
  return { source: x.name, pairs, unmapped: blank ? 'blank' : 'keep' }
}

// ---------------------------------------------------------------------------------------------
// Bin
// ---------------------------------------------------------------------------------------------

export interface BinSpec {
  method: 'breaks' | 'width' | 'quantile'
  /** Cut points (method 'breaks'). */
  breaks?: readonly number[]
  /** Number of intervals (width, quantile). */
  n?: number
  /** Right-closed (a, b] (R's default) or left-closed [a, b). */
  closure: 'right' | 'left'
  /** Custom labels, one per interval; absent: "(a, b]" as R's cut. */
  labels?: readonly string[]
}

/** The formula cutting the variable titled `source` into intervals. */
export function binFormula(source: string, spec: BinSpec): string {
  const parts = [formulaReference(source)]
  if (spec.closure === 'left') parts.push('"[)"')
  if (spec.method === 'breaks') parts.push(...(spec.breaks ?? []).map(String))
  else parts.push(String(spec.n ?? 4))
  for (const l of spec.labels ?? []) parts.push(formulaText(l))
  const fn = spec.method === 'breaks' ? 'cut' : spec.method === 'width' ? 'cutwidth' : 'cutquantile'
  return `=${fn}(${parts.join(', ')})`
}

/** Cut points typed as text ("0, 10, 100" or "0 10 100"), ascending and distinct; null if not. */
export function parseBreaks(text: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const out = parts.map(Number)
  if (out.some((v) => !Number.isFinite(v))) return null
  out.sort((a, b) => a - b)
  if (out.some((v, i) => i > 0 && v === out[i - 1])) return null
  return out
}

/** Labels typed one per line or comma-separated (blank: automatic). */
export const parseLabels = (text: string): string[] =>
  text
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
