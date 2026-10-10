import type { AnalysisResult, NodeId, PageTableSource, Project } from '@ps/model'

// What a live table on a page can show (roadmap 32): every data table, every result table and
// every results sheet, in navigator order.

export interface TableSourceChoice {
  value: string
  label: string
  source: PageTableSource
}

/** A source as a select value. */
export const sourceKey = (s: PageTableSource): string =>
  s.kind === 'table' ? `table:${s.node}` : `results:${s.node}:${s.sheet}`

export function tableSourceChoices(
  project: Project,
  result: (id: NodeId) => AnalysisResult | undefined,
): TableSourceChoice[] {
  return project.order.flatMap((id): TableSourceChoice[] => {
    const n = project.nodes[id]
    if (n?.kind === 'table') {
      const source = { kind: 'table' as const, node: n.id }
      return [{ value: sourceKey(source), label: `${n.name} (data)`, source }]
    }
    if (n?.kind !== 'analysis') return []
    const r = result(n.id)
    const out: TableSourceChoice[] = []
    if (r?.table) {
      const source = { kind: 'table' as const, node: n.id }
      out.push({ value: sourceKey(source), label: `${n.name} (result table)`, source })
    }
    for (const sh of r?.sheets ?? []) {
      const source = { kind: 'results' as const, node: n.id, sheet: sh.key }
      out.push({ value: sourceKey(source), label: `${n.name} – ${sh.title}`, source })
    }
    return out
  })
}
