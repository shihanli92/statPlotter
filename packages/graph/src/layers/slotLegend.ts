import { type Layer, sourceTable } from '@ps/model'
import { graphRows } from '../data.ts'
import { type LegendEntry, reversedEntries, SWATCH } from '../layout/legend.ts'
import { isMapped, mappedRows, mappedVariables } from '../mapped.ts'
import { glyphLayer, type LegendGlyph } from './glyphs.ts'
import type { LayerKit } from './kit.ts'
import type { GraphLooks } from './looks.ts'

// The legends of category and grouped graphs: each data set's sample, and the variables mapped
// to appearance. Shared by both frames (audit 2, G12: no frame imports another).

/**
 * A category or grouped graph of variables' mapped appearance (roadmap 34b): the rows it draws,
 * and on a grouped graph its groups' variable (their colour is theirs). Undefined when nothing is
 * mapped besides the axes.
 */
export function frameLooks(kit: LayerKit): GraphLooks | undefined {
  const { graph } = kit
  if (!isMapped(graph) || !graph.mapping) return undefined
  // Only points of every row take a row's look (a text colour variable's groups are data sets).
  if (!kit.drawn('points', (l) => l.stat.kind === 'identity').length) return undefined
  const table = sourceTable(kit.ctx.project, graph.seriesSource.table, kit.ctx.result)
  if (!table) return undefined
  const rows = graphRows(graph, table)
  const vars = mappedVariables(table, graph.mapping)
  const group = graph.frame === 'grouped' ? vars?.group : undefined
  return kit.looks({
    drawn: mappedRows(table, graph, rows),
    ...(group ? { seriesVariable: group.id } : {}),
  })
}

/**
 * A category or grouped graph's legend: its data sets (in reverse when asked; left out where they
 * are a graph of variables' categories), headed by their variable when other variables' legends
 * follow or a heading is given, then those of the variables mapped to appearance (roadmap 34b).
 */
export function legendWith(
  kit: LayerKit,
  looks: GraphLooks | undefined,
  series: LegendEntry[],
  o: { keep: boolean; title?: string; extra?: readonly LegendEntry[] },
): { entries: LegendEntry[]; sampleWidth: number } {
  const { legend } = kit.graph
  // Roadmap 47b: not reversed when the legend's order lists one of the group's entries.
  const own = [
    ...(o.keep ? reversedEntries(legend, series, [...series, ...(o.extra ?? [])]) : []),
    ...(o.extra ?? []),
  ]
  if (!looks) return { entries: own, sampleWidth: SWATCH }
  const guides = looks.guides(SWATCH)
  const title = legend.titles?.color ?? (guides.entries.length ? o.title : undefined)
  const heading: LegendEntry[] =
    own.length && title
      ? [
          {
            key: 'aes/groups',
            id: 'legend/aes/groups',
            target: ['legend'],
            label: title,
            sample: () => [],
            fixed: true,
          },
        ]
      : []
  return { entries: [...heading, ...own, ...guides.entries], sampleWidth: guides.sampleWidth }
}

type SwatchGlyph = Exclude<LegendGlyph, 'polygon' | 'arrow'>

/** Glyphs of category and grouped graphs' layers besides bars, boxes and points. */
const LINE_GLYPHS: readonly LegendGlyph[] = ['line', 'area', 'band', 'errorbar', 'center']

/**
 * A data set's legend sample: the swatch of a bar (or box, or violin) layer drawing it, else the
 * symbol of a points layer drawing it, else (audit 2, G4) the glyph of another layer drawing it
 * (`glyphLayer`: a line, band, error bar or centre line). When no layer draws the data set, the
 * symbol of its hidden points layer (its format still names the data set); without one, none.
 */
export function legendGlyph(
  kit: LayerKit,
  key: string,
): [SwatchGlyph, Layer] | [SwatchGlyph | null, undefined] {
  const shown = (l: Layer) => kit.shows(l, key)
  const bar = kit.drawn('bar').find(shown)
  if (bar) return ['bar', bar]
  const box = kit.graph.layers.find(
    (l) => (l.geom === 'box' || l.geom === 'violin') && l.visible !== false && shown(l),
  )
  if (box) return ['box', box]
  const points = kit.drawn('points').find(shown)
  if (points) return ['points', points]
  const other = glyphLayer(
    kit.graph.layers.filter((l) => kit.data(l).from === 'table' && shown(l)),
    LINE_GLYPHS,
  )
  if (other) return other as [SwatchGlyph, Layer]
  const hidden = kit.all('points')[0]
  return hidden ? ['points', hidden] : [null, undefined]
}
