import type { Command, DocumentStore } from '@ps/engine'
import {
  aesKind,
  builderPresetsFor,
  canMoveLayer,
  cellsColumns,
  cellsColumnsNote,
  defaultUserPreset,
  equalizePlotSizes,
  frontFirst,
  graphPalette,
  graphTheme,
  histogramLayer,
  iconKindFor,
  iconViewBox,
  isEmbeddingPair,
  layerTitle,
  layoutGraph,
  levelsNote,
  mappingAxes,
  matrixKindOf,
  newGraphNode,
  PLOT_FAMILIES,
  type PlotStyle,
  plotIcon,
  presetCellsAllowed,
  presetsFor,
  previewGraph,
  previewNote,
  previewScreen,
  previewSource,
  recipeLayers,
  rowToIndex,
  splitGraphs,
  styleOfLayer,
  tooManyLevels,
  userPresetId,
  userPresetsFor,
  WHISKER_LABELS,
  withLayers,
  withOrientation,
} from '@ps/graph'
import {
  type DataSetColumn,
  type DataTable,
  type DocNode,
  type ErrorStat,
  type Frame,
  type GraphNode,
  type Layer,
  type LevelMeasure,
  levelsInTable,
  type NodeId,
  newAnnotationId,
  newNodeId,
  type PresetRecipe,
  presetRecipe,
  type Stat,
  type UserPreset,
} from '@ps/model'
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { Dialog, NoticeDialog } from '../../components/Dialog.tsx'
import { Checkbox, Field, RadioGroup, Select } from '../../components/fields.tsx'
import { useConfirm } from '../../components/modals.tsx'
import {
  useDoc,
  useResultLookup,
  useResultState,
  useServices,
  useSourceTable,
} from '../../context.tsx'
import { graphItems, newPageOf, withGraphs } from '../../layout/figure.ts'
import { type StackDirection, stackGraphs } from '../../layout/stack.ts'
import { rememberPreset } from '../../recentChoices.ts'
import { sourceProblem } from '../../resultTables.ts'
import { capitalize, hasGraphOf, newGraphName } from '../../util.ts'
import { graphChangeCommands } from '../graphActions.ts'
import { ERROR_STATS, pairedCenter } from '../inspector/errorBars.ts'
import { LevelOrderEditor } from '../LevelOrder.tsx'
import { NestedFields } from '../NestedFields.tsx'
import { ManagePresetsDialog, SavePresetDialog } from '../presets/PresetDialogs.tsx'
import { usePresetLibrary } from '../presets/userPresetStore.ts'
import { rowLabel, usedRows } from '../rows.ts'
import { NodeEl } from '../SceneSvg.tsx'
import { defaultSplitVariable, splitSet, textVariables } from '../split.ts'
import {
  type Appearance,
  appearanceAllowed,
  appearanceVariables,
  areasOf,
  axisVariables,
  type BuilderState,
  builderChange,
  builderOf,
  builderReducer,
  densityColored,
  type Groups,
  groupsOf,
  initialBuilder,
  styleChoices,
  withBuilderLevels,
} from './builderState.ts'
import { useLatest } from './latest.ts'

// The graph builder (roadmap 33c, design §7.1, the mockup the user approved): presets on top,
// plot-style icons drawn by the engine, the layer table on the left, a live preview on the right,
// and the data sets, rows and what to make below. It makes new graphs (Insert › New graph…),
// copies (Duplicate as…) and changes an existing graph's layers (Change layers…, one undo step).

/** What the builder works on. */
type BuilderMode =
  /** `preset`: the one to start from (the toolbar's New graph ▾, roadmap 43). */
  | { kind: 'new'; tableId: NodeId; preset?: string | undefined }
  | { kind: 'duplicate'; graphId: NodeId }
  /**
   * `store` and `graph`: where OK applies the change and the graph it changes (a Format dialog's
   * draft and its graph; else the document's).
   */
  | { kind: 'change'; graphId: NodeId; store?: DocumentStore; graph?: GraphNode }

type Split = 'none' | 'row' | 'dataSet' | 'level'

/** Slices share their data sets, so one legend (on the last graph) is enough for the figure. */
export function legendOnLast(graphs: GraphNode[]): GraphNode[] {
  return graphs.map((g, i) =>
    i < graphs.length - 1 && g.legend.show ? { ...g, legend: { ...g.legend, show: false } } : g,
  )
}

/**
 * The preset a new graph of a node starts with, when it has a natural one: a frequency
 * distribution's table is a histogram.
 */
export function defaultPresetFor(node: DocNode | undefined): string | undefined {
  return node?.kind === 'analysis' && node.analysisId === 'frequencyDistribution'
    ? 'histogram'
    : undefined
}

const KIND_LABELS: Record<DataTable['tableKind'], string> = {
  column: 'Column',
  grouped: 'Grouped',
  xy: 'XY',
  contingency: 'Contingency',
  survival: 'Survival',
  partsOfWhole: 'Parts of whole',
  multipleVariables: 'Multiple variables',
  nested: 'Nested',
}

/** The table's kind and shape, for the builder's header. */
export function tableContext(table: DataTable): string {
  const rows = table.rowCount
  const sets = table.dataSets.filter((d) => !d.text).length
  return `${KIND_LABELS[table.tableKind]} table · ${rows} row${rows === 1 ? '' : 's'} × ${sets} data set${sets === 1 ? '' : 's'}`
}

/** The preview's description for screen readers ("Bars (mean), error bars (SD)…, 3 data sets"). */
export function previewLabel(layers: readonly Layer[], frame: Frame, dataSets: number): string {
  const names = layers.filter((l) => l.visible !== false).map((l) => layerTitle(l, frame))
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)!.replace(/^./, (c) => c.toLowerCase())}`
      : (names[0] ?? 'Nothing')
  return `Preview: ${list}, ${dataSets} data set${dataSets === 1 ? '' : 's'}`
}

/** Values a table holds (the preview waits for typing to pause on large ones). */
const valueCount = (t: DataTable) =>
  t.dataSets.reduce((n, d) => n + d.subcolumns.length * t.rowCount, 0)

/** The builder dialog for any mode (its table first: a missing result table explains why). */
export function GraphBuilder(props: {
  mode: BuilderMode
  onClose: () => void
  onCreated?: (id: NodeId) => void
}) {
  const { mode } = props
  const inDoc = useDoc((d) =>
    mode.kind === 'new' ? undefined : (d.nodes[mode.graphId] as GraphNode | undefined),
  )
  const graph = (mode.kind === 'change' && mode.graph) || inDoc
  const tableId = mode.kind === 'new' ? mode.tableId : graph?.seriesSource.table
  const table = useSourceTable(tableId as NodeId)
  const node = useDoc((d) => (tableId ? d.nodes[tableId] : undefined))
  const state = useResultState(tableId as NodeId)
  if (!table) {
    return (
      <NoticeDialog
        title="New graph"
        message={sourceProblem(node, table, state) ?? 'The graph’s table is missing.'}
        onClose={props.onClose}
      />
    )
  }
  const preferred = (mode.kind === 'new' && mode.preset) || defaultPresetFor(node)
  return <BuilderForm {...props} table={table} graph={graph} preferred={preferred} />
}

function BuilderForm({
  mode,
  table,
  graph,
  preferred,
  onClose,
  onCreated,
}: {
  mode: BuilderMode
  table: DataTable
  graph: GraphNode | undefined
  preferred?: string
  onClose: () => void
  onCreated?: (id: NodeId) => void
}) {
  const { store, fonts } = useServices()
  const project = useDoc((d) => d)
  const { lookup } = useResultLookup()
  const kind = table.tableKind
  const library = usePresetLibrary()
  // A new graph starts from the user's default preset for the kind (unless the table has a
  // natural one, e.g. a histogram), once the library has been read.
  const userDefault =
    mode.kind === 'new' && !preferred ? defaultUserPreset(library.presets, kind, table) : undefined
  const [s, dispatch] = useReducer(
    (state: BuilderState, a: Parameters<typeof builderReducer>[2]) =>
      builderReducer(table, state, a),
    undefined,
    () => (graph ? builderOf(graph, table) : initialBuilder(table, preferred, userDefault)),
  )
  const acted = useRef(false)
  const act = (a: Parameters<typeof builderReducer>[2]) => {
    acted.current = true
    dispatch(a)
  }
  const defaulted = useRef(!!userDefault)
  useEffect(() => {
    if (!userDefault || acted.current || defaulted.current) return
    defaulted.current = true
    dispatch({ type: 'recipe', spec: recipeLayers(userDefault.recipe, table, userDefault.name) })
  }, [userDefault, table])
  const [presetDialog, setPresetDialog] = useState<'save' | 'manage' | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Roadmap 43: a table's second graph is "Data 1 (2)" (the first is named after the table), in
  // a dialog titled "Another graph of …", so the duplicate is plain to see.
  const [another] = useState(() => mode.kind === 'new' && hasGraphOf(project, mode.tableId))
  const [name, setName] = useState(() =>
    mode.kind === 'new' ? newGraphName(project, table.name) : `${graph?.name ?? ''} (copy)`,
  )
  const [dataSets, setDataSets] = useState<string[]>(table.dataSets.map((d) => d.id))
  // A cells table's variables as columns summarise its first 20 number variables to start with
  // (decision 453), all again when the graph becomes something else unless chosen by hand.
  const columns = mode.kind === 'new' ? cellsColumns(s, table) : null
  const numbers = useMemo(() => table.dataSets.filter((d) => !d.text).length, [table])
  const limited = useRef<string[] | null>(null)
  const columnsKey = columns?.join('\u0000') ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: on entering or leaving columns
  useEffect(() => {
    const all = table.dataSets.map((d) => d.id as string)
    if (columns && dataSets.length === all.length) {
      limited.current = columns
      setDataSets(columns)
    } else if (!columns && limited.current && dataSets === limited.current) {
      limited.current = null
      setDataSets(all)
    }
  }, [columnsKey])
  const chosenNumbers = columns
    ? dataSets.filter((id) => !table.dataSets.find((d) => d.id === id)?.text).length
    : numbers
  const sliceable = kind === 'grouped' || kind === 'contingency' || kind === 'xy'
  const rowsAvailable = useMemo(() => usedRows(table), [table])
  const [rows, setRows] = useState<number[]>(rowsAvailable)
  const [split, setSplit] = useState<Split>('none')
  // Roadmap 34d: one graph per level of a text variable.
  const textVars = useMemo(() => textVariables(table), [table])
  const [splitVar, setSplitVar] = useState<string>('')
  const [shareX, setShareX] = useState(true)
  const [shareY, setShareY] = useState(true)
  const [onPage, setOnPage] = useState(true)
  // Duplicate as…: the copy stacked with the original on a page.
  const [stack, setStack] = useState(true)
  const [direction, setDirection] = useState<StackDirection>('vertical')
  const [hideInner, setHideInner] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const theme = graph ? graphTheme(project, graph) : graphTheme(project)
  const palette = graph ? graphPalette(graph, theme) : (theme.categorical ?? theme.palette)
  const turnable = s.frame === 'category' || s.frame === 'grouped'

  /**
   * The graph the builder makes (or changes), as the preview shows it (`from`: the table it is
   * laid out of, a big table's sample in the preview).
   */
  const made = (forPreview: boolean, from: DataTable = table): GraphNode => {
    const change = builderChange(s)
    let g = graph ? withLayers(graph, change, from) : newGraphNode(from, change, name)
    if (!graph) {
      const allSets = dataSets.length === table.dataSets.length
      const allRows =
        !sliceable ||
        (rows.length === rowsAvailable.length && rows.every((r, i) => r === rowsAvailable[i]))
      g = {
        ...g,
        seriesSource: {
          table: table.id,
          include: allSets ? 'all' : dataSets,
          ...(allRows ? {} : { rows }),
        },
      }
    }
    if (turnable || graph?.style.orientation) g = withOrientation(g, s.horizontal)
    // Roadmap 36: a new graph of an embedding's two axes (UMAP_1 by UMAP_2) draws corner arrows.
    if (!graph && g.frame === 'xy') {
      const v = axisVariables(s)
      const titleOf = (k: string | undefined) => table.dataSets.find((d) => d.id === k)?.title ?? ''
      if (v.x && v.y && isEmbeddingPair(titleOf(v.x), titleOf(v.y)))
        g = { ...g, style: { ...g.style, frame: 'arrows' } }
    }
    if (s.drawOrder) g = { ...g, drawOrder: s.drawOrder }
    if (s.scales) g = { ...g, scales: { ...g.scales, ...s.scales } }
    g = withBuilderLevels(g, s, graph)
    return forPreview ? { ...g, id: (graph?.id ?? 'builderPreview') as NodeId } : g
  }

  // The preview (roadmap 34f): a big table's is drawn from a sample of its rows
  // (`previewSource`; the graph made draws them all) and laid out only for the last of quick
  // changes (`useLatest`), so clicking across plot styles never waits for stale layouts.
  const big = valueCount(table) > 20_000
  const { value: preview, stale } = useLatest(
    () => {
      try {
        // A graph of chosen rows names the whole table's rows: drawn whole.
        const sliced =
          (!graph && sliceable && rows.length !== rowsAvailable.length) ||
          !!graph?.seriesSource.rows
        const src = sliced
          ? { project, result: lookup, shown: 0, of: 0 }
          : previewSource(project, table.id, lookup)
        // The graph itself made of the rows drawn (its scaffold counts levels), of at most 20
        // variables, their points standing for rows about 5,000 in all (decision 452).
        const sample = src.project.nodes[table.id]
        const { graph: g, sets } = previewGraph(
          made(true, sample?.kind === 'table' ? sample : table),
          table,
        )
        const p = graph ? src.project : withGraphs(src.project, [g])
        return {
          scene: layoutGraph({
            project: p,
            graph: g,
            fonts,
            result: src.result,
            screen: previewScreen(sets?.shown ?? null),
          }),
          graph: g,
          note: previewNote({
            ...src,
            sets,
            setsName: kind === 'multipleVariables' ? 'variables' : 'data sets',
          }),
        }
      } catch {
        return null
      }
    },
    [s, dataSets, rows, name, project, fonts, lookup, graph],
    big,
  )

  const create = () => {
    if (!s.layers.length) return setError('Choose at least one plot style.')
    if (mode.kind === 'change' && graph) {
      const target = mode.store ?? store
      const cmds = graphChangeCommands(graph, made(false))
      if (cmds.length) target.dispatch(cmds, 'Change layers')
      onClose()
      return
    }
    if (mode.kind === 'duplicate' && graph) {
      duplicate(made(false))
      return
    }
    if (!dataSets.length) return setError('Choose at least one data set.')
    if (sliceable && !rows.length) return setError('Choose at least one row.')
    const base = made(false)
    // A set of split graphs (roadmap 34d): live with the table, on a page's grid when asked.
    const opts = {
      by: split === 'none' ? ('level' as const) : split,
      ...(split === 'level' ? { variable: splitVar || defaultSplitVariable(base, textVars) } : {}),
      linkX: shareX,
      linkY: shareY,
    }
    const set = split === 'none' || !onPage ? null : splitSet(project, fonts, table, base, opts)
    const graphs =
      split === 'none' ? [base] : (set?.graphs ?? equalizePlotSizes(splitGraphs(table, base, opts)))
    if (!graphs.length) return setError('There is nothing to split the graph by.')
    const nodes: DocNode[] = [...graphs, ...(set ? [set.layout] : [])]
    // Offered again by the toolbar's New graph ▾ (roadmap 43): built-in presets as chosen.
    const chosen = s.custom ? undefined : s.preset
    if (chosen && presetsFor(kind).some((p) => p.id === chosen)) rememberPreset(kind, chosen)
    store.dispatch(
      // New graphs take the project's style (roadmap 37).
      nodes.map((n) => ({ type: 'node.add' as const, node: n, fresh: n.kind === 'graph' })),
      split === 'none'
        ? 'New graph'
        : `New graphs (one per ${split === 'row' ? 'row' : split === 'level' ? 'level' : 'data set'})`,
    )
    onCreated?.(nodes[nodes.length - 1]!.id)
    onClose()
  }

  /** Duplicate as…: the copy (with the builder's layers), alone or stacked with the original. */
  const duplicate = (changed: GraphNode) => {
    if (!graph) return
    const copy = copyGraph(changed, name)
    const cmds: Command[] = []
    let open: NodeId = copy.id
    if (!stack) {
      cmds.push({ type: 'node.add', node: copy, at: project.order.indexOf(graph.id) + 1 })
    } else {
      let res!: ReturnType<typeof stackGraphs>
      const layout = newPageOf(
        `${graph.name} (two views)`,
        (page) => {
          res = stackGraphs(project, [graph, copy], fonts, page, { direction, shareY, hideInner })
          return graphItems(res.graphs, res.placements)
        },
        { orientation: direction === 'vertical' ? 'portrait' : 'landscape' },
      )
      const [orig, dup] = res.graphs as [GraphNode, GraphNode]
      cmds.push(...graphChangeCommands(graph, orig))
      cmds.push({ type: 'node.add', node: dup, at: project.order.indexOf(graph.id) + 1 })
      cmds.push({ type: 'node.add', node: layout })
      open = layout.id
    }
    store.dispatch(cmds, stack ? 'Duplicate and stack graphs' : 'Duplicate graph')
    onCreated?.(open)
    onClose()
  }

  const splitKey = splitVar || defaultSplitVariable(s, textVars)
  const levelCount = useMemo(() => {
    const v = table.dataSets.find((d) => d.id === splitKey)
    return v?.text ? levelsInTable(v).length : 0
  }, [table, splitKey])
  const count =
    split === 'row'
      ? rows.length
      : split === 'dataSet'
        ? dataSets.length
        : split === 'level'
          ? levelCount
          : 1
  const title =
    mode.kind === 'new'
      ? `${another ? 'Another' : 'New'} graph of “${table.name}”`
      : mode.kind === 'duplicate'
        ? `Duplicate “${graph?.name}”`
        : `Change layers of “${graph?.name}”`
  const okLabel =
    mode.kind === 'change'
      ? 'OK'
      : mode.kind === 'duplicate'
        ? stack
          ? 'Duplicate and stack'
          : 'Duplicate'
        : count > 1
          ? `Create ${count} graphs`
          : 'Create'
  const shownSets = dataSets.length || 1

  /** The builder's layers as a preset recipe (null: nothing a preset can keep). */
  const recipe = (): PresetRecipe | null => {
    try {
      return presetRecipe(
        {
          frame: s.frame,
          look: s.look,
          layers: s.layers,
          style: turnable && s.horizontal ? { orientation: 'horizontal' } : {},
          drawOrder: s.drawOrder ?? graph?.drawOrder,
          scales: s.scales ?? graph?.scales,
          ...(s.mapping ? { mapping: s.mapping } : {}),
        },
        kind,
        table,
      )
    } catch {
      return null
    }
  }
  const saveRecipe = presetDialog === 'save' ? recipe() : null

  return (
    <>
      <Dialog title={title} onClose={onClose} wide okLabel={okLabel} onOk={create}>
        <div className="graph-builder">
          <p className="builder-context muted">
            {tableContext(table)}
            {mode.kind !== 'new' && ` · “${table.name}”`}
          </p>
          <PresetsRow
            table={table}
            s={s}
            user={userPresetsFor(library.presets, kind, table)}
            onPick={(id) => {
              setSaved(null)
              act({ type: 'preset', id })
            }}
            onPickUser={(p) => {
              setSaved(null)
              act({ type: 'recipe', spec: recipeLayers(p.recipe, table, p.name) })
            }}
            canSave={!!library.library && s.layers.length > 0}
            onSave={() => setPresetDialog('save')}
            onManage={library.library ? () => setPresetDialog('manage') : undefined}
          />
          {saved && (
            <p className="builder-note" role="status">
              {saved}
            </p>
          )}
          <StyleIcons
            table={table}
            s={s}
            palette={palette}
            onToggle={(style) => act({ type: 'toggle', style })}
          />
          {s.note && (
            <p className="builder-note" role="status">
              {s.note}
            </p>
          )}
          {chosenNumbers < numbers && (
            <p className="builder-note" role="status">
              {cellsColumnsNote(chosenNumbers, numbers)}
            </p>
          )}
          <div className="builder-main">
            <div className="builder-layers">
              <LayerTable s={s} table={table} palette={palette} act={act} />
              <div className="builder-options">
                {turnable && (
                  <Checkbox
                    label="Horizontal (categories down the left, values across)"
                    checked={s.horizontal}
                    onChange={(on) => act({ type: 'horizontal', on })}
                  />
                )}
                {s.frame === 'grouped' && (
                  <Select<Groups>
                    label="Groups"
                    value={groupsOf(s.layers)}
                    options={[
                      { value: 'dodge', label: 'Side by side' },
                      { value: 'aligned', label: 'At the same position' },
                      { value: 'stack', label: 'Stacked' },
                      { value: 'percent', label: '100% stacked' },
                    ]}
                    onChange={(value) => act({ type: 'groups', value })}
                  />
                )}
                {s.frame === 'xy' && s.layers.some((l) => l.geom === 'area') && (
                  <Select
                    label="Areas"
                    value={areasOf(s.layers)}
                    options={[
                      { value: 'overlap', label: 'Overlapping' },
                      { value: 'stack', label: 'Stacked' },
                    ]}
                    onChange={(v) => act({ type: 'areas', stacked: v === 'stack' })}
                  />
                )}
                {s.frame === 'polar' && (
                  <Select<'whole.pie' | 'whole.donut'>
                    label="Shape"
                    value={s.look === 'whole.donut' ? 'whole.donut' : 'whole.pie'}
                    options={[
                      { value: 'whole.pie', label: 'Pie' },
                      { value: 'whole.donut', label: 'Donut' },
                    ]}
                    onChange={(look) => act({ type: 'look', look: look as 'whole.pie' })}
                  />
                )}
                <MapVariables table={table} s={s} act={act} />
              </div>
            </div>
            <section
              className={`builder-preview ${stale ? 'stale' : ''}`}
              aria-label="Preview"
              aria-busy={stale}
            >
              {preview?.note && (
                <p className="builder-preview-note muted" role="note">
                  {preview.note}
                </p>
              )}
              {preview ? (
                <svg
                  role="img"
                  aria-label={previewLabel(s.layers, s.frame, shownSets)}
                  viewBox={`0 0 ${preview.scene.width} ${preview.scene.height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <rect width={preview.scene.width} height={preview.scene.height} fill="#ffffff" />
                  <NodeEl node={preview.scene.root} />
                </svg>
              ) : (
                <p className="muted">{stale ? 'Drawing the preview…' : 'No preview.'}</p>
              )}
              {preview && preview.scene.warnings.length > 0 && (
                <ul className="builder-warnings">
                  {preview.scene.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {mode.kind === 'new' && (
            <BottomStrip
              table={table}
              name={name}
              setName={setName}
              dataSets={dataSets}
              setDataSets={setDataSets}
              rows={rows}
              setRows={setRows}
              rowsAvailable={rowsAvailable}
              sliceable={sliceable}
              split={split}
              setSplit={setSplit}
              textVars={textVars}
              splitVar={splitVar || defaultSplitVariable(s, textVars)}
              setSplitVar={setSplitVar}
              levelCount={levelCount}
              xLinkable={s.frame === 'xy'}
              shareX={shareX}
              setShareX={setShareX}
              shareY={shareY}
              setShareY={setShareY}
              onPage={onPage}
              setOnPage={setOnPage}
              nested={s.nested}
              setNested={(value) => act({ type: 'nested', value })}
              mapped={!!s.mapping}
              histogram={!!histogramLayer(s)}
            />
          )}
          {mode.kind === 'duplicate' && (
            <div className="builder-strip">
              <Field label="Name of the copy">
                {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Checkbox
                label="Put both on a new layout page, plot areas aligned"
                checked={stack}
                onChange={setStack}
              />
              {stack && (
                <>
                  <RadioGroup<StackDirection>
                    legend="Arrangement"
                    name="dup-dir"
                    value={direction}
                    options={[
                      { value: 'vertical', label: 'One above the other (categories line up)' },
                      { value: 'horizontal', label: 'Side by side (Y scales line up)' },
                    ]}
                    onChange={setDirection}
                  />
                  <Checkbox
                    label="Share the Y axis range (stays in sync)"
                    checked={shareY}
                    onChange={setShareY}
                  />
                  <Checkbox
                    label={
                      direction === 'vertical'
                        ? 'Show X axis labels on the bottom graph only'
                        : 'Show Y axis labels on the left graph only'
                    }
                    checked={hideInner}
                    onChange={setHideInner}
                  />
                </>
              )}
            </div>
          )}
          {mode.kind === 'change' && (
            <p className="muted">
              OK applies the layers as one step; formats of layers that stay are kept.
            </p>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
      </Dialog>
      {presetDialog === 'save' &&
        (saveRecipe ? (
          <SavePresetDialog
            recipe={saveRecipe}
            onClose={() => setPresetDialog(null)}
            onSaved={(_, message) => setSaved(message)}
          />
        ) : (
          <NoticeDialog
            title="Save as preset"
            message="These layers draw only analysis results or functions, which a preset can’t keep."
            onClose={() => setPresetDialog(null)}
          />
        ))}
      {presetDialog === 'manage' && <ManagePresetsDialog onClose={() => setPresetDialog(null)} />}
    </>
  )
}

/**
 * A copy of a graph with new ids (its annotations too). Its curves keep their ids, which only
 * need be unique within the graph, so their formats and legend entries stay theirs.
 */
export function copyGraph(graph: GraphNode, name: string): GraphNode {
  const copy: GraphNode = { ...structuredClone(graph), id: newNodeId(), name }
  copy.annotations = copy.annotations.map((a) => ({ ...a, id: newAnnotationId() }))
  return copy
}

// --- Presets -------------------------------------------------------------------------------

/**
 * The presets row: the user's presets that fit the table first (starred), then the built-in ones,
 * as one radio group (arrow keys, Home / End), "Custom" once edited; Save as preset… and Manage.
 */
function PresetsRow({
  table,
  s,
  user,
  onPick,
  onPickUser,
  canSave,
  onSave,
  onManage,
}: {
  table: DataTable
  s: BuilderState
  user: readonly UserPreset[]
  onPick: (id: string) => void
  onPickUser: (p: UserPreset) => void
  canSave: boolean
  onSave: () => void
  onManage?: () => void
}) {
  const chips = [
    ...user.map((p) => ({
      id: userPresetId(p.name),
      label: p.name,
      description: `Your preset (${p.recipe.layers.length} layer${p.recipe.layers.length === 1 ? '' : 's'})`,
      pick: () => onPickUser(p),
      user: true,
      reason: undefined as string | undefined,
    })),
    ...builderPresetsFor(table.tableKind, table).map((p) => {
      // A cells table's chips of a mark per row are shown disabled, with why (roadmap 34f).
      const a = presetCellsAllowed(p.id, table, s.mapping ? { mapping: s.mapping } : {})
      return {
        id: p.id,
        label: p.label,
        description: p.description,
        pick: () => onPick(p.id),
        user: false,
        reason: a.allowed ? undefined : a.reason,
      }
    }),
  ]
  const describedBy = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = chips.findIndex((p) => p.id === s.preset)
  // The presets are the dialog's first stop (design §7.4): focused once it has opened (after
  // the modal's own focusing, which would take the first chip whatever is chosen).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on open only
  useEffect(() => {
    const id = requestAnimationFrame(() => refs.current[Math.max(at, 0)]?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  // Arrows step over disabled chips (they explain themselves on hover and to screen readers).
  const focus = (i: number, by = 1) => {
    for (let k = 0; k < chips.length; k++) {
      const n = (((i + k * by) % chips.length) + chips.length) % chips.length
      if (chips[n]!.reason) continue
      chips[n]!.pick()
      refs.current[n]?.focus()
      return
    }
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const by =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (by) focus(i + by, by)
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(chips.length - 1, -1)
    else return
    e.preventDefault()
  }
  return (
    <div className="builder-presets">
      <span className="builder-label" id="builder-presets-label">
        Presets
      </span>
      <div className="preset-row-line">
        <div role="radiogroup" aria-labelledby="builder-presets-label" className="preset-chips">
          {chips.map((p, i) => {
            const on = p.id === s.preset
            return (
              // biome-ignore lint/a11y/useSemanticElements: chips, a radio group of buttons (design §7.4)
              <button
                key={p.id}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={on && !s.custom}
                tabIndex={(at < 0 ? i === 0 : on) ? 0 : -1}
                className={`chip ${p.user ? 'user' : ''} ${on ? (s.custom ? 'provenance' : 'on') : ''} ${p.reason ? 'unavailable' : ''}`}
                aria-label={p.label}
                aria-description={p.user ? 'Your preset' : undefined}
                aria-disabled={p.reason ? true : undefined}
                aria-describedby={p.reason ? `${describedBy}-${p.id}` : undefined}
                title={p.reason ? `${p.label}: ${p.reason}` : p.description}
                onClick={() => !p.reason && p.pick()}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                {p.user && (
                  <span className="user-mark" aria-hidden="true">
                    ★{' '}
                  </span>
                )}
                {p.label}
                {p.reason && (
                  <span id={`${describedBy}-${p.id}`} className="visually-hidden">
                    {p.reason}
                  </span>
                )}
              </button>
            )
          })}
          {s.custom && <span className="chip custom">Custom</span>}
        </div>
        <span className="preset-actions">
          <button type="button" className="link" disabled={!canSave} onClick={onSave}>
            Save as preset…
          </button>
          {onManage && (
            <button type="button" className="link" aria-label="Manage presets…" onClick={onManage}>
              Manage…
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

// --- Plot-style icons ------------------------------------------------------------------------

/** A plot style's icon, drawn by the graph engine (cached). */
function PlotIcon({
  style,
  table,
  frame,
  palette,
}: {
  style: string
  table: DataTable['tableKind']
  frame?: Frame
  palette: readonly string[]
}) {
  const { fonts } = useServices()
  const scene = plotIcon(fonts, style, table, { frame, palette })
  if (!scene) return null
  const [x, y, w, h] = iconViewBox(scene)
  return (
    <svg
      className="plot-icon-svg"
      viewBox={`${x} ${y} ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      <NodeEl node={scene.root} />
    </svg>
  )
}

/** The plot styles, grouped and tinted by family: toggle buttons, unavailable ones with why. */
function StyleIcons({
  table,
  s,
  palette,
  onToggle,
}: {
  table: DataTable
  s: BuilderState
  palette: readonly string[]
  onToggle: (style: string) => void
}) {
  const id = useId()
  const choices = styleChoices(table, s)
  return (
    <div className="builder-styles">
      {PLOT_FAMILIES.map((f) => {
        const mine = choices.filter((c) => c.style.family === f.id)
        if (!mine.length) return null
        return (
          <fieldset key={f.id} className={`style-family family-${f.id}`}>
            <legend className="builder-label">{f.label}</legend>
            <div className="style-icons">
              {mine.map(({ style, selected, allowed }) => {
                const why = `${id}-${style.id}-why`
                const frameChoice = !!style.frameChoice
                // A style the graph has can always be taken off (a cells table's swarm, roadmap
                // 34f): not disabled, though it couldn't be added now.
                const removable = selected && !frameChoice && !allowed.allowed
                const usable = allowed.allowed || removable
                return (
                  <button
                    key={style.id}
                    type="button"
                    className={`style-icon ${selected ? 'on' : ''} ${usable ? '' : 'unavailable'}`}
                    aria-pressed={selected}
                    aria-label={style.label}
                    aria-disabled={!usable}
                    aria-describedby={allowed.allowed ? undefined : why}
                    title={
                      allowed.allowed
                        ? frameChoice
                          ? `${style.label}: replaces the layers`
                          : style.label
                        : removable
                          ? `${style.label}: ${allowed.reason} Click to take it off.`
                          : `${style.label}: ${allowed.reason}`
                    }
                    onClick={() => usable && onToggle(style.id)}
                  >
                    <span className="icon-circle">
                      <PlotIcon
                        style={style.id}
                        table={iconKindFor(
                          matrixKindOf(table, s),
                          style.frameChoice ? style.frames[0] : s.frame,
                        )}
                        frame={style.frameChoice ? undefined : s.frame}
                        palette={palette}
                      />
                      {selected && (
                        <span className="check-badge" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </span>
                    <span className="icon-label">{style.label}</span>
                    {!allowed.allowed && (
                      <span id={why} className="visually-hidden">
                        {allowed.reason}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}

// --- The layer table -----------------------------------------------------------------------

const CENTER = [
  ['mean', 'Mean'],
  ['median', 'Median'],
  ['geomean', 'Geometric mean'],
] as const

/** The dropdowns a layer's stat needs in the table. */
function StatSelect({
  layer,
  frame,
  onChange,
  counts = false,
}: {
  layer: Layer
  frame: Frame
  onChange: (s: Stat) => void
  /** Text × text: each cell is a count (Show says count or percent), nothing to summarise. */
  counts?: boolean
}): ReactNode {
  if (counts) return null
  const s = layer.stat
  const label = `${layerTitle(layer, frame)}: statistic`
  const select = (
    value: string,
    options: readonly (readonly [string, string])[],
    on: (v: string) => void,
  ) => (
    <select aria-label={label} value={value} onChange={(e) => on(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
  switch (layer.geom) {
    case 'points':
      if (layer.aes) return null
      return select(
        s.kind === 'identity' ? 'each' : s.kind === 'summary' ? s.center : 'each',
        [
          ['each', frame === 'xy' ? 'Each replicate' : 'All values'],
          ['mean', 'Mean'],
          ['median', 'Median'],
        ],
        (v) =>
          onChange(v === 'each' ? { kind: 'identity' } : { kind: 'summary', center: v as 'mean' }),
      )
    case 'bar':
    case 'center':
    case 'line':
    case 'step':
    case 'area':
      // A histogram: what its bars measure, and its bins' width (empty: automatic).
      if (s.kind === 'bin')
        return (
          <span className="field-row">
            {select(
              s.measure ?? 'count',
              [
                ['count', 'Count'],
                ['percent', 'Percent'],
                ['fraction', 'Fraction'],
              ],
              (v) => onChange({ ...s, measure: v as 'count' }),
            )}
            <BinWidthInput
              label={`${layerTitle(layer, frame)}: bin width`}
              width={s.width}
              onChange={(width) => {
                const { width: _, ...rest } = s
                onChange(width === undefined ? rest : { ...rest, width })
              }}
            />
          </span>
        )
      if (s.kind !== 'summary' || s.by === 'all' || s.by === 'subject') return null
      return select(s.center, CENTER, (v) => onChange({ ...s, center: v as 'mean' }))
    case 'errorbar':
    case 'band':
      if (s.kind !== 'summary') return null
      return select(
        s.error ?? 'none',
        ERROR_STATS.map((e) => [e.value, e.label] as const),
        (v) => {
          const error = v as ErrorStat
          // A median's spread with the median, the geometric mean's with it (IQR, geometric SD).
          onChange({ ...s, center: pairedCenter(error, s.center) as typeof s.center, error })
        },
      )
    case 'box':
      return select(
        s.kind === 'range' ? 'range' : s.kind === 'boxplot' ? s.whiskers : 'minmax',
        [
          ...Object.entries(WHISKER_LABELS).map(([k, l]) => [k, `Whiskers ${l}`] as const),
          ['range', 'Floating (min to max)'],
        ],
        (v) =>
          onChange(
            v === 'range'
              ? { kind: 'range', center: 'mean' }
              : { kind: 'boxplot', whiskers: v as 'tukey' },
          ),
      )
    default:
      return null
  }
}

/** A histogram's bin width: empty for the automatic one; applied once it is a positive number. */
function BinWidthInput({
  label,
  width,
  onChange,
}: {
  label: string
  width: number | undefined
  onChange: (w: number | undefined) => void
}) {
  const [text, setText] = useState(width === undefined ? '' : String(width))
  return (
    <input
      type="number"
      aria-label={label}
      placeholder="Auto width"
      min={0}
      step="any"
      value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        const v = Number(t)
        if (!t.trim()) onChange(undefined)
        else if (Number.isFinite(v) && v > 0) onChange(v)
      }}
    />
  )
}

/**
 * One row per layer, front first (the top row is drawn in front, roadmap 33e): icon, name, its
 * stat, ↑ / ↓ (and drag; up is towards the front), ✕. Attached layers (error bars, labels) show
 * their host and, just above it, point down to it.
 */
function LayerTable({
  s,
  table,
  palette,
  act,
}: {
  s: BuilderState
  table: DataTable
  palette: readonly string[]
  act: (a: Parameters<typeof builderReducer>[2]) => void
}) {
  const confirm = useConfirm()
  const [dragging, setDragging] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLTableRowElement | null>())
  const name = (l: Layer) => layerTitle(l, s.frame)
  const attachedTo = (id: string) =>
    s.layers.filter((l) => l.on === id || (l.data?.from === 'layer' && l.data.layer === id))
  const shown = frontFirst(s.layers)
  const n = shown.length
  // Focus follows the row moved with the keyboard (its element may be new after a move).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus after the layers change
  useEffect(() => {
    if (current) rows.current.get(current)?.focus()
  }, [current, s.layers])
  const remove = async (id: string) => {
    const host = s.layers.find((l) => l.id === id)
    const with_ = attachedTo(id)
    if (
      host &&
      with_.length &&
      !(await confirm({
        title: `Delete ${name(host)} and what is on it (${with_.map(name).join(', ')})?`,
        ok: 'Delete',
        danger: true,
      }))
    )
      return
    // Focus the row that takes its place (else the one above).
    const row = shown.findIndex((l) => l.id === id)
    const gone = new Set([id, ...with_.map((l) => l.id)])
    const rest = shown.filter((l) => !gone.has(l.id))
    const next = rest[Math.min(row, rest.length - 1)]
    if (current === id) setCurrent(next?.id ?? null)
    act({ type: 'remove', id })
  }
  /** Up: towards the front (1); down: towards the back (−1). */
  const move = (id: string, by: 1 | -1) => act({ type: 'move', id, by })
  const onKeyDown = (e: KeyboardEvent, l: Layer, row: number) => {
    if (e.target !== e.currentTarget) return
    const up = e.key === 'ArrowUp'
    const down = e.key === 'ArrowDown'
    if ((up || down) && e.altKey) {
      move(l.id, up ? 1 : -1)
      setCurrent(l.id)
    } else if (up || down) {
      const next = shown[row + (up ? -1 : 1)]
      if (next) setCurrent(next.id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') void remove(l.id)
    else return
    e.preventDefault()
  }
  return (
    <div className="builder-table">
      <span className="builder-label" id="builder-layers-label">
        Layers, front to back
      </span>
      {n === 0 && <p className="muted">Choose plot styles above.</p>}
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a grid of layer rows with their controls (design §7.4) */}
      <table role="grid" aria-labelledby="builder-layers-label" className="layer-grid">
        <tbody>
          {shown.map((l, row) => {
            const on = s.layers.find((h) => h.id === l.on)
            const style: PlotStyle | undefined = styleOfLayer(l, s.frame)
            const end = n > 1 && (row === 0 ? 'front' : row === n - 1 ? 'back' : null)
            return (
              <tr
                key={l.id}
                ref={(el) => {
                  rows.current.set(l.id, el)
                }}
                aria-label={name(l)}
                aria-description={end ? `in ${end}` : undefined}
                tabIndex={current === l.id || (!current && row === 0) ? 0 : -1}
                className={`layer-row ${on ? 'attached' : ''}`}
                draggable
                onFocus={(e) => e.target === e.currentTarget && setCurrent(l.id)}
                onKeyDown={(e) => onKeyDown(e, l, row)}
                onDragStart={(e) => {
                  setDragging(l.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', l.id)
                }}
                onDragOver={(e) => dragging && dragging !== l.id && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragging) act({ type: 'moveTo', id: dragging, to: rowToIndex(n, row) })
                  setDragging(null)
                }}
                onDragEnd={() => setDragging(null)}
              >
                <td className="layer-index" title={on ? `On ${name(on)}` : undefined}>
                  {on ? '↲' : ''}
                </td>
                <td className="layer-icon">
                  {style && (
                    <PlotIcon
                      style={style.id}
                      table={iconKindFor(matrixKindOf(table, s), s.frame)}
                      frame={s.frame}
                      palette={palette}
                    />
                  )}
                </td>
                <td className="layer-name">
                  {name(l)}
                  {on && <span className="muted"> on {name(on)}</span>}
                  {end && <span className="muted layer-end"> · {end}</span>}
                </td>
                <td>
                  <StatSelect
                    layer={l}
                    frame={s.frame}
                    counts={matrixKindOf(table, s) === 'mvTextText'}
                    onChange={(stat) => act({ type: 'stat', id: l.id, stat })}
                  />
                </td>
                <td className="layer-buttons">
                  <button
                    type="button"
                    aria-label={`Move ${name(l)} up (to the front)`}
                    title="Bring forward (Alt+↑)"
                    disabled={!canMoveLayer(s.layers, l.id, 1)}
                    onClick={() => move(l.id, 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${name(l)} down (to the back)`}
                    title="Send backward (Alt+↓)"
                    disabled={!canMoveLayer(s.layers, l.id, -1)}
                    onClick={() => move(l.id, -1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${name(l)}`}
                    title="Delete"
                    onClick={() => void remove(l.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted">
        The top layer is drawn in front. Alt+↑ / ↓ moves the focused layer forward or back, Delete
        removes it.
      </p>
    </div>
  )
}

/** A variable's name and type in the Map variables lists ("Group (text)"). */
const variableLabel = (d: DataTable['dataSets'][number]) =>
  `${d.title || d.id} (${d.text ? 'text' : d.formula !== undefined ? 'number, calculated' : 'number'})`

/**
 * Multiple variables (roadmap 34a): the variables on X and Y, of any type; the frame follows the
 * types. Colour, shape, size and labels (roadmap 34b) take the variables the matrix allows for
 * the layers chosen (`appearanceAllowed`; the others listed but disabled, the row's reason shown
 * when none fits), and on XY graphs the lines' groups. Each variable shows its type. Graphs of a
 * text variable's levels have "Order of levels…" and, text × text, what they count.
 */
function MapVariables({
  table,
  s,
  act,
}: {
  table: DataTable
  s: BuilderState
  act: (a: Parameters<typeof builderReducer>[2]) => void
}) {
  /** Order of levels… open, with the order it was opened on (Cancel puts it back). */
  const [ordering, setOrdering] = useState<{ levels: BuilderState['levels'] } | null>(null)
  if (table.tableKind !== 'multipleVariables') return null
  const vars = axisVariables(s)
  const looks = appearanceVariables(s)
  // Lines by group, and paths (roadmap 34c): their groups; vectors: their ends.
  const lines = s.layers.find((l) => (l.geom === 'line' || l.geom === 'path') && l.aes)
  const vectors = s.layers.find((l) => l.geom === 'segment')
  const all = table.dataSets
  const axes = s.mapping && mappingAxes(table, s.mapping)
  const tt = axes === 'tt'
  // A histogram of a variable (roadmap 34f): X binned, its groups overlaid or stacked.
  const hist = s.mapping ? undefined : histogramLayer(s)
  const select = (
    field: string,
    label: string,
    value: string,
    options: readonly DataTable['dataSets'][number][],
    on: (key: string | undefined) => void,
    none?: string,
    disabled = false,
    /** Why a variable can't be chosen (absent: it can). */
    why: (key: string) => string | undefined = () => undefined,
  ) => {
    // Roadmap 34e: a text variable of more than 1,000 levels can't be an axis, colour, shape or
    // group (labels are point labels, at most 100 shown).
    const reasons = options.map(
      (d) => (field === 'label' ? undefined : tooManyLevels(d)) ?? why(d.id),
    )
    // A row none of whose variables fits says why (the first reason), and is disabled.
    const none_ = options.length > 0 && reasons.every(Boolean) && !value
    const hint = none_ ? reasons[0] : undefined
    return (
      <Field key={field} label={label}>
        {(id) => (
          <>
            <select
              id={id}
              value={value}
              disabled={disabled || none_}
              title={hint}
              aria-describedby={hint ? `${id}-why` : undefined}
              onChange={(e) => on(e.target.value || undefined)}
            >
              {none !== undefined && <option value="">{none}</option>}
              {options.map((d, i) => (
                <option key={d.id} value={d.id} disabled={!!reasons[i] && d.id !== value}>
                  {variableLabel(d)}
                  {levelsNote(d)}
                  {reasons[i] && d.id !== value && !none_ ? ` — ${reasons[i]}` : ''}
                </option>
              ))}
            </select>
            {hint && (
              <span className="muted map-why" id={`${id}-why`}>
                {capitalize(hint)}
              </span>
            )}
          </>
        )}
      </Field>
    )
  }
  /** A row of a variable mapped to appearance (roadmap 34b). */
  const appearance = (field: Appearance, label: string) =>
    select(
      field,
      label,
      looks[field] ?? '',
      // The variables of the types the aesthetic takes (shapes: text; sizes: numbers), not on an
      // axis of a graph of variables.
      all.filter(
        (d) =>
          aesKind(field, d.text ? 'text' : 'number') !== null &&
          !(s.mapping && field === 'color' && (d.id === vars.x || d.id === vars.y)),
      ),
      (key) => act({ type: 'appearance', field, key }),
      'None',
      !vars.x || tt,
      (key) => {
        const a = appearanceAllowed(table, s, field, key)
        return a.allowed ? undefined : a.reason
      },
    )
  const map = (field: 'x' | 'y' | 'color') => (key: string | undefined) =>
    act({ type: 'map', field, key })
  return (
    <fieldset className="field map-variables">
      <legend>Map variables</legend>
      {select('x', 'X', vars.x ?? '', all, map('x'), 'Each number variable (columns)')}
      {select('y', 'Y', vars.y ?? '', all, map('y'), hist ? 'Counts (histogram)' : '—', !vars.x)}
      {tt
        ? select('color', 'Colour', '', [], map('color'), 'The Y variable', true)
        : densityColored(s)
          ? select('color', 'Colour', '', [], () => {}, 'Local density (below)', true)
          : appearance('color', 'Colour')}
      {/* Roadmap 34g: the points coloured by their local density, the densest on top. */}
      {!s.mapping &&
        !hist &&
        s.frame === 'xy' &&
        s.layers.some((l) => l.geom === 'points' && l.aes) && (
          <Checkbox
            label="Colour the points by their local density"
            checked={densityColored(s)}
            onChange={(on) => act({ type: 'densityColor', on })}
          />
        )}
      {!tt && appearance('shape', 'Shape')}
      {!tt && appearance('size', 'Size')}
      {!tt && appearance('label', 'Label')}
      {lines &&
        select(
          'group',
          lines.geom === 'line' ? 'Lines by' : 'Paths by',
          lines.aes?.group ?? '',
          all.filter((d) => d.text),
          (key) => act({ type: 'aes', field: 'group', key }),
          'The colour variable',
        )}
      {vectors &&
        (['xend', 'yend'] as const).map((field) =>
          select(
            field,
            field === 'xend' ? 'X end' : 'Y end',
            vectors.aes?.[field] ?? '',
            all.filter((d) => !d.text),
            (key) => act({ type: 'aes', field, key }),
          ),
        )}
      {hist?.aes?.color && (
        <Select
          label="Groups"
          value={hist.position?.kind === 'stack' ? 'stack' : 'overlay'}
          options={[
            { value: 'overlay', label: 'Overlaid (translucent)' },
            { value: 'stack', label: 'Stacked' },
          ]}
          onChange={(v) => act({ type: 'bins', stacked: v === 'stack' })}
        />
      )}
      {tt && (
        <Select<LevelMeasure>
          label="Show"
          value={s.mapping?.measure ?? 'count'}
          options={[
            { value: 'count', label: 'Count' },
            { value: 'percentOfX', label: 'Percent within each X level' },
            { value: 'percentOfTotal', label: 'Percent of total' },
          ]}
          onChange={(value) => act({ type: 'measure', value })}
        />
      )}
      {(s.mapping || looks.color || looks.shape) && (
        <button
          type="button"
          className="map-levels"
          onClick={() => setOrdering({ levels: s.levels })}
        >
          Order of levels…
        </button>
      )}
      {ordering && (s.mapping || looks.color || looks.shape) && (
        <Dialog
          title="Order of levels"
          onClose={() => {
            act({ type: 'allLevels', levels: ordering.levels })
            setOrdering(null)
          }}
          okLabel="Done"
          onOk={() => setOrdering(null)}
        >
          <LevelOrderEditor
            table={table}
            graph={{
              ...(s.mapping ? { mapping: s.mapping } : {}),
              ...(s.levels ? { levels: s.levels } : {}),
              ...(s.levelOrder ? { levelOrder: s.levelOrder } : {}),
              frame: s.frame,
              layers: s.layers,
              seriesSource: { table: table.id, include: 'all' },
            }}
            onChange={(variable, order) => act({ type: 'levels', variable, order })}
          />
        </Dialog>
      )}
    </fieldset>
  )
}

// --- Bottom strip (new graphs) ---------------------------------------------------------------

function BottomStrip(p: {
  table: DataTable
  name: string
  setName: (v: string) => void
  dataSets: string[]
  setDataSets: (v: string[]) => void
  rows: number[]
  setRows: (v: number[]) => void
  rowsAvailable: number[]
  sliceable: boolean
  split: Split
  setSplit: (v: Split) => void
  /** Text variables to split by (roadmap 34d), the one chosen and its levels' count. */
  textVars: readonly DataSetColumn[]
  splitVar: string
  setSplitVar: (v: string) => void
  levelCount: number
  /** X is continuous (XY graphs): it can be shared too. */
  xLinkable: boolean
  shareX: boolean
  setShareX: (v: boolean) => void
  shareY: boolean
  setShareY: (v: boolean) => void
  onPage: boolean
  setOnPage: (v: boolean) => void
  nested: BuilderState['nested']
  setNested: (v: Partial<NonNullable<BuilderState['nested']>>) => void
  /** A graph of variables (its categories are levels, not data sets). */
  mapped: boolean
  /** Roadmap 34g: a histogram of a variable — per data set, one histogram per variable. */
  histogram?: boolean
}) {
  const { table } = p
  const toggle = <T,>(list: T[], v: T, on: boolean, order: readonly T[]) =>
    order.filter((x) => (x === v ? on : list.includes(x)))
  return (
    <div className="builder-strip">
      <Field label="Name">
        {(id) => <input id={id} value={p.name} onChange={(e) => p.setName(e.target.value)} />}
      </Field>
      {!p.mapped && (
        <fieldset className="field">
          <legend>Data sets</legend>
          <div className="row-picks">
            {table.dataSets.map((d) => (
              <label key={d.id} className="check">
                <input
                  type="checkbox"
                  checked={p.dataSets.includes(d.id)}
                  onChange={(e) =>
                    p.setDataSets(
                      toggle(
                        p.dataSets,
                        d.id as string,
                        e.target.checked,
                        table.dataSets.map((x) => x.id as string),
                      ),
                    )
                  }
                />
                {d.title || '(untitled)'}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {p.sliceable && (
        <fieldset className="field">
          <legend>Rows</legend>
          <div className="row-picks">
            {p.rowsAvailable.map((r) => (
              <label key={r} className="check">
                <input
                  type="checkbox"
                  checked={p.rows.includes(r)}
                  onChange={(e) => p.setRows(toggle(p.rows, r, e.target.checked, p.rowsAvailable))}
                />
                {rowLabel(table, r)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <RadioGroup<Split>
        legend="Make"
        name="ng-split"
        value={p.split}
        options={[
          { value: 'none', label: 'One graph' },
          ...(p.sliceable && table.tableKind !== 'xy'
            ? [{ value: 'row' as const, label: `One graph per row (${p.rows.length})` }]
            : []),
          ...(p.mapped
            ? []
            : [
                {
                  value: 'dataSet' as const,
                  label: p.histogram
                    ? `One histogram per variable (${p.dataSets.filter((k) => !table.dataSets.find((d) => d.id === k)?.text).length})`
                    : `One graph per data set (${p.dataSets.length})`,
                },
              ]),
          ...(p.textVars.length
            ? [
                {
                  value: 'level' as const,
                  label: `One graph per level of a text variable${p.split === 'level' ? ` (${p.levelCount})` : ''}`,
                },
              ]
            : []),
        ]}
        onChange={p.setSplit}
      />
      {p.split === 'level' && (
        <Select
          label="Variable"
          value={p.splitVar}
          options={p.textVars.map((v) => ({
            value: v.id as string,
            label: v.title || '(untitled)',
          }))}
          onChange={p.setSplitVar}
        />
      )}
      {p.split !== 'none' && (
        <>
          {p.xLinkable && (
            <Checkbox
              label="Share the X axis range across the graphs (stays in sync)"
              checked={p.shareX}
              onChange={p.setShareX}
            />
          )}
          <Checkbox
            label="Share the Y axis range across the graphs (stays in sync)"
            checked={p.shareY}
            onChange={p.setShareY}
          />
          <Checkbox
            label="Place them on a new layout page, plot areas aligned"
            checked={p.onPage}
            onChange={p.setOnPage}
          />
          <p className="muted">
            New {p.split === 'level' ? 'levels' : p.split === 'row' ? 'rows' : 'data sets'} in the
            table get their graph too.
          </p>
        </>
      )}
      {p.nested && <NestedFields value={p.nested} onChange={p.setNested} />}
    </div>
  )
}
