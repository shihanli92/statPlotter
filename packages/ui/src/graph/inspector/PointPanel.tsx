import {
  identityStyle,
  layerStyle,
  pointOverride,
  type ResolvedSeriesStyle,
  resolveColor,
  resolveSeries,
} from '@ps/graph'
import {
  type DataTable,
  type GraphNode,
  type Layer,
  labelRuns,
  type Project,
  parsePointKey,
  type ResultLookup,
  sourceTable,
  statOf,
  toLabel,
} from '@ps/model'
import { ColorField } from '../../components/ColorPicker.tsx'
import { Checkbox, NumberInput, Section, Select } from '../../components/fields.tsx'
import { RichTextField, SHAPES } from '../../components/formatFields.tsx'
import { singleMarkName } from '../format/route.ts'
import { effectiveText, type PanelContext } from './context.ts'

/** "WT · Day 3 · replicate 2": which point a point key names, in the table's own words. */
export function describePoint(
  project: Project,
  graph: GraphNode,
  dataSet: string,
  key: string,
  lookup?: ResultLookup,
): string {
  const table = sourceTable(project, graph.seriesSource.table, lookup)
  const p = parsePointKey(key)
  if (table?.kind !== 'table' || !p) return key
  const ds = table.dataSets.find((d) => d.id === dataSet)
  const parts = [ds?.title || 'Data set']
  const x = table.x?.subcolumns[0]?.values[p.row]
  const title = table.rowTitles?.[p.row]
  parts.push(
    title
      ? `“${title}” (row ${p.row + 1})`
      : x !== undefined && x !== null
        ? `X = ${x} (row ${p.row + 1})`
        : `row ${p.row + 1}`,
  )
  if (p.sub === undefined) parts.push('mean of the row')
  else if (table.tableKind === 'nested') {
    // Nested: the subcolumn is a subject, the row one of its replicate measurements.
    parts.splice(1, 0, ds?.subcolumnTitles?.[p.sub] || `subject ${p.sub + 1}`)
  } else if ((ds?.subcolumns.length ?? 1) > 1) parts.push(`replicate ${p.sub + 1}`)
  return parts.join(' · ')
}

/**
 * The look of a data set's marks of a kind (its symbols, bars or boxes): the layer it was picked
 * in when that draws them, else the first shown layer that does.
 */
function markStyle(
  ctx: PanelContext,
  dataSet: string,
  geoms: readonly Layer['geom'][],
  layerId?: string,
): ResolvedSeriesStyle {
  const { graph, theme } = ctx
  const draws = (l: Layer) => geoms.includes(l.geom) && l.visible !== false
  const layer = graph.layers.find((l) => l.id === layerId && draws(l)) ?? graph.layers.find(draws)
  return layer
    ? layerStyle(theme, graph, layer, dataSet, statOf(layer, dataSet))
    : identityStyle(theme, graph, dataSet)
}

/** Format of one point: colour, symbol, size, fill, border, hide, label. */
export function PointPanel({
  ctx,
  dataSet,
  point,
  layer,
  onWholeDataSet,
}: {
  ctx: PanelContext
  dataSet: string
  point: string
  /** The layer the point was picked in. */
  layer?: string
  onWholeDataSet: () => void
}) {
  const { graph, project, theme, palette } = ctx
  const series = resolveSeries(project, graph, ctx.lookup).find((s) => s.key === dataSet)
  if (!series) return <p className="muted">This data set is no longer on the graph.</p>
  const style = markStyle(ctx, dataSet, ['points'], layer)
  const own = pointOverride(graph, dataSet, point) ?? {}
  const seriesColor =
    'series' in style.color
      ? palette[series.index % palette.length]!
      : resolveColor(style.color, palette)
  const color = own.color ? resolveColor(own.color, palette, seriesColor) : seriesColor
  const shape = own.shape ?? style.points.shape
  const border = own.border ?? style.points.border
  const set = (field: string, v: unknown, label = 'Format point') =>
    ctx.set(['pointOverrides', dataSet, point, field], v, label)
  const kind = singleMarkName(graph, point)
  if (kind === 'slice')
    return <SlicePanel ctx={ctx} dataSet={dataSet} point={point} onWholeDataSet={onWholeDataSet} />
  if (kind === 'bar' || kind === 'box')
    return (
      <CellPanel
        ctx={ctx}
        kind={kind}
        dataSet={dataSet}
        point={point}
        seriesColor={seriesColor}
        layer={layer}
        onWholeDataSet={onWholeDataSet}
      />
    )

  return (
    <>
      <div className="point-banner">
        <div>
          <strong>{ctx.points ? `These ${ctx.points} points` : 'This point only'}</strong>
          <div className="muted">
            {ctx.points ? 'Values shown: ' : ''}
            {describePoint(project, graph, dataSet, point, ctx.lookup)}
          </div>
        </div>
        <button type="button" className="link" onClick={onWholeDataSet}>
          Whole data set
        </button>
      </div>
      <Section title="Point colour">
        <ColorField
          label="Colour"
          value={color}
          palette={palette}
          automatic={{
            on: !own.color,
            label: 'Data set’s colour',
            css: seriesColor,
            onPick: () => set('color', undefined),
          }}
          onChange={(_, c) => set('color', c)}
        />
      </Section>
      <Section title="Point symbol">
        <div className="field-row">
          <Select label="Shape" value={shape} options={SHAPES} onChange={(v) => set('shape', v)} />
          <NumberInput
            label="Size (pt)"
            value={own.size ?? style.points.size}
            min={1}
            max={40}
            step={0.5}
            onChange={(v) => set('size', v)}
          />
        </div>
        <Checkbox
          label="Hollow"
          checked={(own.fill ?? style.points.fill).type === 'none'}
          onChange={(v) =>
            set(
              'fill',
              v ? { type: 'none' } : { type: 'solid', color: { series: true }, opacity: 1 },
            )
          }
        />
        <NumberInput
          label="Border (pt)"
          value={border.width}
          min={0}
          max={10}
          step={0.25}
          onChange={(width) => set('border', { ...border, width })}
        />
      </Section>
      <Section title="Point label and visibility">
        <RichTextField
          label="Label beside the point"
          value={labelRuns(own.label)}
          textStyle={effectiveText(ctx, theme.pointLabel, style.pointLabels?.text)}
          palette={palette}
          placeholder={
            style.pointLabels?.source !== undefined && style.pointLabels.source !== 'none'
              ? 'The data set’s label'
              : 'None'
          }
          onChange={(rt) => set('label', rt ? toLabel(rt) : undefined)}
        />
        {own.labelOffset && (
          <button
            type="button"
            onClick={() => set('labelOffset', undefined, 'Reset label position')}
          >
            Reset label position
          </button>
        )}
        <Checkbox
          label="Hide this point (it still counts in the statistics)"
          checked={!!own.hide}
          onChange={(v) => set('hide', v || undefined)}
        />
      </Section>
      <button
        type="button"
        onClick={() => ctx.set(['pointOverrides', dataSet, point], undefined, 'Reset point')}
        disabled={Object.keys(own).length === 0}
      >
        Reset to the data set’s style
      </button>
    </>
  )
}

/**
 * Format of one part of a whole (a pie or donut slice, a stacked segment): its colour, pulled out
 * of the pie (explode), or hidden.
 */
function SlicePanel({
  ctx,
  dataSet,
  point,
  onWholeDataSet,
}: {
  ctx: PanelContext
  dataSet: string
  point: string
  onWholeDataSet: () => void
}) {
  const { graph, project, palette } = ctx
  const own = pointOverride(graph, dataSet, point) ?? {}
  const p = parsePointKey(point)
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  // The default colour is the category's (the row's place among the categories shown).
  const category = p && table ? categoryIndex(table, p.row) : 0
  const base = palette[category % palette.length]!
  const color = own.color ? resolveColor(own.color, palette, base) : base
  const set = (field: string, v: unknown) =>
    ctx.set(['pointOverrides', dataSet, point, field], v, 'Format slice')
  const pie = graph.frame === 'polar'
  return (
    <>
      <div className="point-banner">
        <div>
          <strong>
            {ctx.points
              ? `These ${ctx.points} ${pie ? 'slices' : 'parts'}`
              : `This ${pie ? 'slice' : 'part'} only`}
          </strong>
          <div className="muted">
            {describePoint(project, graph, dataSet, point, ctx.lookup).replace(
              ' · mean of the row',
              '',
            )}
          </div>
        </div>
        <button type="button" className="link" onClick={onWholeDataSet}>
          Whole data set
        </button>
      </div>
      <Section title="Colour">
        <ColorField
          label="Colour"
          value={color}
          palette={palette}
          onChange={(_, c) => set('color', c)}
        />
      </Section>
      {pie && (
        <Section title="Emphasis">
          <NumberInput
            label="Pull out of the pie (% of the radius)"
            value={Math.round((own.explode ?? 0) * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => set('explode', v > 0 ? v / 100 : undefined)}
          />
        </Section>
      )}
      <Section title="Visibility">
        <Checkbox
          label="Hide it (it still counts in the total)"
          checked={!!own.hide}
          onChange={(v) => set('hide', v || undefined)}
        />
      </Section>
      <button
        type="button"
        onClick={() => ctx.set(['pointOverrides', dataSet, point], undefined, 'Reset slice')}
        disabled={Object.keys(own).length === 0}
      >
        Reset to the default
      </button>
    </>
  )
}

/** Position of a table row among the rows with a value in any data set (a part's category). */
function categoryIndex(table: DataTable, row: number): number {
  let k = 0
  for (let r = 0; r < row; r++)
    if (table.dataSets.some((d) => d.subcolumns[0]?.values[r] !== null)) k++
  return k
}

/**
 * Format of one bar or box of a grouped graph (a table row's cell): its colour, fill and border,
 * or hiding it (with its error bar and centre).
 */
function CellPanel({
  ctx,
  kind,
  dataSet,
  point,
  seriesColor,
  layer,
  onWholeDataSet,
}: {
  ctx: PanelContext
  kind: 'bar' | 'box'
  dataSet: string
  point: string
  seriesColor: string
  layer?: string
  onWholeDataSet: () => void
}) {
  const { graph, project, palette } = ctx
  const style = markStyle(ctx, dataSet, kind === 'bar' ? ['bar'] : ['box', 'violin'], layer)
  const own = pointOverride(graph, dataSet, point) ?? {}
  const color = own.color ? resolveColor(own.color, palette, seriesColor) : seriesColor
  const mark = own[kind] ?? {}
  const fill = mark.fill ?? style[kind].fill
  const border = mark.border ?? style[kind].border
  const label = kind === 'bar' ? 'Format bar' : 'Format box'
  const setMark = (patch: typeof mark) =>
    ctx.set(['pointOverrides', dataSet, point, kind], { ...mark, ...patch }, label)
  const where = describePoint(project, graph, dataSet, point, ctx.lookup).replace(
    ' · mean of the row',
    '',
  )
  return (
    <>
      <div className="point-banner">
        <div>
          <strong>
            {ctx.points
              ? `These ${ctx.points} ${kind}${kind === 'box' ? 'es' : 's'}`
              : `This ${kind} only`}
          </strong>
          <div className="muted">{where}</div>
        </div>
        <button type="button" className="link" onClick={onWholeDataSet}>
          Whole data set
        </button>
      </div>
      <Section title={kind === 'bar' ? 'Bar colour' : 'Box colour'}>
        <ColorField
          label="Colour"
          value={color}
          palette={palette}
          onChange={(_, c) => ctx.set(['pointOverrides', dataSet, point, 'color'], c, label)}
        />
      </Section>
      <Section title="Fill and border">
        <NumberInput
          label="Fill opacity"
          value={fill.type === 'solid' ? fill.opacity : 0}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) =>
            setMark({
              fill: {
                type: 'solid',
                color: fill.type === 'solid' ? fill.color : { series: true },
                opacity: v,
              },
            })
          }
        />
        <NumberInput
          label="Border (pt)"
          value={border.width}
          min={0}
          max={10}
          step={0.25}
          onChange={(width) => setMark({ border: { ...border, width } })}
        />
      </Section>
      <Section title="Visibility">
        <Checkbox
          label={`Hide this ${kind}, its error bar and centre (the values still count)`}
          checked={!!own.hide}
          onChange={(v) =>
            ctx.set(['pointOverrides', dataSet, point, 'hide'], v || undefined, label)
          }
        />
      </Section>
      <button
        type="button"
        onClick={() => ctx.set(['pointOverrides', dataSet, point], undefined, `Reset ${kind}`)}
        disabled={Object.keys(own).length === 0}
      >
        Reset to the data set’s style
      </button>
    </>
  )
}
