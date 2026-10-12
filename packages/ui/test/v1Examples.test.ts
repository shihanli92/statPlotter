import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { registry } from '@ps/analyses'
import { layoutGraph, type Scene, type SceneNode, sceneToSvg } from '@ps/graph'
import {
  type GraphNode,
  type MigrationNote,
  type NodeId,
  type Project,
  paramsOf,
  parseProject,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'
import { canon, firstDifference as sceneDifference } from '../../graph/test/scenes.ts'
import { EXAMPLES } from '../src/examples/registry.ts'
import { builtExample, sourceContext } from './exampleBuilds.ts'

// The examples against their v1 documents (roadmap 33b): every synthetic example's v1 JSON,
// written on the 33a code (`graph/test/fixtures/v1/examples/`), migrated, is the document the
// example builds now (ids counted per document, as the fixtures were written) but for its graphs'
// layers, which the examples now make natively (roadmap 33c: presets and layer edits, no
// placeholder layers): every graph keeps everything else, and draws exactly as its v1 document
// migrated does (the whole scene, targets included) and as at stage 1 (the SVG's hash; until
// roadmap 33d the migrated graphs were also compared with the v1 layouts). Published examples
// that read local journal data are checked the same way where V1_PUBLISHED_DIR holds their v1
// documents (written by the fixture generator; never committed).

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: true }),
)

const FIX = new URL('../../graph/test/fixtures/v1/examples/', import.meta.url)
const PUBLISHED = process.env.V1_PUBLISHED_DIR

const context = sourceContext()

/** Key-sorted JSON without what changes from run to run (dates, the app's version). */
function normalized(project: object): string {
  return JSON.stringify(project, (key, value) => {
    if (key === 'created' || key === 'modified') return '<date>'
    if (key === 'appVersion') return '<version>'
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  })
}

/** The first path where two JSON texts differ. */
function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return `${path}: ${JSON.stringify(a)?.slice(0, 400)} ≠ ${JSON.stringify(b)?.slice(0, 400)}`
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDifference(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      `${path}.${k}`,
    )
    if (d) return d
  }
  return `${path}: differ`
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** What a graph's layers decide (compared by drawing instead). */
const LAYERED = ['layers', 'look', 'preset', 'seriesOverrides', 'style', 'scales']

/**
 * A project with its graphs' layer fields left out, and its analyses' params as they mean them
 * (roadmap 51c: params read through `paramsOf`, at the current version: a v1 document's params
 * of 0.3.8 and the example's, pinned to the same choices, are the same params).
 */
function withoutLayers(project: Project, example: string): object {
  const nodes = Object.fromEntries(
    Object.entries(project.nodes).map(([id, n]) => {
      if (n.kind === 'graph')
        return [id, Object.fromEntries(Object.entries(n).filter(([k]) => !LAYERED.includes(k)))]
      if (n.kind !== 'analysis') return [id, n]
      const def = registry.get(n.analysisId)
      const p = def && paramsOf(def, n)
      if (!p?.ok) return [id, n]
      const params = { ...(p.params as object), ...CHANGED_SINCE_V1[`${example}/${n.analysisId}`] }
      return [id, { ...n, params, pluginVersion: def!.version }]
    }),
  )
  return { ...project, nodes }
}

/**
 * Params an example now states that its v1 document left to a default, the same results (each
 * with its reason): applied to the migrated document before comparing.
 */
const CHANGED_SINCE_V1: Record<string, object> = {
  // Roadmap 51c (S39): the ROC direction is stated (patients higher), as the data-chosen one was.
  'clinical/roc': { direction: 'higher' },
}

/**
 * Text an example now words otherwise (its notes and names): replaced in the migrated document
 * before comparing. Roadmap 51c: Transform's label "Y = log10(Y)" (S38), the spelling Šidák (S33).
 */
const TEXT_SINCE_V1: Record<string, [string, string][]> = {
  'data-processing': [['Y = log(Y)', 'Y = log10(Y)']],
  grouped: [['Šídák', 'Šidák']],
}

const reworded = (project: Project, example: string): Project =>
  (TEXT_SINCE_V1[example] ?? []).reduce(
    (p, [from, to]) => JSON.parse(JSON.stringify(p).replaceAll(from, to)) as Project,
    project,
  )

/** A scene as text without empty groups (a layer drawing nothing leaves one; SVG drops it). */
function drawing(scene: Scene): string {
  const prune = (n: SceneNode): SceneNode | null => {
    const children = n.children?.map(prune).filter((c): c is SceneNode => c !== null)
    if (!n.prim && n.children && !children?.length) return null
    return children ? { ...n, children } : n
  }
  return canon({ ...scene, root: prune(scene.root)! })
}

/** Every graph of a project laid out (analyses computed): graph id → SVG hash. */
async function renders(project: Project) {
  const engine = await startedEngine(project, registry)
  engine.stop()
  const result = (id: NodeId) => engine.latest(id)
  const out: Record<string, string> = {}
  for (const n of Object.values(project.nodes))
    if (n.kind === 'graph')
      out[n.id] = sha(sceneToSvg(layoutGraph({ project, graph: n, fonts, result }), { ids: true }))
  return { out, result }
}

const fixtures = (dir: string) =>
  readdirSync(dir).flatMap((f) => (f.endsWith('.json') && f.includes('.') ? [f] : []))

const committed = fixtures(FIX.pathname).filter((f) => f !== 'renders.json')
const published = PUBLISHED ? fixtures(PUBLISHED).filter((f) => !f.endsWith('.renders.json')) : []

describe('examples: the v1 document migrated is the document built now', () => {
  const stage1 = JSON.parse(readFileSync(new URL('renders.json', FIX), 'utf8'))
  const cases = [
    ...committed.map((f) => ({ file: new URL(f, FIX).pathname, local: false })),
    ...published.map((f) => ({ file: `${PUBLISHED}/${f}`, local: true })),
  ].map((c) => ({
    ...c,
    id: c.file
      .split('/')
      .at(-1)!
      .replace(/\.json$/, ''),
  }))
  it.each(cases)(
    '$id',
    async ({ file, local, id }) => {
      const example = EXAMPLES.find((e) => e.id === id)!
      const v1 = JSON.parse(readFileSync(file, 'utf8'))
      const notes: MigrationNote[] = []
      const migrated = parseProject(v1, notes)
      // Built with ids counted from 0, once per run (`exampleBuilds.ts`).
      const built = (await builtExample(example, context))!
      const diff = firstDifference(
        JSON.parse(normalized(withoutLayers(reworded(migrated, id), id))),
        JSON.parse(normalized(withoutLayers(built, id))),
      )
      expect(diff, `${id}: ${diff}`).toBeNull()
      expect(
        notes.filter((n) => n.kind === 'approximated'),
        id,
      ).toEqual([])

      // Each graph renders as at stage 1 (the SVG's hash).
      const hashes = local
        ? JSON.parse(readFileSync(file.replace(/\.json$/, '.renders.json'), 'utf8'))
        : stage1[id]
      const { out, result } = await renders(migrated)
      expect(out).toEqual(hashes)
      expect((await renders(built)).out).toEqual(hashes)
      // The whole scene (targets, hit boxes, warnings) as the migrated graph's.
      for (const n of Object.values(built.nodes)) {
        if (n.kind !== 'graph') continue
        const old = layoutGraph({
          project: migrated,
          graph: migrated.nodes[n.id] as GraphNode,
          fonts,
          result,
        })
        const now = layoutGraph({ project: built, graph: n, fonts, result })
        const d = sceneDifference(drawing(old), drawing(now))
        expect(d, `${id}: ${n.name}: ${d}`).toBeNull()
      }
    },
    120_000,
  )
})
