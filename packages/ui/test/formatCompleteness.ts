import { readFileSync } from 'node:fs'
import type { Command } from '@ps/engine'
import type { GraphNode, Project } from '@ps/model'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../src/examples/registry.ts'
import type { FormatTarget, OneSeries } from '../src/graph/format/route.ts'
import { builtExample } from './exampleBuilds.ts'
import {
  type FieldEntry,
  installDom,
  inventory,
  recordingContext,
  representativeGraphs,
} from './formatInventory.ts'

// Roadmap 46 (stage 2, decision 916): reorganising the Format options by element loses no field.
// `formatInventory.v46.json` holds every field the stage-1 tabs rendered (Format graph ›
// Appearance / Graph settings / Labels & annotations / Data sets on graph, Format axes › Frame &
// origin / X axis / Left Y axis / Right Y axis / Titles & fonts, the legend, brackets, text and
// lines; every layer for all its data sets and for one; a point) for one graph of each kind in
// the synthetic examples, each by its label and the paths its change writes. It was recorded once
// from stage 1 (b7cc9df) and is frozen: those tabs no longer exist. Each must be rendered
// somewhere in the new places of the same graph (the graph, its title, each axis, the legend,
// each layer, a data set of each layer, a point, each bracket, text and line), every section
// open: the same kind of control writing the same paths, under the same label or the new one it
// was given (`RENAMED`: labels named for their element, plain words for engine words).

/** Old labels → the labels the same field has now (besides the old label itself). */
const RENAMED: Record<string, readonly string[]> = {
  // Text styles, named for their text (Common holds the font, size and bold).
  Font: ['Title font', 'Tick label font', 'Legend text font', 'Font for all text'],
  'Size (pt)': [
    'Title size (pt)',
    'Tick label size (pt)',
    'Legend text size (pt)',
    'Size of all text (pt)',
  ],
  Bold: ['Bold title', 'Bold tick labels', 'Bold legend text', 'All text bold'],
  Italic: ['Italic title', 'Italic tick labels', 'Italic legend text', 'All text italic'],
  Colour: [
    'Title colour',
    'Tick label colour',
    'Legend text colour',
    'Colour of all text',
    // Roadmap 49b (decision 1236): a curve's or function's own colour, the row at the top of a
    // layer's view, says it colours it in every layer.
    'Curve colour (every layer)',
    'Function colour (every layer)',
  ],
  'Data set colour': ['Data set colour (every layer)'],
  // An axis' fields named for it.
  'Line colour': ['Axis line colour'],
  'Length (pt)': ['Tick length (pt)'],
  'Thickness (pt)': ['Tick thickness (pt)'],
  Format: ['Number format'],
  Scale: ['Numbers in units of'],
  Prefix: ['Number prefix'],
  Suffix: ['Number suffix'],
  Angle: ['Number angle'],
  Rotation: ['Label angle'],
  Axes: ['Frame'],
  // Engine words: plain names (V7).
  'Where marks overlap, draw': ['Drawing order'],
  'Draw this layer for this data set': [],
  Name: ['Layer name'],
  'In the legend': ['Layer in the legend'],
  'Use this format (except colour) for all data sets': ['Every data set (all but its colour)'],
  'Reset to default': ['Reset this data set to the default'],
  // Roadmap 47b: the legend's columns, at every position.
  'Entries per row (0 = all in one row)': ['Columns'],
  // Audit 3 (A10): Delete, the one verb for taking layers off a graph.
  Remove: ['Delete'],
  // Roadmap 49a (decision 1219): fills, outlines and lines in the Appearance table, by aesthetic.
  Border: ['Outline'],
  'Border width (pt)': ['Outline width (pt)'],
  'Border (pt)': ['Outline width (pt)'],
  'Width (pt)': ['Line width (pt)', 'Outline width (pt)'],
  Style: ['Line style'],
  // Graphs of variables' points: the Shape row's mode is Fixed or By variable.
  Shape: ['Fixed shape'],
}

/**
 * Roadmap 49a (decision 1219): controls that became another kind of control writing the same
 * field — points' Hollow checkbox is the Fill row's mode (By data set, Fixed, None).
 */
const REKINDED: Record<string, readonly { kind: string; label: string }[]> = {
  'check\u0000Hollow': [{ kind: 'select', label: 'Fill' }],
}

/**
 * Roadmap 49a (decision 1218): the Appearance table sets a field for every data set on the layer
 * alone, keeping each data set's own value (counted under the row, with a Reset) where stage 1's
 * fields also cleared them: an old field's writes compare without those clearings.
 */
function withoutClearings(writes: string): string {
  const paths = writes.split('|')
  const layers = new Set(
    paths.flatMap((p) => /^set:layers\/(\{[^}]*\})\/style\//.exec(p)?.[1] ?? []),
  )
  return paths
    .filter((p) => {
      const m = /^set:layers\/(\{[^}]*\})\/series\//.exec(p)
      return !m || !layers.has(m[1]!)
    })
    .join('|')
}

/** A data set's buttons and text that write nothing until used (matched by label alone). */
const DATA_SET_ACTIONS = new Set([
  'Use this format (except colour) for all data sets',
  'Reset to default',
  'Label beside the point',
  'Whole data set',
  'Reset to the data set’s style',
])

/**
 * Roadmap 49b (decision 1236): stage-1 fields no place has any more because they never drew
 * anything, now that a data set is formatted in the layers that can pick it:
 * - the grand mean's per-data-set fields (its line, width, style, "draw for this data set"): it
 *   is one line at the mean of every value, drawn with its layer's style alone (`reflineNode`);
 * - a heat map's data set (its colour, labels, per-data-set cell fields, its "points", Copy this
 *   format): the cells are drawn with the tile layer's style and statistic and the graph's
 *   colour scale alone (`heatmapOf`), and a cell selects its layer, never a data set or point.
 * Matched by their writes into those layers' per-data-set entries, and (a graph none of whose
 * layers picks a data set) a data set's identity, points and actions.
 */
function dropped(graph: GraphNode, old: FieldEntry): boolean {
  const alone = graph.layers
    .filter((l) => l.geom === 'refline' || l.geom === 'tile')
    .map((l) => `set:layers/{${l.id}}/series/`)
  // Roadmap 49c: a heat map's trees draw no data sets either.
  const noDataSets = !graph.layers.some(
    (l) => l.geom !== 'tile' && l.geom !== 'refline' && l.geom !== 'dendrogram',
  )
  const writes = old.writes.split('|')
  if (old.writes === '') return noDataSets && DATA_SET_ACTIONS.has(old.label)
  return writes.every(
    (w) =>
      alone.some((p) => w.startsWith(p)) ||
      (noDataSets && (w.startsWith('set:seriesOverrides/') || w.startsWith('set:pointOverrides/'))),
  )
}

/** Old labels that became one per element (matched by their start). */
const RENAMED_PATTERNS: readonly [string, RegExp][] = [
  ['Draw this layer for this data set', /^Show .+ for this data set$/],
  // The series picker: "Format Points (every value) of" → "Data set" (or "Curve", "Function").
  ['', /^(Data set|Curve|Function)$/],
]

/**
 * Roadmap 49c (decision 1251): a heat map's trees are layers of their own. Its "Dendrogram depth
 * (pt)" is each tree's size (a row tree's "Tree width (pt)", a column tree's "Tree height (pt)", writing its
 * `depth`); "Cluster rows" / "Cluster columns" also add or remove the axis' tree (`graph.addLayer`,
 * `graph.removeLayer` beside the same write).
 */
function movedField(old: FieldEntry, now: FieldEntry): boolean {
  if (old.label === 'Dendrogram depth (pt)' && /\/style\/cluster\/dendrogram$/.test(old.writes))
    return (
      now.kind === old.kind &&
      (now.label === 'Tree width (pt)' || now.label === 'Tree height (pt)') &&
      /^set:layers\/\{(rowTree|columnTree)\d*\}\/style\/depth$/.test(now.writes)
    )
  if (/^set:layers\/\{[^}]*\}\/style\/cluster\/(rows|columns)$/.test(old.writes)) {
    const own = now.writes
      .split('|')
      .filter((w) => w !== 'graph.addLayer' && w !== 'graph.removeLayer')
    return now.kind === old.kind && now.label === old.label && own.join('|') === old.writes
  }
  return false
}

function sameField(old: FieldEntry, now: FieldEntry): boolean {
  if (movedField(old, now)) return true
  if (old.writes !== now.writes && withoutClearings(old.writes) !== now.writes) return false
  if (
    REKINDED[`${old.kind}\u0000${old.label}`]?.some(
      (r) => r.kind === now.kind && r.label === now.label,
    )
  )
    return true
  if (old.kind !== now.kind) return false
  if (old.label === now.label) return true
  if (RENAMED[old.label]?.includes(now.label)) return true
  return RENAMED_PATTERNS.some(
    ([from, to]) =>
      (from === old.label || (from === '' && /^Format .+ of$/.test(old.label))) &&
      to.test(now.label),
  )
}

const BASELINE = JSON.parse(
  readFileSync(new URL('./formatInventory.v46.json', import.meta.url), 'utf8'),
) as Record<string, FieldEntry[]>

/**
 * The check, for the graphs whose index is `shard` modulo `of`: run in several files (each its own
 * worker) so no one process holds every example's places at once (one file ran out of memory in
 * CI's Linux runner). Each shard file mocks the ids as `countedIds` does.
 */
export function formatCompletenessShard(shard: number, of: number): void {
  describe(`the Format places by element (part ${shard + 1} of ${of})`, () => {
    it('render every field the stage-1 tabs rendered, for every kind of graph', async () => {
      const projects: [string, Project][] = []
      for (const e of EXAMPLES.filter((x) => x.section === 'examples')) {
        const p = await builtExample(e)
        if (p) projects.push([e.id, p])
      }
      await installDom()
      const React = await import('react')
      const { createRoot } = await import('react-dom/client')
      const { DocumentStore } = await import('@ps/engine')
      const { ExpandSections, LiveFields } = await import('../src/components/fields.tsx')
      const { ServicesContext } = await import('../src/context.tsx')
      const { FormatSections } = await import('../src/graph/format/sections.tsx')
      const route = await import('../src/graph/format/route.ts')
      const { seriesOfLayer } = await import('../src/graph/inspector/layers.ts')
      const host = document.body.appendChild(document.createElement('div'))
      const root = createRoot(host)
      const act = (fn: () => void) => React.act(fn)
      const render = (node: ReactNode) => {
        act(() => root.render(node))
        return host
      }
      const all = representativeGraphs(projects)
      expect(Object.keys(BASELINE).sort()).toEqual(all.map(([n]) => n).sort())
      const graphs = all.filter((_, i) => i % of === shard)
      projects.length = 0

      /** Every place of a graph: the elements a user can select. */
      const places = (project: Project, graph: GraphNode): FormatTarget[] => {
        const out: FormatTarget[] = [
          route.graphPlace(),
          route.TITLE_PLACE,
          route.axisPlace('x'),
          route.axisPlace('y'),
          ...(graph.axes.y2 ? [route.axisPlace('y2')] : []),
          route.LEGEND_PLACE,
        ]
        graph.annotations.forEach((a, index) => {
          out.push(a.type === 'bracket' ? { place: 'bracket', index } : { place: 'object', index })
        })
        // Roadmap 49b: every layer reached as a user reaches it — the front layer's view, then
        // › (`stepLayer`) through every layer to the back, the series picked kept where the layer
        // landed on draws it — each for every series and for one (the one kept, else its first).
        let pointDone = false
        const front = graph.layers.at(-1)
        let visited = 0
        for (
          let at: FormatTarget | null = front ? route.layerPlace(front.id) : null;
          at?.place === 'layer';
          at = route.stepLayer(graph, at, 1)
        ) {
          visited++
          const l = graph.layers.find((x) => x.id === (at as { layer: string }).layer)!
          out.push(route.layerPlace(l.id))
          const first = seriesOfLayer(project, graph, l, () => undefined)[0]
          if (!first || !route.picksSeries(l)) continue
          const pick: OneSeries =
            route.oneSeriesOf(at) ??
            (first.kind === 'output'
              ? { output: first.key }
              : first.kind === 'function'
                ? { fn: first.key }
                : { dataSet: first.key })
          at = route.layerView(l.id, pick)
          out.push(at)
          if ('dataSet' in pick && !pointDone) {
            pointDone = true
            out.push(route.pointPlace(pick.dataSet, 'r0s0', l.id))
            if (route.singleMarkName(graph, 'r0') !== 'data point')
              out.push(route.pointPlace(pick.dataSet, 'r0', l.id))
          }
        }
        expect(visited, graph.name).toBe(graph.layers.length)
        return out
      }

      const missing: string[] = []
      for (const [name, project, graph] of graphs) {
        const written: Command[] = []
        const ctx = recordingContext(project, graph, written)
        const services = {
          platform: {},
          store: new DocumentStore(project),
          engine: { subscribe: () => () => {}, version: 0, latest: () => undefined },
        }
        const now: FieldEntry[] = []
        for (const target of places(project, graph)) {
          act(() => root.render(null))
          now.push(
            ...(await inventory(
              render,
              act,
              React.createElement(
                ServicesContext.Provider,
                { value: services as never },
                React.createElement(
                  ExpandSections.Provider,
                  { value: true },
                  React.createElement(
                    LiveFields.Provider,
                    { value: true },
                    React.createElement(FormatSections, {
                      ctx: ctx as never,
                      target,
                      setTarget: () => {},
                    }),
                  ),
                ),
              ),
              written,
            )),
          )
        }
        for (const old of BASELINE[name] ?? [])
          if (!dropped(graph, old) && !now.some((n) => sameField(old, n)))
            missing.push(`${name}: ${old.kind} “${old.label}” ${old.writes}`)
      }
      act(() => root.unmount())
      expect(missing).toEqual([])
    }, 600_000)
  })
}
