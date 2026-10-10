import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import { evenIndices, layoutGraph, sceneToSvg } from '@ps/graph'
import type { DataTable, GraphNode, Project } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'
import { EXAMPLES, type ExampleDef } from '../src/examples/registry.ts'
import { THUMBNAIL_SAMPLE } from '../src/examples/thumbnails.ts'
import { builtExample } from './exampleBuilds.ts'

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

// Roadmap 47: the Examples dialog's cards show a thumbnail of each example's graph, drawn ahead
// of time and committed (`src/examples/thumbnails.json`, loaded with the dialog): the graph laid
// out as the app draws it (analyses computed, as the example tests do), a sample of its points,
// written as SVG and made small (numbers to 0.1 pt, circles as circles, bare groups unwrapped).
// Only the examples that are part of the app: never one read from the local source_data folder.
// After changing an example or the drawing, run this test with UPDATE_THUMBS=1 and review the
// cards. The comparison allows a last-digit difference in a number in a tag (a coordinate laid out
// from a result computed with Math.exp or Math.log, which may differ in its last bit between
// processors), never in the text drawn (numbers included) or the structure (audit 3, T4).

const FILE = new URL('../src/examples/thumbnails.json', import.meta.url)

/** The examples with a thumbnail: synthetic, or published with their data in the app. */
export const THUMBNAILED: ExampleDef[] = EXAMPLES.filter(
  (e) => !e.available && (e.section === 'examples' || e.section === 'published'),
)

/** The graph a card shows: the one the example names, else its first. */
export function thumbnailGraph(project: Project, def: Pick<ExampleDef, 'thumbnail' | 'id'>) {
  const graphs = project.order
    .map((id) => project.nodes[id])
    .filter((n): n is GraphNode => n?.kind === 'graph')
  const g = def.thumbnail ? graphs.find((n) => n.name === def.thumbnail) : graphs[0]
  if (!g) throw new Error(`${def.id}: no graph “${def.thumbnail ?? '(first)'}”`)
  return g
}

const round = (s: string) => {
  const v = Math.round(Number(s) * 10) / 10
  return Object.is(v, -0) ? '0' : String(v)
}

/** An SVG made small: numbers to 0.1, symbol circles as circles, bare groups unwrapped. */
export function optimizeSvg(svg: string): string {
  const small = svg
    .replace(/\n/g, '')
    // A symbol's circle: "Mx,ya r,r 0 1,0 2r,0a r,r 0 1,0 -2r,0Z" (`symbolPath`).
    .replace(
      /<path d="M(-?[\d.]+),(-?[\d.]+)a([\d.]+),\3 0 1,0 [\d.]+,0a\3,\3 0 1,0 -[\d.]+,0Z"/g,
      (_, x, y, r) => `<circle cx="${round(String(Number(x) + Number(r)))}" cy="${y}" r="${r}"`,
    )
    // Numbers in attribute values (coordinates, sizes, path data, transforms).
    .replace(/="([^"]*)"/g, (all, v: string) =>
      /^[-\d., a-zA-Z()]*$/.test(v) && /\d/.test(v) ? `="${v.replace(/-?\d+\.\d+/g, round)}"` : all,
    )
  // Groups without attributes: their contents in their place.
  const bare: boolean[] = []
  return small.replace(/<g( [^>]*)?>|<\/g>/g, (tag, attrs?: string) => {
    if (tag === '</g>') return bare.pop() ? '' : tag
    bare.push(!attrs)
    return attrs ? tag : ''
  })
}

/** Tables of more rows than a thumbnail shows: an even sample of their rows (a UMAP's cells). */
const THUMBNAIL_ROWS = 400

/** The project with its large tables cut to an even sample of their rows. */
export function thinned(project: Project, rows = THUMBNAIL_ROWS): Project {
  const nodes = { ...project.nodes }
  for (const [id, n] of Object.entries(project.nodes)) {
    if (n?.kind !== 'table' || n.rowCount <= rows) continue
    const keep = evenIndices(n.rowCount, rows)
    const pick = <T>(a: readonly T[] | undefined) => a && keep.map((i) => a[i]!)
    const column = (c: DataTable['dataSets'][number]['subcolumns'][number]) => ({
      ...c,
      values: pick(c.values)!,
      ...(c.excluded ? { excluded: pick(c.excluded) } : {}),
      ...(c.limit ? { limit: pick(c.limit) } : {}),
    })
    const t: DataTable = {
      ...n,
      rowCount: rows,
      rowTitles: n.rowTitles ? pick(n.rowTitles)! : null,
      ...(n.rowTitlesRich ? { rowTitlesRich: pick(n.rowTitlesRich) } : {}),
      ...(n.x ? { x: { ...n.x, subcolumns: n.x.subcolumns.map(column) } } : {}),
      dataSets: n.dataSets.map((d) => ({
        ...d,
        subcolumns: d.subcolumns.map(column),
        ...(d.text ? { text: pick(d.text) } : {}),
      })),
    }
    nodes[id as keyof typeof nodes] = t
  }
  return { ...project, nodes }
}

/** A card's thumbnail of an example's project (its analyses run). */
export async function thumbnailOf(def: ExampleDef, built: Project): Promise<string> {
  const store = new DocumentStore(thinned(built))
  const engine = await startedEngine(store, registry)
  engine.stop()
  const project = store.getState()
  const graph = thumbnailGraph(project, def)
  const scene = layoutGraph({
    project,
    graph,
    fonts,
    result: (id) => engine.latest(id),
    screen: THUMBNAIL_SAMPLE,
  })
  return optimizeSvg(sceneToSvg(scene, { background: '#ffffff', portableFonts: true }))
}

/**
 * Two SVGs equal but for numbers in their tags (coordinates, sizes) differing by at most 0.2 (a
 * rounding step either side): the text drawn (between tags) is compared exactly, numbers and all
 * (audit 3, T4: a tolerance on text took "P = 0.0123" for "P = 0.2").
 */
export function sameDrawing(a: string, b: string): boolean {
  const num = /-?\d+(?:\.\d+)?/g
  const parts = (svg: string) => svg.split(/(<[^>]*>)/)
  const pa = parts(a)
  const pb = parts(b)
  if (pa.length !== pb.length) return false
  return pa.every((x, i) => {
    const y = pb[i]!
    if (!x.startsWith('<')) return x === y
    if (x.replace(num, '#') !== y.replace(num, '#')) return false
    const nx = x.match(num) ?? []
    const ny = y.match(num) ?? []
    return nx.length === ny.length && nx.every((v, j) => Math.abs(Number(v) - Number(ny[j])) <= 0.2)
  })
}

describe('the examples’ thumbnails (roadmap 47)', () => {
  it('make an SVG small without changing what it draws', () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="100.123pt" height="50pt" viewBox="0 0 100.123 50">',
      '<g>',
      '<g>',
      '<path d="M10.25,20.04a3,3 0 1,0 6,0a3,3 0 1,0 -6,0Z" fill="#0072b2" stroke="#0072b2" stroke-width="0.75"/>',
      '</g>',
      '<g data-x="1" transform="translate(1.26,2)"><text fill="#000000" xml:space="preserve"><tspan x="48.118" y="20.674" font-size="14">P = 0.0123</tspan></text></g>',
      '</g>',
      '</svg>',
    ].join('\n')
    expect(optimizeSvg(svg)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100.1pt" height="50pt" viewBox="0 0 100.1 50">' +
        '<circle cx="13.3" cy="20" r="3" fill="#0072b2" stroke="#0072b2" stroke-width="0.8"/>' +
        '<g data-x="1" transform="translate(1.3,2)"><text fill="#000000" xml:space="preserve"><tspan x="48.1" y="20.7" font-size="14">P = 0.0123</tspan></text></g>' +
        '</svg>',
    )
    // Numbers a rounding step apart are the same drawing; text and structure are not.
    expect(sameDrawing('<a x="1.2"/>', '<a x="1.3"/>')).toBe(true)
    expect(sameDrawing('<a x="1.2"/>', '<a x="1.5"/>')).toBe(false)
    expect(sameDrawing('<a x="1.2">P</a>', '<a x="1.2">Q</a>')).toBe(false)
    // Audit 3 (T4): numbers in the text are text, compared exactly.
    expect(sameDrawing('<a x="1.2">P = 0.0123</a>', '<a x="1.2">P = 0.2</a>')).toBe(false)
    expect(sameDrawing('<a x="1.2">10</a>', '<a x="1.3">10</a>')).toBe(true)
    expect(sameDrawing('<a>10</a><b/>', '<a>10</a>')).toBe(false)
  })

  it('are drawn for every example that is part of the app, and none read from local files', {
    timeout: 600_000,
  }, async () => {
    expect(THUMBNAILED.map((e) => e.id)).toContain('getting-started')
    expect(THUMBNAILED.every((e) => !e.available)).toBe(true)
    const made: Record<string, string> = {}
    for (const def of THUMBNAILED) made[def.id] = await thumbnailOf(def, (await builtExample(def))!)
    const have: Record<string, string> = existsSync(FILE)
      ? JSON.parse(readFileSync(FILE, 'utf8'))
      : {}
    const fresh =
      Object.keys(have).join() === Object.keys(made).join() &&
      Object.keys(made).every((id) => sameDrawing(have[id]!, made[id]!))
    if (process.env.UPDATE_THUMBS && !fresh)
      writeFileSync(FILE, `${JSON.stringify(made, null, 2)}\n`)
    else {
      expect(Object.keys(have), 'run with UPDATE_THUMBS=1 to redraw them').toEqual(
        Object.keys(made),
      )
      for (const id of Object.keys(made))
        expect(sameDrawing(have[id]!, made[id]!), `${id}: run with UPDATE_THUMBS=1`).toBe(true)
    }
    // Small enough to load with the dialog (all of them, before compression).
    const bytes = Object.values(made).reduce((n, s) => n + s.length, 0)
    expect(bytes).toBeLessThan(400_000)
  })
})
