import { registry } from '@ps/analyses'
import {
  bracketsFromAnalysis,
  createGraphFor,
  layoutGraph,
  presetGraph,
  type Scene,
} from '@ps/graph'
import {
  decodeText,
  describeAccount,
  findBlocks,
  guessBlock,
  type ImportTableKind,
  importFile,
  isTextImport,
  type LongImportOptions,
  longToTable,
  type Sheet,
  type SheetImportResult,
  sheetToTable,
} from '@ps/io'
import {
  type Aes,
  type AnalysisNode,
  type AnalysisResult,
  type AxisSpec,
  type Comparison,
  createProject,
  type DataTable,
  type DocNode,
  type ErrorStat,
  formatP,
  type GraphNode,
  type Layer,
  type LayoutItem,
  type LevelMeasure,
  type NodeId,
  newGroupId,
  newLayoutItemId,
  newNodeId,
  normalizeColumn,
  type Project,
  pSummary,
  type SymbolShape,
} from '@ps/model'
import { newLayout, pageSpec } from '../../layout/figure.ts'
import { parseRichText } from '../markup.ts'
import type { ExampleContext, ExampleDef } from '../registry.ts'

/*
 * Published-data examples that read a paper's source data at run time (development builds only:
 * `ExampleContext.sourceFile`), so no data from the paper is part of the app. A paper is described
 * declaratively: which file, sheet and table each figure panel comes from, the analysis the
 * figure's P values come from, how the graph looks, and the P values printed in the figure (short
 * metadata, not data; or, for a paper whose licence keeps them out, the cells of its source data
 * that state them, read at run time). Building imports each table through the importer as a user would, adds the
 * analyses, graphs with the figure's brackets, a page per figure with the panels arranged and
 * lettered as the paper has them, and notes that put the printed P values next to the ones the
 * app computes. Every chart panel with source data that the app can draw is rebuilt; the others
 * are catalogued, with what they need, in docs/design/PAPER_PANELS.md.
 */

/** A P value as the figure prints it and the comparison it belongs to. */
export interface PrintedP {
  /** Data set titles (as imported, or as `Panel.edit` renames them). */
  a: string
  b: string
  /** Grouped tables: the row title of the cells compared (`rowB` when the second differs). */
  row?: string
  rowB?: string
  /**
   * As printed: "0.0027", "<0.0001", "5e-7", stars ("**", "ns"), or a threshold ("<0.018")
   * when the figure only marks significance. Absent when `cell` gives it.
   */
  p?: string
  /**
   * Read at run time from this cell (A1 notation) of the panel's sheet instead of `p`: the value
   * as the source data file states it (the figure's software's results pasted beside the data),
   * for papers whose licence keeps their printed values out of the app (decision 1000). A number
   * is taken at full precision ("0.0046", "0.00003"); text as written, or the part `match`
   * captures.
   */
  cell?: string
  /** With `cell`: the part of the cell's text holding the value ("t=3.035, df=34", /t=([\d.]+)/). */
  match?: RegExp
  /** A statistic stated without its sign (t, whose sign follows the order compared). */
  magnitude?: boolean
  /**
   * The result value holding the P value (e.g. 'p', a survival analysis' log-rank test) when the
   * analysis tests `a` against `b` as a whole rather than listing comparisons; or, with `stat`,
   * another statistic the figure prints (a correlation's 'r'). A value a fit gives per data set
   * ('slope', a parameter's name) is data set `a`'s.
   */
  value?: string
  /** The printed statistic when it isn't a P value ("r"); `p` then holds its printed value. */
  stat?: string
  /** Why the app's value differs from the printed one, when it does (found when checking). */
  differs?: string
}

export interface AnalysisSpec {
  /** Analysis plugin id ('ttest', 'oneWayAnova', …). */
  analysis: string
  /** Short name of the test, used in the analysis' name ("Unpaired t test"). */
  test: string
  params?: Record<string, unknown>
  /** Data set titles to analyze (in this order); default all. */
  dataSets?: string[]
  /** Why this test when it isn't the one the legend names (kept in the notes). */
  why?: string
  /**
   * The analysis runs on a table made from the panel's (the figure tests other numbers than it
   * draws: pooled controls, one time point, values back-transformed): a new table, named, made
   * as a user would and said in `describe`. Its comparisons draw no brackets on the panel's graph.
   */
  on?: { name: string; describe: string; apply: (table: DataTable) => DataTable }
  printed: PrintedP[]
  /**
   * Brackets for the printed comparisons: "P = 0.0027" ('p', the default), the bare number, or
   * stars; none on survival graphs.
   */
  brackets?: 'p' | 'number' | 'stars' | 'none'
}

export interface GraphSpec {
  /**
   * Graph name when a panel has several graphs of its table (default the panel's name); the
   * graph's title shows it.
   */
  name?: string
  /** Graph preset (see `GRAPH_PRESETS`); none for survival graphs. */
  preset?: string
  /** The error bars' statistic (SD, SEM, 95% CI as 'CI', …), drawn both ways. */
  error?: ErrorStat
  /** Logarithmic Y axis (log10, or 'log2'). */
  logY?: boolean | 'log2'
  /** Logarithmic X axis (XY graphs; log10, or 'log2'). */
  logX?: boolean | 'log2'
  /** Fixed axis ranges [min, max] (default automatic). */
  yRange?: [number, number]
  xRange?: [number, number]
  /** Y axis title, in the rich-text markup ("% CD45.1^+ IFNγ^+"). */
  yTitle?: string
  xTitle?: string
  /** Plot area width and height in points (default the preset's). */
  size?: [number, number]
  /** Hollow symbols (the figure's open circles). */
  open?: boolean
  /** Data set colours in order of the data sets shown (#rrggbb). */
  colors?: string[]
  /** Data set symbols in order (the figure's filled and open shapes). */
  symbols?: { shape: SymbolShape; open?: boolean }[]
  /** Slanted data set titles under the X axis. */
  rotate?: 45 | 90
  /** Categories down the left, values across (category and grouped graphs). */
  horizontal?: boolean
  legend?: boolean
  /** Only these data sets (titles), in the table's order; default all. */
  dataSets?: string[]
  /** Only these rows (titles) of a grouped or XY table, in this order; default all. */
  rows?: string[]
  /**
   * Multiple-variables tables (roadmap 34a): the variables on the axes by title — a text
   * variable's levels as categories and a number variable as the values (or turned), a text
   * variable as colour groups, two text variables counted.
   */
  mapping?: { x: string; y: string; color?: string; measure?: LevelMeasure }
  /** Multiple-variables tables: number × number points, variables by title (the bubble plot's). */
  aes?: Partial<Record<keyof Aes, string>>
  /** Graphs sharing a group id on an axis share its automatic range (`GraphNode.links`). */
  link?: { x?: string; y?: string }
  /** A change made in Format graph that the fields above don't cover (said in `does`). */
  format?: { does: string; apply: (graph: GraphNode, table: DataTable) => GraphNode }
}

/**
 * How a panel's table is imported when the importer's detected settings aren't what the figure
 * needs: the table kind (e.g. 'multipleVariables' for records with text columns), the header row,
 * the first column's use, replicates side by side, and the range (A1 notation, "A1:F40").
 */
interface ImportSpec {
  tableKind?: ImportTableKind
  headerRow?: boolean
  firstColumn?: 'data' | 'x' | 'rowTitles'
  replicates?: number
  range?: string
}

/** Where a table comes from: a file, its sheet and block, and how it is imported. */
interface TableSource {
  /** File in the paper's source-data folder. */
  file: string
  /** Worksheet name (spreadsheets); CSV files and archive members use their file name. */
  sheet: string
  /** Which table on the sheet: its title as the importer reads it, or its index; default the first. */
  block?: string | number
  /** Settings changed in the import dialog (default the detected ones). */
  import?: ImportSpec
  /** Long-format data (one value per row): the columns by header title, as the import dialog offers. */
  long?: {
    value: string
    group: string
    row?: string
    subject?: string
    filters?: { column: string; value: string }[]
  }
}

export interface Panel extends TableSource {
  /**
   * "3h" or "ED3h" (Extended Data): the panel as the paper labels it (in analysis names); its
   * figure page is "Fig. 3" or "Extended Data Fig. 3" and its letter "h".
   */
  label: string
  /** Table (and graph) name: "Fig. 3h – Worm count". */
  name: string
  /**
   * Other tables the edit joins with the panel's (a second sheet or file: values matched by
   * subject, say), imported the same way; handed to `edit` in this order, never added to the
   * project themselves.
   */
  with?: TableSource[]
  /**
   * A change a user would make after importing (rows filtered, reshaped, joined with `with`), and
   * a sentence saying what it does.
   */
  edit?: { describe: string; apply: (table: DataTable, others: DataTable[]) => DataTable }
  /** What the figure legend says about the statistics (or the panel, when it prints none). */
  legend: string
  /** The analyses giving the figure's statistics; none when it prints none. */
  analyses?: AnalysisSpec[]
  /** The panel's graph, or several graphs of its table (one per row, say). */
  graph: GraphSpec | GraphSpec[]
}

/**
 * A figure page: its panels row by row as the paper arranges them (panel labels; every graph of a
 * label goes in its place), and notes on the page about the panels left out and why.
 */
export interface FigureSpec {
  /** "1" or "ED1" (Extended Data Fig. 1). */
  figure: string
  /**
   * Rows of panel labels: "5c" places every graph of the panel, "5c:2" its second graph and
   * "5c:1-3" its first three (a panel spread over several rows of the figure).
   */
  rows?: string[][]
  /**
   * Graphs drawn inside another graph's plot area (the figure's insets), not in the rows: `graph`
   * and `into` as rows name them ("1a:2" into "1a:1"), `at` where the inset's plot area's top-left
   * corner goes, as fractions of the host's plot area from its top left, and `scale` its size
   * relative to the host's (default 1; smaller text, as figures draw their insets).
   */
  insets?: { graph: string; into: string; at: [number, number]; scale?: number }[]
  notes?: string
}

export interface PaperSpec {
  id: string
  /** "Contreras-Castillo et al. 2026 (Nature Immunology)" */
  title: string
  description: string
  /** Full citation with DOI. */
  citation: string
  /** Folder under source_data/. */
  folder: string
  panels: Panel[]
  /**
   * Figure pages' arrangements; a figure not listed puts its graphs in panel order,
   * `layoutColumns` to a row.
   */
  figures?: FigureSpec[]
  /** Graphs per row of a figure page without an arrangement (default 3). */
  layoutColumns?: number
  /**
   * A repair a user makes to the delimited-text files in a text editor before importing them
   * (lines run together, say), and a sentence saying what it does (in every table's notes).
   */
  fixText?: { describe: string; apply: (text: string) => string }
}

/** How a computed P value compares with the printed one. */
type Agreement = 'agrees' | 'truncated' | 'differs'

interface PValueCheck {
  panel: string
  analysis: string
  comparison: string
  printed: string
  computed: number
  agreement: Agreement
  /** The difference was known (documented in the spec). */
  expectedToDiffer: boolean
}

/** Whether a P value agrees with the value or statement printed in a figure. */
export function comparePrinted(printed: string, p: number): Agreement {
  const s = printed
    .trim()
    .replace(/\s+/g, '')
    .replace(/^P[=]?/i, '')
  if (/^ns$/i.test(s)) return p >= 0.05 ? 'agrees' : 'differs'
  if (/^\*+$/.test(s)) return pSummary(p, 'GP') === s ? 'agrees' : 'differs'
  if (s.startsWith('<')) return p < Number(s.slice(1)) ? 'agrees' : 'differs'
  if (s.startsWith('>')) return p > Number(s.slice(1)) ? 'agrees' : 'differs'
  const v = Number(s)
  if (!Number.isFinite(v)) throw new Error(`Can’t read the printed P value “${printed}”.`)
  const exp = /^(\d(?:\.(\d+))?)e(-?\d+)$/i.exec(s)
  if (exp) {
    const digits = 1 + (exp[2]?.length ?? 0)
    return Number(p.toPrecision(digits)) === v ? 'agrees' : 'differs'
  }
  const decimals = s.split('.')[1]?.length ?? 0
  const scale = 10 ** decimals
  if (Number(p.toFixed(decimals)) === v) return 'agrees'
  return Math.floor(p * scale * (1 + 1e-12)) / scale === v ? 'truncated' : 'differs'
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/[\s ]+/g, ' ')
    .trim()
    .toLowerCase()

/** Reads and parses a paper's files (once per build). */
class Files {
  private sheets = new Map<string, Promise<Sheet[]>>()
  constructor(
    private ctx: ExampleContext,
    private paper: PaperSpec,
  ) {}
  path = (file: string) => `${this.paper.folder}/${file}`
  sheet(file: string, name: string): Promise<Sheet> {
    let all = this.sheets.get(file)
    if (!all) {
      all = this.ctx.sourceFile(this.path(file)).then((bytes) => {
        if (!bytes)
          throw new Error(
            `${this.path(file)} was not found in the local source_data folder (needed for ${this.paper.title}).`,
          )
        const fix = this.paper.fixText
        const f = importFile(
          file,
          fix && isTextImport(file)
            ? new TextEncoder().encode(fix.apply(decodeText(bytes)))
            : bytes,
        )
        if (f.kind !== 'sheets') throw new Error(`${file} holds no spreadsheet data.`)
        return f.sheets
      })
      this.sheets.set(file, all)
    }
    return all.then((sheets) => {
      const s = sheets.find((x) => norm(x.name) === norm(name))
      if (!s)
        throw new Error(
          `${file} has no sheet “${name}” (sheets: ${sheets.map((x) => x.name).join(', ')}).`,
        )
      return s
    })
  }
}

/** "B2:F40" as 0-based inclusive rows and columns. */
function a1Range(a1: string): { r0: number; c0: number; r1: number; c1: number } {
  const cell = (s: string) => {
    const m = /^([A-Z]+)(\d+)$/i.exec(s.trim())
    if (!m) throw new Error(`Can’t read the cell “${s}” of the range “${a1}”.`)
    const c = [...m[1]!.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
    return { r: Number(m[2]) - 1, c }
  }
  const [from, to] = a1.split(':')
  const a = cell(from!)
  const b = cell(to ?? from!)
  return { r0: a.r, c0: a.c, r1: b.r, c1: b.c }
}

/** A cell's value as a printed value: a number at full precision, text trimmed (`PrintedP.cell`). */
function cellValue(sheet: Sheet, printed: PrintedP, where: string): string {
  const { r0, c0 } = a1Range(printed.cell!)
  const v = sheet.rows[r0]?.[c0]
  if (v === null || v === undefined || typeof v === 'boolean')
    throw new Error(`${where}: the cell ${printed.cell} of “${sheet.name}” holds no value.`)
  const s = typeof v === 'number' ? String(v) : v.trim()
  if (!printed.match) return s
  const m = printed.match.exec(s)
  if (!m?.[1])
    throw new Error(`${where}: the cell ${printed.cell} (“${s}”) doesn’t match ${printed.match}.`)
  return m[1]
}

/** The printed values a panel's analyses read from its sheet (`PrintedP.cell`). */
async function cellValues(files: Files, panel: Panel): Promise<Map<PrintedP, string>> {
  const out = new Map<PrintedP, string>()
  const wanted = (panel.analyses ?? []).flatMap((a) => a.printed).filter((p) => p.cell)
  if (!wanted.length) return out
  const sheet = await files.sheet(panel.file, panel.sheet)
  for (const p of wanted) out.set(p, cellValue(sheet, p, panel.name))
  return out
}

/** Imports a panel's table as the import dialog does with its detected settings. */
async function importPanel(
  files: Files,
  panel: TableSource,
  name: string,
): Promise<SheetImportResult> {
  const sheet = await files.sheet(panel.file, panel.sheet)
  if (panel.long) {
    const header = sheet.rows[0] ?? []
    const col = (title: string) => {
      const c = header.findIndex((h) => typeof h === 'string' && norm(h) === norm(title))
      if (c < 0) throw new Error(`${name}: ${panel.file} has no column “${title}”.`)
      return c
    }
    const l = panel.long
    const opts: LongImportOptions = {
      name: name,
      value: col(l.value),
      group: col(l.group),
      row: l.row ? col(l.row) : null,
      subject: l.subject ? col(l.subject) : null,
      filters: (l.filters ?? []).map((f) => ({ col: col(f.column), value: f.value })),
    }
    return longToTable(sheet, opts)
  }
  if (panel.import?.range || (panel.import?.tableKind && panel.block === undefined)) {
    // Settings chosen in the import dialog for a range (the whole sheet by default).
    const i = panel.import
    const tableKind = i.tableKind ?? 'column'
    return sheetToTable(sheet, {
      name: name,
      tableKind,
      headerRow: i.headerRow ?? true,
      firstColumn: i.firstColumn ?? (tableKind === 'xy' || tableKind === 'survival' ? 'x' : 'data'),
      ...(i.replicates ? { replicates: i.replicates } : {}),
      ...(i.range ? { range: a1Range(i.range) } : {}),
    })
  }
  const blocks = findBlocks(sheet)
  const block =
    typeof panel.block === 'number'
      ? blocks[panel.block]
      : panel.block === undefined
        ? blocks[0]
        : blocks.find((b) => norm(b.title) === norm(panel.block as string))
  if (!block)
    throw new Error(
      `${name}: no table ${typeof panel.block === 'string' ? `titled “${panel.block}” ` : ''}on sheet “${panel.sheet}” of ${panel.file} (found: ${blocks.map((b) => b.title ?? 'untitled').join(', ') || 'none'}).`,
    )
  const guess = { ...guessBlock(sheet, block.range, block.parts, block.layout), ...panel.import }
  return sheetToTable(sheet, {
    name: name,
    ...guess,
    range: block.range,
    area: block.area,
    ...(block.parts ? { parts: block.parts } : {}),
    ...(block.layout ? { layout: block.layout } : {}),
  })
}

/** "P = 0.0027", "P < 0.0001", "**": a P value or statement as a figure prints it. */
function printedText(printed: string): string {
  const s = printed.trim()
  if (/^(\*+|ns)$/i.test(s)) return s
  return /^[<>]/.test(s) ? `P ${s[0]} ${s.slice(1)}` : `P = ${s}`
}

/** "P = 0.0027 (0.002746, **)": the app's P value as it displays it, more digits, stars. */
function appText(p: number): string {
  const shown = formatP(p, { pValueStyle: 'GP', pValueDigits: 4 })
  const more = p < 1e-4 ? p.toExponential(2) : p.toPrecision(4)
  return `${printedText(shown)} (${more}, ${pSummary(p, 'GP')})`
}

const AGREEMENT_TEXT: Record<Agreement, string> = {
  agrees: 'agrees',
  truncated: 'agrees (the printed value is truncated, not rounded)',
  differs: 'differs',
}

function dataSetKey(table: DataTable, title: string, where: string): string {
  const ds = table.dataSets.find((d) => norm(d.title) === norm(title))
  if (!ds)
    throw new Error(
      `${where}: no data set “${title}” (data sets: ${table.dataSets.map((d) => d.title).join(', ')}).`,
    )
  return ds.id
}

function rowIndex(table: DataTable, title: string, where: string): number {
  const r = (table.rowTitles ?? []).findIndex((t) => norm(t) === norm(title))
  if (r < 0)
    throw new Error(
      `${where}: no row “${title}” (rows: ${(table.rowTitles ?? []).join(', ') || 'none'}).`,
    )
  return r
}

/** The result's comparison of the printed pair (either order). */
function findComparison(
  table: DataTable,
  result: AnalysisResult,
  printed: PrintedP,
  where: string,
): Comparison {
  const a = dataSetKey(table, printed.a, where)
  const b = dataSetKey(table, printed.b, where)
  const ra = printed.row !== undefined ? rowIndex(table, printed.row, where) : undefined
  const rb = printed.rowB !== undefined ? rowIndex(table, printed.rowB, where) : ra
  const cmp = result.comparisons.find(
    (c) =>
      (c.a.key === a && c.b.key === b && c.rowA === ra && c.rowB === rb) ||
      (c.a.key === b && c.b.key === a && c.rowA === rb && c.rowB === ra),
  )
  if (!cmp)
    throw new Error(
      `${where}: the analysis gives no comparison ${printed.a} vs ${printed.b}${printed.row ? ` (${printed.row})` : ''}.`,
    )
  return cmp
}

const pair = (p: PrintedP) =>
  // A value of one data set's fit (`value` with `a` = `b`) names the data set alone.
  p.value && p.a === p.b && !p.row
    ? p.a
    : `${p.a}${p.row && p.rowB && p.rowB !== p.row ? ` (${p.row})` : ''} vs ${p.b}${p.rowB && p.rowB !== p.row ? ` (${p.rowB})` : p.row ? ` (${p.row})` : ''}`

const OPEN = {
  fill: { type: 'none' },
  border: { color: { series: true }, width: 1, dash: 'solid' },
} as const

/** A variable of a multiple-variables table by title. */
function variableKey(table: DataTable, title: string, where: string): string {
  return dataSetKey(table, title, `${where} (variables)`)
}

const logScale = (log: boolean | 'log2' | undefined) =>
  log === 'log2' ? ('log2' as const) : log ? ('log10' as const) : undefined

/** An axis with the spec's scale, range and title (continuous axes take all three). */
function styledAxis(
  axis: AxisSpec,
  log: boolean | 'log2' | undefined,
  range: [number, number] | undefined,
  title: string | undefined,
): AxisSpec {
  let a = axis
  const scale = logScale(log)
  if (a.type === 'continuous') {
    if (scale) a = { ...a, scale }
    if (range) a = { ...a, range: { min: range[0], max: range[1] } }
  }
  return title ? { ...a, title: { content: parseRichText(title) } } : a
}

/**
 * A graph of a panel: its preset (or the variables mapped, for a multiple-variables table), the
 * error bars' statistic, the symbols and colours, the axes, the data sets and rows shown; drawn
 * by data set, as the examples were before roadmap 33b.
 */
function styleGraph(table: DataTable, spec: GraphSpec, name: string): GraphNode {
  const where = name
  const mapping = spec.mapping && {
    x: variableKey(table, spec.mapping.x, where),
    y: variableKey(table, spec.mapping.y, where),
    ...(spec.mapping.color ? { color: variableKey(table, spec.mapping.color, where) } : {}),
    ...(spec.mapping.measure ? { measure: spec.mapping.measure } : {}),
  }
  const g0 = spec.preset
    ? presetGraph(table, spec.preset, name, mapping ? { mapping } : {})
    : createGraphFor(table)
  if (mapping && !g0.mapping)
    throw new Error(`${where}: the preset “${spec.preset}” can’t draw the variables mapped.`)
  const aes =
    spec.aes &&
    Object.fromEntries(
      Object.entries(spec.aes).map(([k, title]) => [k, variableKey(table, title!, where)]),
    )
  const shown = spec.dataSets
    ? table.dataSets.filter((d) => spec.dataSets!.some((t) => norm(t) === norm(d.title)))
    : table.dataSets
  if (spec.dataSets && shown.length !== spec.dataSets.length)
    for (const t of spec.dataSets) dataSetKey(table, t, where)
  const layers = g0.layers.map((l): Layer => {
    if (l.geom === 'errorbar' && spec.error && l.stat.kind === 'summary')
      return {
        ...l,
        stat: { ...l.stat, error: spec.error },
        style: { ...l.style, direction: 'both' },
      }
    if (l.geom !== 'points') return l
    const series: NonNullable<Layer['series']> = { ...l.series }
    spec.symbols?.forEach(({ shape, open }, i) => {
      const ds = shown[i]
      if (ds) series[ds.id] = { style: { shape, ...(open ? OPEN : {}) } }
    })
    return {
      ...l,
      ...(aes ? { aes } : {}),
      ...(spec.open ? { style: { ...l.style, ...OPEN } } : {}),
      ...(spec.symbols ? { series } : {}),
    } as Layer
  })
  const overrides: GraphNode['seriesOverrides'] = {}
  spec.colors?.forEach((rgb, i) => {
    const ds = shown[i]
    if (ds) overrides[ds.id] = { color: { rgb } }
  })
  const rows = spec.rows?.map((t) => rowIndex(table, t, where))
  const x = g0.axes.x
  const g: GraphNode = {
    ...g0,
    name,
    title: g0.title && name !== table.name ? { ...g0.title, content: [{ text: name }] } : g0.title,
    layers,
    drawOrder: 'series',
    seriesSource: {
      ...g0.seriesSource,
      ...(spec.dataSets ? { include: shown.map((d) => d.id) } : {}),
      ...(rows ? { rows } : {}),
    },
    seriesOverrides: { ...g0.seriesOverrides, ...overrides },
    ...(spec.size
      ? { size: { ...g0.size, plotWidth: spec.size[0], plotHeight: spec.size[1] } }
      : {}),
    ...(spec.link ? { links: spec.link } : {}),
    axes: {
      ...g0.axes,
      y: styledAxis(g0.axes.y, spec.logY, spec.yRange, spec.yTitle),
      x:
        x.type === 'categorical'
          ? {
              ...x,
              ...(spec.rotate ? { rotation: spec.rotate } : {}),
              ...(spec.xTitle ? { title: { content: parseRichText(spec.xTitle) } } : {}),
            }
          : styledAxis(x, spec.logX, spec.xRange, spec.xTitle),
    },
    legend: spec.legend === undefined ? g0.legend : { ...g0.legend, show: spec.legend },
    ...(spec.horizontal ? { style: { ...g0.style, orientation: 'horizontal' as const } } : {}),
  }
  return spec.format ? spec.format.apply(g, table) : g
}

/** A graph built for a panel, with the panel's label. */
interface PlacedGraph {
  graph: GraphNode
  label: string
}

/**
 * The figure a panel label belongs to: "3h" → Fig. 3, letter h; "ED3h" → Extended Data Fig. 3.
 * `order` sorts main figures before Extended Data ones, each by number.
 */
function figureOf(label: string): {
  key: string
  name: string
  letter: string
  order: number
} {
  const m = /^(ED)?(\d+)([a-z]*)$/i.exec(label.trim())
  if (!m) throw new Error(`Can’t read the panel label “${label}” (expected “3h” or “ED3h”).`)
  const ed = !!m[1]
  const n = Number(m[2])
  return {
    key: `${ed ? 'ED' : ''}${n}`,
    name: `${ed ? 'Extended Data Fig. ' : 'Fig. '}${n}`,
    letter: m[3]!.toLowerCase(),
    order: (ed ? 1000 : 0) + n,
  }
}

/** The figure pages of a paper: each figure's graphs row by row, in figure order. */
function figurePages(
  paper: PaperSpec,
  graphs: readonly PlacedGraph[],
): {
  name: string
  rows: PlacedGraph[][]
  insets?: { graph: PlacedGraph; into: PlacedGraph; at: [number, number]; scale: number }[]
  notes?: string
}[] {
  const byFigure = new Map<string, PlacedGraph[]>()
  for (const g of graphs) {
    const key = figureOf(g.label).key
    byFigure.set(key, [...(byFigure.get(key) ?? []), g])
  }
  const columns = paper.layoutColumns ?? 3
  const chunks = (list: PlacedGraph[]) =>
    Array.from({ length: Math.ceil(list.length / columns) }, (_, i) =>
      list.slice(i * columns, (i + 1) * columns),
    )
  const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  return [...byFigure.entries()]
    .sort(([a], [b]) => figureOf(`${a}a`).order - figureOf(`${b}a`).order)
    .map(([key, list]) => {
      const spec = paper.figures?.find((f) => f.figure === key)
      const name = figureOf(`${key}a`).name
      if (!spec?.rows)
        return { name, rows: chunks(list), ...(spec?.notes ? { notes: spec.notes } : {}) }
      const used = new Set<PlacedGraph>()
      // "5c" places every graph of the panel; "5c:2" its second, "5c:1-3" its first three.
      const pick = (entry: string) => {
        const [label, which] = entry.split(':') as [string, string | undefined]
        const all = list.filter((g) => sameLabel(g.label, label))
        const [from, to] = which ? which.split('-').map(Number) : [1, all.length]
        const of = all.slice(from! - 1, to ?? from)
        if (!of.length) throw new Error(`${paper.title}, ${name}: no panel “${entry}” to place.`)
        for (const g of of) used.add(g)
        return of
      }
      const insets = (spec.insets ?? []).map((i) => ({
        graph: pick(i.graph)[0]!,
        into: pick(i.into)[0]!,
        at: i.at,
        scale: i.scale ?? 1,
      }))
      for (const i of insets) used.delete(i.into)
      const inInsets = new Set(insets.map((i) => i.graph))
      const rows = spec.rows.map((labels) =>
        labels.flatMap((entry) => pick(entry).filter((g) => !inInsets.has(g))),
      )
      const rest = list.filter((g) => !used.has(g))
      return {
        name,
        rows: [...rows, ...chunks(rest)],
        ...(insets.length ? { insets } : {}),
        ...(spec.notes ? { notes: spec.notes } : {}),
      }
    })
}

/** Room for a panel's letter left of its graph, and between graphs and rows (points). */
const LETTER_ROOM = 14
const FIGURE_GAP = 14
const FIGURE_MARGIN = 36

/**
 * A figure page: the rows of graphs at one scale (never above 1) on whichever Letter page,
 * portrait or landscape, shows them largest; plot areas lined up along each row, each panel's
 * letter (bold, as the paper prints it) at its row's top left of its first graph, grouped with
 * the panel's graphs so they move together.
 */
function placeFigure(
  rows: readonly PlacedGraph[][],
  scene: (graph: GraphNode) => Scene,
): { page: { width: number; height: number }; items: LayoutItem[] } {
  const scenes = rows.map((row) => row.map(({ graph }) => scene(graph)))
  const rowTops = scenes.map((row) => Math.max(...row.map((s) => s.plot.y)))
  const rowHeights = scenes.map((row, r) =>
    Math.max(...row.map((s) => rowTops[r]! - s.plot.y + s.height)),
  )
  const rowWidths = scenes.map(
    (row) => row.reduce((w, s) => w + LETTER_ROOM + s.width, 0) + FIGURE_GAP * (row.length - 1),
  )
  const width = Math.max(...rowWidths)
  const height = rowHeights.reduce((h, r) => h + r, 0) + FIGURE_GAP * (rows.length - 1)
  const fit = (p: { width: number; height: number }) =>
    Math.min(1, (p.width - 2 * FIGURE_MARGIN) / width, (p.height - 2 * FIGURE_MARGIN) / height)
  const portrait = pageSpec('letter', 'portrait')
  const landscape = pageSpec('letter', 'landscape')
  const page = fit(portrait) >= fit(landscape) ? portrait : landscape
  const s = fit(page)
  const letterSize = Math.max(8, Math.round(14 * s))

  const items: LayoutItem[] = []
  const groups = new Map<string, ReturnType<typeof newGroupId>>()
  let y = FIGURE_MARGIN
  rows.forEach((row, r) => {
    let x = FIGURE_MARGIN
    row.forEach(({ graph, label }, i) => {
      const sc = scenes[r]![i]!
      const first = !groups.has(label)
      if (first) groups.set(label, newGroupId())
      const group = groups.get(label)!
      if (first)
        items.push({
          type: 'text',
          id: newLayoutItemId(),
          group,
          x,
          y,
          content: { content: [{ text: figureOf(label).letter, bold: true, size: letterSize }] },
        })
      items.push({
        type: 'graph',
        id: newLayoutItemId(),
        group,
        graph: graph.id,
        x: x + LETTER_ROOM * s,
        y: y + (rowTops[r]! - sc.plot.y) * s,
        scale: s,
      })
      x += (LETTER_ROOM + sc.width + FIGURE_GAP) * s
    })
    y += (rowHeights[r]! + FIGURE_GAP) * s
  })
  return { page, items }
}

/** The import dialog's settings a panel changes, as a sentence. */
const describeImport = (i: ImportSpec): string =>
  [
    i.tableKind && `table kind ${i.tableKind}`,
    i.headerRow !== undefined && (i.headerRow ? 'first row as titles' : 'no title row'),
    i.firstColumn &&
      `first column as ${i.firstColumn === 'rowTitles' ? 'row titles' : i.firstColumn}`,
    i.replicates && `${i.replicates} replicates side by side`,
    i.range && `range ${i.range}`,
  ]
    .filter(Boolean)
    .join(', ')

export interface BuiltPaper {
  project: Project
  checks: PValueCheck[]
  /** Each analysis' result, as the engine would compute it (brackets on the pages need them). */
  results: Map<NodeId, AnalysisResult>
}

/** Builds a paper's project: tables, analyses, graphs, a figure layout and the P value checks. */
export async function buildPaper(paper: PaperSpec, ctx: ExampleContext): Promise<BuiltPaper> {
  const files = new Files(ctx, paper)
  const project = createProject(paper.title)
  const add = (node: DocNode) => {
    project.nodes[node.id] = node
    project.order.push(node.id)
  }
  const checks: PValueCheck[] = []
  const results = new Map<NodeId, AnalysisResult>()
  const graphs: PlacedGraph[] = []

  // Imported panels in order; parsing is shared per file.
  const imported = await Promise.all(paper.panels.map((p) => importPanel(files, p, p.name)))
  const joined = await Promise.all(
    paper.panels.map((p) =>
      Promise.all((p.with ?? []).map((w, i) => importPanel(files, w, `${p.name} (${i + 2})`))),
    ),
  )
  const fromCells = await Promise.all(paper.panels.map((p) => cellValues(files, p)))
  paper.panels.forEach((panel, i) => {
    /** A printed value: as the spec gives it, or as its cell in the source data states it. */
    const printedOf = (printed: PrintedP): string => {
      const v = fromCells[i]!.get(printed) ?? printed.p
      if (v === undefined) throw new Error(`${panel.name}: a printed value has neither p nor cell.`)
      return v
    }
    const { table: raw, account } = imported[i]!
    const others = joined[i]!.map((r) => r.table)
    const table = panel.edit ? panel.edit.apply(raw, others) : raw
    const notes: string[] = [
      `${paper.citation}`,
      `Source data: ${panel.file}, ${panel.long ? 'one value per row' : `sheet “${panel.sheet}”`}${typeof panel.block === 'string' ? `, table “${panel.block}”` : ''}; imported with ${panel.import ? `these settings changed: ${describeImport(panel.import)}` : 'the settings the importer detects'}${panel.long ? ` (value ${panel.long.value}, data sets by ${panel.long.group}${panel.long.row ? `, rows by ${panel.long.row}` : ''}${panel.long.subject ? `, subjects by ${panel.long.subject}` : ''}${panel.long.filters?.length ? `, only rows with ${panel.long.filters.map((f) => `${f.column} = ${f.value}`).join(' and ')}` : ''})` : ''}.`,
    ]
    if (paper.fixText && isTextImport(panel.file))
      notes.push(`Before importing, in a text editor: ${paper.fixText.describe}`)
    if (account?.leftOut.length) notes.push(`Left out at import: ${describeAccount(account)}`)
    if (panel.with?.length)
      notes.push(
        `Joined with: ${panel.with.map((w) => `${w.file}, sheet “${w.sheet}”${typeof w.block === 'string' ? `, table “${w.block}”` : ''}`).join('; ')}.`,
      )
    if (panel.edit) notes.push(`After importing: ${panel.edit.describe}`)
    notes.push(`Legend: ${panel.legend}`)
    const node: DataTable = { ...table, name: panel.name, notes: '' }
    add(node)

    const specs = Array.isArray(panel.graph) ? panel.graph : [panel.graph]
    let panelGraphs = specs.map((g) => styleGraph(node, g, g.name ?? panel.name))
    const lines: string[] = []
    for (const spec of panel.analyses ?? []) {
      const def = registry.get(spec.analysis)
      if (!def) throw new Error(`Unknown analysis “${spec.analysis}”.`)
      const params = def.params.parse(spec.params ?? {})
      const label = `${figureOf(panel.label).name}${figureOf(panel.label).letter}`
      // The table analysed: the panel's, or one made from it (added after it).
      let src: DataTable = node
      if (spec.on) {
        src = {
          ...spec.on.apply(node),
          id: newNodeId(),
          name: spec.on.name,
          notes: [
            paper.citation,
            `Made from “${panel.name}” for the test the figure prints: ${spec.on.describe}`,
          ].join('\n'),
        }
        add(src)
      }
      const keys = spec.dataSets
        ? spec.dataSets.map((t) => dataSetKey(src, t, panel.name))
        : src.dataSets.map((d) => d.id)
      const pairName =
        spec.dataSets?.length === 2 && src.tableKind !== 'grouped'
          ? `: ${spec.dataSets[0]} vs ${spec.dataSets[1]}`
          : ''
      const analysis: AnalysisNode = {
        kind: 'analysis',
        id: newNodeId(),
        name: `${label} – ${spec.test}${pairName}`,
        analysisId: spec.analysis,
        pluginVersion: def.version,
        input: { source: src.id, dataSets: keys },
        params,
      }
      add(analysis)
      // As the engine runs it (see `prepare` in @ps/engine).
      const input = keys.map((k) => normalizeColumn(src, k)!)
      const result = def.run(input, params, {
        tableKind: src.tableKind,
        xTitle: src.x?.title ?? null,
      })
      if (result.status === 'error')
        throw new Error(
          `${analysis.name}: ${result.diagnostics.map((d) => d.message).join(' ') || 'failed'}`,
        )
      results.set(analysis.id, result)

      lines.push(
        `${analysis.name}${spec.on ? ` (of the table “${spec.on.name}”)` : ''}${spec.why ? ` — ${spec.why}` : ''}`,
      )
      const keysShown = new Set<string>()
      for (const printed of spec.printed) {
        let p: number
        if (printed.value) {
          // A value of one data set's fit ('slope', a parameter) is keyed by data set: `a`'s.
          const v =
            result.values[printed.value] ??
            result.values[`${printed.value}:${dataSetKey(src, printed.a, analysis.name)}`]
          const ok = printed.stat
            ? v?.kind === 'number' || v?.kind === 'integer' || v?.kind === 'pvalue'
            : v?.kind === 'pvalue'
          if (!ok || !v || !('v' in v) || typeof v.v !== 'number')
            throw new Error(
              `${analysis.name}: the results have no ${printed.stat ?? 'P value'} “${printed.value}”.`,
            )
          p = printed.magnitude ? Math.abs(v.v) : v.v
        } else {
          const cmp = findComparison(src, result, printed, analysis.name)
          keysShown.add(cmp.key)
          p = cmp.pAdjusted ?? cmp.p
        }
        const value = printedOf(printed)
        const agreement = comparePrinted(value, p)
        checks.push({
          panel: panel.name,
          analysis: analysis.name,
          comparison: printed.stat ? `${pair(printed)} (${printed.stat})` : pair(printed),
          printed: value,
          computed: p,
          agreement,
          expectedToDiffer: printed.differs !== undefined,
        })
        const said = printed.cell ? `source data (${printed.cell})` : 'printed'
        const shownText = printed.stat
          ? `${said} ${printed.stat} = ${value}; app ${printed.stat} = ${p.toPrecision(4)}`
          : `${said} ${printedText(value)}; app ${appText(p)}`
        lines.push(
          `  ${pair(printed)}: ${shownText}: ${AGREEMENT_TEXT[agreement]}${printed.differs ? `. ${printed.differs}` : ''}`,
        )
      }
      const show = spec.brackets ?? 'p'
      if (show !== 'none' && !spec.on)
        panelGraphs = panelGraphs.map((graph) => {
          // Graphs of mapped variables draw levels, not the data sets compared.
          if (graph.mapping) return graph
          const include = graph.seriesSource.include
          const rows = graph.seriesSource.rows
          const brackets = bracketsFromAnalysis(graph, analysis.id, result, show).filter(
            (b) =>
              b.type === 'bracket' &&
              b.label.source === 'analysis' &&
              keysShown.has(b.label.comparison) &&
              (include === 'all' || (include.includes(b.a) && include.includes(b.b))) &&
              (!rows ||
                b.rowA === undefined ||
                (rows.includes(b.rowA) && rows.includes(b.rowB ?? b.rowA))),
          )
          return { ...graph, annotations: [...graph.annotations, ...brackets] }
        })
    }
    if (lines.length)
      notes.push(
        '',
        `P values printed in the figure${(panel.analyses ?? []).some((a) => a.printed.some((p) => p.cell)) ? ' (or stated in its source data)' : ''} and computed by the app:`,
        ...lines,
      )
    else notes.push('', 'The figure prints no statistics for this panel.')
    const formats = specs.flatMap((g) => (g.format ? [g.format.does] : []))
    if (formats.length) notes.push('', `Formatted: ${formats.join(' ')}`)
    node.notes = notes.join('\n')
    for (const graph of panelGraphs) {
      add(graph)
      graphs.push({ graph, label: panel.label })
    }
  })

  // One page per figure: the panels row by row as the paper arranges them, plot areas lined up in
  // each row, each panel's letter at its first graph's top-left corner.
  const result = (id: NodeId) => results.get(id)
  const scene = (graph: GraphNode) => layoutGraph({ project, graph, fonts: ctx.fonts, result })
  for (const fig of figurePages(paper, graphs)) {
    const placed = placeFigure(fig.rows, scene)
    // Insets: their plot area's corner at `at` of the host's plot area, grouped with the host.
    for (const inset of fig.insets ?? []) {
      const host = placed.items.find(
        (i): i is Extract<LayoutItem, { type: 'graph' }> =>
          i.type === 'graph' && i.graph === inset.into.graph.id,
      )
      if (!host) throw new Error(`${paper.title}, ${fig.name}: an inset’s host isn’t on the page.`)
      const h = scene(inset.into.graph).plot
      const p = scene(inset.graph.graph).plot
      const s = host.scale * inset.scale
      placed.items.push({
        type: 'graph',
        id: newLayoutItemId(),
        ...(host.group ? { group: host.group } : {}),
        graph: inset.graph.graph.id,
        x: host.x + (h.x + inset.at[0] * h.w) * host.scale - p.x * s,
        y: host.y + (h.y + inset.at[1] * h.h) * host.scale - p.y * s,
        scale: s,
      })
    }
    const layout = newLayout(`${fig.name} (reproduced)`, placed.page, placed.items, {
      show: false,
      style: 'a',
    })
    add(fig.notes ? { ...layout, notes: fig.notes } : layout)
  }
  return { project, checks, results }
}

/** Every file a paper needs. */
export const paperFiles = (paper: PaperSpec): string[] => [
  ...new Set(
    paper.panels.flatMap((p) => [p, ...(p.with ?? [])].map((t) => `${paper.folder}/${t.file}`)),
  ),
]

/** The Examples-dialog entry of a paper: available when all its files are present. */
export function paperExample(paper: PaperSpec): ExampleDef {
  return {
    id: paper.id,
    title: paper.title,
    description: paper.description,
    section: 'published',
    available: async (ctx) =>
      (await Promise.all(paperFiles(paper).map((f) => ctx.sourceFile(f)))).every((b) => b !== null),
    build: async (ctx) => (await buildPaper(paper, ctx)).project,
  }
}
