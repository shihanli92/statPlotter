/** Throws unless x is a non-negative integer count. */
export function checkCount(x: number, what: string): void {
  if (!(Number.isInteger(x) && x >= 0)) {
    throw new Error(`${what} must be a non-negative integer count, got ${x}`)
  }
}

/**
 * Validates a contingency table (rows of non-negative integer counts, all the same length,
 * at least minRows × minCols) and returns it as plain arrays.
 */
export function checkTable(
  table: readonly (readonly number[])[],
  what: string,
  minRows = 2,
  minCols = 2,
): number[][] {
  const r = table.length
  const c = r > 0 ? table[0]!.length : 0
  if (r < minRows || c < minCols) {
    throw new Error(`${what}: table must be at least ${minRows} × ${minCols}, got ${r} × ${c}`)
  }
  return table.map((row, i) => {
    if (row.length !== c) throw new Error(`${what}: row ${i + 1} has ${row.length} cells, not ${c}`)
    return row.map((x) => {
      checkCount(x, `${what}: cell`)
      return x
    })
  })
}

/** Throws unless the table is exactly 2 × 2. */
export function check2x2(table: readonly (readonly number[])[], what: string): number[][] {
  const t = checkTable(table, what)
  if (t.length !== 2 || t[0]!.length !== 2) {
    throw new Error(`${what}: a 2 × 2 table is required, got ${t.length} × ${t[0]!.length}`)
  }
  return t
}

export function rowSums(t: readonly (readonly number[])[]): number[] {
  return t.map((row) => row.reduce((s, x) => s + x, 0))
}

export function colSums(t: readonly (readonly number[])[]): number[] {
  return t[0]!.map((_, j) => t.reduce((s, row) => s + row[j]!, 0))
}
