import type { PageTableCell, PageTableGrid } from '@ps/graph'
import {
  type AnalysisResult,
  type NodeId,
  nodeById,
  type PageTableSource,
  type Project,
  sourceTable,
} from '@ps/model'
import { cellOf, type Row } from './export/cells.ts'
import { resultSheetRows } from './export/results.ts'
import { tableRows } from './export/table.ts'

// Live tables on layout pages (roadmap 32): a data table (or an analysis' result table) laid out
// as the grid shows it, or a results sheet as the results view shows it, as rows of text for the
// page to draw. The page lays tables out again whenever the document or the results change.

/** A number as the page shows it: in full, without floating-point noise (0.1 + 0.2 → 0.3). */
const numberText = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(12))) : '')

function cells(rows: readonly Row[]): PageTableCell[][] {
  return rows.map((r) =>
    r.map((c): PageTableCell => {
      const cell = cellOf(c)
      const text =
        cell.text ?? (typeof cell.v === 'number' ? numberText(cell.v) : (cell.v ?? '').toString())
      return {
        text,
        ...(cell.style ? { style: cell.style } : {}),
        ...(typeof cell.v === 'number' ? { numeric: true } : {}),
      }
    }),
  )
}

/** The cells of a table item's source, or why there are none. */
export function pageTableGrid(
  project: Project,
  source: PageTableSource,
  result: (id: NodeId) => AnalysisResult | undefined,
): PageTableGrid {
  const node = nodeById(project.nodes, source.node)
  if (!node) return { error: 'its source was deleted' }
  if (source.kind === 'table') {
    const t = sourceTable(project, node.id, result)
    if (!t) return { error: node.kind === 'analysis' ? 'not computed yet' : 'no table' }
    return { rows: cells(tableRows(t, { excluded: 'blank' })) }
  }
  if (node.kind !== 'analysis') return { error: 'no results' }
  const r = result(node.id)
  if (!r) return { error: 'not computed yet' }
  const sheet = r.sheets.find((s) => s.key === source.sheet)
  if (!sheet) return { error: `“${node.name}” has no such results sheet` }
  // Audit 4 (G1; the user's answer Q2): as before 0.3.11 — no summary sentence, no table
  // captions (the sentence took the header's place, and both moved saved row ranges onto other
  // rows); the results view and exports keep them.
  const blocks = sheet.blocks.flatMap((b) =>
    b.type === 'summary'
      ? []
      : b.type === 'table' && b.caption
        ? [{ ...b, caption: undefined }]
        : [b],
  )
  return {
    rows: cells(
      resultSheetRows({ ...sheet, blocks }, { mode: 'displayed', settings: project.settings }),
    ),
  }
}
