import type { DocNode } from '@ps/model'

/**
 * The next name in a series that isn't taken: "Day 1" → "Day 2", "Plate 09" → "Plate 10",
 * "Mouse 3 (left)" → "Mouse 4 (left)"; without a number, "Name (copy)".
 */
export function nextInSeries(name: string, taken: ReadonlySet<string> = new Set()): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(name)
  if (!m) {
    let out = `${name} (copy)`
    for (let k = 2; taken.has(out); k++) out = `${name} (copy ${k})`
    return out
  }
  const [, head, digits, tail] = m as unknown as [string, string, string, string]
  for (let n = Number(digits) + 1; ; n++) {
    const out = `${head}${String(n).padStart(digits.length, '0')}${tail}`
    if (!taken.has(out)) return out
  }
}

const NOUNS: Record<Exclude<DocNode['kind'], 'table' | 'info'>, [string, string]> = {
  analysis: ['analysis', 'analyses'],
  graph: ['graph', 'graphs'],
  layout: ['layout', 'layouts'],
}

/** "2 analyses, 1 graph and 1 layout" (kinds with none left out); "nothing" when empty. */
export function countNodes(nodes: readonly Pick<DocNode, 'kind'>[]): string {
  const parts = (['analysis', 'graph', 'layout'] as const).flatMap((k) => {
    const n = nodes.filter((x) => x.kind === k).length
    return n ? [`${n} ${NOUNS[k][n === 1 ? 0 : 1]}`] : []
  })
  if (!parts.length) return 'nothing'
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
