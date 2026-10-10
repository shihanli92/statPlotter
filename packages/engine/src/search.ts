import {
  type DocNode,
  type NodeId,
  nodeById,
  type Project,
  richPlain,
  type TextSpec,
} from '@ps/model'

// Project search (roadmap 40, decisions 598–599): sheet names, notes, info fields, column and
// variable titles, graph and axis titles, text on layout pages and analysis names — never cell
// values, so a search costs the same whatever the tables' sizes (a CPU-growth guard checks it).

/** Where a match is, for jumping to it. */
export type SearchTarget =
  | { kind: 'name' }
  | { kind: 'notes' }
  | { kind: 'column'; column: string }
  | { kind: 'field'; index: number; part: 'label' | 'value' }
  | { kind: 'graphTitle' }
  | { kind: 'axisTitle'; axis: 'x' | 'y' | 'y2' }
  | { kind: 'pageText'; item: string }
  | { kind: 'analysis' }

export interface SearchHit {
  /** What the text is ("Sheet name", "Column title", "Y axis title", "Info field"…). */
  label: string
  /** The text, cut round the match for long ones. */
  before: string
  match: string
  after: string
  score: number
  target: SearchTarget
}

/** The matches in one sheet, best first. */
export interface SheetHits {
  node: NodeId
  kind: DocNode['kind']
  name: string
  score: number
  hits: SearchHit[]
}

export interface SearchOptions {
  /** An analysis' plugin title ("Unpaired t test"), searched as its analysis name. */
  analysisTitle?: (analysisId: string) => string | undefined
  /** Most matches listed per sheet (default 20). */
  perSheet?: number
}

/** Lower case without accents, for matching. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** How well `text` matches `query` (folded), 0 for no match; where the match is. */
function matchScore(text: string, q: string): { score: number; at: number; len: number } | null {
  const t = fold(text)
  if (!q) return null
  const at = t.indexOf(q)
  if (at >= 0) {
    const score = t === q ? 100 : at === 0 ? 80 : /[\s\p{P}]/u.test(t[at - 1] ?? '') ? 60 : 40
    return { score, at, len: q.length }
  }
  // Every word of the query somewhere in the text.
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length < 2) return null
  const first = t.indexOf(words[0]!)
  if (first < 0 || !words.every((w) => t.includes(w))) return null
  return { score: 30, at: first, len: words[0]!.length }
}

/** Characters of context either side of a match in a long text. */
const CONTEXT = 30

function hitOf(
  text: string,
  q: string,
  label: string,
  target: SearchTarget,
  weight: number,
): SearchHit | null {
  // Folding keeps the length of most text; where it doesn't, the cut is approximate.
  const flat = text.replace(/\s+/g, ' ')
  const m = matchScore(flat, q)
  if (!m) return null
  const at = Math.min(m.at, flat.length)
  const start = Math.max(0, at - CONTEXT)
  const end = Math.min(flat.length, at + m.len + CONTEXT)
  return {
    label,
    before: (start > 0 ? '…' : '') + flat.slice(start, at),
    match: flat.slice(at, at + m.len),
    after: flat.slice(at + m.len, end) + (end < flat.length ? '…' : ''),
    score: m.score * weight,
    target,
  }
}

const specText = (t: TextSpec | null | undefined) => (t ? richPlain(t.content) : '')

/** The texts of a sheet that search looks at: [text, label, target, weight]. */
function textsOf(node: DocNode, opts: SearchOptions): [string, string, SearchTarget, number][] {
  const out: [string, string, SearchTarget, number][] = [
    [node.name, 'Sheet name', { kind: 'name' }, 1.5],
  ]
  const notes = 'notes' in node ? node.notes : undefined
  if (notes) out.push([notes, 'Notes', { kind: 'notes' }, 1])
  switch (node.kind) {
    case 'table':
      if (node.x?.title)
        out.push([node.x.title, 'X column title', { kind: 'column', column: 'x' }, 1.2])
      for (const ds of node.dataSets)
        out.push([
          ds.title,
          node.tableKind === 'multipleVariables' ? 'Variable' : 'Column title',
          { kind: 'column', column: ds.id },
          1.2,
        ])
      break
    case 'analysis': {
      const title = opts.analysisTitle?.(node.analysisId)
      if (title) out.push([title, 'Analysis', { kind: 'analysis' }, 1.2])
      break
    }
    case 'graph': {
      const title = specText(node.title)
      if (title) out.push([title, 'Graph title', { kind: 'graphTitle' }, 1.2])
      for (const axis of ['x', 'y', 'y2'] as const) {
        const spec = node.axes[axis]
        const text = spec ? specText(spec.title) : ''
        if (text)
          out.push([
            text,
            `${axis === 'y2' ? 'Right Y' : axis.toUpperCase()} axis title`,
            { kind: 'axisTitle', axis },
            1.1,
          ])
      }
      break
    }
    case 'layout':
      for (const it of node.items)
        if (it.type === 'text') {
          const text = specText(it.content)
          if (text) out.push([text, 'Text on the page', { kind: 'pageText', item: it.id }, 1])
        }
      break
    case 'info':
      node.fields.forEach((f, index) => {
        if (f.label) out.push([f.label, 'Info field', { kind: 'field', index, part: 'label' }, 1.2])
        if (f.value)
          out.push([
            f.value,
            `Info: ${f.label || 'value'}`,
            { kind: 'field', index, part: 'value' },
            1.1,
          ])
      })
      break
  }
  return out
}

/**
 * The sheets matching `query`, best first (then in navigator order), each with its matches and
 * a snippet of each. Case and accents are ignored; a query of several words also matches a text
 * holding them all.
 */
export function searchProject(
  project: Pick<Project, 'nodes' | 'order'>,
  query: string,
  opts: SearchOptions = {},
): SheetHits[] {
  const q = fold(query.trim()).replace(/\s+/g, ' ')
  if (!q) return []
  const perSheet = opts.perSheet ?? 20
  const out: (SheetHits & { rank: number })[] = []
  project.order.forEach((id, rank) => {
    const node = nodeById(project.nodes, id)
    if (!node) return
    const hits: SearchHit[] = []
    for (const [text, label, target, weight] of textsOf(node, opts)) {
      const hit = hitOf(text, q, label, target, weight)
      if (hit) hits.push(hit)
    }
    if (!hits.length) return
    hits.sort((a, b) => b.score - a.score)
    out.push({
      node: id,
      kind: node.kind,
      name: node.name,
      score: hits[0]!.score + Math.min(hits.length - 1, 5),
      hits: hits.slice(0, perSheet),
      rank,
    })
  })
  out.sort((a, b) => b.score - a.score || a.rank - b.rank)
  return out.map(({ rank: _, ...rest }) => rest)
}
