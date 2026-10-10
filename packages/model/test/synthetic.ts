import { mulberry32 } from '../../stats/test/rng.ts'
import { createTable } from '../src/factory.ts'
import type { ColumnId, NodeId } from '../src/ids.ts'
import type { DataTable } from '../src/table.ts'

// Synthetic single-cell / FACS tables (roadmap 34e), shaped like a CSV export of Seurat or Scanpy:
// a unique cell id, text samples, clusters and cell types, integer cluster numbers, a clustered 2D
// embedding (UMAP), principal components, counts and gene-like skewed numbers (mostly zeros, the
// rest log-normal). Deterministic for a seed; the same rows as a table or as CSV text, so an
// imported CSV can be compared with the table. Shared by the io, engine, graph and ui tests (and
// the profile), which import it by path.

export interface SyntheticOptions {
  rows: number
  /** Gene-like columns (default 20). */
  genes?: number
  /** Principal components (default 10). */
  pcs?: number
  /** Clusters (default 14). */
  clusters?: number
  /** A first column of unique cell ids (default true). */
  cellIds?: boolean
  seed?: number
}

export type SyntheticCell = number | string | null

export interface SyntheticColumn {
  title: string
  type: 'number' | 'text'
}

const SAMPLES = ['S1_ctrl', 'S2_ctrl', 'S3_ctrl', 'S4_stim', 'S5_stim', 'S6_stim']
const TYPES = ['CD4 naive', 'CD4 memory', 'CD8 naive', 'CD8 effector', 'Treg', 'NK', 'MAIT', 'gdT']
const BASES = 'ACGT'

export function syntheticColumns(o: SyntheticOptions): SyntheticColumn[] {
  const cols: SyntheticColumn[] = []
  if (o.cellIds ?? true) cols.push({ title: 'cell', type: 'text' })
  cols.push({ title: 'sample', type: 'text' }, { title: 'cluster', type: 'text' })
  cols.push({ title: 'cell_type', type: 'text' }, { title: 'seurat_clusters', type: 'number' })
  cols.push({ title: 'UMAP_1', type: 'number' }, { title: 'UMAP_2', type: 'number' })
  for (let k = 1; k <= (o.pcs ?? 10); k++) cols.push({ title: `PC_${k}`, type: 'number' })
  cols.push({ title: 'nCount_RNA', type: 'number' }, { title: 'nFeature_RNA', type: 'number' })
  cols.push({ title: 'percent.mt', type: 'number' })
  for (let k = 1; k <= (o.genes ?? 20); k++) cols.push({ title: `GENE${k}`, type: 'number' })
  return cols
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return r === 0 ? 0 : r
}

/** Each row's cells in column order, row by row (one pass of one generator). */
export function* syntheticRows(o: SyntheticOptions): Generator<SyntheticCell[]> {
  const u = mulberry32(o.seed ?? 34)
  const gauss = () => {
    const a = Math.max(u(), 1e-12)
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u())
  }
  const nClusters = o.clusters ?? 14
  const pcs = o.pcs ?? 10
  const genes = o.genes ?? 20
  // Cluster centres on the embedding, their spreads, and each cluster's cell type and gene means.
  const centres = Array.from({ length: nClusters }, () => [gauss() * 8, gauss() * 8, 0.5 + u()])
  const typeOf = Array.from({ length: nClusters }, (_, c) => TYPES[c % TYPES.length]!)
  const geneMean = Array.from({ length: nClusters }, () =>
    Array.from({ length: genes }, () => ({ on: 0.15 + 0.8 * u(), mu: gauss() * 0.6 })),
  )
  for (let r = 0; r < o.rows; r++) {
    const row: SyntheticCell[] = []
    // Skewed cluster sizes: lower clusters are bigger.
    const c = Math.min(nClusters - 1, Math.floor(nClusters * u() ** 1.6))
    const [cx, cy, spread] = centres[c]!
    if (o.cellIds ?? true) {
      let id = ''
      for (let k = 0; k < 16; k++) id += BASES[Math.floor(u() * 4)]
      row.push(`${id}-1_${(r % 6) + 1}`)
    }
    row.push(SAMPLES[Math.floor(u() * SAMPLES.length)]!, `C${c}`, typeOf[c]!, c)
    row.push(round(cx! + gauss() * spread!, 4), round(cy! + gauss() * spread!, 4))
    for (let k = 0; k < pcs; k++) row.push(round(gauss() * (pcs - k) * 0.7 + (c - 7) * 0.3, 5))
    const count = Math.round(Math.exp(7.5 + gauss() * 0.5))
    row.push(count, Math.round(count * (0.3 + 0.2 * u())))
    // About one cell in a hundred has no mitochondrial fraction (an empty cell).
    row.push(u() < 0.01 ? null : round(Math.abs(gauss() * 2 + 4), 3))
    for (let k = 0; k < genes; k++) {
      const g = geneMean[c]![k]!
      row.push(u() < g.on ? round(Math.exp(g.mu + gauss() * 0.7), 3) : 0)
    }
    yield row
  }
}

/** The CSV text of the rows, in chunks of about `chunkRows` rows (header first). */
export function* syntheticCsv(o: SyntheticOptions, chunkRows = 5000): Generator<string> {
  yield `${syntheticColumns(o)
    .map((c) => c.title)
    .join(',')}\n`
  let lines: string[] = []
  for (const row of syntheticRows(o)) {
    lines.push(row.map((v) => (v === null ? 'NA' : String(v))).join(','))
    if (lines.length >= chunkRows) {
      yield `${lines.join('\n')}\n`
      lines = []
    }
  }
  if (lines.length) yield `${lines.join('\n')}\n`
}

/** The whole CSV text (small sizes only). */
export const syntheticCsvText = (o: SyntheticOptions): string => [...syntheticCsv(o)].join('')

/**
 * The rows as a multiple-variables table with fixed ids (table `t1`, variables `v0`, `v1`…): text
 * columns as text variables, numbers as numeric ones (empty cells null).
 */
export function syntheticTable(o: SyntheticOptions): DataTable {
  const cols = syntheticColumns(o)
  const n = o.rows
  const numbers = cols.map((c) => (c.type === 'number' ? new Array<number | null>(n) : null))
  const texts = cols.map((c) => (c.type === 'text' ? new Array<string | null>(n) : null))
  let r = 0
  for (const row of syntheticRows(o)) {
    for (let k = 0; k < cols.length; k++) {
      const v = row[k]!
      if (numbers[k]) numbers[k]![r] = v as number | null
      else texts[k]![r] = v as string | null
    }
    r++
  }
  const table = createTable({ tableKind: 'multipleVariables', columns: 0, rows: 0 })
  table.id = 't1' as NodeId
  table.name = 'Synthetic cells'
  table.rowCount = n
  table.dataSets = cols.map((c, k) => {
    const empty = new Array<number | null>(n).fill(null)
    return {
      id: `v${k}` as ColumnId,
      title: c.title,
      subcolumns: [{ type: 'number' as const, values: numbers[k] ?? empty }],
      ...(texts[k] ? { text: texts[k]! } : {}),
    }
  })
  return table
}
