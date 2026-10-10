import {
  type FormulaNode,
  formulaReference,
  formulaText,
  numberFromText,
  parseFormula,
} from '@ps/model'

/*
 * Roadmap 38: Filter rows' condition editor. A condition is a formula of the formula language
 * (`filterRows.condition`); the editor builds one from rows of (variable, operator, value),
 * joined by AND within a group and OR between groups, and reads such a formula back to edit it.
 * Anything else is edited as typed text.
 */

type ConditionOp =
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'contains'
  | 'startswith'
  | 'blank'
  | 'notblank'

export interface Condition {
  /** The variable's title. */
  variable: string
  op: ConditionOp
  /** As typed: text, or a number for number variables. */
  value: string
}

/** OR of groups, each the AND of its conditions. */
export type ConditionGroups = Condition[][]

export const CONDITION_OPS: readonly {
  op: ConditionOp
  label: string
  text: boolean
  number: boolean
}[] = [
  { op: '=', label: 'is', text: true, number: true },
  { op: '<>', label: 'is not', text: true, number: true },
  { op: '>', label: '>', text: false, number: true },
  { op: '>=', label: '≥', text: false, number: true },
  { op: '<', label: '<', text: false, number: true },
  { op: '<=', label: '≤', text: false, number: true },
  { op: 'contains', label: 'contains', text: true, number: false },
  { op: 'startswith', label: 'starts with', text: true, number: false },
  { op: 'blank', label: 'is blank', text: true, number: true },
  { op: 'notblank', label: 'is not blank', text: true, number: true },
]

export const needsValue = (op: ConditionOp) => op !== 'blank' && op !== 'notblank'

/** One condition as a formula, or null when its value doesn't fit (a number variable's text). */
function conditionText(c: Condition, isText: boolean): string | null {
  const v = formulaReference(c.variable)
  if (c.op === 'blank') return `isblank(${v})`
  if (c.op === 'notblank') return `not isblank(${v})`
  if (isText) {
    const t = formulaText(c.value)
    if (c.op === 'contains' || c.op === 'startswith') return `${c.op}(${v}, ${t})`
    if (c.op !== '=' && c.op !== '<>') return null
    return `${v} ${c.op === '=' ? '=' : '<>'} ${t}`
  }
  const n = numberFromText(c.value)
  if (n === null || c.op === 'contains' || c.op === 'startswith') return null
  return `${v} ${c.op} ${n}`
}

/**
 * The formula of the groups (empty conditions left out), or null when a condition is
 * incomplete. Groups of several conditions are bracketed when there are several groups.
 */
export function conditionFormula(
  groups: ConditionGroups,
  isText: (variable: string) => boolean,
): string | null {
  const parts: string[] = []
  for (const g of groups) {
    const terms: string[] = []
    for (const c of g) {
      if (!c.variable) continue
      const t = conditionText(c, isText(c.variable))
      if (t === null) return null
      terms.push(t)
    }
    if (!terms.length) continue
    const and = terms.join(' and ')
    parts.push(groups.length > 1 && terms.length > 1 ? `(${and})` : and)
  }
  return parts.length ? parts.join(' or ') : null
}

const COMPARE = new Set(['=', '<>', '<', '<=', '>', '>='])

function readCondition(n: FormulaNode): Condition | null {
  if (n.k === 'bin' && COMPARE.has(n.op) && n.a.k === 'var') {
    const b = n.b
    const value =
      b.k === 'str'
        ? b.v
        : b.k === 'num'
          ? String(b.v)
          : b.k === 'neg' && b.a.k === 'num'
            ? String(-b.a.v)
            : null
    if (value === null) return null
    return { variable: n.a.name, op: n.op as ConditionOp, value }
  }
  if (n.k === 'call' && (n.fn === 'contains' || n.fn === 'startswith')) {
    const [a, b] = n.args
    if (a?.k === 'var' && b?.k === 'str') return { variable: a.name, op: n.fn, value: b.v }
  }
  if (n.k === 'call' && n.fn === 'isblank' && n.args[0]?.k === 'var')
    return { variable: n.args[0].name, op: 'blank', value: '' }
  if (n.k === 'call' && n.fn === 'not' && n.args[0]?.k === 'call' && n.args[0].fn === 'isblank') {
    const a = n.args[0].args[0]
    if (a?.k === 'var') return { variable: a.name, op: 'notblank', value: '' }
  }
  return null
}

/** The groups a formula written as the editor writes it describes; null for any other formula. */
export function parseCondition(formula: string): ConditionGroups | null {
  if (!formula.trim()) return [[]]
  let tree: FormulaNode
  try {
    tree = parseFormula(formula)
  } catch {
    return null
  }
  const ors = tree.k === 'call' && tree.fn === 'or' ? tree.args : [tree]
  const groups: ConditionGroups = []
  for (const g of ors) {
    const ands = g.k === 'call' && g.fn === 'and' ? g.args : [g]
    const conds: Condition[] = []
    for (const a of ands) {
      const c = readCondition(a)
      if (!c) return null
      conds.push(c)
    }
    groups.push(conds)
  }
  return groups
}
