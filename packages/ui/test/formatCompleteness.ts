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
  Colour: ['Title colour', 'Tick label colour', 'Legend text colour', 'Colour of all text'],
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
}

/** Old labels that became one per element (matched by their start). */
const RENAMED_PATTERNS: readonly [string, RegExp][] = [
  ['Draw this layer for this data set', /^Show .+ for this data set$/],
  // The series picker: "Format Points (every value) of" → "Data set" (or "Curve", "Function").
  ['', /^(Data set|Curve|Function)$/],
]

function sameField(old: FieldEntry, now: FieldEntry): boolean {
  if (old.kind !== now.kind || old.writes !== now.writes) return false
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
        let pointDone = false
        for (const l of graph.layers) {
          out.push(route.layerPlace(l.id))
          const first = seriesOfLayer(project, graph, l, () => undefined)[0]
          if (!first) continue
          const pick: OneSeries =
            first.kind === 'output'
              ? { output: first.key }
              : first.kind === 'function'
                ? { fn: first.key }
                : { dataSet: first.key }
          out.push(route.seriesPlace(pick, l.id))
          if (first.kind === 'dataSet' && !pointDone) {
            pointDone = true
            out.push(route.seriesPlace({ dataSet: first.key, point: 'r0s0' }, l.id))
            if (route.singleMarkName(graph, 'r0') !== 'data point')
              out.push(route.seriesPlace({ dataSet: first.key, point: 'r0' }, l.id))
          }
        }
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
          if (!now.some((n) => sameField(old, n)))
            missing.push(`${name}: ${old.kind} “${old.label}” ${old.writes}`)
      }
      act(() => root.unmount())
      expect(missing).toEqual([])
    }, 600_000)
  })
}
