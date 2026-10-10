import type { DataTable } from '@ps/model'

// A table's rows as graphs of it choose them (Rows on the graph, New graph › one per row).

/** A row's name: its title, its X value (XY tables), or its number. */
export function rowLabel(table: DataTable, r: number): string {
  const title = table.rowTitles?.[r]
  if (title) return title
  const x = table.x?.subcolumns[0]?.values[r]
  if (x !== undefined && x !== null && table.tableKind === 'xy') return `X = ${x}`
  return `Row ${r + 1}`
}

/** Rows that hold any value or a title (lists of rows leave out the empty rows below the data). */
export function usedRows(table: DataTable): number[] {
  const out: number[] = []
  for (let r = 0; r < table.rowCount; r++) {
    const any =
      table.dataSets.some((d) => d.subcolumns.some((c) => c.values[r] !== null)) ||
      !!table.rowTitles?.[r]
    if (any) out.push(r)
  }
  return out
}
