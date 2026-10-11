import { readdirSync, readFileSync } from 'node:fs'
import {
  GraphNode,
  GraphNodeV1,
  type MigrationNote,
  migrateProject,
  Project,
  parseProject,
} from '@ps/model'
import { describe, expect, it } from 'vitest'

// The v1 fixtures (roadmap 33b): every golden graph, every synthetic example and hand-made exotic
// projects as v1 documents, written on the 33a code (0.1.11) by the generator of commit
// "Roadmap 33b: v1 fixtures" (`ui/test/genV1Fixtures.test.ts` there, run with GEN_V1=1). Each opens:
// migrated, valid, the same after a save and reopen. Their renders are checked by the golden
// test (goldens), `ui/test/v1Examples.test.ts` (examples) and `ui/test/v1Fixtures.test.ts`
// (exotic projects, the template, the method and a project file).

const FIX = new URL('./fixtures/v1/', import.meta.url)

const projects = (dir: string): [string, Record<string, unknown>][] =>
  readdirSync(new URL(`${dir}/`, FIX))
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'renders.json')
    .map((f) => [`${dir}/${f}`, JSON.parse(readFileSync(new URL(`${dir}/${f}`, FIX), 'utf8'))])

const ALL = [...projects('golden'), ...projects('examples'), ...projects('exotic')]

describe('v1 fixtures open as current (v3) projects', () => {
  it.each(ALL)('%s', (name, raw) => {
    // A v1 document: every graph valid as v1.
    expect(raw.schemaVersion).toBe(1)
    const v1Graphs = Object.values(raw.nodes as Record<string, { kind: string }>).filter(
      (n) => n.kind === 'graph',
    )
    for (const g of v1Graphs) expect(GraphNodeV1.safeParse(g).error?.issues).toBeUndefined()

    // Migrated: a valid v3 project (through v2); the migration is deterministic and leaves its input alone.
    const before = JSON.stringify(raw)
    const notes: MigrationNote[] = []
    const project = parseProject(raw, notes)
    expect(JSON.stringify(raw)).toBe(before)
    expect(project.schemaVersion).toBe(3)
    expect(parseProject(raw)).toEqual(project)
    const graphs = Object.values(project.nodes).filter((n) => n.kind === 'graph')
    expect(graphs).toHaveLength(v1Graphs.length)
    for (const g of graphs) {
      expect(GraphNode.parse(g)).toEqual(g)
      expect(g.drawOrder).toBe('series')
      expect('graphType' in g || 'extraSeries' in g || 'functions' in g).toBe(false)
    }

    // Saved and reopened: the same document (a v3 file needs no migration).
    const reopened = parseProject(JSON.parse(JSON.stringify(project)))
    expect(reopened).toEqual(project)
    expect(migrateProject(project)).toBe(project)
    expect(Project.safeParse(reopened).success).toBe(true)

    // Only the hand-made approximation fixtures change how anything looks.
    const changed = notes.filter((n) => n.kind === 'approximated')
    if (name.includes('approximated-') || name.endsWith('functions.json'))
      expect(changed.length, name).toBeGreaterThan(0)
    else expect(changed, name).toEqual([])
  })

  it('reports the three behaviour changes, each on its graph', () => {
    const notes = (name: string) => {
      const out: MigrationNote[] = []
      parseProject(JSON.parse(readFileSync(new URL(`exotic/${name}.json`, FIX), 'utf8')), out)
      return out.filter((n) => n.kind === 'approximated')
    }
    expect(notes('approximated-grouped-mean-points')).toEqual([
      {
        kind: 'approximated',
        graph: 'Bars with mean symbols',
        text: 'points on grouped bars (mean replicates) now count in the Y axis range, as everything drawn does',
      },
    ])
    expect(notes('approximated-xy-each-of-means')).toEqual([
      {
        kind: 'approximated',
        graph: 'Each replicate of means',
        text: 'every replicate of entered means: the Y axis range now reaches only what is drawn (no error bars)',
      },
    ])
    expect(notes('functions')).toEqual([
      {
        kind: 'approximated',
        graph: 'Data with functions',
        text: 'function points are not drawn, so the legend no longer shows a symbol for them',
      },
    ])
  })
})
