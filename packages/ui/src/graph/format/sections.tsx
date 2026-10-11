import { type Layer, sourceTable } from '@ps/model'
import type { ReactNode } from 'react'
import { GroupSection, Section, SectionScopeContext, Select } from '../../components/fields.tsx'
import { AnnotationPanel } from '../inspector/AnnotationPanel.tsx'
import { AppearanceByVariableSection } from '../inspector/AppearanceByVariable.tsx'
import { CycleListsSection } from '../inspector/AppearanceTable.tsx'
import {
  AxisCommon,
  AxisExtra,
  AxisGridSection,
  AxisLabelsSection,
  AxisLineSection,
  AxisNumbersSection,
  AxisTicksSection,
  AxisTitleSection,
  RightAxisRemoveSection,
} from '../inspector/AxisPanel.tsx'
import type { PanelContext } from '../inspector/context.ts'
import {
  ColourSchemeFields,
  CopyFormatSection,
  hasOwnFormats,
  ResetLayerSeries,
  SeriesColor,
  YAxisSelect,
} from '../inspector/DataSetSection.tsx'
import { FunctionPanel } from '../inspector/FunctionPanel.tsx'
import {
  AddSection,
  AnnotationsListSection,
  ArrangementSection,
  BracketsSection,
  ChangeLayersSection,
  CurvesSection,
  DataSetsSection,
  FrameSection,
  FunctionsSection,
  GraphCommon,
  GraphTextSection,
  GraphTitleSection,
  LegendSection,
  LevelsSection,
  RightAxisSection,
  SizeSection,
} from '../inspector/GraphSections.tsx'
import {
  CommonLayerFields,
  hasCommonFields,
  isResultLayer,
  LayerFields,
  LayerNameFields,
  layerPart,
  ShowForDataSet,
} from '../inspector/LayerFields.tsx'
import { LayersSection } from '../inspector/LayersSection.tsx'
import { LegendEntrySection, LegendPanel } from '../inspector/LegendPanel.tsx'
import { graphSeries, layerPath, type SeriesItem, seriesOfLayer } from '../inspector/layers.ts'
import { PointLabelsSection } from '../inspector/PointLabelsSection.tsx'
import { PointPanel } from '../inspector/PointPanel.tsx'
import { RowsSection, SharedAxesSection } from '../inspector/SlicesSection.tsx'
import { SplitSection } from '../inspector/SplitSection.tsx'
import { MatchFormatSection } from '../MatchFormat.tsx'
import { RiskTableSection } from '../results/ResultPanels.tsx'
import {
  type AxisKey,
  type FormatTarget,
  layerPlace,
  layerView,
  type OneSeries,
  oneSeriesOf,
  pickKeys,
  picksSeries,
  seriesTarget,
} from './route.ts'

// Roadmap 46: what each place of the Format panel and dialog shows, as a table of sections.
// Stage 2 (decisions 910–919): a place is an element — the graph, its title, an axis, the legend,
// a layer (roadmap 49b: for every series it draws, one or several), a point, a bracket, a text
// box or line (`placeOf`) — and opens on its Common settings, the rest in sections that start
// closed, their state remembered per kind of element. Each section is wrapped in an element carrying its id (`data-format-section`),
// which `FormatPanel`'s reveal (and a field search) scroll to; a target's `section` opens one.

/** What a section is given: the panel's context, where it is, and the way to move elsewhere. */
export interface SectionProps {
  ctx: PanelContext
  target: FormatTarget
  /** Shows another place (a layer, a data set, a point) without closing the panel or dialog. */
  setTarget: (t: FormatTarget) => void
}

/** One block of fields in a place of the Format panel. */
export interface FormatSection {
  /** Stable within its place: the wrapper's `data-format-section`, what a reveal jumps to. */
  id: string
  render: (p: SectionProps) => ReactNode
  /** Open unless the user closed it (Common; the graph's layer list); else closed at first. */
  open?: boolean
  /**
   * Kept mounted while the place changes to another of the same kind (the graph's layer list,
   * which keeps its focus and scroll as a layer is chosen in it).
   */
  keep?: boolean
  /**
   * The graph's own settings shown in several places (the drawing order in the graph's and each
   * layer's): the Format search lists its fields once (roadmap 47).
   */
  shared?: boolean
}

/** The kinds of place, each with its sections. */
export type PlaceKind =
  | 'graph'
  | 'title'
  | 'axis'
  | 'legend'
  | 'layer'
  | 'point'
  | 'bracket'
  | 'object'

/** A target's kind of place (roadmap 49b: a layer's view whichever series it picks). */
export const placeOf = (t: FormatTarget): PlaceKind => t.place

const section = (
  id: string,
  render: (p: SectionProps) => ReactNode,
  opts: { open?: boolean; keep?: boolean; shared?: boolean } = {},
): FormatSection => ({ id, render, ...opts })

const shared = { shared: true }

const open = { open: true }

/** An axis section, for the axis a target names. */
const axisSection = (
  id: string,
  render: (p: { ctx: PanelContext; which: AxisKey }) => ReactNode,
  opts: { open?: boolean } = {},
) =>
  section(
    id,
    ({ ctx, target }) => (target.place === 'axis' ? render({ ctx, which: target.axis }) : null),
    opts,
  )

/** The sections of each kind of place, in order. */
export const FORMAT_SECTIONS: Readonly<Record<PlaceKind, readonly FormatSection[]>> = {
  graph: [
    section(
      'layers',
      ({ ctx, setTarget }) => (
        <LayersSection
          ctx={ctx}
          selected={undefined}
          onSelect={(id) => setTarget(layerPlace(id, 'layers'))}
        />
      ),
      { open: true, keep: true, shared: true },
    ),
    section('common', ({ ctx }) => <GraphCommon ctx={ctx} />, open),
    section('text', ({ ctx }) => <GraphTextSection ctx={ctx} />),
    section('frame', ({ ctx }) => <FrameSection ctx={ctx} />),
    section('size', ({ ctx }) => <SizeSection ctx={ctx} />),
    section('arrangement', ({ ctx }) => <ArrangementSection ctx={ctx} />),
    section('levels', ({ ctx }) => <LevelsSection ctx={ctx} />),
    section('dataSets', ({ ctx }) => <DataSetsSection ctx={ctx} />),
    // Roadmap 49a: the orders of shapes and line styles data sets take in turn.
    section('cycles', ({ ctx }) => <CycleListsSection ctx={ctx} />),
    section('rows', ({ ctx }) => <RowsSection ctx={ctx} />),
    section('curves', ({ ctx }) => <CurvesSection ctx={ctx} />),
    section('functions', ({ ctx }) => <FunctionsSection ctx={ctx} />),
    section('byVariable', ({ ctx }) => <AppearanceByVariableSection ctx={ctx} />, shared),
    section('legend', ({ ctx }) => <LegendSection ctx={ctx} />),
    section('brackets', ({ ctx }) => <BracketsSection ctx={ctx} />, shared),
    section('riskTable', ({ ctx }) => <RiskTableSection ctx={ctx} />),
    section('annotations', ({ ctx }) => <AnnotationsListSection ctx={ctx} />),
    section('add', ({ ctx }) => <AddSection ctx={ctx} />),
    section('rightAxis', ({ ctx }) => <RightAxisSection ctx={ctx} />),
    section('sharedAxes', ({ ctx }) => <SharedAxesSection ctx={ctx} />),
    section('changeLayers', ({ ctx }) => <ChangeLayersSection ctx={ctx} />),
    section('split', ({ ctx }) => <SplitSection ctx={ctx} />),
    section('matchFormat', ({ ctx }) => (
      <MatchFormatSection
        project={ctx.project}
        graph={ctx.graph}
        dispatch={(cmds, label) => ctx.dispatch(cmds, label)}
      />
    )),
    section('source', ({ ctx }) => {
      const table = sourceTable(ctx.project, ctx.graph.seriesSource.table, ctx.lookup)
      return (
        <p className="muted">
          {table ? `Data from the table “${table.name}”.` : 'The source table is missing.'}
        </p>
      )
    }),
  ],
  title: [section('common', ({ ctx }) => <GraphTitleSection ctx={ctx} />, open)],
  axis: [
    axisSection('common', (p) => <AxisCommon {...p} />, open),
    axisSection('numbers', (p) => <AxisNumbersSection {...p} />),
    axisSection('labels', (p) => <AxisLabelsSection {...p} />),
    axisSection('title', (p) => <AxisTitleSection {...p} />),
    axisSection('ticks', (p) => <AxisTicksSection {...p} />),
    axisSection('tickValues', (p) => <AxisExtra {...p} part="tickValues" />),
    axisSection('grid', (p) => <AxisGridSection {...p} />),
    axisSection('line', (p) => <AxisLineSection {...p} />),
    axisSection('breaks', (p) => <AxisExtra {...p} part="breaks" />),
    axisSection('scaleBar', (p) => <AxisExtra {...p} part="scaleBar" />),
    axisSection('treatments', (p) => <AxisExtra {...p} part="treatments" />),
    axisSection('spans', (p) => <AxisExtra {...p} part="spans" />),
    axisSection('rightAxis', (p) => <RightAxisRemoveSection {...p} />),
  ],
  legend: [
    section('legendEntry', (p) => <LegendEntrySection {...p} />, open),
    section('common', ({ ctx }) => <LegendPanel ctx={ctx} part="common" />, open),
    section('entries', ({ ctx }) => <LegendPanel ctx={ctx} part="entries" />),
    section('text', ({ ctx }) => <LegendPanel ctx={ctx} part="text" />),
    section('box', ({ ctx }) => <LegendPanel ctx={ctx} part="box" />),
  ],
  // Roadmap 49b: one layer at a time — the layer's own sections for the series picked (every
  // one, one, or several selected together); the arrows above (`LayerSteps`) step to the others.
  layer: [
    section('legendEntry', (p) => <LegendEntrySection {...p} />, open),
    section('picker', (p) => <SeriesPicker {...p} />, open),
    section('colour', (p) => <SeriesColourRow {...p} />, open),
    section('common', (p) => <LayerCommon {...p} />, open),
    section('function', ({ ctx, target }) => {
      const one = oneSeriesOf(target)
      return one && 'fn' in one ? <FunctionPanel ctx={ctx} id={one.fn} /> : null
    }),
    section('fields', (p) => <LayerOwnFields {...p} />, open),
    section('labels', (p) => <LayerLabels {...p} />),
    section('byVariable', ({ ctx }) => <AppearanceByVariableSection ctx={ctx} />, shared),
    section(
      'layers',
      ({ ctx, target, setTarget }) =>
        target.place === 'layer' ? (
          <LayersSection
            ctx={ctx}
            selected={target.layer}
            onSelect={(id) => setTarget(layerPlace(id, 'layers'))}
          />
        ) : null,
      shared,
    ),
    section('advanced', (p) => <LayerAdvanced {...p} />),
    section('copy', ({ ctx, target }) => {
      const v = viewOf(ctx, target)
      const one = v && oneOf(v)
      return one ? <CopyFormatSection ctx={ctx} item={one} /> : null
    }),
  ],
  point: [
    section(
      'point',
      ({ ctx, target, setTarget }) => {
        if (target.place !== 'point') return null
        const { dataSet, point, layer } = target
        return (
          <PointPanel
            ctx={ctx}
            dataSet={dataSet}
            point={point}
            {...(layer === undefined ? {} : { layer })}
            // Roadmap 49b: its data set in the layer it was picked in (else the front-most).
            onWholeDataSet={() => setTarget(seriesTarget(ctx.graph, { dataSet }, layer))}
          />
        )
      },
      open,
    ),
  ],
  bracket: [
    section(
      'bracket',
      ({ ctx, target }) =>
        target.place === 'bracket' ? <AnnotationPanel ctx={ctx} index={target.index} /> : null,
      open,
    ),
    section('brackets', ({ ctx }) => <BracketsSection ctx={ctx} />, shared),
  ],
  object: [
    section(
      'object',
      ({ ctx, target }) =>
        target.place === 'object' ? <AnnotationPanel ctx={ctx} index={target.index} /> : null,
      open,
    ),
  ],
}

/** The sections of a target's place. */
export const sectionsFor = (t: FormatTarget): readonly FormatSection[] =>
  FORMAT_SECTIONS[placeOf(t)]

/** The section a target asks to open, if any. */
const sectionOf = (t: FormatTarget): string | undefined => ('section' in t ? t.section : undefined)

/**
 * A target's options: its place's sections, each in its marked wrapper, remembering their open
 * state per kind of place; the one the target names (or `reveal`, a search's jump) open.
 */
export function FormatSections(p: SectionProps & { reveal?: string | undefined }): ReactNode {
  const kind = placeOf(p.target)
  const asked = sectionOf(p.target)
  // One set of fields per place: a field's text never carries over to another element.
  const place = JSON.stringify(p.target)
  return sectionsFor(p.target).map((s) => (
    <SectionScopeContext.Provider
      key={s.keep ? `${kind}/${s.id}` : `${s.id}|${place}`}
      value={{ kind, collapsed: !s.open, force: s.id === asked || s.id === p.reveal }}
    >
      <div className="format-section" data-format-section={s.id}>
        {s.render(p)}
      </div>
    </SectionScopeContext.Provider>
  ))
}

// --- A layer's view (roadmap 49b) ----------------------------------------------------------

/** What a layer's view shows: the layer, the series it draws, and those picked. */
interface View {
  layer: Layer
  /** Every series the layer draws. */
  items: readonly SeriesItem[]
  /** The series picked (one, or several data sets; empty: gone from the graph); null: all. */
  picked: readonly SeriesItem[] | null
}

/** A target's layer view (none: another place, or the layer is gone). */
function viewOf(ctx: PanelContext, target: FormatTarget): View | null {
  if (target.place !== 'layer') return null
  const layer = ctx.graph.layers.find((l) => l.id === target.layer)
  if (!layer) return null
  const items = seriesOfLayer(ctx.project, ctx.graph, layer, ctx.lookup)
  if (!target.series) return { layer, items, picked: null }
  const picked = pickKeys(target.series).flatMap((k) => items.find((i) => i.key === k) ?? [])
  return { layer, items, picked }
}

/** The one series a view picks. */
const oneOf = (v: View): SeriesItem | undefined =>
  v.picked?.length === 1 ? v.picked[0] : undefined

/** The series a view's fields format: every one (null), one (its key) or several (their keys). */
const keysOf = (v: View): string | readonly string[] | null =>
  v.picked === null ? null : v.picked.length === 1 ? v.picked[0]!.key : v.picked.map((i) => i.key)

/** The pick a series picker value names. */
function pickFrom(v: string): OneSeries {
  const [kind, k] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)]
  return kind === 'output' ? { output: k } : kind === 'function' ? { fn: k } : { dataSet: k }
}

/**
 * Which of a layer's series its view formats: all, one, or (several data sets selected on the
 * canvas) those. Named "Data set" (or "Curve", "Function"). Layers without data sets of their
 * own to pick (a heat map, the grand mean, the Significance layer, lines at values…) have none.
 */
function SeriesPicker({ ctx, target, setTarget }: SectionProps) {
  const v = viewOf(ctx, target)
  if (!v || !picksSeries(v.layer) || !v.items.length) return null
  const { layer } = v
  const kind = (v.picked?.[0] ?? v.items[0])!.kind
  const items = v.items.filter((i) => i.kind === kind)
  const noun = kind === 'dataSet' ? 'Data set' : kind === 'output' ? 'Curve' : 'Function'
  const several = v.picked && v.picked.length > 1 ? v.picked.length : 0
  const one = oneOf(v)
  const options = [
    {
      value: 'all',
      label:
        kind === 'dataSet' ? 'All data sets' : kind === 'output' ? 'All curves' : 'All functions',
    },
    ...(several ? [{ value: 'several', label: `${several} data sets selected` }] : []),
    ...items.map((i) => ({ value: `${i.kind}:${i.key}`, label: i.title })),
  ]
  return (
    <div className="series-picker">
      <Select
        label={noun}
        value={several ? 'several' : one ? `${one.kind}:${one.key}` : 'all'}
        options={options}
        onChange={(value) => {
          if (value === 'several') return
          setTarget(value === 'all' ? layerPlace(layer.id) : layerView(layer.id, pickFrom(value)))
        }}
      />
    </div>
  )
}

/**
 * Roadmap 49b (the user's choice): one series picked, its own colour — the colour every layer
 * draws it in — as a row at the top of the view.
 */
function SeriesColourRow({ ctx, target }: SectionProps) {
  const v = viewOf(ctx, target)
  const one = v && oneOf(v)
  if (!one) return null
  const dataSets = graphSeries(ctx.project, ctx.graph, ctx.lookup).filter(
    (i) => i.kind === 'dataSet',
  ).length
  return (
    <div className="series-colour-row">
      <SeriesColor ctx={ctx} item={one} dataSets={dataSets} />
    </div>
  )
}

/**
 * A layer's Common settings: for every series, their colours (the colour scheme) and the layer's
 * own Common fields (a line's width and style, error bars' kind and cap width); for the series
 * picked, those fields alone.
 */
function LayerCommon({ ctx, target }: SectionProps) {
  const v = viewOf(ctx, target)
  if (!v) return <p className="muted">This layer is no longer on the graph.</p>
  const { layer, items } = v
  if (v.picked?.length === 0)
    return <p className="muted">This data set is no longer on the graph.</p>
  // A line or band at values, an analysis' results: no data sets to colour.
  if (isResultLayer(layer)) return null
  if (v.picked)
    return hasCommonFields(layer) ? (
      <Section title="Common">
        <CommonLayerFields ctx={ctx} layer={layer} items={items} seriesKey={keysOf(v)} />
      </Section>
    ) : null
  // Roadmap 46b: a Significance layer's points are its classes' colours: its Common, the cut-offs.
  const classed = layer.stat.kind === 'threshold'
  return (
    <Section title="Common">
      {!classed && <ColourSchemeFields ctx={ctx} items={items} />}
      {hasCommonFields(layer) && (
        <CommonLayerFields ctx={ctx} layer={layer} items={items} seriesKey={null} />
      )}
    </Section>
  )
}

/**
 * A layer's own fields for the series picked (every one, one or several), as one section named by
 * what it draws ("Symbols", "Bars", "Error bars"…).
 */
function LayerOwnFields({ ctx, target }: SectionProps) {
  const v = viewOf(ctx, target)
  if (!v || v.picked?.length === 0) return null
  const { layer, items } = v
  const fields = (
    <LayerFields
      key={layer.id}
      ctx={ctx}
      layer={layer}
      items={items}
      seriesKey={keysOf(v)}
      common={hasCommonFields(layer)}
    />
  )
  // Lines and bands at values, an analysis' results, the Significance layer: their own sections.
  if (isResultLayer(layer) || layer.stat.kind === 'threshold') return fields
  return <GroupSection title={layerPart(layer).title}>{fields}</GroupSection>
}

/**
 * Labels on the points of the series picked: a curve's, the data sets'; every data set's of a
 * layer drawing the table's data sets.
 */
function LayerLabels({ ctx, target }: SectionProps) {
  const v = viewOf(ctx, target)
  const { graph } = ctx
  if (!v) return null
  const hasX = graph.frame === 'xy'
  if (v.picked) {
    const first = v.picked[0]
    if (!first || first.kind === 'function') return null
    return (
      <PointLabelsSection
        ctx={ctx}
        items={
          first.kind === 'output' ? { output: first.key } : { dataSets: v.picked.map((i) => i.key) }
        }
        hasX={hasX}
      />
    )
  }
  const { layer, items } = v
  const dataSets = items.filter((i) => i.kind === 'dataSet')
  const whole = graph.frame === 'polar' || graph.layers.some((l) => l.stat.kind === 'fraction')
  if (
    !dataSets.length ||
    (layer.data && layer.data.from !== 'table') ||
    whole ||
    graph.frame === 'matrix'
  )
    return null
  return (
    <PointLabelsSection ctx={ctx} items={{ dataSets: dataSets.map((i) => i.key) }} hasX={hasX} />
  )
}

/**
 * A layer's Advanced settings: for one series picked, the Y axis it is on, whether this layer
 * draws it, taking a curve off the graph; the layer's name, its legend entry, its data sets' own
 * formats reset.
 */
function LayerAdvanced({ ctx, target }: SectionProps) {
  const v = viewOf(ctx, target)
  if (!v) return null
  const { layer } = v
  const one = oneOf(v)
  return (
    <Section title="Advanced">
      {one && <YAxisSelect ctx={ctx} item={one} />}
      {one && <ShowForDataSet ctx={ctx} layer={layer} seriesKey={one.key} />}
      {one?.kind === 'output' && <RemoveCurve ctx={ctx} layer={layer} item={one} />}
      <LayerNameFields ctx={ctx} layer={layer} />
      {hasOwnFormats(layer) && <ResetLayerSeries ctx={ctx} layer={layer} />}
    </Section>
  )
}

/** Takes an analysis' curve off the graph (it stays in the analysis' results). */
function RemoveCurve({ ctx, layer, item }: { ctx: PanelContext; layer: Layer; item: SeriesItem }) {
  const { graph } = ctx
  if (layer.data?.from !== 'outputs') return null
  const rest = layer.data.series.filter((s) => s.id !== item.key)
  return (
    <button
      type="button"
      className="danger"
      onClick={() => {
        ctx.dispatch(
          [
            {
              type: 'node.set',
              id: graph.id,
              path: layerPath(layer.id, 'data'),
              value: { from: 'outputs', series: rest },
            },
            ...graph.layers
              .filter((l) => l.series?.[item.key])
              .map((l) => ({
                type: 'node.set' as const,
                id: graph.id,
                path: layerPath(l.id, 'series', item.key),
                value: undefined,
              })),
            {
              type: 'node.set',
              id: graph.id,
              path: ['seriesOverrides', item.key],
              value: undefined,
            },
          ],
          'Remove curve',
        )
        ctx.onSelect(null)
      }}
    >
      Remove curve from graph
    </button>
  )
}
