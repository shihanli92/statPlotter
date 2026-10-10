import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { registry } from '@ps/analyses'
import { applyMethod, DocumentStore, readMethod } from '@ps/engine'
import { layoutGraph, sceneToSvg } from '@ps/graph'
import { ProjectFileError, readProjectFile, writeProjectFile } from '@ps/io'
import {
  createProject,
  createTable,
  GraphNode,
  type NodeId,
  type Project,
  parseProject,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'

// The hand-made exotic v1 projects, a template, a method and a project file written on the 33a
// code (roadmap 33b): migrated, each graph renders exactly as it did (the stage-1 SVG's hash). (Until
// roadmap 33d each migrated graph was also compared with the v1 layout of its v1 graph.)

const FIX = new URL('../../graph/test/fixtures/v1/', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, FIX))
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

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

describe('exotic v1 projects', () => {
  const stage1 = JSON.parse(read('exotic/renders.json').toString())
  const names = readdirSync(new URL('exotic/', FIX))
    .filter((f) => f.endsWith('.json') && f !== 'renders.json')
    .map((f) => f.replace(/\.json$/, ''))

  it.each(names)(
    '%s',
    async (name) => {
      const v1 = JSON.parse(read(`exotic/${name}.json`).toString())
      const project = parseProject(v1)
      const { out } = await renders(project)
      expect(out).toEqual(stage1[name])
      for (const g of Object.values(project.nodes))
        if (g.kind === 'graph') expect(GraphNode.parse(g)).toEqual(g)
    },
    60_000,
  )
})

describe('templates, methods and project files of v1', () => {
  it('a v1 template opens as a new project: migrated, its graphs as they were', async () => {
    const file = readProjectFile(read('reuse/getting-started.pstemplate'))
    expect(file.template).toBe(true)
    expect(file.project.schemaVersion).toBe(2)
    const { out } = await renders(file.project)
    expect(out).toEqual(JSON.parse(read('reuse/renders.json').toString()).template)
  })

  it('a v1 method reads, migrated, and applies to a table of this version', async () => {
    const method = readMethod(read('reuse/dose-response.psmethod').toString())
    expect(method.project.schemaVersion).toBe(2)
    const graphs = Object.values(method.project.nodes).filter((n) => n.kind === 'graph')
    expect(graphs.length).toBeGreaterThan(0)
    for (const g of graphs) expect(GraphNode.safeParse(g).success).toBe(true)
    // Applied to a new XY table: graphs and analyses made for it, valid in the document.
    const table = createTable({ name: 'Plate 9', tableKind: 'xy', columns: 2, rows: 4 })
    const store = new DocumentStore({
      ...createProject(),
      nodes: { [table.id]: table },
      order: [table.id],
    })
    const plan = applyMethod(method, store.getState(), [table.id], { match: 'position' })
    store.dispatch(plan.commands)
    const made = plan.created[0]!.nodes.map((id) => store.getState().nodes[id]!)
    expect(made.some((n) => n.kind === 'graph')).toBe(true)
    const engine = await startedEngine(store, registry)
    engine.stop()
    for (const n of made)
      if (n.kind === 'graph') layoutGraph({ project: store.getState(), graph: n, fonts })
  })

  it('a v1 project file (or a recovery copy, Save’s bytes) opens, and saves as v2', () => {
    const bytes = read('reuse/getting-started.psproj')
    const file = readProjectFile(new Uint8Array(bytes))
    expect(file.project.schemaVersion).toBe(2)
    expect(file.notes).toEqual([])
    const again = readProjectFile(writeProjectFile(file.project))
    // Saving stamps the time and version it was saved with; the document is the same.
    expect({ ...again.project, meta: file.project.meta }).toEqual(file.project)
    expect(again.notes).toEqual([])
  })

  it('a file of a newer format is refused with a message saying so', () => {
    const p = createProject()
    const bytes = writeProjectFile({ ...p, schemaVersion: 3 as never })
    expect(() => readProjectFile(bytes)).toThrow(ProjectFileError)
    expect(() => readProjectFile(bytes)).toThrow(
      'This project was saved by a newer version of the app (file format v3; this version reads up to v2). Open it in the newer version.',
    )
  })
})
