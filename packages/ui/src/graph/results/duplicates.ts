import { type GraphNode, graphRefs, type NodeId, type Project } from '@ps/model'

// Roadmap 51c (design §7.5): P values on one graph from two or more analyses comparing the same
// two groups (the same data sets, at the same rows or X, pooled the same way) — a sign that tests
// were tried until one gave a small P. Derived from the graph and its analyses, never stored;
// read through `graphRefs` (its brackets and the analyses its layers draw).

export interface DuplicateComparison {
  /** What is compared (groups, rows or X), as a key. */
  key: string
  graph: NodeId
  graphName: string
  /** The two sides' titles. */
  a: string
  b: string
  /** The analyses that test it, with their names; what each draws on the graph. */
  tests: { analysis: NodeId; name: string; on: { bracket?: string; layer?: string } }[]
}

/** The text of a duplicate: "2 tests of Control vs Treated shown". */
export const duplicateText = (d: DuplicateComparison) =>
  `${d.tests.length} tests of ${d.a} vs ${d.b} shown`

/** Every comparison a graph shows from two or more analyses. */
export function duplicateComparisons(graph: GraphNode, project: Project): DuplicateComparison[] {
  const table = project.nodes[graph.seriesSource.table]
  const title = (k: string) =>
    (table?.kind === 'table' && table.dataSets.find((d) => d.id === k)?.title) || k
  const side = (keys: readonly string[]) => [...keys].sort().join('+')
  const groups = new Map<string, { a: string; b: string; tests: DuplicateComparison['tests'] }>()
  const add = (
    left: readonly string[],
    right: readonly string[],
    where: string,
    analysis: NodeId,
    on: { bracket?: string; layer?: string },
  ) => {
    const [s1, s2] = [side(left), side(right)].sort()
    const key = `${s1}~${s2}@${where}`
    let g = groups.get(key)
    if (!g) {
      g = { a: left.map(title).join(' + '), b: right.map(title).join(' + '), tests: [] }
      groups.set(key, g)
    }
    if (g.tests.some((t) => t.analysis === analysis)) return
    const node = project.nodes[analysis]
    g.tests.push({ analysis, name: node?.name ?? analysis, on })
  }
  for (const ref of graphRefs(graph)) {
    if (ref.kind === 'bracket') {
      const br = ref.annotation
      if (br.label.source !== 'analysis') continue
      const where = `${br.rowA ?? ''}|${br.rowB ?? ''}|${br.x ?? ''}`
      add([br.a, ...(br.group ?? [])], [br.b], where, br.label.analysis, { bracket: br.id })
    } else if (ref.kind === 'analysis' && ref.path[0] === 'layers') {
      // A label of a two-group test's results (its P) drawn on the graph.
      const node = project.nodes[ref.node]
      if (node?.kind !== 'analysis' || node.input.dataSets.length !== 2) continue
      if (node.input.source !== graph.seriesSource.table) continue
      const [x, y] = node.input.dataSets as [string, string]
      const pooled = node.input.pools?.find((p) => p.includes(x))
      const layer = graph.layers[Number(ref.path[1])]?.id
      add(pooled ?? [x], [y], `||${node.input.atX ?? ''}`, node.id, { ...(layer ? { layer } : {}) })
    }
  }
  const out: DuplicateComparison[] = []
  for (const [key, g] of groups)
    if (g.tests.length >= 2)
      out.push({ key, graph: graph.id, graphName: graph.name, a: g.a, b: g.b, tests: g.tests })
  return out
}
