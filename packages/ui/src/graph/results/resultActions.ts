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
  paramsOf,
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
  const params = paramsOf(def, analysis)
  if (!params.ok) return []
  const source = project.nodes[analysis.input.source]
  const tableKind =
    analysis.input.atX !== undefined
      ? 'column'
      : source?.kind === 'table'
        ? source.tableKind
        : 'column'
  return def
    .graphResults(params.params, { tableKind, dataSets: analysis.input.dataSets })
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

/**
 * The tests a new bracket's analysis may run (two groups, or a pool against one). Roadmap 51c
 * (S2, S4): Welch's t test first and by default; Student's only with a reason.
 */
export const BRACKET_TESTS = [
  { value: 'welch', label: 'Welch’s t test (recommended)' },
  { value: 'ttest', label: 'Student’s t test (equal SDs)' },
  { value: 'mannWhitney', label: 'Mann-Whitney test' },
] as const
export type BracketTest = (typeof BRACKET_TESTS)[number]['value']

/** What a bracket's label shows. */
export type BracketShow = 'stars' | 'p' | 'both' | 'number'

/** The suffix of bracket analyses that share a graph with others (S4). */
export const UNCORRECTED = ' (uncorrected)'

/** Complete params (design §6.1: creators store them whole) of a bracket's test. */
function testParams(test: BracketTest): { analysisId: string; params: unknown } {
  const analysisId = test === 'mannWhitney' ? 'mannWhitney' : 'ttest'
  const def = registry.get(analysisId)!
  const raw =
    test === 'mannWhitney'
      ? {}
      : { design: 'unpaired', unpaired: { assumeEqualSD: test === 'ttest' } }
  return { analysisId, params: def.params.parse(raw) }
}

const testNode = (
  test: BracketTest,
  table: DataTable,
  dataSets: string[],
  input: Partial<AnalysisNode['input']>,
  name: string,
): AnalysisNode => {
  const { analysisId, params } = testParams(test)
  return {
    kind: 'analysis',
    id: newNodeId(),
    name,
    analysisId,
    pluginVersion: registry.get(analysisId)?.version ?? 1,
    input: { source: table.id, dataSets, ...input },
    params,
    // Roadmap 51c (§7.3): one test of two groups, made by a bracket.
    origin: { bracket: true },
  }
}

/** The analyses labelling a graph's brackets, made by brackets (one test each, uncorrected). */
export function bracketTests(project: Project, graph: GraphNode): AnalysisNode[] {
  const ids = new Set(
    graph.annotations.flatMap((a) =>
      a.type === 'bracket' && a.label.source === 'analysis' ? [a.label.analysis] : [],
    ),
  )
  return [...ids].flatMap((id) => {
    const n = project.nodes[id]
    return n?.kind === 'analysis' && n.origin?.bracket ? [n] : []
  })
}

/**
 * S4: with two or more bracket tests on one graph, each name ends "(uncorrected)" (the new one's
 * too): commands renaming the graph's, and the new analysis' name.
 */
function markUncorrected(
  project: Project | undefined,
  graph: GraphNode,
  analysis: AnalysisNode,
): Command[] {
  const others = project ? bracketTests(project, graph) : []
  if (!others.length || !analysis.origin?.bracket) return []
  if (!analysis.name.endsWith(UNCORRECTED)) analysis.name += UNCORRECTED
  return others
    .filter((n) => !n.name.endsWith(UNCORRECTED))
    .map((n) => ({ type: 'node.set', id: n.id, path: ['name'], value: n.name + UNCORRECTED }))
}

/** A new bracket's label: named test after a P value (§7.4). */
const bracketLabel = (analysis: NodeId, comparison: string, show: BracketShow) => ({
  source: 'analysis' as const,
  analysis,
  comparison,
  show,
  ...(show === 'p' || show === 'both' ? { test: true } : {}),
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
  o: { x: number; a: string; b: string; test: BracketTest; show: BracketShow },
  project?: Project,
): { analysis: AnalysisNode; commands: Command[] } {
  const title = (k: string) => table.dataSets.find((d) => d.id === k)?.title || k
  const label = BRACKET_TESTS.find((t) => t.value === o.test)!.label.replace(' (recommended)', '')
  const analysis = testNode(
    o.test,
    table,
    [o.a, o.b],
    { atX: o.x },
    `${label} at X = ${o.x} (${title(o.a)} vs. ${title(o.b)})`,
  )
  const renames = markUncorrected(project, graph, analysis)
  const bracket: Annotation = {
    type: 'bracket',
    id: newAnnotationId(),
    a: o.a,
    b: o.b,
    x: o.x,
    label: bracketLabel(analysis.id, `${o.a}|${o.b}`, o.show),
    level: 'auto',
  }
  return {
    analysis,
    commands: [
      { type: 'node.add', node: analysis },
      ...renames,
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
  o: { group: string[]; one: string; row?: number; test: BracketTest; show: BracketShow },
  project?: Project,
): { analysis: AnalysisNode; commands: Command[] } | { error: string } {
  if (o.group.length < 2) return { error: 'Choose two or more data sets for the group.' }
  if (o.group.includes(o.one)) return { error: 'The one data set can’t be in the group.' }
  const title = (k: string) => table.dataSets.find((d) => d.id === k)?.title || k
  const name = `${o.group.map(title).join(' + ')} vs. ${title(o.one)}`
  const grouped = table.tableKind === 'grouped'
  const dataSets = [...o.group, o.one]
  const multipleT = registry.get('multipleT')!
  const analysis: AnalysisNode = grouped
    ? {
        kind: 'analysis',
        id: newNodeId(),
        name: `Multiple t tests (pooled), ${name}`,
        analysisId: 'multipleT',
        pluginVersion: multipleT.version,
        input: { source: table.id, dataSets, pools: [o.group] },
        // Each row's test, the rows corrected together (roadmap 51c, §7.3: Holm-Šidák across
        // rows): Welch (the usual default), a pooled SD, or Mann-Whitney.
        params: multipleT.params.parse({
          approach: 'significance',
          sigMethod: 'holm-sidak',
          ...(o.test === 'mannWhitney'
            ? { distribution: 'nonparametric', rankTest: 'mannWhitney' }
            : { variance: o.test === 'welch' ? 'welch' : 'individual' }),
        }),
        origin: { bracket: true },
      }
    : testNode(
        o.test,
        table,
        dataSets,
        { pools: [o.group] },
        `${BRACKET_TESTS.find((t) => t.value === o.test)!.label.replace(' (recommended)', '')} (pooled), ${name}`,
      )
  const renames = grouped ? [] : markUncorrected(project, graph, analysis)
  const [first, ...rest] = o.group
  const row = grouped ? (o.row ?? 0) : undefined
  const bracket: Annotation = {
    type: 'bracket',
    id: newAnnotationId(),
    a: first!,
    b: o.one,
    group: rest,
    ...(row !== undefined ? { rowA: row, rowB: row } : {}),
    label: bracketLabel(
      analysis.id,
      row !== undefined ? `row${row}:${first}|${o.one}` : `${first}|${o.one}`,
      o.show,
    ),
    level: 'auto',
  }
  return {
    analysis,
    commands: [
      { type: 'node.add', node: analysis },
      ...renames,
      {
        type: 'node.set',
        id: graph.id,
        path: ['annotations'],
        value: [...graph.annotations, bracket],
      },
    ],
  }
}

// --- One analysis of all the groups (roadmap 51c, design §7.3) -------------------------------

/**
 * Whether a bracket dialog should offer one analysis of all the groups first: a graph with three
 * or more groups shown, or one that already has a bracket among those groups.
 */
export function offersOneAnalysis(graph: GraphNode, table: DataTable): boolean {
  const inc = graph.seriesSource.include
  const shown = inc === 'all' ? table.dataSets.length : inc.length
  return shown >= 3 || graph.annotations.some((a) => a.type === 'bracket')
}

/** The data sets a graph shows, in table order. */
const shownKeys = (graph: GraphNode, table: DataTable) => {
  const include = graph.seriesSource.include
  return table.dataSets
    .map((d) => d.id as string)
    .filter((k) => include === 'all' || include.includes(k as never))
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k) => b.includes(k))

/** The comparison key of two data sets, in the analysis' order (`i|j`, i before j). */
const pairKey = (order: readonly string[], a: string, b: string, row?: number) => {
  const [x, y] = order.indexOf(a) <= order.indexOf(b) ? [a, b] : [b, a]
  return `${row === undefined ? '' : `row${row}:`}${x}|${y}`
}

/**
 * One analysis comparing all the groups a graph shows, labelling a bracket per comparison: a
 * column table's one-way ANOVA with Tukey's comparisons (Dunnett's with `control`), a grouped
 * table's two-way ANOVA comparing the columns within each row (Šidák; the brackets of `row`), an
 * XY table's two-way ANOVA with comparisons at each X (`input.byX`; the bracket of `a`–`b` at
 * `x`). An existing analysis of the same groups and kind is reused. Brackets the graph has among
 * those groups from bracket tests are pointed at it, and those tests (no longer used) removed:
 * all one undo step.
 */
export function oneAnalysisBracketCommands(
  project: Project,
  graph: GraphNode,
  table: DataTable,
  o: {
    show: BracketShow
    control?: string
    row?: number
    /** XY: the pair and the X of the bracket asked for. */
    x?: number
    a?: string
    b?: string
  },
): { analysis: AnalysisNode; commands: Command[]; added: number } | { error: string } {
  const keys = shownKeys(graph, table)
  if (keys.length < 2) return { error: 'The graph shows fewer than two data sets.' }
  const kind = table.tableKind
  const xy = kind === 'xy'
  const id = kind === 'column' ? 'oneWayAnova' : 'twoWayAnova'
  const def = registry.get(id)!
  const control = o.control && keys.includes(o.control) ? o.control : undefined
  const raw =
    kind === 'column'
      ? control
        ? { comparisons: 'vsControl', control, controlMethod: 'dunnett' }
        : { comparisons: 'allPairs', allPairsMethod: 'tukey' }
      : { comparisons: 'withinRows', kind: 'allPairs', allPairsMethod: 'sidak' }
  const params = def.params.parse(raw)
  const existing = Object.values(project.nodes).find(
    (n): n is AnalysisNode =>
      n.kind === 'analysis' &&
      n.analysisId === id &&
      n.input.source === table.id &&
      !!n.input.byX === xy &&
      n.input.atX === undefined &&
      !n.input.pools &&
      sameSet(n.input.dataSets, keys) &&
      JSON.stringify(n.params) === JSON.stringify(params),
  )
  const order = existing?.input.dataSets ?? keys
  const analysis: AnalysisNode = existing ?? {
    kind: 'analysis',
    id: newNodeId(),
    name:
      kind === 'column'
        ? `One-way ANOVA (${control ? 'Dunnett' : 'Tukey'}) of ${table.name}`
        : xy
          ? `Two-way ANOVA, comparisons at each X (Šidák), of ${table.name}`
          : `Two-way ANOVA, comparisons within each row (Šidák), of ${table.name}`,
    analysisId: id,
    pluginVersion: def.version,
    input: { source: table.id, dataSets: keys, ...(xy ? { byX: true as const } : {}) },
    params,
  }
  const xs = xy ? xValuesOf(table) : []
  // The brackets of this analysis' comparisons the graph shows.
  const rowOfX = (x: number | undefined) => (x === undefined ? undefined : xs.indexOf(x))
  const wanted: Annotation[] = []
  if (kind === 'column') {
    const pairs: [string, string][] = control
      ? keys.filter((k) => k !== control).map((k) => [control, k])
      : keys.flatMap((a, i) => keys.slice(i + 1).map((b) => [a, b] as [string, string]))
    for (const [a, b] of pairs)
      wanted.push({
        type: 'bracket',
        id: newAnnotationId(),
        a,
        b,
        label: bracketLabel(analysis.id, pairKey(order, a, b), o.show),
        level: 'auto',
      })
  } else if (xy) {
    if (o.a && o.b && o.x !== undefined && rowOfX(o.x)! >= 0)
      wanted.push({
        type: 'bracket',
        id: newAnnotationId(),
        a: o.a,
        b: o.b,
        x: o.x,
        label: bracketLabel(analysis.id, pairKey(order, o.a, o.b, rowOfX(o.x)), o.show),
        level: 'auto',
      })
  } else {
    const row = o.row ?? 0
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++)
        wanted.push({
          type: 'bracket',
          id: newAnnotationId(),
          a: keys[i]!,
          b: keys[j]!,
          rowA: row,
          rowB: row,
          label: bracketLabel(analysis.id, pairKey(order, keys[i]!, keys[j]!, row), o.show),
          level: 'auto',
        })
  }
  // Brackets of bracket tests between two of these groups: labelled from the one analysis now.
  const tests = new Set(bracketTests(project, graph).map((n) => n.id))
  const same = (a: Annotation, b: Annotation) =>
    a.type === 'bracket' &&
    b.type === 'bracket' &&
    [a.a, a.b].sort().join() === [b.a, b.b].sort().join() &&
    (a.rowA ?? -1) === (b.rowA ?? -1) &&
    (a.x ?? null) === (b.x ?? null)
  const annotations = graph.annotations.map((a) => {
    if (a.type !== 'bracket' || a.label.source !== 'analysis' || !tests.has(a.label.analysis))
      return a
    if (a.group?.length || !keys.includes(a.a) || !keys.includes(a.b)) return a
    const row = xy ? rowOfX(a.x) : a.rowA
    if (xy && (row === undefined || row < 0)) return a
    return {
      ...a,
      label: { ...a.label, analysis: analysis.id, comparison: pairKey(order, a.a, a.b, row) },
    }
  })
  const added = wanted.filter(
    (w) =>
      !annotations.some(
        (a) =>
          same(a, w) &&
          a.type === 'bracket' &&
          a.label.source === 'analysis' &&
          a.label.analysis === analysis.id,
      ),
  )
  const next = [...annotations, ...added]
  // The bracket tests no other bracket (on any graph) still uses.
  const stillUsed = new Set(
    Object.values(project.nodes).flatMap((n) =>
      n.kind !== 'graph'
        ? []
        : (n.id === graph.id ? next : n.annotations).flatMap((a) =>
            a.type === 'bracket' && a.label.source === 'analysis' ? [a.label.analysis] : [],
          ),
    ),
  )
  const unused = [...tests].filter((t) => !stillUsed.has(t))
  return {
    analysis,
    added: added.length,
    commands: [
      ...(existing ? [] : [{ type: 'node.add' as const, node: analysis }]),
      { type: 'node.set', id: graph.id, path: ['annotations'], value: next },
      ...unused.map((t): Command => ({ type: 'node.remove', id: t })),
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
