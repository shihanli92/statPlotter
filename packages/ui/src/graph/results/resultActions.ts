import { registry } from '@ps/analyses'
import type { Command } from '@ps/engine'
import { checkLayers, freshLayerId, matrixKindOf, newLayerIndex, RESULT_GEOMS } from '@ps/graph'
import {
  type AnalysisNode,
  type AnalysisResult,
  type Annotation,
  type DataTable,
  type GraphNode,
  type Layer,
  type NodeId,
  newAnnotationId,
  newNodeId,
  type Project,
  type ResultRef,
  type ResultStat,
  type ResultTemplate,
  rowLabel,
  sourceTable,
} from '@ps/model'

// Results on graphs (roadmap 35), the UI's side: which analyses' results a graph can show, their
// ready labels, lines and bands, and the commands adding a result layer, an inset table, the
// number at risk, a bracket at one X or from a group to one (each with its analysis).

/** The analyses of a graph's table (the results it can show). */
export function resultAnalyses(project: Project, graph: Pick<GraphNode, 'seriesSource'>) {
  return Object.values(project.nodes).filter(
    (n): n is AnalysisNode => n.kind === 'analysis' && n.input.source === graph.seriesSource.table,
  )
}

/** The kind of result layer a geom draws. */
const RESULT_KIND = { label: 'label', line: 'refline', band: 'band' } as const
export type ResultKind = keyof typeof RESULT_KIND

/** An analysis' ready results for a graph (those for its frame), of a kind when given. */
export function templatesFor(
  project: Project,
  analysis: AnalysisNode,
  graph: Pick<GraphNode, 'frame'> | null,
  kind?: ResultKind,
): ResultTemplate[] {
  const def = registry.get(analysis.analysisId)
  if (!def?.graphResults) return []
  const params = def.params.safeParse(analysis.params)
  if (!params.success) return []
  const source = project.nodes[analysis.input.source]
  const tableKind =
    analysis.input.atX !== undefined
      ? 'column'
      : source?.kind === 'table'
        ? source.tableKind
        : 'column'
  return def
    .graphResults(params.data, { tableKind, dataSets: analysis.input.dataSets })
    .filter(
      (t) =>
        (kind === undefined || t.kind === kind) &&
        (!graph || !t.frames || (t.frames as readonly string[]).includes(graph.frame)),
    )
}

/** A result layer for a graph: a template's stat over an analysis, a fresh id, a name. */
export function resultLayer(
  graph: Pick<GraphNode, 'layers'>,
  analysis: AnalysisNode,
  kind: ResultKind,
  stat: Omit<ResultStat, 'kind'>,
  name?: string,
): Layer {
  const geom = RESULT_KIND[kind]
  const base = kind === 'label' ? 'result' : kind === 'line' ? 'resultLine' : 'resultBand'
  return {
    id: freshLayerId(base, graph.layers),
    geom,
    stat: { kind: 'result', ...stat },
    data: { from: 'analysis', analysis: analysis.id },
    ...(name ? { name: name.slice(0, 80) } : {}),
    // Drop lines go without a legend entry; lines and bands of a value name it there.
    ...(stat.drop ? { legend: 'hide' as const } : {}),
  } as Layer
}

/** The command adding a layer where a new layer of its kind goes (marks on top, fills behind). */
export const addLayerCommand = (graph: GraphNode, layer: Layer): Command => ({
  type: 'graph.addLayer',
  id: graph.id,
  layer,
  at: newLayerIndex(graph.layers, layer),
})

/** Whether a graph can draw result layers (the matrix: graphs with value axes). */
export function resultsAllowed(
  project: Project,
  graph: GraphNode,
  lookup: (id: NodeId) => AnalysisResult | undefined,
): boolean {
  const table = sourceTable(project, graph.seriesSource.table, lookup)
  if (!table) return false
  const probe = {
    id: 'probe',
    geom: 'label',
    stat: { kind: 'result', fields: {} },
    data: { from: 'analysis', analysis: 'x' as NodeId },
  } as Layer
  const kind = matrixKindOf(table, graph)
  return (
    !!checkLayers({ frame: graph.frame, layers: [probe] }, kind).get('probe')?.allowed &&
    RESULT_GEOMS.includes('label')
  )
}

/** The layers a template adds to a graph (a label, a line or a band), named after it. */
export function templateLayer(graph: GraphNode, analysis: AnalysisNode, t: ResultTemplate): Layer {
  return resultLayer(graph, analysis, t.kind, t.stat, `${t.title} (${analysis.name})`)
}

/**
 * Roadmap 35's "Show on graph": each chosen template as a layer on every graph of the analyzed
 * table that can draw it (its frame among the template's).
 */
export function showOnGraphsCommands(
  project: Project,
  analysis: AnalysisNode,
  templates: readonly ResultTemplate[],
  lookup: (id: NodeId) => AnalysisResult | undefined,
): Command[] {
  const out: Command[] = []
  for (const n of Object.values(project.nodes)) {
    if (n.kind !== 'graph' || n.seriesSource.table !== analysis.input.source) continue
    if (!resultsAllowed(project, n, lookup)) continue
    let graph = n
    for (const t of templates) {
      if (t.frames && !(t.frames as readonly string[]).includes(graph.frame)) continue
      const layer = templateLayer(graph, analysis, t)
      out.push(addLayerCommand(graph, layer))
      graph = { ...graph, layers: [...graph.layers, layer] }
    }
  }
  return out
}

// --- Picking a value of the results -----------------------------------------------------------

/** A value of an analysis' results a field can read, with where it is and how it reads. */
export interface PickableValue {
  ref: ResultRef
  /** Where: "Table of results › Best-fit values › IC50 › Control". */
  where: string
  /** As the results show it. */
  shown: string
}

/** The cells of a results sheet as pickable values, block by block (titles, rows, columns). */
export function sheetValues(
  result: AnalysisResult,
  settings: Project['settings'],
): { sheet: string; title: string; blocks: { title: string; rows: PickableValue[][] }[] }[] {
  const shown = (v: Parameters<typeof rowLabel>[0][number]) => rowLabel([v], settings)
  return result.sheets.map((sh) => ({
    sheet: sh.key,
    title: sh.title,
    blocks: sh.blocks.flatMap((b) => {
      if (b.type === 'note') return []
      const block = b.title
      const at = (row: string, column?: string): string =>
        [sh.title, block, row || '(row)', column]
          .filter((x) => x !== undefined && x !== '')
          .join(' › ')
      if (b.type === 'keyValue')
        return [
          {
            title: block ?? '',
            rows: b.rows.map((r) => [
              {
                ref: { from: 'cell', sheet: sh.key, ...(block ? { block } : {}), row: r.label },
                where: at(r.label),
                shown: shown(r.value),
              },
            ]),
          },
        ]
      return [
        {
          title: block ?? '',
          rows: b.rows.map((cells) => {
            const row = rowLabel(cells, settings)
            return cells.slice(1).map((v, j) => {
              const column = b.columns[j + 1] ?? ''
              return {
                ref: {
                  from: 'cell' as const,
                  sheet: sh.key,
                  ...(block ? { block } : {}),
                  row,
                  column,
                },
                where: at(row, column),
                shown: shown(v),
              }
            })
          }),
        },
      ]
    }),
  }))
}

/** A cell reference read per data set: the data set's title in its row or column → `{dataSet}`. */
export function perDataSetRef(ref: ResultRef, titles: readonly string[]): ResultRef {
  if (ref.from !== 'cell') return ref
  const swap = (s: string | undefined) =>
    s === undefined
      ? s
      : titles.includes(s)
        ? '{dataSet}'
        : s.replace(/ vs\. .+$/, (m) =>
            titles.some((t) => m === ` vs. ${t}`) ? ' vs. {dataSet}' : m,
          )
  const column = swap(ref.column)
  const row = swap(ref.row)!
  return { ...ref, row, ...(column !== undefined ? { column } : {}) }
}

/** A field's name for a picked value: its row's label made a name ("R squared" → R_squared). */
export function fieldNameOf(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_ ]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/^[^A-Za-z]+/, '')
      .slice(0, 24) || 'value'
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`
}

// --- Tables, the number at risk ----------------------------------------------------------------

/** A new inset table of an analysis' results sheet (its first, unless given). */
export function newInsetTable(analysis: AnalysisNode, sheet: string): Annotation {
  return { type: 'table', id: newAnnotationId(), analysis: analysis.id, sheet, place: 'topRight' }
}

/** Whether a graph is a survival graph (its layers Kaplan-Meier's): it may show the number at risk. */
export const isSurvivalGraph = (graph: Pick<GraphNode, 'layers'>) =>
  graph.layers.some((l) => l.stat.kind === 'km')

/** The command showing or hiding the number at risk (its other options kept). */
export function riskTableCommand(graph: GraphNode, show: boolean): Command {
  return {
    type: 'node.set',
    id: graph.id,
    path: ['riskTable'],
    value: show
      ? { ...graph.riskTable, show: true }
      : graph.riskTable
        ? { ...graph.riskTable, show: false }
        : undefined,
  }
}

// --- Brackets with their analyses --------------------------------------------------------------

/** The tests a new bracket's analysis may run (two groups, or a pool against one). */
export const BRACKET_TESTS = [
  { value: 'ttest', label: 'Unpaired t test' },
  { value: 'welch', label: 'Unpaired t test with Welch’s correction' },
  { value: 'mannWhitney', label: 'Mann-Whitney test' },
] as const
export type BracketTest = (typeof BRACKET_TESTS)[number]['value']

const testNode = (
  test: BracketTest,
  table: DataTable,
  dataSets: string[],
  input: Partial<AnalysisNode['input']>,
  name: string,
): AnalysisNode => ({
  kind: 'analysis',
  id: newNodeId(),
  name,
  analysisId: test === 'welch' ? 'ttest' : test,
  pluginVersion: registry.get(test === 'welch' ? 'ttest' : test)?.version ?? 1,
  input: { source: table.id, dataSets, ...input },
  params:
    test === 'welch'
      ? { design: 'unpaired', unpaired: { assumeEqualSD: false } }
      : test === 'ttest'
        ? { design: 'unpaired' }
        : {},
})

/** The X values of an XY table (each once, in order), for brackets at one X. */
export function xValuesOf(table: DataTable): number[] {
  const xs = table.x?.subcolumns[0]?.values ?? []
  return [...new Set(xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))]
}

/**
 * A bracket between two data sets at one X of an XY graph, labelled live by a new analysis of
 * their values there (`input.atX`): the analysis and the bracket in one step.
 */
export function xBracketCommands(
  graph: GraphNode,
  table: DataTable,
  o: {
    x: number
    a: string
    b: string
    test: BracketTest
    show: 'stars' | 'p' | 'both' | 'number'
  },
): { analysis: AnalysisNode; commands: Command[] } {
  const title = (k: string) => table.dataSets.find((d) => d.id === k)?.title || k
  const label = BRACKET_TESTS.find((t) => t.value === o.test)!.label
  const analysis = testNode(
    o.test,
    table,
    [o.a, o.b],
    { atX: o.x },
    `${label} at X = ${o.x} (${title(o.a)} vs. ${title(o.b)})`,
  )
  const bracket: Annotation = {
    type: 'bracket',
    id: newAnnotationId(),
    a: o.a,
    b: o.b,
    x: o.x,
    label: { source: 'analysis', analysis: analysis.id, comparison: `${o.a}|${o.b}`, show: o.show },
    level: 'auto',
  }
  return {
    analysis,
    commands: [
      { type: 'node.add', node: analysis },
      {
        type: 'node.set',
        id: graph.id,
        path: ['annotations'],
        value: [...graph.annotations, bracket],
      },
    ],
  }
}

/**
 * A bracket from a group of data sets to one (on a grouped graph, within a row), labelled live
 * by a new analysis of the group pooled against the one (`input.pools`): a t test or
 * Mann-Whitney test of column data; multiple t tests per row of grouped data.
 */
export function groupBracketCommands(
  graph: GraphNode,
  table: DataTable,
  o: {
    group: string[]
    one: string
    row?: number
    test: BracketTest
    show: 'stars' | 'p' | 'both' | 'number'
  },
): { analysis: AnalysisNode; commands: Command[] } | { error: string } {
  if (o.group.length < 2) return { error: 'Choose two or more data sets for the group.' }
  if (o.group.includes(o.one)) return { error: 'The one data set can’t be in the group.' }
  const title = (k: string) => table.dataSets.find((d) => d.id === k)?.title || k
  const name = `${o.group.map(title).join(' + ')} vs. ${title(o.one)}`
  const grouped = table.tableKind === 'grouped'
  const dataSets = [...o.group, o.one]
  const analysis: AnalysisNode = grouped
    ? {
        kind: 'analysis',
        id: newNodeId(),
        name: `Multiple t tests (pooled), ${name}`,
        analysisId: 'multipleT',
        pluginVersion: registry.get('multipleT')?.version ?? 1,
        input: { source: table.id, dataSets, pools: [o.group] },
        // Each row's own test, uncorrected (one comparison per bracket): Welch (Prism's default),
        // a pooled SD, or Mann-Whitney.
        params: {
          approach: 'none',
          ...(o.test === 'mannWhitney'
            ? { distribution: 'nonparametric', rankTest: 'mannWhitney' }
            : { variance: o.test === 'welch' ? 'welch' : 'individual' }),
        },
      }
    : testNode(
        o.test,
        table,
        dataSets,
        { pools: [o.group] },
        `${BRACKET_TESTS.find((t) => t.value === o.test)!.label} (pooled), ${name}`,
      )
  const [first, ...rest] = o.group
  const row = grouped ? (o.row ?? 0) : undefined
  const bracket: Annotation = {
    type: 'bracket',
    id: newAnnotationId(),
    a: first!,
    b: o.one,
    group: rest,
    ...(row !== undefined ? { rowA: row, rowB: row } : {}),
    label: {
      source: 'analysis',
      analysis: analysis.id,
      comparison: row !== undefined ? `row${row}:${first}|${o.one}` : `${first}|${o.one}`,
      show: o.show,
    },
    level: 'auto',
  }
  return {
    analysis,
    commands: [
      { type: 'node.add', node: analysis },
      {
        type: 'node.set',
        id: graph.id,
        path: ['annotations'],
        value: [...graph.annotations, bracket],
      },
    ],
  }
}

/** A grouped table's rows, by title, for a bracket within a row. */
export function rowsOf(table: DataTable): { index: number; title: string }[] {
  return Array.from({ length: table.rowCount }, (_, i) => ({
    index: i,
    title: table.rowTitles?.[i] || `Row ${i + 1}`,
  }))
}
