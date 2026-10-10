import {
  type ConstantValue,
  type FormulaNode,
  formulaNames,
  type InfoConstants,
  numberFromText,
  parseFormula,
} from './formula.ts'
import type { NodeId } from './ids.ts'
import type { InfoNode } from './other.ts'
import type { DocNode } from './project.ts'

// Info sheets (roadmap 40): label/value fields and notes about the experiment, and the fields as
// named constants in formulas (`[Info: dilution]`, `[Sheet name: dilution]`; decisions 595–597).

/** How labels and sheet names are matched: without case, spaces collapsed. */
const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The prefix naming "the first info sheet with this field". */
export const INFO_PREFIX = 'Info'

/** A field's value as a constant: a number, or why it isn't one. */
function fieldValue(sheet: InfoNode, label: string): ConstantValue | undefined {
  const field = sheet.fields.find((f) => key(f.label) === key(label))
  if (!field) return undefined
  if (!field.value.trim()) return { error: `the info field “${field.label}” is empty` }
  const v = numberFromText(field.value)
  return v === null
    ? { error: `the info field “${field.label}” isn’t a number (“${field.value.trim()}”)` }
    : { value: v }
}

/** The ways a bracketed name splits into a prefix and a label (at each colon). */
function splits(name: string): { prefix: string; label: string }[] {
  const out: { prefix: string; label: string }[] = []
  for (let i = name.indexOf(':'); i >= 0; i = name.indexOf(':', i + 1))
    out.push({ prefix: name.slice(0, i).trim(), label: name.slice(i + 1).trim() })
  return out
}

/** The info constants of these sheets (in navigator order). */
export function buildConstants(sheets: readonly InfoNode[]): InfoConstants {
  const byName = new Map<string, InfoNode>()
  for (const s of sheets) if (!byName.has(key(s.name))) byName.set(key(s.name), s)
  return {
    lookup(name) {
      for (const { prefix, label } of splits(name)) {
        if (!label) continue
        if (key(prefix) === key(INFO_PREFIX)) {
          for (const s of sheets) {
            const v = fieldValue(s, label)
            if (v) return v
          }
          return { error: `no info sheet has a field “${label}”` }
        }
        const sheet = byName.get(key(prefix))
        if (sheet)
          return fieldValue(sheet, label) ?? { error: `“${sheet.name}” has no field “${label}”` }
      }
      return null
    },
  }
}

/** A project's info sheets in navigator order. */
export function infoSheets(project: {
  nodes: Readonly<Record<string, DocNode>>
  order: readonly NodeId[]
}): InfoNode[] {
  return project.order.flatMap((id) => {
    const n = Object.hasOwn(project.nodes, id) ? project.nodes[id] : undefined
    return n?.kind === 'info' ? [n] : []
  })
}

/** Constants by the content of the sheets they come from (a few kept, most recent last). */
const recent = new Map<string, InfoConstants>()
const RECENT = 16

/**
 * The project's info constants: the same object for the same info sheets' names and fields in
 * the same order (so tables bound to them, and their formulas' values, stay memoized, whichever
 * project asked last).
 */
export function infoConstants(project: {
  nodes: Readonly<Record<string, DocNode>>
  order: readonly NodeId[]
}): InfoConstants {
  const sheets = infoSheets(project)
  const sig = JSON.stringify(sheets.map((s) => [s.name, s.fields]))
  const hit = recent.get(sig)
  if (hit) return hit
  const constants = buildConstants(sheets)
  recent.set(sig, constants)
  if (recent.size > RECENT) recent.delete(recent.keys().next().value!)
  return constants
}

/** The constants a formula reference panel lists: `[Info: label]` for each numeric field. */
export function constantList(
  sheets: readonly InfoNode[],
): { reference: string; sheet: string; label: string; value: string; number: boolean }[] {
  const seen = new Set<string>()
  const out: ReturnType<typeof constantList> = []
  for (const s of sheets)
    for (const f of s.fields) {
      if (!f.label.trim()) continue
      const first = !seen.has(key(f.label))
      seen.add(key(f.label))
      out.push({
        reference: first
          ? `[${INFO_PREFIX}: ${f.label.trim()}]`
          : `[${s.name.trim()}: ${f.label.trim()}]`,
        sheet: s.name,
        label: f.label,
        value: f.value,
        number: numberFromText(f.value) !== null,
      })
    }
  return out
}

/**
 * The formula with info references rewritten (roadmap 40: renames follow): `rename(prefix,
 * label)` gives the new `[prefix: label]` text inside the brackets, or null to leave it. Null
 * when nothing changed or the formula doesn't parse.
 */
export function renameInfoInFormula(
  formula: string,
  rename: (prefix: string, label: string) => string | null,
): string | null {
  let tree: FormulaNode
  try {
    tree = parseFormula(formula)
  } catch {
    return null
  }
  const edits: { start: number; end: number; text: string }[] = []
  for (const n of formulaNames(tree)) {
    if (n.k !== 'var' || n.bare) continue
    for (const { prefix, label } of splits(n.name)) {
      const to = rename(prefix, label)
      if (to !== null) {
        edits.push({ start: n.start, end: n.end, text: `[${to.replace(/\]/g, '')}]` })
        break
      }
    }
  }
  if (!edits.length) return null
  let out = formula
  for (const e of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out === formula ? null : out
}

/** An info reference of a formula and the sheet it reads (none: it names no sheet). */
export interface InfoRead {
  /** The table's data set whose formula holds it. */
  dataSet: string
  prefix: string
  label: string
  /** `[Info: label]` (the first sheet with the field), not `[Sheet name: label]`. */
  info: boolean
  sheet: InfoNode | undefined
}

/**
 * The info references in a table's formulas and the sheets they read, as `buildConstants`
 * resolves them against `sheets` (navigator order; audit 2, M5): `[Info: label]` the first sheet
 * with a field so labelled, `[Sheet name: label]` the first sheet so named. Bracketed names that
 * are the table's variables are not references.
 */
export function infoReads(
  table: { dataSets: readonly { id: string; title: string; formula?: string }[] },
  sheets: readonly InfoNode[],
): InfoRead[] {
  const titles = new Set(table.dataSets.map((d) => key(d.title)))
  const out: InfoRead[] = []
  for (const ds of table.dataSets) {
    if (ds.formula === undefined || !ds.formula.includes(':')) continue
    let tree: FormulaNode
    try {
      tree = parseFormula(ds.formula)
    } catch {
      continue
    }
    for (const n of formulaNames(tree)) {
      if (n.k !== 'var' || n.bare || titles.has(key(n.name))) continue
      for (const { prefix, label } of splits(n.name)) {
        if (!label) continue
        if (key(prefix) === key(INFO_PREFIX)) {
          const sheet = sheets.find((s) => s.fields.some((f) => key(f.label) === key(label)))
          out.push({ dataSet: ds.id, prefix, label, info: true, sheet })
          break
        }
        const sheet = sheets.find((s) => key(s.name) === key(prefix))
        if (sheet) {
          out.push({ dataSet: ds.id, prefix, label, info: false, sheet })
          break
        }
      }
    }
  }
  return out
}

/** Whether two labels or sheet names match as formulas match them. */
export const sameInfoName = (a: string, b: string) => key(a) === key(b)

/** Field templates for Insert › Info sheet (decision 594). */
export const INFO_TEMPLATES: readonly { id: string; name: string; labels: readonly string[] }[] = [
  { id: 'blank', name: 'Blank', labels: [] },
  {
    id: 'experiment',
    name: 'Experiment',
    labels: [
      'Date',
      'Investigator',
      'Notebook ref',
      'Protocol',
      'Cell line / strain',
      'Reagent lot',
    ],
  },
  {
    id: 'assay',
    name: 'Assay',
    labels: ['Date', 'Assay', 'Plate ID', 'Instrument', 'Dilution', 'Standard lot', 'Operator'],
  },
  {
    id: 'animal',
    name: 'Animal study',
    labels: ['Protocol number', 'Species / strain', 'Sex', 'Age', 'Housing', 'Treatment', 'Dose'],
  },
]

/** A new info sheet from a template. */
export function createInfoSheet(id: NodeId, name: string, template = 'blank'): InfoNode {
  const t = INFO_TEMPLATES.find((x) => x.id === template) ?? INFO_TEMPLATES[0]!
  return {
    kind: 'info',
    id,
    name,
    fields: t.labels.map((label) => ({ label, value: '' })),
    notes: '',
  }
}
