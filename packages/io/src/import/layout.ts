import { clean, filled, isText } from './cells.ts'
import type { ImportTableKind, Sheet, SheetCell } from './sheet.ts'

/**
 * How a block of a sheet maps onto a table, read from its structure: title lines, one or two
 * header rows, rows of values, and annotation rows ("P value", "Statistical test") that end it.
 * Every data set lists exactly the columns holding its values, so data sets of different widths,
 * skipped annotation columns and super-headers need no fixed replicate count.
 */
export interface BlockLayout {
  kind: ImportTableKind
  /**
   * columns: each row is a row of the table, a data set's columns its replicates.
   * flat: one row of values; a data set's values are its cells in that row (a column table).
   * rows: each row is a data set, its values running across (a column table).
   * pairs: survival data as (time, event) column pairs, one pair per group.
   */
  orient: 'columns' | 'flat' | 'rows' | 'pairs'
  /** Rows holding values, in order. */
  rows: number[]
  /** Column holding row titles (grouped, column) or X (XY, survival); null when there is none. */
  labelCol: number | null
  /** Title of the X column (XY, survival). */
  xTitle?: string
  sets: { title: string; cols: number[]; row?: number; xCol?: number }[]
}

export interface ParsedBlock {
  title: string | null
  range: { r0: number; c0: number; r1: number; c1: number }
  layout: BlockLayout
}

/** Tokens that stand for a missing value inside data. */
const MISSING = /^(na|n\/a|#n\/a|nan|nd|n\.d\.?|null|-|—|–|\.|none)$/i
/** Numbers, including numeric text ("12", "0.5"), but not labels like "P1". */
const isNum = (v: SheetCell | undefined) =>
  typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d+(\.\d+)?([eE]-?\d+)?\s*$/.test(v))
const text = (v: SheetCell | undefined) => (v === null || v === undefined ? '' : clean(String(v)))

/** Rows or columns that report tests rather than data. */
const ANNOTATION =
  /^(p[\s._-]*val|p[\s-]*adj|adj(usted)?[\s._-]*p|q[\s._-]*val|fdr\b|p\s*[=<>]|statistic|stat(istical)?\s*test|test\s*(used|:)|significan)/i
export const isAnnotation = (s: string) => ANNOTATION.test(clean(s))
/** Summary rows under the values ("Mean", "SD"); as columns (mean | SD) they are data. */
const SUMMARY = /^(mean|average|median|sd|s\.d\.|stdev|std\.?\s*dev|sem|s\.e\.m\.|se)(?![a-z])/i
const isFooter = (s: string) => isAnnotation(s) || SUMMARY.test(clean(s))

/** Replicate labels: "Experiment 1", "Triplicate #2", "Rep 3", "Mouse 4", "Image 12", "#5", "P1". */
const REPLICATE =
  /^(#?\s*\d+|[a-z]{1,3}\s*#?\d+|(exp(eriment)?|rep(licate)?|triplicate|duplicate|mouse|mice|animal|donor|patient|subject|sample|well|image|field|run|biological\s*replicate|technical\s*replicate|n)\s*#?\s*\d+)$/i
const replicateLike = (labels: string[]) =>
  labels.length > 0 &&
  labels.filter((l) => REPLICATE.test(l)).length >= Math.ceil(labels.length * 0.6)

/** Header words that mark a column as X (time, dose…). */
const X_WORD =
  /(^x$|\btime\b|\bdays?\b|\bhours?\b|\bhrs?\b|\bweeks?\b|\bmonths?\b|\bminutes?\b|\bmin\b|\bseconds?\b|\bdose\b|\bconc(entration)?\b|\bage\b|\bdistance\b|\bsurvival\b|\(\s*(d|h|hrs?|min|s|days?|hours?|weeks?|µm|um|nm|mm|mg\/kg)\s*\)|\bpost[\s-]infection\b|\bdpi\b|\bhpi\b)/i
const isXTitle = (s: string) => X_WORD.test(s)

/**
 * Reads a block (rows r0..r1, columns c0..c1, all non-empty rows) into a layout, or null when it
 * doesn't look like a table of values (the caller then falls back to plain range import).
 * `pending` is a title line found above the block.
 */
export function parseBlock(
  sheet: Sheet,
  seg: { r0: number; r1: number; c0: number; c1: number },
  pending: string | null,
): ParsedBlock | null {
  const R = sheet.rows
  let { c0, c1 } = seg
  const { r0, r1 } = seg
  const colEmpty = (c: number) => {
    for (let r = r0; r <= r1; r++) if (filled(R[r]![c])) return false
    return true
  }
  while (c0 < c1 && colEmpty(c0)) c0++
  while (c1 > c0 && colEmpty(c1)) c1--
  // Columns labelled as statistics in the header ("P-value WT/WT vs …", "Statistical test"),
  // counted only where statistics sit: right of the values, with nothing but other statistics or
  // text beyond them.
  let firstNumRow = r1 + 1
  for (let r = r0; r <= r1 && firstNumRow > r1; r++)
    for (let c = c0; c <= c1; c++) if (typeof R[r]![c] === 'number') firstNumRow = r
  const labelled = new Set<number>()
  for (let r = r0; r < firstNumRow; r++) {
    let seen = false
    for (let c = c0; c <= c1; c++) {
      if (!filled(R[r]![c])) continue
      if (seen && isText(R[r]![c]) && isAnnotation(text(R[r]![c]))) labelled.add(c)
      seen = true
    }
  }
  // Columns of text right of all the values (a test's name, notes) are left out too.
  const annotationCols = new Set<number>()
  for (let c = c1; c >= c0; c--) {
    let nums = false
    let texts = false
    for (let r = firstNumRow; r <= r1; r++) {
      if (isNum(R[r]![c])) nums = true
      else if (isText(R[r]![c]) && !MISSING.test(text(R[r]![c]))) texts = true
    }
    if (labelled.has(c) || (texts && !nums)) annotationCols.add(c)
    else if (nums) break
  }
  const cells = (r: number) => {
    const out: number[] = []
    for (let c = c0; c <= c1; c++) if (!annotationCols.has(c) && filled(R[r]![c])) out.push(c)
    return out
  }

  // ---- Walk the rows: title lines, header rows, value rows; stop at annotations or footers.
  const titles: string[] = pending ? [pending] : []
  const headers: number[] = []
  const data: number[] = []
  // Rows labelled as statistics or summaries end the values only where those sit: below them,
  // with nothing but other statistics or text after them. A row titled "SD" (a rat strain) or
  // "P1" among the others stays.
  const labelOf = (r: number) => {
    const cs = cells(r)
    const first = cs.length ? R[r]![cs[0]!] : null
    return isText(first) ? clean(first) : ''
  }
  const footerFrom = (r: number) => {
    for (let q = r; q <= r1; q++)
      if (!isFooter(labelOf(q)) && cells(q).some((c) => isNum(R[q]![c]))) return false
    return true
  }
  for (let r = r0; r <= r1; r++) {
    const cs = cells(r)
    if (!cs.length) {
      if (data.length) break
      continue
    }
    const first = R[r]![cs[0]!]
    const firstText = isText(first) ? clean(first) : ''
    const nums = cs.filter((c) => isNum(R[r]![c]))
    const textBeyond = cs.some(
      (c) => c > cs[0]! && isText(R[r]![c]) && !isNum(R[r]![c]) && !MISSING.test(text(R[r]![c])),
    )
    if (data.length && firstText && isFooter(firstText) && footerFrom(r)) break
    if (!data.length) {
      if (!nums.length && cs.length === 1 && !headers.length) {
        titles.push(firstText || text(first))
        continue
      }
      // A header: labels beyond the first column (numeric labels such as doses may sit among them).
      if (!nums.length || (textBeyond && nums.length < cs.length)) {
        headers.push(r)
        continue
      }
      data.push(r)
      continue
    }
    // Values: numbers, with text (a row title) only in the label column.
    if (nums.length && !textBeyond) data.push(r)
    else break
  }
  if (!data.length) return null

  // A lone line above a single column of values names that column, not the table.
  const valueCols = (() => {
    const set = new Set<number>()
    for (const r of data)
      for (let c = c0; c <= c1; c++) if (!annotationCols.has(c) && isNum(R[r]![c])) set.add(c)
    return [...set].sort((a, b) => a - b)
  })()
  let singleName: string | null = null
  if (!headers.length && valueCols.length === 1 && titles.length > (pending ? 1 : 0)) {
    singleName = titles.pop()!
  }

  // ---- The label column: the leftmost column with anything in the value rows; text there is
  // row titles, numbers under an X-like title are X, unlabelled numbers are row labels.
  let firstCol = c1
  for (const r of data) {
    const cs = cells(r)
    if (cs.length) firstCol = Math.min(firstCol, cs[0]!)
  }
  const firstVals = data.map((r) => R[r]![firstCol])
  const firstIsText =
    firstVals.every((v) => !filled(v) || (isText(v) && !isNum(v))) && firstVals.some(filled)
  const firstIsNum = firstVals.every((v) => isNum(v)) && firstVals.length > 0
  const headerAt = (c: number) => headers.map((h) => text(R[h]![c])).filter(Boolean)
  const firstHeader = headerAt(firstCol)

  // Which header row holds data set titles; a replicate sub-header or a super-header above it.
  const dataColsAll = valueCols.filter((c) => c !== firstCol || (!firstIsText && !firstIsNum))
  const labelsIn = (h: number, cols: number[]) =>
    cols
      .map((c) => R[h]![c])
      .filter(filled)
      .map(text)
  let titleRow: number | null = headers.length ? headers[headers.length - 1]! : null
  let superRow: number | null = null
  const measure: string[] = []
  // Is the first column labels (text, X, or unlabelled numbers left of the titles) or values?
  const lastHeader = headers.length ? headers[headers.length - 1]! : null
  const firstIsLabel =
    firstIsText ||
    (firstIsNum &&
      (headers.some((h) => range(c0, firstCol).some((c) => isXTitle(text(R[h]![c])))) ||
        (lastHeader !== null && !text(R[lastHeader]![firstCol]))))
  let subRow: number | null = null
  if (headers.length >= 2) {
    const sub = headers[headers.length - 1]!
    const top = headers[headers.length - 2]!
    const subLabels = labelsIn(sub, dataColsAll)
    const topLabels = labelsIn(top, range(firstIsLabel ? firstCol + 1 : firstCol, c1))
    if (replicateLike(subLabels)) {
      titleRow = top
      subRow = sub
    } else if (topLabels.length >= 2) superRow = top
    else if (topLabels.length === 1) measure.push(topLabels[0]!)
  }
  const titleFirst = titleRow !== null ? text(R[titleRow]![firstCol]) : ''
  const firstIsLabelFinal =
    firstIsText ||
    (firstIsNum &&
      (headers.some((h) => range(c0, firstCol).some((c) => isXTitle(text(R[h]![c])))) ||
        (!titleFirst && titleRow !== null)))
  // Header text left of the values names what was measured ("P-TBK1/TBK1", "RLU"); a label right
  // over the row titles ("Genotype", "Condition") is only a fallback title.
  let corner = ''
  for (const h of headers) {
    for (let c = c0; c <= firstCol; c++) {
      if (c === firstCol && !firstIsLabelFinal) continue
      const t = text(R[h]![c])
      if (!t || isXTitle(t) || (h === subRow && c >= firstCol)) continue
      const atCorner =
        (c === firstCol && firstIsLabelFinal) ||
        (h === titleRow && c === firstCol - 1 && !firstIsLabelFinal)
      if (atCorner) corner ||= t
      else measure.push(t)
    }
  }

  // ---- Label column kind.
  let labelCol: number | null = null
  let xTitle: string | undefined
  let kind: ImportTableKind = 'column'
  const titleAtFirst = titleRow !== null ? text(R[titleRow]![firstCol]) : ''
  if (firstIsText) labelCol = firstCol
  else if (firstIsNum) {
    const xHeader = headers
      .flatMap((h) => range(c0, firstCol).map((c) => text(R[h]![c])))
      .find(isXTitle)
    if (xHeader && !firstHeader.some((t) => t !== xHeader && !isXTitle(t) && t === titleAtFirst)) {
      labelCol = firstCol
      xTitle = xHeader
    } else if (!titleAtFirst && titleRow !== null) {
      // Unlabelled numbers left of the data set titles: time points or doses as row labels.
      labelCol = firstCol
    }
  }
  const cornerLabel = xTitle ? '' : corner

  // ---- Data set columns from the title row.
  const dataCols = valueCols.filter((c) => c !== labelCol && !annotationCols.has(c))
  if (!dataCols.length) return null
  let sets: BlockLayout['sets'] = []
  if (titleRow !== null) {
    const starts = range(labelCol === null ? firstCol : c0, c1).filter(
      (c) =>
        c !== labelCol &&
        !annotationCols.has(c) &&
        filled(R[titleRow!]![c]) &&
        (labelCol === null || c > labelCol),
    )
    // Titles over the label column (a corner label) don't start a data set.
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i]!
      const to = i + 1 < starts.length ? starts[i + 1]! - 1 : c1
      const cols = dataCols.filter((c) => c >= from && c <= to)
      if (cols.length) sets.push({ title: text(R[titleRow]![from]), cols })
    }
    // Columns before the first title: their own data sets.
    const before = dataCols.filter((c) => c < (starts[0] ?? c1 + 1))
    if (before.length && sets.length) return null
  }
  if (!sets.length) sets = dataCols.map((c) => ({ title: '', cols: [c] }))
  if (singleName && sets.length === 1) sets[0]!.title = singleName
  if (superRow !== null) {
    // "uninfected · AAV-Vector": the super-header spans the titles below it.
    const tops = range(c0, c1).filter((c) => c !== labelCol && filled(R[superRow!]![c]))
    for (const s of sets) {
      const top = [...tops].reverse().find((c) => c <= s.cols[0]!)
      if (top !== undefined)
        s.title = s.title ? `${text(R[superRow]![top])} · ${s.title}` : text(R[superRow]![top])
    }
  }

  // ---- Orientation and table kind.
  let orient: BlockLayout['orient'] = 'columns'
  const rowLabels = labelCol !== null ? data.map((r) => text(R[r]![labelCol!])) : []
  const widest = Math.max(...sets.map((s) => s.cols.length))
  if (labelCol !== null && xTitle !== undefined) {
    // X: survival when each row marks one group with 0/1 (staggered), else XY.
    const codes = data.every((r) => {
      const vals = sets.flatMap((s) => s.cols.map((c) => R[r]![c])).filter(filled)
      return (
        vals.length === 1 && (vals[0] === 0 || vals[0] === 1 || vals[0] === '0' || vals[0] === '1')
      )
    })
    kind = codes && sets.every((s) => s.cols.length === 1) ? 'survival' : 'xy'
  } else if (titleRow === null && labelCol !== null && firstIsText) {
    // No header: each row is a group with its values across.
    orient = 'rows'
    sets = data.map((r) => ({
      title: text(R[r]![labelCol!]),
      cols: dataCols.filter((c) => filled(R[r]![c])),
      row: r,
    }))
    labelCol = null
  } else if (data.length === 1 && (widest > 1 || labelCol !== null)) {
    // One row of values: a column table of each data set's cells.
    orient = 'flat'
    if (labelCol !== null && rowLabels[0]) measure.push(rowLabels[0])
    labelCol = null
  } else if (labelCol !== null && firstIsText && widest === 1 && replicateLike(rowLabels)) {
    // Rows are replicates (Image 1…, Mouse 2…): a column table; the labels stay as row titles.
    kind = 'column'
  } else if (labelCol !== null || widest > 1) {
    kind = 'grouped'
  }

  // Survival from side-by-side (time, event) pairs: X-like titles alternating with group names.
  if (titleRow !== null && orient === 'columns') {
    const heads = range(c0, c1).filter((c) => filled(R[titleRow!]![c]))
    const xs = heads.filter((c) => isXTitle(text(R[titleRow!]![c])))
    if (xs.length >= 2 && xs.every((c) => isNum(R[data[0]!]![c]) || !filled(R[data[0]!]![c]))) {
      const pairs = xs
        .map((x) => ({ x, ev: heads.find((c) => c > x && !xs.includes(c)) }))
        .filter((p): p is { x: number; ev: number } => p.ev !== undefined)
      const binary = pairs.every((p) =>
        data.every((r) => !filled(R[r]![p.ev]) || [0, 1, '0', '1'].includes(R[r]![p.ev] as never)),
      )
      if (pairs.length >= 2 && binary) {
        return {
          title: joinTitle(titles, measure, null),
          range: { r0, c0, r1: data[data.length - 1]!, c1 },
          layout: {
            kind: 'survival',
            orient: 'pairs',
            rows: data,
            labelCol: null,
            xTitle: text(R[titleRow]![pairs[0]!.x]),
            sets: pairs.map((p) => ({ title: text(R[titleRow!]![p.ev]), cols: [p.ev], xCol: p.x })),
          },
        }
      }
    }
  }

  // Data sets without any value (a group left empty) carry nothing to analyse.
  sets = sets.filter((s) =>
    orient === 'rows' ? s.cols.length > 0 : data.some((r) => s.cols.some((c) => filled(R[r]![c]))),
  )
  if (!sets.length) return null
  if (orient === 'flat' || orient === 'rows') kind = 'column'

  return {
    title: joinTitle(titles, measure, cornerLabel || null),
    range: { r0, c0, r1: data[data.length - 1]!, c1 },
    layout: { kind, orient, rows: data, labelCol, ...(xTitle ? { xTitle } : {}), sets },
  }
}

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

/** "Fig.1c – IFN-β protein level", without repeats. */
function joinTitle(titles: string[], measure: string[], corner: string | null): string | null {
  const parts: string[] = []
  for (const t of [...titles, ...measure]) if (t && !parts.includes(t)) parts.push(t)
  if (!parts.length && corner) parts.push(corner)
  return parts.length ? parts.join(' – ') : null
}
