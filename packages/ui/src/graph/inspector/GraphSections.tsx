import { editCommands } from '@ps/engine'
import {
  CORNER_ARROWS,
  graphScale,
  hasRightAxis,
  levelVariables,
  mappingAxes,
  newFunctionCurve,
  resolveSeries,
  rightAxisAllowed,
  seriesOnRight,
} from '@ps/graph'
import {
  GRAPH_SCALE,
  type GraphNode,
  labelPlain,
  richPlain,
  type StrokeStyle,
  sourceTable,
} from '@ps/model'
import { useState } from 'react'
import {
  Checkbox,
  NumberInput,
  OrderedChecklist,
  Section,
  Select,
} from '../../components/fields.tsx'
import {
  FillFields,
  RichTextField,
  StrokeFields,
  sparseStroke,
  TextStyleFields,
} from '../../components/formatFields.tsx'
import { inUnit, useUnit } from '../../styles/units.ts'
import {
  bracketableAnalyses,
  bracketLabelShow,
  missingCurves,
  newBrackets,
  newLine,
  newTextBox,
} from '../graphActions.ts'
import { LevelOrderEditor } from '../LevelOrder.tsx'
import { BRACKET_LABELS } from './AnnotationPanel.tsx'
import { effectiveText, type PanelContext } from './context.ts'
import { functionTitle, graphSeries } from './layers.ts'
import { type TextLabels, TextParts, textLabels } from './textParts.tsx'
import { addRightAxisCommands, removeRightAxisCommands, setAxisCommands } from './yAxis.ts'

/**
 * Graph-wide formatting, as sections the Format dialogs arrange into tabs. Each section reads the
 * (draft) graph from the context and writes through it.
 */

const isCategorical = (ctx: PanelContext) =>
  ctx.graph.frame === 'category' || ctx.graph.frame === 'grouped'

/**
 * "Change layers…", the graph builder over this graph (roadmap 33c, replacing the graph type
 * choice), and the layers kept as presets. The layers themselves are listed at the top of the
 * graph's place (roadmap 46).
 */
export function ChangeLayersSection({ ctx }: { ctx: PanelContext }) {
  return (
    <Section title="Graph type and presets">
      <div className="field-row">
        {ctx.onChangeLayers && (
          <button type="button" onClick={ctx.onChangeLayers}>
            Change layers…
          </button>
        )}
        {ctx.onSavePreset && (
          <button type="button" onClick={ctx.onSavePreset}>
            Save layers as preset…
          </button>
        )}
        {ctx.onManagePresets && (
          <button type="button" onClick={ctx.onManagePresets}>
            Manage presets…
          </button>
        )}
      </div>
      <p className="muted">
        Change layers… draws the graph another way; a layer of the list above formats every data set
        it draws.
      </p>
    </Section>
  )
}

/**
 * Orientation (roadmap 30) and the gaps between groups. How data sets sit in each row (side by
 * side, at one position, stacked) is each layer's Position (Appearance).
 */
export function ArrangementSection({ ctx }: { ctx: PanelContext }) {
  const { graph, set } = ctx
  if (!isCategorical(ctx)) return null
  return (
    <Section title="Arrangement and spacing">
      <Select
        label="Orientation"
        value={graph.style.orientation ?? 'vertical'}
        options={[
          { value: 'vertical', label: 'Vertical (categories along the bottom)' },
          { value: 'horizontal', label: 'Horizontal (categories down the left)' },
        ]}
        onChange={(v) => {
          const horizontal = v === 'horizontal'
          const write = {
            type: 'node.set' as const,
            id: graph.id,
            path: ['style', 'orientation'],
            value: horizontal ? v : undefined,
          }
          // A number by a text variable turns with its variables (roadmap 34a): the text one
          // down the left is Y, along the bottom X.
          const m = graph.mapping
          const table = m && sourceTable(ctx.project, graph.seriesSource.table, ctx.lookup)
          const axes = m && table && mappingAxes(table, m)
          if (m && (axes === 'tn' || axes === 'nt') && (axes === 'nt') !== horizontal)
            ctx.dispatch(
              [
                write,
                {
                  type: 'node.set',
                  id: graph.id,
                  path: ['mapping'],
                  value: { ...m, x: m.y, y: m.x },
                },
              ],
              'Orientation',
            )
          else set(['style', 'orientation'], horizontal ? v : undefined, 'Orientation')
        }}
      />
      <NumberInput
        label="Gap between groups (0–0.9 of a group)"
        value={graph.style.categoryGap ?? 0}
        min={0}
        max={0.9}
        step={0.05}
        onChange={(v) => set(['style', 'categoryGap'], v || undefined, 'Group spacing')}
      />
    </Section>
  )
}

/** Plot-area size (the axis lengths) and the scale of text and marks (roadmap 23). */
export function SizeSection({ ctx }: { ctx: PanelContext }) {
  const { graph, set } = ctx
  const scale = graphScale(graph)
  // Roadmap 37: in the unit chosen in Preferences (inches unless another).
  const unit = useUnit()
  const side = (label: string, key: 'plotWidth' | 'plotHeight') => (
    <NumberInput
      label={`${label} (${unit.id})`}
      value={inUnit(graph.size[key], unit)}
      min={21.6 / unit.per}
      max={1440 / unit.per}
      step={unit.step}
      onChange={(v) => set(['size', key], v * unit.per, 'Resize graph')}
    />
  )
  return (
    <Section title="Size of the plot area">
      <div className="field-row">
        {side('Width', 'plotWidth')}
        {side('Height', 'plotHeight')}
      </div>
      <NumberInput
        label="Scale text and marks (%)"
        value={+(scale * 100).toFixed(2)}
        min={GRAPH_SCALE.min * 100}
        max={GRAPH_SCALE.max * 100}
        step={5}
        help="Text, symbols, line widths, gaps and the legend, in proportion"
        onChange={(v) => set(['size', 'scale'], v === 100 ? undefined : v / 100, 'Scale text')}
      />
      {scale !== 1 && (
        <button type="button" onClick={() => set(['size', 'scale'], undefined, 'Reset text scale')}>
          Reset to 100%
        </button>
      )}
      <p className="muted">
        Resizing the plot with its handles scales them with it (⌘/Ctrl-drag doesn’t); typing a size
        here doesn’t.
      </p>
    </Section>
  )
}

/** The text every text on the graph inherits, as the graph's fields name it. */
const ALL_TEXT: TextLabels = {
  font: 'Font for all text',
  size: 'Size of all text (pt)',
  bold: 'All text bold',
  italic: 'All text italic',
  color: 'Colour of all text',
}

/**
 * Roadmap 46 (stage 2): the graph's Common settings — the font and size of all its text, its
 * frame, its background.
 */
export function GraphCommon({ ctx }: { ctx: PanelContext }) {
  const { graph, theme, palette, set } = ctx
  return (
    <Section title="Common">
      <TextParts
        parts={['font', 'size']}
        labels={ALL_TEXT}
        value={graph.style.text}
        inherited={theme.text}
        palette={palette}
        onChange={(s) => set(['style', 'text'], s, 'Graph font')}
      />
      <Select
        label="Frame"
        value={graph.style.frame ?? 'axes'}
        options={[
          { value: 'axes', label: 'X and Y axes' },
          { value: 'box', label: 'Box round the plot' },
          { value: 'none', label: 'No axis lines' },
          // Roadmap 36: UMAP-style arrows from a corner (graphs with X and Y values).
          ...(graph.frame === 'xy'
            ? [{ value: 'arrows' as const, label: 'Corner arrows (UMAP style)' }]
            : []),
        ]}
        onChange={(v) => set(['style', 'frame'], v === 'axes' ? undefined : v, 'Frame')}
      />
      <FillFields
        label="Graph background colour (else white)"
        value={graph.style.background}
        palette={palette}
        onChange={(f) => set(['style', 'background'], f, 'Graph background')}
      />
    </Section>
  )
}

/** The rest of the text every text inherits (its font and size are in Common). */
export function GraphTextSection({ ctx }: { ctx: PanelContext }) {
  const { graph, theme, palette, set } = ctx
  return (
    <Section title="Text">
      <p className="muted">The style of all text; titles and labels can refine it.</p>
      <TextParts
        parts={['bold', 'italic', 'color']}
        labels={ALL_TEXT}
        value={graph.style.text}
        inherited={theme.text}
        palette={palette}
        reset
        onChange={(s) => set(['style', 'text'], s, 'Graph font')}
      />
    </Section>
  )
}

/** The frame's corner arrows and the plot area's colour (the frame itself is in Common). */
export function FrameSection({ ctx }: { ctx: PanelContext }) {
  const { graph, palette, set } = ctx
  return (
    <Section title="Frame and plot area">
      {graph.style.frame === 'arrows' && (
        <div className="field-row">
          <NumberInput
            label={
              graph.style.arrows?.unit === 'pt'
                ? 'Arrow length (pt)'
                : 'Arrow length (fraction of the plot)'
            }
            value={graph.style.arrows?.length ?? CORNER_ARROWS.fraction}
            min={0}
            max={graph.style.arrows?.unit === 'pt' ? 2000 : 1}
            step={graph.style.arrows?.unit === 'pt' ? 1 : 0.05}
            onChange={(length) =>
              length > 0 &&
              set(['style', 'arrows'], { ...graph.style.arrows, length }, 'Arrow length')
            }
          />
          <Select
            label="In"
            value={graph.style.arrows?.unit ?? 'fraction'}
            options={[
              { value: 'fraction', label: 'Fraction of the plot' },
              { value: 'pt', label: 'Points' },
            ]}
            onChange={(unit) =>
              set(
                ['style', 'arrows'],
                {
                  ...graph.style.arrows,
                  unit: unit === 'fraction' ? undefined : unit,
                  length: unit === 'pt' ? 40 : CORNER_ARROWS.fraction,
                },
                'Arrow length',
              )
            }
          />
          <Select
            label="From the corner"
            value={graph.style.arrows?.corner ?? 'bottomLeft'}
            options={[
              { value: 'bottomLeft', label: 'Bottom left' },
              { value: 'bottomRight', label: 'Bottom right' },
              { value: 'topLeft', label: 'Top left' },
              { value: 'topRight', label: 'Top right' },
            ]}
            onChange={(corner) =>
              set(
                ['style', 'arrows'],
                { ...graph.style.arrows, corner: corner === 'bottomLeft' ? undefined : corner },
                'Arrow corner',
              )
            }
          />
        </div>
      )}
      <FillFields
        label="Plot area colour"
        value={graph.style.plotBackground}
        palette={palette}
        defaultColor={{ rgb: '#f2f2f2' }}
        onChange={(f) => set(['style', 'plotBackground'], f, 'Plot background')}
      />
    </Section>
  )
}

/** A second (right) Y axis on XY and grouped graphs. */
export function RightAxisSection({ ctx }: { ctx: PanelContext }) {
  const { graph } = ctx
  if (graph.layers.some((l) => l.geom === 'difference'))
    return (
      <Section title="Right Y axis">
        <p className="muted">
          The right axis shows the differences (zero at the first data set’s mean). Select it on the
          graph to format it.
        </p>
      </Section>
    )
  if (!rightAxisAllowed(graph)) return null
  const on = hasRightAxis(graph)
  return (
    <Section title="Right Y axis">
      <Checkbox
        label="Show a right Y axis"
        checked={on}
        onChange={(v) =>
          ctx.dispatch(
            v ? addRightAxisCommands(graph) : removeRightAxisCommands(graph),
            v ? 'Add right Y axis' : 'Remove right Y axis',
          )
        }
      />
      <p className="muted">
        {on
          ? 'Select it on the graph to format it. Each data set chooses its axis in Data sets on the graph, or in its own Advanced section.'
          : 'An independent scale for some data sets (e.g. a second measurement in other units).'}
      </p>
    </Section>
  )
}

/** The graph title's Common settings: its text, font, size, bold, slant and colour. */
export function GraphTitleSection({ ctx }: { ctx: PanelContext }) {
  const { graph, theme, palette } = ctx
  return (
    <Section title="Common">
      <RichTextField
        label="Title"
        value={graph.title?.content}
        multiline
        placeholder="No title"
        textStyle={effectiveText(ctx, theme.graphTitle, graph.title?.style)}
        palette={palette}
        onChange={(rt) =>
          ctx.set(['title'], rt ? { content: rt, style: graph.title?.style } : null, 'Graph title')
        }
      />
      {graph.title && (
        <TextParts
          parts={['font', 'size', 'bold', 'italic', 'color']}
          labels={textLabels('Title')}
          value={graph.title.style}
          inherited={effectiveText(ctx, theme.graphTitle)}
          palette={palette}
          reset
          onChange={(s) => ctx.set(['title', 'style'], s, 'Format title')}
        />
      )}
    </Section>
  )
}

/** Legend on/off, with a way to its own dialog. */
export function LegendSection({ ctx }: { ctx: PanelContext }) {
  const { graph, set } = ctx
  return (
    <Section title="Legend">
      <Checkbox
        label="Show legend"
        checked={graph.legend.show}
        onChange={(v) => set(['legend', 'show'], v, v ? 'Show legend' : 'Hide legend')}
      />
      {graph.legend.show && (
        <button type="button" onClick={() => ctx.onSelect(['legend'])}>
          Format legend…
        </button>
      )}
    </Section>
  )
}

/** A bracket style with its line's own fields (none: no `line`; nothing left: undefined). */
function putLine(
  b: GraphNode['style']['bracket'],
  line: Partial<StrokeStyle> | undefined,
): GraphNode['style']['bracket'] {
  const { line: _, ...rest } = b ?? {}
  const out = line ? { ...rest, line } : rest
  return Object.keys(out).length ? out : undefined
}

/** Adding brackets from analyses, and the style every bracket shares. */
export function BracketsSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project, theme, palette, set } = ctx
  const [allComparisons, setAllComparisons] = useState(false)
  if (!isCategorical(ctx)) return null
  const bracketable = bracketableAnalyses(project, graph, ctx.lookup)
  const hasAnalysisBrackets = graph.annotations.some(
    (x) => x.type === 'bracket' && x.label.source === 'analysis',
  )
  const bracket = { ...theme.bracket, ...graph.style.bracket }
  return (
    <Section title="Significance brackets">
      {bracketable.length === 0 && (
        <p className="muted">Analyze this table (e.g. a t test) to add significance brackets.</p>
      )}
      {bracketable.map(({ a, result }) => (
        <button
          type="button"
          key={a.id}
          onClick={() => {
            const added = newBrackets(graph, a.id, result, allComparisons)
            if (added.length)
              set(['annotations'], [...graph.annotations, ...added], 'Add significance brackets')
            else ctx.onError('No new comparisons to add (already shown, or none significant).')
          }}
        >
          Add brackets from “{a.name}”
        </button>
      ))}
      {bracketable.length > 0 && (
        <Checkbox
          label="Include non-significant comparisons"
          checked={allComparisons}
          onChange={setAllComparisons}
        />
      )}
      {(bracketable.length > 0 || hasAnalysisBrackets) && (
        <Select
          label="Labels (all brackets)"
          value={bracketLabelShow(graph)}
          options={BRACKET_LABELS}
          onChange={(v) =>
            set(
              ['annotations'],
              graph.annotations.map((x) =>
                x.type === 'bracket' && x.label.source === 'analysis'
                  ? { ...x, label: { ...x.label, show: v } }
                  : x,
              ),
              'Bracket labels',
            )
          }
        />
      )}
      <Select
        label="P value style"
        value={project.settings.pValueStyle}
        options={[
          { value: 'GP', label: 'GP: ns, * … ****, P<0.0001' },
          { value: 'APA', label: 'APA: ns, * … ***, P<.001' },
          { value: 'NEJM', label: 'NEJM: ns, * … ***, P<0.001' },
        ]}
        onChange={(v) =>
          ctx.dispatch({ type: 'project.setSettings', settings: { pValueStyle: v } })
        }
      />
      <StrokeFields
        label="Bracket line"
        value={{ ...theme.bracket.line, ...graph.style.bracket?.line }}
        palette={palette}
        onChange={(s) =>
          s &&
          set(
            ['style', 'bracket'],
            putLine(
              graph.style.bracket,
              sparseStroke(s, theme.bracket.line, graph.style.bracket?.line),
            ),
            'Bracket style',
          )
        }
      />
      <div className="field-row">
        <NumberInput
          label="Spacing (pt)"
          value={bracket.step}
          min={4}
          max={72}
          onChange={(step) =>
            set(['style', 'bracket'], { ...graph.style.bracket, step }, 'Bracket style')
          }
        />
        <NumberInput
          label="End ticks (pt)"
          value={bracket.tick}
          min={0}
          max={24}
          onChange={(tick) =>
            set(['style', 'bracket'], { ...graph.style.bracket, tick }, 'Bracket style')
          }
        />
      </div>
      <details>
        <summary className="muted">Bracket label text</summary>
        <TextStyleFields
          value={graph.style.bracket?.label}
          inherited={{ ...theme.bracket.label, ...graph.style.text }}
          palette={palette}
          onChange={(s) =>
            set(['style', 'bracket'], { ...graph.style.bracket, label: s }, 'Bracket style')
          }
        />
      </details>
    </Section>
  )
}

/** Every annotation on the graph, each opening its own options. */
export function AnnotationsListSection({ ctx }: { ctx: PanelContext }) {
  const { graph } = ctx
  return (
    <Section title="Text, lines and brackets on the graph">
      {graph.annotations.length === 0 && <p className="muted">None yet.</p>}
      {graph.annotations.map((a, i) => (
        <button key={a.id} type="button" onClick={() => ctx.onSelect(['annotations', i])}>
          {a.type === 'bracket'
            ? `Bracket ${i + 1}`
            : a.type === 'table'
              ? `Results table ${i + 1}`
              : a.type === 'text'
                ? `Text: ${richPlain(a.content.content).slice(0, 30)}`
                : a.arrow === 'none'
                  ? `Line ${i + 1}`
                  : `Arrow ${i + 1}`}
          …
        </button>
      ))}
    </Section>
  )
}

export function AddSection({ ctx }: { ctx: PanelContext }) {
  const { graph, set } = ctx
  const add = (a: (typeof graph.annotations)[number], label: string) => {
    set(['annotations'], [...graph.annotations, a], label)
    ctx.onSelect(['annotations', graph.annotations.length])
  }
  return (
    <Section title="Add to the graph">
      <div className="field-row">
        <button type="button" onClick={() => add(newTextBox(), 'Add text')}>
          Text box
        </button>
        <button type="button" onClick={() => add(newLine('none'), 'Add line')}>
          Line
        </button>
        <button type="button" onClick={() => add(newLine('end'), 'Add arrow')}>
          Arrow
        </button>
      </div>
    </Section>
  )
}

/**
 * A graph of variables (roadmap 34a): the order of its text variables' levels, its categories
 * and its colour groups (in place of the data sets a graph shows).
 */
export function LevelsSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project, set } = ctx
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  // A graph of variables, or an XY graph's points coloured or shaped by a text variable (34b).
  if (table?.kind !== 'table' || !levelVariables(table, graph, null).length) return null
  return (
    <Section title="Order of levels">
      <LevelOrderEditor
        table={table}
        graph={graph}
        onChange={(variable, order, label) => set(['levels', variable], order ?? undefined, label)}
      />
    </Section>
  )
}

/** Which data sets the graph shows, and in what order. */
export function DataSetsSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project, set } = ctx
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  // A graph of variables draws the levels of its text variables (`LevelsSection`).
  if (graph.mapping) return null
  // Graphs of analysis output show no table data sets.
  const outputGraph =
    graph.seriesSource.include !== 'all' && graph.seriesSource.include.length === 0
  const outputs = graph.layers.some((l) => l.data?.from === 'outputs')
  if (table?.kind !== 'table' || (outputGraph && outputs)) return null
  const all = table.dataSets.map((d) => ({ key: d.id as string, title: d.title }))
  if (all.length < 2) return null
  const title = (k: string) => all.find((d) => d.key === k)?.title ?? k
  const axes = rightAxisAllowed(graph)
  const write = (keys: string[], label: string) => {
    const same = keys.length === all.length && keys.every((k, i) => k === all[i]!.key)
    set(['seriesSource', 'include'], same ? 'all' : keys, label)
  }
  return (
    <Section title="Data sets on the graph">
      <OrderedChecklist
        all={all.map((d) => d.key)}
        shown={resolveSeries(project, graph, ctx.lookup).map((s) => s.key)}
        label={title}
        noun="data set"
        onChange={write}
        extra={(k) => (
          <>
            {axes && (
              <select
                aria-label={`Y axis of ${title(k)}`}
                title="Plot against the left or right Y axis"
                value={seriesOnRight(graph, k) ? 'right' : 'left'}
                onChange={(e) => {
                  const side = e.target.value === 'right' ? 'right' : 'left'
                  ctx.dispatch(
                    setAxisCommands(graph, k, side),
                    side === 'right' ? 'Plot on right Y axis' : 'Plot on left Y axis',
                  )
                }}
              >
                <option value="left">Left Y</option>
                <option value="right">Right Y</option>
              </select>
            )}
            <button
              type="button"
              aria-label={`Format ${title(k)}`}
              title="Format this data set"
              onClick={() => ctx.onSelect(['seriesOverrides', k])}
            >
              ✎
            </button>
          </>
        )}
      />
      <p className="muted">Data sets are drawn in this order: each one on top of those above it.</p>
      {graph.seriesSource.include !== 'all' && (
        <p className="muted">
          Data sets added to the table later won’t appear until you tick them.
        </p>
      )}
    </Section>
  )
}

/** Functions plotted on an XY graph ("Plot a function"), and adding one. */
export function FunctionsSection({ ctx }: { ctx: PanelContext }) {
  const { graph } = ctx
  if (graph.frame !== 'xy') return null
  const layer = graph.layers.find((l) => l.data?.from === 'functions')
  const functions = layer?.data?.from === 'functions' ? layer.data.functions : []
  return (
    <Section title="Functions">
      {functions.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => layer && ctx.onSelect(['layers', layer.id, 'series', f.id])}
        >
          {labelPlain(f.title) || functionTitle(f)}…
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          const { cmds, target } = addFunctionCommands(graph)
          ctx.dispatch(cmds, 'Add function')
          ctx.onSelect(target)
        }}
      >
        Plot a function on this graph…
      </button>
    </Section>
  )
}

/**
 * Commands adding a function (a straight line to start from) to a graph's functions layer, made
 * in front of the list when it has none; and the target formatting it.
 */
export function addFunctionCommands(graph: PanelContext['graph']) {
  const fc = newFunctionCurve('straight-line')
  const layer = graph.layers.find((l) => l.data?.from === 'functions')
  if (layer?.data?.from === 'functions')
    return {
      cmds: [
        {
          type: 'node.set' as const,
          id: graph.id,
          path: ['layers', { id: layer.id }, 'data', 'functions'],
          value: [...layer.data.functions, fc],
        },
      ],
      target: ['layers', layer.id, 'series', fc.id],
    }
  const { style: _, ...def } = fc
  return {
    cmds: [
      {
        type: 'graph.addLayer' as const,
        id: graph.id,
        layer: {
          id: 'functions',
          geom: 'line' as const,
          stat: { kind: 'identity' as const },
          data: { from: 'functions' as const, functions: [def] },
        },
      },
    ],
    target: ['layers', 'functions', 'series', fc.id],
  }
}

/** Curves from analyses: those on the graph, and those that could be added. */
export function CurvesSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project } = ctx
  if (graph.frame !== 'xy') return null
  const missing = missingCurves(project, graph)
  const layer = graph.layers.find((l) => l.data?.from === 'outputs')
  const curves = graphSeries(project, graph, ctx.lookup).filter((s) => s.kind === 'output')
  if (!curves.length && !missing.length) return null
  return (
    <Section title="Curves from analyses">
      {curves.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => layer && ctx.onSelect(['layers', layer.id, 'series', c.key])}
        >
          {c.title}…
        </button>
      ))}
      {missing.map(({ a, edits }) => (
        <button
          type="button"
          key={a.id}
          onClick={() => ctx.dispatch(editCommands(graph.id, edits), 'Add curves')}
        >
          Show curves from “{a.name}”
        </button>
      ))}
    </Section>
  )
}
