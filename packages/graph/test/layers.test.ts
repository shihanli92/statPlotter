import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileV1, type GraphNode, type Layer } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  layoutLayers,
  newStyleLayer,
  presetsFor,
  styleAllowed,
  styleContext,
  styleOfLayer,
  stylesFor,
  withStyleLayer,
} from '../src/index.ts'
import { checkLayers, frameAllowed, geomAllowed, positionAllowed } from '../src/layers/matrix.ts'
import { GOLDEN_GROUPS } from './goldenCases.ts'
import { graphOf } from './graphs.ts'
import { flatten, fonts, projectOf, sampleTable, TABLE_KINDS } from './helpers.ts'

// The layer engine (roadmap 33): its rules, its two drawing orders and its compatibility matrix.

const LAYERS = fileURLToPath(new URL('../src/layers/', import.meta.url))

function* sources(dir: string, ends: readonly string[] = ['.ts']): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* sources(p, ends)
    else if (ends.some((e) => entry.endsWith(e))) yield p
  }
}

/** A file's code without its comments and strings' contents. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'/g, "''")

describe('layer engine rules', () => {
  it('never reads a graph type, and reads `look` only in its theme', () => {
    const files = [...sources(LAYERS)]
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) {
      const src = code(readFileSync(file, 'utf8'))
      expect(src, file).not.toMatch(/\bGraphType\b|\bgraphType\b/)
      if (!file.endsWith('/layers/theme.ts')) expect(src, file).not.toMatch(/\blook\b/)
      expect(src, file).not.toMatch(/\blegacy\b/)
    }
  })

  // Audit 2 (G12): frames share what they share through modules of their own (`curves.ts`,
  // `slotLegend.ts`, the geoms), so each frame can change without reaching into another.
  it('no frame imports another frame', () => {
    const frames = [...sources(join(LAYERS, 'frames'))]
    expect(frames.length).toBeGreaterThan(5)
    for (const file of frames) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1])
      expect(
        imports.filter((p) => p!.startsWith('./') || p!.includes('/frames/')),
        file,
      ).toEqual([])
    }
  })

  // Audit 2 (G11): decision 536 for the whole graph package and the app's graph code, not only
  // the layer engine: a graph's look is read through the theme (`markDefaults`, `percentOfWhole`,
  // `graphFamily`), never derived or compared elsewhere. Code setting it (`lookFor`, the builder's
  // pie or donut control) writes it and may hold it; it reads no other graph's.
  it('reads a graph’s look only through the theme, across the graph package and the app', () => {
    const ROOTS = ['../src/', '../../ui/src/graph/'].map((d) =>
      fileURLToPath(new URL(d, import.meta.url)),
    )
    const READERS = [
      // markDefaults, percentOfWhole, graphFamily.
      'graph/src/theme.ts',
      // The builder's pie or donut choice: the control that sets the look.
      'ui/src/graph/builder/GraphBuilder.tsx',
    ]
    const READS = /\blookOf\b|\blook\s*[!=]==|[!=]==\s*[\w.]*\blook\b|\blook\.\w/
    const files = ROOTS.flatMap((root) => [...sources(root, ['.ts', '.tsx'])])
    expect(files.length).toBeGreaterThan(150)
    const readers = files.filter((file) => READS.test(code(readFileSync(file, 'utf8'))))
    expect(readers.map((f) => f.slice(f.indexOf('packages/') + 9)).sort()).toEqual(READERS)
  })
})

/** A column graph of bars, every point and error bars, laid out by layer or by data set. */
function barsAndPoints(drawOrder: GraphNode['drawOrder']) {
  const table = sampleTable('column')
  const graph = { ...graphOf(table, 'barsPoints'), drawOrder }
  return layoutLayers({ project: projectOf(table), graph, fonts })
}

describe('drawing order', () => {
  it('by data set: a group per data set, its layers in its order (v1)', () => {
    const series = flatten(barsAndPoints('series').root).find((n) => n.id === 'series')!
    expect(series.children!.map((n) => n.id)).toEqual(['series/a', 'series/b', 'series/c'])
    expect(series.children![0]!.children!.map((n) => n.layer)).toEqual([
      'bars',
      'points',
      'points',
      'points',
      'points',
      'points',
      'points',
      'error',
    ])
  })

  it('by layer: a group per layer, each with every data set’s marks (the default)', () => {
    for (const order of ['layer', undefined] as const) {
      const series = flatten(barsAndPoints(order).root).find((n) => n.id === 'series')!
      expect(series.children!.map((n) => n.id)).toEqual([
        'layer/bars',
        'layer/points',
        'layer/error',
      ])
      const bars = series.children![0]!.children!
      expect(bars.map((n) => n.id)).toEqual(['series/a/bar', 'series/b/bar', 'series/c/bar'])
      expect(new Set(series.children![1]!.children!.map((n) => n.id.split('/')[1]))).toEqual(
        new Set(['a', 'b', 'c']),
      )
    }
  })

  it('a second layer drawing the same part of a data set adds @<layer> to its ids', () => {
    const table = sampleTable('xy')
    const g = graphOf(table, 'meanSd')
    const each: Layer = {
      id: 'each',
      geom: 'points',
      stat: { kind: 'identity' },
      style: { size: 3 },
    }
    const graph: GraphNode = { ...g, layers: [...g.layers, each] }
    const ids = flatten(layoutLayers({ project: projectOf(table), graph, fonts }).root).map(
      (n) => n.id,
    )
    expect(ids).toContain('series/a/point/0')
    expect(ids).toContain('series/a/point@each/0/1')
  })
})

describe('compatibility matrix', () => {
  it('names why an option is not offered', () => {
    expect(geomAllowed('column', 'box', 'boxplot')).toEqual({ allowed: true })
    expect(geomAllowed('column', 'box', 'boxplot', { raw: false }).reason).toBe('needs raw values')
    expect(geomAllowed('xy', 'tile', 'cell').allowed).toBe(false)
    expect(geomAllowed('partsOfWhole', 'wedge', 'fraction').allowed).toBe(true)
    expect(geomAllowed('survival', 'line', 'summary').reason).toBe('not for survival tables')
    expect(geomAllowed('xy', 'bar', 'bin').reason).toBe('not with this summary for xy tables')
    expect(geomAllowed('column', 'bar', 'bin', { raw: false }).reason).toBe('needs raw values')
    expect(geomAllowed('column', 'line', 'identity', { outputs: true }).allowed).toBe(true)
    expect(positionAllowed('grouped', 'points', { kind: 'stack' }).reason).toBe(
      'only bars and XY areas stack',
    )
    expect(positionAllowed('xy', 'area', { kind: 'stack' }).allowed).toBe(true)
    expect(positionAllowed('xy', 'area', { kind: 'stack', percent: true }).allowed).toBe(false)
    expect(frameAllowed('category', 'column', 'bar', 'bin').reason).toBe('histograms are XY graphs')
    expect(frameAllowed('xy', 'column', 'points', 'identity').reason).toBe(
      'a histogram draws binned bars',
    )
    expect(frameAllowed('xy', 'multipleVariables', 'line', 'identity').allowed).toBe(true)
    expect(frameAllowed('category', 'column', 'line', 'identity').allowed).toBe(false)
    expect(positionAllowed('grouped', 'bar', { kind: 'stack', percent: true }).allowed).toBe(true)
    const stacked = graphOf(sampleTable('grouped'), 'stacked')
    const withPoints: GraphNode = {
      ...stacked,
      layers: [
        ...stacked.layers,
        { id: 'points', geom: 'points', stat: { kind: 'identity' }, position: { kind: 'aligned' } },
      ],
    }
    expect(checkLayers(withPoints, 'grouped').get('points')?.reason).toBe('not with stacked bars')
    const est = graphOf(sampleTable('column'), 'estimation')
    const diff = est.layers.find((l) => l.geom === 'difference')!
    const two = { ...est, layers: [...est.layers, { ...diff, id: 'diff2' }] }
    expect(checkLayers(two, 'column').get('diff2')?.reason).toBe('one difference layer per graph')
  })

  it('allows every drawn layer of every golden v1 graph migrated (contingency aside)', () => {
    // v1 drew any grouped option on contingency tables (error bars, lines, summary labels); the
    // matrix offers counts only. Such layers stay and are drawn as before.
    for (const [, table, graph] of GOLDEN_GROUPS.flatMap((g) => g.cases)) {
      if (table.tableKind === 'contingency') continue
      const compiled = compileV1(graph, table).graph
      const raw = table.yFormat.type === 'replicates'
      for (const [id, a] of checkLayers(compiled, table.tableKind, { raw }))
        expect(a, `${graph.graphType} ${id}`).toEqual({ allowed: true })
    }
  })

  it('allows every preset, and every plot style the builder offers added to it', () => {
    let checked = 0
    for (const kind of TABLE_KINDS) {
      const table = sampleTable(kind)
      const raw = table.yFormat.type === 'replicates'
      for (const p of presetsFor(kind)) {
        const g = graphOf(table, p.id)
        for (const [id, a] of checkLayers(g, kind, { raw }))
          expect(a, `${p.id} on ${kind}: ${id}`).toEqual({ allowed: true })
        const c = styleContext(table, g.frame, g.layers)
        for (const style of stylesFor({ kind, frame: g.frame })) {
          if (style.frameChoice || !styleAllowed(style, c).allowed) continue
          if (g.layers.some((l) => styleOfLayer(l, g.frame)?.id === style.id)) continue
          const layers = withStyleLayer(c, newStyleLayer(style, c))
          for (const [id, a] of checkLayers({ ...g, layers }, kind, { raw }))
            expect(a, `${style.id} on ${p.id} of ${kind}: ${id}`).toEqual({ allowed: true })
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(200)
  })
})
