import { registry } from '@ps/analyses'
import type { ComputeEngine } from '@ps/engine'
import { bubbleData, layoutGraph, layoutPage, type Scene, type SceneNode } from '@ps/graph'
import {
  type AnalysisNode,
  type AnalysisResult,
  type DataTable,
  type DocNode,
  type GraphNode,
  type NodeId,
  normalizeTable,
  type Project,
  parseProject,
  tableFormulas,
} from '@ps/model'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { flatten, fonts } from '../../graph/test/helpers.ts'
import { EXAMPLES, type ExampleDef } from '../src/examples/registry.ts'
import { SYNTHETIC_EXAMPLES } from '../src/examples/synthetic/index.ts'
import { builtExample, sourceContext } from './exampleBuilds.ts'

// Every example builds a valid project whose analyses all run (chained ones included) and whose
// graphs and layouts render cleanly; each is built and computed once, then checked for what it is
// meant to show (planted outliers are found, unknowns interpolate near their true values, the new
// chart types appear, every table kind appears somewhere). Published-data examples that read
// local files run only where the repository's source_data folder exists (it is never committed).
// Each example is built once per run for every file checking it (`exampleBuilds.ts`).

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

const context = sourceContext

/** An example's project with every analysis computed. */
interface Built {
  project: Project
  engine: ComputeEngine
  lookup: (id: NodeId) => AnalysisResult | undefined
  /** The node with this name (and kind); throws if there is none. */
  byName: (name: string, kind?: DocNode['kind']) => DocNode
  /** The result of the analysis with this name. */
  result: (name: string) => AnalysisResult
  graph: (name: string) => GraphNode
  /** The graph with this name, laid out with the computed results. */
  scene: (name: string) => Scene
}

const builds = new Map<string, Promise<Built | null>>()

/** Builds and computes an example once per file; null when it can't be built here. */
function load(example: ExampleDef): Promise<Built | null> {
  let b = builds.get(example.id)
  if (!b) {
    b = (async () => {
      const project = await builtExample(example)
      if (!project) return null
      const engine = await startedEngine(project, registry)
      engine.stop()
      const lookup = (id: NodeId) => engine.latest(id)
      const byName = (name: string, kind?: DocNode['kind']) => {
        const node = Object.values(project.nodes).find(
          (n) => n.name === name && (!kind || n.kind === kind),
        )
        if (!node) throw new Error(`no node “${name}”`)
        return node
      }
      const graph = (name: string) =>
        Object.values(project.nodes).find(
          (n): n is GraphNode => n.kind === 'graph' && n.name === name,
        )!
      return {
        project,
        engine,
        lookup,
        byName,
        result: (name: string) => engine.latest(byName(name).id)!,
        graph,
        scene: (name: string) =>
          layoutGraph({ project, graph: graph(name), fonts, result: lookup }),
      }
    })()
    builds.set(example.id, b)
  }
  return b
}

const value = (r: AnalysisResult, key: string): number => {
  const v = r.values[key]
  if (!v || !('v' in v) || typeof v.v !== 'number') throw new Error(`no number ${key}`)
  return v.v
}

/** What each example is meant to show, beyond building, computing and rendering cleanly. */
const CHECKS: Record<string, [name: string, check: (b: Built) => void | Promise<void>][]> = {
  'getting-started': [
    [
      'an estimation plot, a violin, labelled bars',
      ({ graph, scene }) => {
        expect(graph('Enzyme activity (estimation plot)').look).toBe('column.estimation')
        expect(
          flatten(scene('Enzyme activity (estimation plot)').root).some((n) =>
            n.id.endsWith('/diff'),
          ),
        ).toBe(true)
        expect(graph('Cell area (violin)').layers.some((l) => l.geom === 'violin')).toBe(true)
        expect(
          flatten(scene('Dose response (bars)').root).filter((n) =>
            /^series\/.*\/label$/.test(n.id),
          ),
        ).toHaveLength(3)
      },
    ],
  ],

  'curve-fitting': [
    [
      'builds deterministically',
      async ({ project }) => {
        const tables = (p: Project) =>
          Object.values(p.nodes)
            .filter((n) => n.kind === 'table')
            .map((n) =>
              JSON.stringify(n.kind === 'table' ? n.dataSets.map((d) => d.subcolumns) : 0),
            )
        const again = await EXAMPLES.find((e) => e.id === 'curve-fitting')!.build(context())
        expect(tables(project)).toEqual(tables(again))
      },
    ],
    [
      'ROUT finds the planted outlier, unknowns land near their true values',
      ({ project, byName, result, lookup }) => {
        const rout = result('One site binding with ROUT')
        const key = (byName('One site binding with ROUT') as AnalysisNode).input.dataSets[0]!
        expect(value(rout, `outliers:${key}`)).toBe(1)
        // The planted point is labelled on the graph (its key names its replicate).
        const graph = byName('Binding with an outlier', 'graph') as GraphNode
        const scene = layoutGraph({ project, graph, fonts, result: lookup })
        const labelled = flatten(scene.root).filter((n) => n.point === 'r6s1')
        expect(labelled.length).toBe(2)

        // ELISA: mean of each sample's two interpolated concentrations within 20% of the truth.
        const conc = result('Interpolated concentrations (pg/mL)').table!
        const x = conc.x!.subcolumns[0]!.values as number[]
        ;[22, 48, 110, 260, 480].forEach((truth, i) => {
          const mean = (x[2 * i]! + x[2 * i + 1]!) / 2
          expect(Math.abs(mean / truth - 1)).toBeLessThan(0.2)
        })
        // BCA: within 10%.
        const bca = result('Linear standard curve').table!
        const bx = bca.x!.subcolumns[0]!.values as number[]
        ;[180, 620, 1240].forEach((truth, i) => {
          expect(Math.abs((bx[2 * i]! + bx[2 * i + 1]!) / 2 / truth - 1)).toBeLessThan(0.1)
        })
        // The global fit shares one Hill slope near the simulated 1.4.
        const fit = byName('Global fit (shared Hill slope)') as AnalysisNode
        const slopes = fit.input.dataSets.map((k) => value(result(fit.name), `HillSlope:${k}`))
        expect(slopes[0]).toBe(slopes[1])
        expect(Math.abs(slopes[0]! - 1.4)).toBeLessThan(0.2)
        // Enzyme inhibition: Ki near the simulated 3 µM.
        const inh = byName('Competitive inhibition (global)') as AnalysisNode
        const ki = value(result(inh.name), `Ki:${inh.input.dataSets[0]}`)
        expect(Math.abs(ki - 3)).toBeLessThan(0.6)
      },
    ],
  ],

  'data-processing': [
    [
      'the planted outlier is removed before the ANOVA',
      ({ byName, result }) => {
        const outliers = result('Outliers (ROUT)')
        expect(value(outliers, 'outliers')).toBe(1)
        const assay = byName('Assay with an outlier', 'table')
        if (assay.kind !== 'table') throw new Error('not a table')
        const batch2 = assay.dataSets[1]!.id
        const cleaned = outliers.table!.dataSets.find((d) => d.id === batch2)!
        expect(cleaned.subcolumns[0]!.values[3]).toBeNull()
        expect(cleaned.subcolumns[0]!.values.filter((v) => v !== null)).toHaveLength(7)
        // Roadmap 51c (S13): the ANOVA of the cleaned table says a value was removed first.
        const anova = result('One-way ANOVA of cleaned data')
        expect(anova.status).toBe('warning')
        expect(anova.diagnostics.map((d) => d.message).join(' ')).toMatch(
          /^1 value was removed as outlier \(ROUT, Q = 1%\) in “Outliers \(ROUT\)” before this analysis/,
        )
      },
    ],
    [
      'the frequency distribution is a histogram',
      ({ scene }) => {
        const bars = flatten(scene('Frequency distribution').root).filter((n) =>
          /^series\/.*\/bar\/\d+$/.test(n.id),
        )
        expect(bars.length).toBeGreaterThan(10)
      },
    ],
  ],

  grouped: [
    [
      'multiple t tests flag the changed genes only, labelled on the volcano',
      ({ project, byName, result, lookup }) => {
        const r = result('Multiple t tests (one per gene)')
        const flagged = value(r, 'flagged')
        expect(flagged).toBeGreaterThanOrEqual(5)
        expect(flagged).toBeLessThanOrEqual(9)
        // The discoveries carry their gene names (the row titles), in italics.
        const graph = byName('Volcano plot', 'graph') as GraphNode
        const scene = layoutGraph({ project, graph, fonts, result: lookup })
        const labels: SceneNode[] = []
        const walk = (n: SceneNode) => {
          if (n.target?.[0] === 'pointLabel' && n.prim?.type === 'text') labels.push(n)
          for (const c of n.children ?? []) walk(c)
        }
        walk(scene.root)
        expect(labels).toHaveLength(flagged)
        for (const n of labels) {
          if (n.prim?.type !== 'text') continue
          expect(n.prim.layout.runs.map((x) => x.text).join('')).toMatch(/^Gene \d\d$/)
          expect(n.prim.layout.runs[0]!.italic).toBe(true)
        }
      },
    ],
  ],

  formatting: [
    [
      'a bubble plot and functions',
      ({ graph, scene }) => {
        expect(graph('Tumour cohort (bubble plot)').look).toBe('bubble.scatter')
        expect(
          flatten(scene('Damped oscillation (function)').root).filter((n) =>
            n.id.startsWith('function/'),
          ).length,
        ).toBeGreaterThan(1)
      },
    ],
  ],

  'parts-of-whole': [
    [
      'pies, bars and a donut',
      ({ project, scene }) => {
        expect(
          Object.values(project.nodes).some(
            (n) => n.kind === 'table' && n.tableKind === 'partsOfWhole',
          ),
        ).toBe(true)
        for (const name of [
          'Immune cells (pies)',
          'Immune cells (100% stacked bars)',
          'Spleen (donut)',
        ])
          expect(flatten(scene(name).root).some((n) => n.id.includes('/slice/'))).toBe(true)
      },
    ],
  ],

  'multiple-variables': [
    [
      'has text and calculated variables that analyses and graphs use',
      ({ project, engine }) => {
        const nodes = Object.values(project.nodes)
        const trial = nodes.find((n) => n.name === 'Blood pressure trial') as DataTable
        const col = (t: string) => trial.dataSets.find((d) => d.title === t)!
        expect(col('Group').text).toHaveLength(36)
        expect(col('Sex').text?.every((s) => s === 'F' || s === 'M')).toBe(true)

        const formulas = tableFormulas(trial)
        for (const t of ['BMI', 'Change', 'Obese', 'Treated'])
          expect(formulas.get(col(t).id)?.error, t).toBeNull()
        const [w, h] = [col('Weight (kg)'), col('Height (m)')].map((d) => d.subcolumns[0]!.values)
        expect(formulas.get(col('BMI').id)!.values[0]).toBeCloseTo(w![0]! / h![0]! ** 2, 12)
        const change = formulas.get(col('Change').id)!.values
        expect(Number.isNaN(change[7]!)).toBe(true)
        expect(formulas.get(col('Treated').id)!.values.slice(0, 3)).toEqual(
          Float64Array.from([0, 1, 1]),
        )
        // Normalized views carry text and calculated values.
        const views = normalizeTable(trial)
        expect(views[0]!.text?.[0]).toBe('Placebo')

        for (const a of nodes.filter((n) => n.kind === 'analysis'))
          expect(engine.latest(a.id)?.status, a.name).toBe('ok')

        const bubble = nodes.find(
          (n): n is GraphNode => n.kind === 'graph' && n.look === 'bubble.scatter',
        )!
        expect(bubbleData(project, bubble).categories).toEqual(['Placebo', 'Low dose', 'High dose'])
        const scene = layoutGraph({ project, graph: bubble, fonts })
        expect(scene.warnings).toEqual([])

        const extracted = nodes.find((n) => n.name === 'Change by group') as DataTable
        expect(extracted.tableKind).toBe('column')
        expect(extracted.dataSets.map((d) => d.title)).toEqual(['Placebo', 'Low dose', 'High dose'])
      },
    ],
  ],
}

describe.each(EXAMPLES)('example $id', (example) => {
  let built: Built | null = null
  beforeAll(async () => {
    built = await load(example)
  }, 120_000)

  it('builds, runs every analysis and renders', () => {
    if (!built) return
    const { project, engine, lookup } = built
    expect(() => parseProject(JSON.parse(JSON.stringify(project)))).not.toThrow()
    for (const node of Object.values(project.nodes)) {
      if (node.kind !== 'analysis') continue
      const state = engine.get(node.id)
      expect(state?.status, `${node.name}: ${state?.status === 'error' ? state.message : ''}`).toBe(
        'ready',
      )
      const r = engine.latest(node.id)!
      expect(r.status, `${node.name}: ${r.diagnostics.map((d) => d.message).join(' ')}`).not.toBe(
        'error',
      )
    }
    for (const node of Object.values(project.nodes)) {
      if (node.kind === 'graph') {
        const scene = layoutGraph({ project, graph: node, fonts, result: lookup })
        expect(scene.warnings, `${example.id} › ${node.name}`).toEqual([])
      }
      if (node.kind === 'layout')
        expect(
          layoutPage({ project, layout: node, fonts, result: lookup }).items.length,
        ).toBeGreaterThan(0)
    }
  })

  for (const [name, check] of CHECKS[example.id] ?? [])
    it(name, async () => {
      expect(built, `${example.id} could not be built`).not.toBeNull()
      await check(built!)
    })
})

describe('synthetic examples', () => {
  it('together cover every table kind with an editor', async () => {
    const kinds = new Set<string>()
    for (const e of SYNTHETIC_EXAMPLES) {
      const p = (await load(e))!.project
      for (const n of Object.values(p.nodes)) if (n.kind === 'table') kinds.add(n.tableKind)
    }
    for (const k of [
      'column',
      'xy',
      'grouped',
      'contingency',
      'survival',
      'multipleVariables',
      'nested',
    ])
      expect(kinds).toContain(k)
  })

  it('have what-they-show checks for examples that exist', () => {
    for (const id of Object.keys(CHECKS)) expect(SYNTHETIC_EXAMPLES.map((e) => e.id)).toContain(id)
  })
})
