import {
  type Aes,
  type DataTable,
  type GraphNode,
  type Project,
  type ResultLookup,
  sourceTable,
} from '@ps/model'
import { sizeScale } from '../../aesthetics.ts'
import { graphRows, variableValues } from '../../data.ts'
import { Extent } from '../../layout/common.ts'

// Variables mapped to aesthetics (multiple-variables tables): one mark per row, at its X and Y
// variables, sized by the size variable and coloured by the colour variable (the scales:
// `aesthetics.ts`, roadmap 34b). Rows missing X, Y or the size variable are left out (a row
// without a colour value is drawn in the missing colour). The bubble plot's data.

export interface BubbleVariables {
  x?: string
  y?: string
  size?: string
  color?: string
}

/**
 * The variables mapped: those chosen that the table has, else X = the first variable and Y = the
 * second (no size or colour variable).
 */
export function pickVariables(b: Aes, table: DataTable): BubbleVariables {
  const keys = new Set(table.dataSets.map((d) => d.id as string))
  const pick = (k: string | undefined) => (k && keys.has(k) ? k : undefined)
  return {
    x: pick(b.x) ?? table.dataSets[0]?.id,
    y: pick(b.y) ?? table.dataSets[1]?.id,
    size: pick(b.size),
    color: pick(b.color),
  }
}

export interface BubbleRow {
  /** Table row (the point key's row). */
  row: number
  x: number
  y: number
  size: number
  /** The colour variable's value, or its category's index when it is a text variable. */
  color: number
}

export interface BubbleData {
  table: DataTable | undefined
  vars: BubbleVariables
  rows: BubbleRow[]
  titles: Record<string, string>
  /** A text colour variable's categories, in order of first appearance (`BubbleRow.color`). */
  categories?: string[]
}

/** A text column's rows as category indices, per column array and row count (audit 3, P4). */
const coding = new WeakMap<
  readonly (string | null)[],
  Map<number, { index: Float64Array; categories: string[] }>
>()

/**
 * Each row's category: the index of its trimmed text among the texts in order of first
 * appearance (NaN when empty), and those texts. Kept per column array (documents are immutable),
 * so a layout after an edit of the graph doesn't read a million rows' texts again.
 */
function categoriesOf(
  text: readonly (string | null)[],
  rowCount: number,
): { index: Float64Array; categories: string[] } {
  let byCount = coding.get(text)
  const hit = byCount?.get(rowCount)
  if (hit) return hit
  const categories: string[] = []
  const at = new Map<string, number>()
  const index = Float64Array.from({ length: rowCount }, (_, r) => {
    const t = text[r]?.trim()
    if (!t) return Number.NaN
    let k = at.get(t)
    if (k === undefined) {
      k = categories.length
      at.set(t, k)
      categories.push(t)
    }
    return k
  })
  const out = { index, categories }
  if (!byCount) {
    byCount = new Map()
    coding.set(text, byCount)
  }
  byCount.set(rowCount, out)
  return out
}

/** The rows of a mapped graph (`aes` picks the variables from the table). */
export function aesRows(
  project: Project,
  graph: Pick<GraphNode, 'seriesSource'>,
  result: ResultLookup | undefined,
  aes: (table: DataTable) => BubbleVariables,
): BubbleData {
  const table = sourceTable(project, graph.seriesSource.table, result)
  if (!table) return { table, vars: {}, rows: [], titles: {} }
  const vars = aes(table)
  const values = (key: string | undefined) => variableValues(table, key)
  // A text colour variable: each row's category index (NaN when empty).
  const colorText = table.dataSets.find((d) => d.id === vars.color)?.text
  const coded = colorText ? categoriesOf(colorText, table.rowCount) : undefined
  const categories = coded?.categories
  const cs = coded ? coded.index : values(vars.color)
  const [xs, ys, ss] = [values(vars.x), values(vars.y), values(vars.size)]
  const rows: BubbleRow[] = []
  if (xs && ys) {
    const shown = graphRows(graph, table)
    const n = shown ? shown.length : table.rowCount
    for (let i = 0; i < n; i++) {
      const r = shown ? shown[i]! : i
      const row = {
        row: r,
        x: xs[r]!,
        y: ys[r]!,
        size: ss ? ss[r]! : 0,
        color: cs ? cs[r]! : 0,
      }
      if (Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.size))
        rows.push(row)
    }
  }
  const titles = Object.fromEntries(table.dataSets.map((d) => [d.id, d.title]))
  return { table, vars, rows, titles, ...(categories ? { categories } : {}) }
}

/** X or Y extent of a bubble plot (bubble centres). */
export function bubbleExtent(d: BubbleData, axis: 'x' | 'y', log: boolean): Extent {
  const e = new Extent(log)
  for (const r of d.rows) e.add(axis === 'x' ? r.x : r.y)
  return e
}

/**
 * Bubble diameters for the size values (`sizeScale` by area over the data's range): area
 * proportional to the value when none is negative (the largest `max` points across, none smaller
 * than `min`), else area rising linearly from `min` at the smallest value to `max` at the largest.
 */
export const bubbleSizer = (values: readonly number[], max: number, min: number) =>
  sizeScale(values, { max, min })
