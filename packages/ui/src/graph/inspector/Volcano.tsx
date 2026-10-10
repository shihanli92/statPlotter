import type { Command } from '@ps/engine'
import {
  CLASS_NAMES,
  cutoffValues,
  DEFAULT_CUTOFFS,
  dataOf,
  freshLayerId,
  isThresholdLayer,
  LEGEND_CLASSES,
  layerStyle,
  negLog10P,
  newLayerIndex,
  resolveSeries,
  THRESHOLD_THEME,
  type Theme,
} from '@ps/graph'
import {
  type AnalysisResult,
  type ColorRef,
  type Cutoffs,
  type GraphNode,
  type GraphPathSegment,
  type Layer,
  type LayerOf,
  labelPlain,
  type NodeId,
  type Project,
  type ResultStat,
  sourceTable,
} from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import { Checkbox, NumberInput, Section, Select } from '../../components/fields.tsx'
import { ColorRefField } from '../../components/formatFields.tsx'
import type { PanelContext } from './context.ts'
import { layerPath } from './layers.ts'

// Roadmap 46b: a volcano plot's thresholds — the graph's shared cut-offs (`GraphNode.cutoffs`),
// the lines at ±(the fold change's) and at the significance's (typed lines whose value is a
// `cutoff` reference), and the Significance layer (points of stat `threshold`) classing the
// points by them. Insert › Volcano thresholds… adds them in one step; the cut-offs are edited in
// the Significance layer's panel or either line's, each edit one step moving all three.

/** Grey of the points beneath a Significance layer. */
export const BASE_GREY = '#c8c8c8'

/** Whether a layer is a line at one of the graph's cut-offs, and which. */
export function cutoffOf(layer: Layer): 'fold' | 'sig' | null {
  if (layer.stat.kind !== 'result' || layer.data?.from !== 'values') return null
  const ref = layer.stat.fields[layer.stat.at ?? '']?.ref
  return ref?.from === 'cutoff' ? ref.which : null
}

/** A graph's own cut-offs, else the defaults. */
export const cutoffsOf = (graph: Pick<GraphNode, 'cutoffs'>): Cutoffs =>
  graph.cutoffs ?? DEFAULT_CUTOFFS

/**
 * The commands setting a graph's cut-offs: the cut-offs, and the lines at them along their axes
 * (the fold change's along `foldAxis`, the significance's along the other) — one step.
 */
export function cutoffsCommands(graph: GraphNode, next: Cutoffs): Command[] {
  const cmds: Command[] = [{ type: 'node.set', id: graph.id, path: ['cutoffs'], value: next }]
  const foldAxis = next.foldAxis ?? 'x'
  for (const l of graph.layers) {
    const which = cutoffOf(l)
    if (!which || l.stat.kind !== 'result') continue
    const along = (which === 'fold') === (foldAxis === 'x') ? 'x' : 'y'
    if ((l.stat.axis ?? 'y') !== along)
      cmds.push({
        type: 'node.set',
        id: graph.id,
        path: layerPath(l.id, 'stat', 'axis'),
        value: along === 'x' ? 'x' : undefined,
      })
  }
  return cmds
}

/** A P value or −log10 P written for people ("0.05", "1.301"). */
const num = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(4)) : '—')

/**
 * The cut-offs' fields: the fold change's, the significance's (as P, or the axis' value), which
 * axis is which and what the significance axis holds. `only`: one cut-off's field (a line's
 * panel). Every change is one step (`cutoffsCommands`).
 */
export function CutoffFields({ ctx, only }: { ctx: PanelContext; only?: 'fold' | 'sig' }) {
  const c = cutoffsOf(ctx.graph)
  const set = (patch: Partial<Cutoffs>, label: string) =>
    ctx.dispatch(cutoffsCommands(ctx.graph, { ...c, ...patch }), label)
  const pValues = c.values === 'p'
  const asP = 'p' in c.sig
  const sigField = (
    <>
      {!pValues && (
        <Select
          label="Significance cut-off as"
          value={asP ? 'p' : 'value'}
          options={[
            { value: 'p', label: 'A P value (drawn at −log10 P)' },
            { value: 'value', label: 'The axis’ value (−log10 P)' },
          ]}
          onChange={(v) => {
            const axis = cutoffValues(ctx.graph).sig
            set(
              v === 'p'
                ? { sig: { p: Math.min(1, Math.max(1e-300, 10 ** -axis)) } }
                : { sig: { value: +axis.toPrecision(6) } },
              'Significance cut-off entry',
            )
          }}
        />
      )}
      {'p' in c.sig ? (
        <NumberInput
          label="P cut-off"
          value={c.sig.p}
          min={1e-300}
          max={1}
          step={0.01}
          help={pValues ? undefined : `Drawn at −log10 P = ${num(negLog10P(c.sig.p))}`}
          onChange={(p) => p > 0 && set({ sig: { p } }, 'P cut-off')}
        />
      ) : (
        <NumberInput
          label={pValues ? 'P cut-off' : '−log10 P cut-off'}
          value={c.sig.value}
          step={0.1}
          onChange={(value) => set({ sig: { value } }, 'Significance cut-off')}
        />
      )}
    </>
  )
  const foldField = (
    <NumberInput
      label="Fold change cut-off (±)"
      value={c.fold}
      min={0}
      step={0.1}
      help="Up: fold change ≥ the cut-off; down: ≤ −the cut-off"
      onChange={(fold) => set({ fold }, 'Fold change cut-off')}
    />
  )
  if (only === 'fold')
    return (
      <>
        {foldField}
        <p className="muted">Shared with the graph’s other volcano thresholds.</p>
      </>
    )
  if (only === 'sig')
    return (
      <>
        {sigField}
        <p className="muted">Shared with the graph’s other volcano thresholds.</p>
      </>
    )
  return (
    <>
      {foldField}
      {sigField}
      <Select
        label="Fold change along"
        value={c.foldAxis ?? 'x'}
        options={[
          { value: 'x', label: `X (${axisName(ctx.graph, 'x')})` },
          { value: 'y', label: `Y (${axisName(ctx.graph, 'y')})` },
        ]}
        onChange={(v) => set({ foldAxis: v === 'x' ? undefined : 'y' }, 'Fold change axis')}
      />
      <Select
        label="The significance axis shows"
        value={c.values ?? 'negLog10'}
        options={[
          { value: 'negLog10', label: '−log10 P' },
          { value: 'p', label: 'P values' },
        ]}
        onChange={(v) => {
          // P values on the axis: the cut-off is a P value, drawn where it is.
          const sig: Cutoffs['sig'] = 'p' in c.sig ? c.sig : { p: DEFAULT_P }
          set({ values: v === 'p' ? 'p' : undefined, sig }, 'Significance values')
        }}
      />
      <p className="muted">
        Points exactly at a cut-off count as significant (≥). Points without both values aren’t
        classed.
      </p>
    </>
  )
}

const DEFAULT_P = 0.05

/** An axis' name for choices: its title, else X or Y. */
function axisName(graph: GraphNode, axis: 'x' | 'y'): string {
  const t = graph.axes[axis].title
  const text = t ? labelPlain(t.content).trim() : ''
  return text || axis.toUpperCase()
}

/**
 * The Format panel of a Significance layer: each class' colour (its Common settings are the
 * cut-offs, `CommonLayerFields`).
 */
export function SignificancePanel({ ctx, layer }: { ctx: PanelContext; layer: Layer }) {
  const classes = ((layer.style ?? {}) as { classes?: Partial<Record<string, ColorRef>> }).classes
  return (
    <Section title="Classes">
      {LEGEND_CLASSES.map((k) => (
        <ColorRefField
          key={k}
          label={`${CLASS_NAMES[k]} colour`}
          value={classes?.[k]}
          palette={ctx.palette}
          fallback={THRESHOLD_THEME[k]}
          automatic={{
            onPick: () =>
              ctx.set(
                layerPath(layer.id, 'style', 'classes', k),
                undefined,
                `${CLASS_NAMES[k]} colour`,
              ),
          }}
          onChange={(color) =>
            ctx.set(
              layerPath(layer.id, 'style', 'classes'),
              { ...classes, [k]: color },
              `${CLASS_NAMES[k]} colour`,
            )
          }
        />
      ))}
    </Section>
  )
}

// --- Insert › Volcano thresholds… ----------------------------------------------------------------

/** The points the thresholds class: the graph's mapped points, else its front-most points. */
export function basePointsLayer(graph: Pick<GraphNode, 'layers'>): LayerOf<'points'> | undefined {
  const points = graph.layers.filter(
    (l): l is LayerOf<'points'> =>
      l.geom === 'points' &&
      l.visible !== false &&
      !isThresholdLayer(l) &&
      l.stat.kind !== 'dotplot',
  )
  return points.find((l) => l.aes) ?? points.at(-1)
}

/** What the dialog asks. */
export interface VolcanoChoice {
  fold: number
  /** The P cut-off (as a P value). */
  p: number
  /** The fold change along X (else Y). */
  foldAxis: 'x' | 'y'
  /** The significance axis holds P values (else −log10 P). */
  pValues: boolean
  /** A graph of variables: the variables of the fold change and the P values (its X and Y). */
  variables?: { fold: string; sig: string }
  /** Add the Significance layer (and grey the points beneath). */
  colour: boolean
}

/** A line at a cut-off (typed values, its value the graph's cut-off). */
function cutoffLine(id: string, which: 'fold' | 'sig', along: 'x' | 'y', name: string): Layer {
  const stat: ResultStat = {
    kind: 'result',
    fields: { at: { ref: { from: 'cutoff', which } } },
    at: 'at',
    ...(along === 'x' ? { axis: 'x' as const } : {}),
    ...(which === 'fold' ? { mirror: true } : {}),
  }
  return { id, geom: 'refline', stat, data: { from: 'values' }, name, legend: 'hide' } as Layer
}

/**
 * The commands of the volcano thresholds (one step): the cut-offs; the lines at ±(fold change)
 * and at the significance's unless the graph has them; with `colour`, a Significance layer over
 * the points (unless it has one), the points beneath grey, the legend shown with the classes'
 * counts in place of the points' own entries. A graph of variables maps the chosen variables.
 */
export function volcanoCommands(
  project: Project,
  graph: GraphNode,
  lookup: (id: NodeId) => AnalysisResult | undefined,
  theme: Theme,
  choice: VolcanoChoice,
): { cmds: Command[]; added: string[] } {
  const cmds: Command[] = []
  const set = (path: GraphPathSegment[], value: unknown) =>
    cmds.push({ type: 'node.set', id: graph.id, path, value })
  const cutoffs: Cutoffs = {
    fold: choice.fold,
    sig: { p: choice.p },
    ...(choice.foldAxis === 'y' ? { foldAxis: 'y' as const } : {}),
    ...(choice.pValues ? { values: 'p' as const } : {}),
  }
  cmds.push(...cutoffsCommands(graph, cutoffs))
  const base = basePointsLayer(graph)
  // A graph of variables: the fold change along X, the P values up Y (its mapped points' aes).
  if (base?.aes && choice.variables)
    set(layerPath(base.id, 'aes'), {
      ...base.aes,
      x: choice.variables.fold,
      y: choice.variables.sig,
    })
  let layers = [...graph.layers]
  const added: string[] = []
  const add = (layer: Layer) => {
    const at = newLayerIndex(layers, layer)
    cmds.push({ type: 'graph.addLayer', id: graph.id, layer, at })
    layers = [...layers.slice(0, at), layer, ...layers.slice(at)]
    added.push(layer.id)
  }
  if (choice.colour && base && !graph.layers.some(isThresholdLayer)) {
    const sig: Layer = {
      id: freshLayerId('sig', layers),
      geom: 'points',
      stat: { kind: 'threshold' },
      name: 'Significance',
      // Analysis outputs (a volcano plot's own graph): the same as the points'.
      ...(base.data && base.data.from !== 'table'
        ? { data: { from: 'layer', layer: base.id } }
        : {}),
    }
    add(sig)
    // The points beneath grey (their fill and border; undo restores them).
    const style = layerStyle(theme, graph, base, '', base.stat).points
    const grey: ColorRef = { rgb: BASE_GREY }
    if (style.fill.type === 'solid')
      set(layerPath(base.id, 'style', 'fill'), { ...style.fill, color: grey })
    set(layerPath(base.id, 'style', 'border'), { ...style.border, color: grey })
    // The classes' counts in the legend, the points' own entries left out.
    const keys = pointKeys(project, graph, lookup, base)
    const hidden = [...new Set([...(graph.legend.hidden ?? []), ...keys])]
    set(['legend'], { ...graph.legend, show: true, ...(hidden.length ? { hidden } : {}) })
  }
  const along = (which: 'fold' | 'sig') =>
    (which === 'fold') === (choice.foldAxis === 'x') ? 'x' : 'y'
  if (!graph.layers.some((l) => cutoffOf(l) === 'fold'))
    add(cutoffLine(freshLayerId('foldCut', layers), 'fold', along('fold'), 'Fold change cut-off'))
  if (!graph.layers.some((l) => cutoffOf(l) === 'sig'))
    add(cutoffLine(freshLayerId('pCut', layers), 'sig', along('sig'), 'P cut-off'))
  return { cmds, added }
}

/** The legend keys of what a points layer draws: its outputs, else the table's data sets. */
function pointKeys(
  project: Project,
  graph: GraphNode,
  lookup: (id: NodeId) => AnalysisResult | undefined,
  base: Layer,
): string[] {
  if (base.aes) return []
  const data = dataOf(graph, base)
  if (data.from === 'outputs') return data.series.map((s) => s.id)
  if (data.from !== 'table') return []
  return resolveSeries(project, graph, lookup).map((s) => s.key)
}

/** The number variables of a graph of variables' table (for the dialog's choices). */
function numberVariables(
  project: Project,
  graph: GraphNode,
  lookup: (id: NodeId) => AnalysisResult | undefined,
): { value: string; label: string }[] {
  const t = sourceTable(project, graph.seriesSource.table, lookup)
  return (t?.dataSets ?? [])
    .filter((d) => !d.text)
    .map((d) => ({ value: d.id as string, label: d.title || d.id }))
}

/**
 * Insert › Volcano thresholds…: the fold change's and the P value's cut-offs, which columns
 * (axes) they are, and whether to colour the points by significance.
 */
export function VolcanoDialog({
  project,
  graph,
  lookup,
  onApply,
  onClose,
}: {
  project: Project
  graph: GraphNode
  lookup: (id: NodeId) => AnalysisResult | undefined
  onApply: (choice: VolcanoChoice) => void
  onClose: () => void
}) {
  const now = cutoffsOf(graph)
  const base = basePointsLayer(graph)
  const vars = base?.aes ? numberVariables(project, graph, lookup) : []
  const [fold, setFold] = useState(now.fold)
  const [p, setP] = useState('p' in now.sig ? now.sig.p : DEFAULT_P)
  const [foldAxis, setFoldAxis] = useState<'x' | 'y'>(now.foldAxis ?? 'x')
  const [pValues, setPValues] = useState(now.values === 'p')
  const [colour, setColour] = useState(true)
  const [foldVar, setFoldVar] = useState(base?.aes?.x ?? vars[0]?.value ?? '')
  const [sigVar, setSigVar] = useState(base?.aes?.y ?? vars[1]?.value ?? '')
  const ok = fold >= 0 && p > 0 && p <= 1
  return (
    <Dialog
      title="Volcano thresholds"
      onClose={onClose}
      okLabel="Add"
      okDisabled={!ok}
      onOk={() => {
        onApply({
          fold,
          p,
          foldAxis: vars.length ? 'x' : foldAxis,
          pValues,
          colour,
          ...(vars.length ? { variables: { fold: foldVar, sig: sigVar } } : {}),
        })
        onClose()
      }}
    >
      <p className="muted">
        Lines at ± the fold change’s cut-off and at the P value’s, and the points coloured up, down
        or not significant. The cut-offs are shared: change them later in the Significance layer’s
        or a line’s options.
      </p>
      <NumberInput
        label="log2 fold change cut-off (±)"
        value={fold}
        min={0}
        step={0.1}
        onChange={setFold}
      />
      <NumberInput
        label="P cut-off"
        value={p}
        min={1e-300}
        max={1}
        step={0.01}
        help={pValues ? undefined : `Drawn at −log10 P = ${num(negLog10P(p))}`}
        onChange={setP}
      />
      {vars.length ? (
        <div className="field-row">
          <Select label="Fold change (X)" value={foldVar} options={vars} onChange={setFoldVar} />
          <Select label="P or −log10 P (Y)" value={sigVar} options={vars} onChange={setSigVar} />
        </div>
      ) : (
        <Select
          label="Fold change"
          value={foldAxis}
          options={[
            { value: 'x', label: `X: ${axisName(graph, 'x')}` },
            { value: 'y', label: `Y: ${axisName(graph, 'y')}` },
          ]}
          onChange={setFoldAxis}
        />
      )}
      <Select
        label="The significance values are"
        value={pValues ? 'p' : 'negLog10'}
        options={[
          { value: 'negLog10', label: '−log10 P' },
          { value: 'p', label: 'P values' },
        ]}
        onChange={(v) => setPValues(v === 'p')}
      />
      <Checkbox
        label="Colour the points up, down or not significant"
        checked={colour}
        onChange={setColour}
      />
      <p className="muted">Points exactly at a cut-off count as significant.</p>
    </Dialog>
  )
}
