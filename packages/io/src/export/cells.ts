// Data and results out (roadmap 26): a neutral sheet — rows of cells — that the writers turn into
// CSV / TSV, an HTML table (the clipboard's rich text) or an Excel workbook.

/** A cell's value: a number (always written at full precision), text, or empty. */
export type ExportValue = number | string | null

export interface ExportCell {
  v: ExportValue
  /** How it reads in CSV, TSV and HTML when not the value itself: a rounded number, "<0.0001". */
  text?: string
  /** Excel number format showing the number as `text` does ('0.000', '0.00E+00'). */
  format?: string
  /** A section's title or a column title: bold (a title a little larger). */
  style?: 'title' | 'header'
  /** An excluded value: grey italic in Excel and HTML. */
  excluded?: boolean
  /** Workbooks: a link to another worksheet, by its index in the workbook. */
  link?: number
}

export type Cell = ExportValue | ExportCell
export type Row = Cell[]

export interface ExportSheet {
  /** The worksheet's name as wished (made valid and unique when written). */
  name: string
  rows: Row[]
}

export const cellOf = (c: Cell): ExportCell => (c !== null && typeof c === 'object' ? c : { v: c })

/** A cell as text: its display text, else the number in full, else the text. */
export function exportText(c: Cell): string {
  const { v, text } = cellOf(c)
  if (text !== undefined) return text
  return v === null ? '' : String(v)
}

export const title = (text: string): ExportCell => ({ v: text, style: 'title' })
export const header = (text: string): ExportCell => ({ v: text || null, style: 'header' })

/** A titled part of a sheet (a table, a block of results). */
export interface Section {
  title?: string
  rows: Row[]
}

/** Sections one under another, each under its title, with a blank row between. */
export function stackSections(sections: readonly Section[]): Row[] {
  const out: Row[] = []
  for (const s of sections) {
    if (out.length) out.push([])
    if (s.title !== undefined) out.push([title(s.title)])
    for (const r of s.rows) out.push(r) // no spread: a sheet can have 100k+ rows
  }
  return out
}

/** The widest row's length. A reduce: a sheet can have more rows than a call takes arguments. */
export const widthOf = (rows: readonly Row[]) => rows.reduce((w, r) => Math.max(w, r.length), 0)
