import {
  type AxisSpec,
  type ContinuousAxisSpec,
  type DataTable,
  type Frame,
  type GraphLook,
  type GraphNode,
  type Layer,
  type LevelMeasure,
  levelsInTable,
  newNodeId,
  subcolumnCount,
  titleRuns,
  type VariableMapping,
} from '@ps/model'
import { ESTIMATION_AXIS } from './layers/geoms/difference.ts'
import { defaultContinuousAxis } from './layout/common.ts'
import { mappedVariables } from './mapped.ts'
import { type NewLooks, newLayerLooks } from './newDefaults.ts'
import { percentOfWhole } from './theme.ts'

// A new graph's scaffold (roadmap 33c): the size, axes and legend its frame and layers call for
// (a category frame's data set titles along X, a heat map's categorical axes, survival's percent
// axis…). New graphs, and graphs whose layers move to another frame, take it.

/** What a graph's scaffold depends on: its frame, look and layers (and mapped variables). */
export interface GraphSpec {
  frame: Frame
  /** The context new graphs are made in (absent: the frame's), read through the theme. */
  look?: GraphLook | undefined
  layers: readonly Layer[]
  /** A graph of a multiple-variables table's variables (roadmap 34a). */
  mapping?: VariableMapping | null
}

/** The size, axes and legend of a new graph of a table with these layers. */
export interface Scaffold {
  size: GraphNode['size']
  axes: GraphNode['axes']
  legend: GraphNode['legend']
}

const title = (text: string) => ({ content: [{ text }] })

/** A continuous axis with a title. */
const titled = (text: string): ContinuousAxisSpec => ({
  ...defaultContinuousAxis(),
  title: title(text),
})

function columnScaffold(table: DataTable): Scaffold {
  const n = Math.max(table.dataSets.length, 1)
  // Nested groups show their subjects side by side, so each group needs room for them.
  const subjects = table.tableKind === 'nested' ? subcolumnCount(table.yFormat) : 1
  const perGroup = Math.max(54, 20 * subjects + 12)
  return {
    size: { plotWidth: Math.min(360, Math.max(96, perGroup * n)), plotHeight: 180 },
    axes: {
      x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0 },
      y: defaultContinuousAxis(),
    },
    legend: { show: false, position: 'right' },
  }
}

function xyScaffold(table: DataTable): Scaffold {
  return {
    size: { plotWidth: 216, plotHeight: 162 },
    axes: {
      x: {
        ...defaultContinuousAxis(),
        title: table.x?.title ? { content: titleRuns(table.x.title, table.x.titleRich) } : null,
      },
      y: defaultContinuousAxis(),
    },
    legend: { show: true, position: 'right' },
  }
}

/** A variable's title as an axis title (none when untitled). */
const varTitle = (d: DataTable['dataSets'][number] | undefined) =>
  d?.title ? { content: titleRuns(d.title, d.titleRich) } : null

/**
 * What a text × text graph's value axis says: what it counts, or (bars stacked as percents)
 * percents within each category (`cat`: the X variable's title).
 */
export function measureTitle(measure: LevelMeasure | 'stacked', cat: string): string {
  if (measure === 'count') return 'Count'
  if (measure === 'percentOfTotal') return 'Percent of total'
  return cat ? `Percent within ${cat}` : 'Percent within each category'
}

/**
 * A graph of variables (roadmap 34a): a slot per level, groups within them; the categorical axis
 * titled after the text variable, the value axis after the number variable (or what text × text
 * counts); a heat map's axes after its two variables.
 */
function mappedScaffold(table: DataTable, spec: GraphSpec, mapping: VariableMapping): Scaffold {
  const vars = mappedVariables(table, mapping)
  const column = columnScaffold(table)
  const cats = Math.max(1, vars ? levelsInTable(vars.cat).length : 1)
  const groups = vars?.group ? Math.max(1, levelsInTable(vars.group).length) : 1
  const categorical = (d: DataTable['dataSets'][number] | undefined): AxisSpec => ({
    ...(column.axes.x as Extract<AxisSpec, { type: 'categorical' }>),
    title: varTitle(d),
  })
  // Bars stacked as percents of each category: whatever is counted, that is what they show.
  const percent = spec.layers.some(
    (l) => l.geom === 'bar' && l.position?.kind === 'stack' && !!l.position.percent,
  )
  const counted = percent ? 'stacked' : (mapping.measure ?? 'count')
  const value = vars?.value
    ? titled(vars.value.title ?? '')
    : titled(measureTitle(counted, vars?.cat.title ?? ''))
  if (vars?.value && !vars.value.title) value.title = null
  if (spec.frame === 'matrix') {
    const m = scaffoldFor(table, { ...spec, mapping: null })
    const cell = Math.max(8, Math.min(24, 216 / Math.max(cats, groups)))
    return {
      size: {
        plotWidth: Math.min(432, Math.max(72, cell * cats)),
        plotHeight: Math.min(432, Math.max(72, cell * groups)),
      },
      axes: {
        x: { ...m.axes.x, title: varTitle(vars?.cat) } as AxisSpec,
        y: { ...m.axes.y, title: varTitle(vars?.group) } as AxisSpec,
      },
      legend: m.legend,
    }
  }
  const grouped = spec.frame === 'grouped'
  const per = grouped ? Math.max(30 * groups, 54) : 54
  return {
    size: { plotWidth: Math.min(432, Math.max(96, per * cats)), plotHeight: 180 },
    axes: { x: categorical(vars?.cat), y: value },
    legend: { show: (grouped && !!vars?.group) || guided(table, mapping), position: 'right' },
  }
}

/**
 * Whether variables mapped to appearance give a graph legends of their own (roadmap 34b): a shape
 * or size variable, or a number variable's colours (a text colour variable's are the groups').
 */
function guided(table: DataTable, m: Partial<Record<'color' | 'shape' | 'size', string>>): boolean {
  const type = (k: string | undefined) => table.dataSets.find((d) => d.id === k)
  return !!(type(m.shape) || type(m.size) || (type(m.color) && !type(m.color)!.text))
}

/** The size, axes and legend a new graph of `table` drawing `spec` starts with. */
export function scaffoldFor(table: DataTable, spec: GraphSpec): Scaffold {
  if (
    spec.mapping &&
    table.tableKind === 'multipleVariables' &&
    (spec.frame === 'category' || spec.frame === 'grouped' || spec.frame === 'matrix') &&
    mappedVariables(table, spec.mapping)
  )
    return mappedScaffold(table, spec, spec.mapping)
  const column = columnScaffold(table)
  switch (spec.frame) {
    case 'category': {
      if (percentOfWhole(spec)) {
        const n = Math.max(table.dataSets.length, 1)
        return {
          size: { plotWidth: Math.min(360, Math.max(80, 60 * n)), plotHeight: 180 },
          axes: {
            x: column.axes.x,
            y: {
              ...defaultContinuousAxis(),
              title: title('Percent of total'),
              range: { min: 0, max: 100 },
              ticks: { interval: 25, minor: 0 },
            },
          },
          legend: { show: true, position: 'right' },
        }
      }
      // An estimation plot formats its difference axis as the right Y axis.
      if (spec.layers.some((l) => l.geom === 'difference'))
        return { ...column, axes: { ...column.axes, y2: ESTIMATION_AXIS } }
      return column
    }
    case 'grouped': {
      const groups = Math.max(table.rowCount, 1)
      const width = 30 * groups * Math.max(table.dataSets.length, 1)
      // Bars stacked as percents of each row: the value axis says so.
      const percent = spec.layers.some(
        (l) => l.geom === 'bar' && l.position?.kind === 'stack' && !!l.position.percent,
      )
      const contingency = table.tableKind === 'contingency'
      const y = percent
        ? titled(contingency ? 'Percent of subjects' : 'Percent of total')
        : contingency
          ? titled('Number of subjects')
          : column.axes.y
      return {
        size: { plotWidth: Math.min(432, Math.max(180, width)), plotHeight: 180 },
        axes: { x: column.axes.x, y },
        legend: { show: true, position: 'right' },
      }
    }
    case 'polar': {
      const n = Math.max(table.dataSets.length, 1)
      const hidden = (a: AxisSpec): AxisSpec => ({ ...a, show: false })
      return {
        size: { plotWidth: Math.min(540, 160 * n), plotHeight: 160 },
        axes: { x: hidden(column.axes.x), y: hidden(column.axes.y) },
        legend: { show: true, position: 'right' },
      }
    }
    case 'matrix': {
      const cols = Math.max(table.dataSets.filter((d) => !d.text).length, 1)
      // Roadmap 34g: a dot plot's rows are its group variable's levels, its legend the dots'.
      const dots = spec.layers.find((l) => l.stat.kind === 'dotplot')
      const group = table.dataSets.find((d) => d.id === dots?.aes?.group && !!d.text)
      if (dots) {
        const levels = Math.max(group ? levelsInTable(group).length : 1, 1)
        const cell = Math.max(12, Math.min(24, 288 / Math.max(cols, levels)))
        const bare = { tickStyle: { direction: 'none' as const } }
        return {
          size: {
            plotWidth: Math.min(540, Math.max(72, cell * cols)),
            plotHeight: Math.min(540, Math.max(72, cell * levels)),
          },
          axes: {
            x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0, ...bare },
            y: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0, ...bare },
          },
          legend: { show: true, position: 'right' },
        }
      }
      const rows = Math.max(table.rowCount, 1)
      const cell = Math.max(8, Math.min(24, 216 / Math.max(cols, rows)))
      const bare = { tickStyle: { direction: 'none' as const } }
      return {
        size: {
          plotWidth: Math.min(432, Math.max(72, cell * cols)),
          plotHeight: Math.min(432, Math.max(72, cell * rows)),
        },
        axes: {
          x: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0, ...bare },
          y: { type: 'categorical', title: null, labels: 'dataSetTitles', rotation: 0, ...bare },
        },
        legend: { show: false, position: 'right' },
      }
    }
    case 'xy': {
      const xy = xyScaffold(table)
      if (spec.layers.some((l) => l.stat.kind === 'km'))
        return {
          ...xy,
          axes: {
            x: xy.axes.x,
            y: { ...titled('Percent survival'), ticks: { interval: 25, minor: 0 } },
          },
        }
      // A histogram: the values along X, what the bars measure up the Y axis; of a variable
      // (roadmap 34f): X titled after it, a legend of its groups.
      const binLayer = spec.layers.find((l) => l.stat.kind === 'bin')
      const bin = binLayer?.stat
      if (bin?.kind === 'bin') {
        const aes = binLayer?.aes
        const x = aes ? table.dataSets.find((d) => d.id === aes.x) : undefined
        return {
          ...xy,
          axes: {
            x: { ...defaultContinuousAxis(), ...(aes ? { title: varTitle(x) } : {}) },
            y: titled(
              { count: 'Number of values', percent: 'Percent', fraction: 'Fraction' }[
                bin.measure ?? 'count'
              ],
            ),
          },
          legend: { show: aes ? !!aes.color : table.dataSets.length > 1, position: 'right' },
        }
      }
      const aes = spec.layers.find((l) => l.geom === 'points' && l.aes)?.aes
      if (aes) {
        // Bubbles: the axes titled after their variables.
        const varTitle = (key: string | undefined): AxisSpec => {
          const d = table.dataSets.find((x) => x.id === key)
          return {
            ...defaultContinuousAxis(),
            title: d?.title ? { content: titleRuns(d.title, d.titleRich) } : null,
          }
        }
        // Roadmap 34g: densities' colour bars, points coloured by density.
        const density = spec.layers.some(
          (l) =>
            l.geom === 'hex' ||
            l.geom === 'raster' ||
            l.geom === 'contour' ||
            (l.style as { colorBy?: string } | undefined)?.colorBy === 'density',
        )
        return {
          size: { plotWidth: 216, plotHeight: 180 },
          axes: { x: varTitle(aes.x), y: varTitle(aes.y) },
          legend: { show: !!(aes.size || aes.color || aes.shape) || density, position: 'right' },
        }
      }
      return xy
    }
  }
}

/**
 * A new graph of a table drawing `spec` (drawn layer by layer, the default). A graph of
 * variables keeps its mapping, turned (categories down the left) when Y is the text variable.
 */
export function newGraphNode(
  table: DataTable,
  spec: GraphSpec & { preset?: string },
  name?: string,
  /** Audit 3: the looks new layers start with ('new', `newLayerLooks`) or the theme's. */
  looks: NewLooks = 'new',
): GraphNode {
  const scaffold = scaffoldFor(table, spec)
  const mapping = spec.mapping ?? undefined
  const turned = !!mapping && mappedVariables(table, mapping)?.axes === 'nt'
  return {
    kind: 'graph',
    id: newNodeId(),
    name: name ?? table.name,
    frame: spec.frame,
    layers: looks === 'new' ? newLayerLooks(spec.layers) : [...spec.layers],
    ...(spec.look ? { look: spec.look } : {}),
    ...(spec.preset ? { preset: spec.preset } : {}),
    seriesSource: { table: table.id, include: 'all' },
    seriesOverrides: {},
    size: scaffold.size,
    axes: scaffold.axes,
    annotations: [],
    legend: scaffold.legend,
    title: title(table.name),
    style: turned ? { orientation: 'horizontal' } : {},
    ...(mapping ? { mapping } : {}),
  }
}
