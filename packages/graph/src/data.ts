import {
  type DataSetColumn,
  type DataTable,
  type ErrorSpec,
  type GraphNode,
  levelAt,
  levelKey,
  type NormalizedDataSet,
  normalizeDataSet,
  type Project,
  primaryValues,
  type ReplicateData,
  type ResultLookup,
  type RichText,
  type SeriesFilter,
  type SeriesStyle,
  type SummaryData,
  sourceTable,
  titleRuns,
} from '@ps/model'
import {
  geometricMean,
  geometricMeanCI,
  geometricSdFactor,
  max,
  mean,
  min,
  quantile,
  quantileSorted,
  sd,
  sem,
  sortAscending,
  tQuantile,
} from '@ps/stats'
import { histogramLayer, variableBins } from './binned.ts'
import { mappedSeries } from './mapped.ts'

export interface GraphSeries {
  key: string
  title: string
  /** The title's formatted form, when it has one (roadmap 28). */
  titleRich?: RichText
  /** Position in the graph (drives default colour and category order). */
  index: number
  /**
   * The data set as the graph shows it: with a row slice (`seriesSource.rows`), only those rows,
   * in slice order (row i of `ds` is table row `rows[i]`).
   */
  ds: NormalizedDataSet
  /** Table row of each of `ds`' rows when the graph shows a row slice; absent = all rows. */
  rows?: readonly number[]
  /** Names of the data set's subcolumns (nested tables: its subjects), when it has any. */
  subcolumnTitles?: readonly (string | null)[]
  /** Formatted row titles by row of `ds` (null = plain), when the table has any. */
  rowTitlesRich?: readonly (RichText | null)[]
  /** X errors by row of `ds` (± values, NaN = none), when the table's X has errors. */
  xErr?: Float64Array
  /**
   * A grouped graph of variables (roadmap 34a, `mappedSeries`): each row's (category's) values
   * with the table rows they come from, in place of the replicates of `ds` (cells are uneven).
   */
  cells?: readonly (readonly PlotPoint[])[]
  /** The table's row titles, for the points of `cells` (their `row` is a table row). */
  cellRowTitles?: readonly (string | null)[]
  /**
   * Its values are counts (a text × text graph of variables counting rows, roadmap 34b): axes and
   * colour bars of them tick at whole numbers.
   */
  counts?: true
}

/** A series' title as rich text. */
export const seriesTitle = (s: Pick<GraphSeries, 'title' | 'titleRich'>): RichText =>
  titleRuns(s.title, s.titleRich)

/** The title of row `r` of a series' data set as rich text; null when the row has none. */
export function rowTitleOf(
  s: Pick<GraphSeries, 'ds' | 'rowTitlesRich'>,
  r: number,
): RichText | null {
  const t = s.ds.rowTitles?.[r]
  return t ? titleRuns(t, s.rowTitlesRich?.[r]) : null
}

/** Table row of row `r` of a series' (possibly sliced) data set. */
export const tableRow = (s: Pick<GraphSeries, 'rows'>, r: number): number => s.rows?.[r] ?? r

/** A graph's own rows made valid, per `seriesSource.rows` array (immutable) and row count. */
const ownRowsCache = new WeakMap<readonly number[], Map<number, number[]>>()
/** Those rows of a filter's level, per valid own rows and level rows (both cached arrays). */
const bothRowsCache = new WeakMap<readonly number[], WeakMap<readonly number[], number[]>>()

/**
 * The rows a graph shows: `seriesSource.rows` without out-of-range indices and repeats (first
 * occurrence wins), then (roadmap 34d) only those of its filter's level; null when the graph shows
 * every row. The same array for the same rows array, filter and table column (audit 2, G8: what
 * caches of a graph's rows are keyed by); callers never write to it.
 */
export function graphRows(
  graph: Pick<GraphNode, 'seriesSource'>,
  table: Pick<DataTable, 'rowCount' | 'dataSets'>,
): number[] | null {
  const { rows, filter } = graph.seriesSource
  const own = rows ? ownRows(rows, table.rowCount) : null
  if (!filter) return own
  const level = filterRows(table, filter)
  if (!own) return level
  let byLevel = bothRowsCache.get(own)
  if (!byLevel) {
    byLevel = new WeakMap()
    bothRowsCache.set(own, byLevel)
  }
  let out = byLevel.get(level)
  if (!out) {
    const keep = new Set(level)
    out = own.filter((r) => keep.has(r))
    byLevel.set(level, out)
  }
  return out
}

/** A graph's own rows without out-of-range indices and repeats (cached per array and count). */
function ownRows(rows: readonly number[], rowCount: number): number[] {
  let byCount = ownRowsCache.get(rows)
  const hit = byCount?.get(rowCount)
  if (hit) return hit
  const seen = new Set<number>()
  const out: number[] = []
  for (const r of rows) {
    if (!Number.isInteger(r) || r < 0 || r >= rowCount || seen.has(r)) continue
    seen.add(r)
    out.push(r)
  }
  if (!byCount) {
    byCount = new Map()
    ownRowsCache.set(rows, byCount)
  }
  byCount.set(rowCount, out)
  return out
}

/** Rows of each level of a text variable, per column object (immutable) and level key. */
const filterCache = new WeakMap<DataSetColumn, Map<string, number[]>>()

/**
 * The table rows whose text variable `filter.variable` has the level `filter.level` (roadmap
 * 34d), in table order: not empty, not excluded. None when the variable isn't a text variable of
 * the table.
 */
export function filterRows(
  table: Pick<DataTable, 'rowCount' | 'dataSets'>,
  filter: SeriesFilter,
): number[] {
  const ds = table.dataSets.find((d) => d.id === filter.variable)
  if (!ds?.text) return []
  let byLevel = filterCache.get(ds)
  const hit = byLevel?.get(filter.level)
  if (hit && hit.length <= table.rowCount) return hit
  const out: number[] = []
  const excluded = ds.subcolumns[0]?.excluded
  const n = Math.min(table.rowCount, ds.text.length)
  for (let r = 0; r < n; r++) {
    if (excluded?.[r]) continue
    const t = levelAt(ds.text, r)
    if (t !== null && levelKey(t) === filter.level) out.push(r)
  }
  if (!byLevel) {
    byLevel = new Map()
    filterCache.set(ds, byLevel)
  }
  byLevel.set(filter.level, out)
  return out
}

/**
 * The graph's series, following its source per `seriesSource.include` and `rows`. The source is
 * a data table, or an analysis whose result is a table (chaining): that needs `result`, and the
 * graph shows nothing until the result exists. A graph mapping a multiple-variables table's
 * variables to its axes (roadmap 34a) has a series per level instead (`mappedSeries`), and a
 * histogram of a variable (roadmap 34f) one per level of its colour variable (`variableBins`).
 */
export function resolveSeries(
  project: Project,
  graph: Pick<GraphNode, 'seriesSource'> &
    Partial<Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder' | 'frame' | 'layers'>>,
  result?: ResultLookup,
): GraphSeries[] {
  const table = sourceTable(project, graph.seriesSource.table, result)
  if (!table) return []
  const rows = graphRows(graph, table)
  if (graph.mapping && graph.frame) {
    const mapped = mappedSeries(table, { ...graph, frame: graph.frame }, rows)
    if (mapped) return mapped
  }
  // A histogram of a variable (roadmap 34f): a data set per level of its colour variable.
  const hist =
    graph.frame && graph.layers
      ? histogramLayer({ ...graph, frame: graph.frame, layers: graph.layers })
      : undefined
  if (hist) return variableBins(table, graph, hist, rows).series
  const include = graph.seriesSource.include
  const keys = include === 'all' ? table.dataSets.map((d) => d.id as string) : include
  // X with errors: the second X subcolumn holds ± errors.
  const xe = table.x?.xFormat === 'numbersWithError' ? table.x.subcolumns[1] : undefined
  const xErr = xe
    ? Float64Array.from(rows ?? Array.from({ length: table.rowCount }, (_, r) => r), (r) => {
        const v = xe.values[r]
        return v === null || v === undefined || xe.excluded?.[r] ? Number.NaN : v
      })
    : undefined
  const out: GraphSeries[] = []
  for (const key of keys) {
    const col = table.dataSets.find((d) => d.id === key)
    // Text (categorical) variables have no values to plot as a data set.
    if (!col || col.text) continue
    const full = normalizeDataSet(table, col)
    const ds = rows ? sliceDataSet(col, full, rows) : full
    const rich = table.rowTitlesRich
    out.push({
      key,
      title: ds.title,
      ...(col.titleRich ? { titleRich: col.titleRich } : {}),
      index: out.length,
      ds,
      ...(rows ? { rows } : {}),
      ...(col.subcolumnTitles ? { subcolumnTitles: col.subcolumnTitles } : {}),
      ...(rich ? { rowTitlesRich: rows ? rows.map((r) => rich[r] ?? null) : rich } : {}),
      ...(xErr ? { xErr } : {}),
    })
  }
  return out
}

/**
 * Row slices of a normalized data set, per rows array (`graphRows`' arrays are the same for the
 * same rows: audit 2, G8). Kept while both are: a split set of any number of levels keeps every
 * level's slice (they partition the rows), where 8 slices kept by a 600 KB key string thrashed.
 */
const sliceCache = new WeakMap<NormalizedDataSet, WeakMap<readonly number[], NormalizedDataSet>>()

/**
 * A normalized data set restricted to `rows` (valid, distinct table rows), in that order, with
 * row titles, X and counts to match. Cached per full view (itself cached per column object), so
 * a sliced graph stays cheap to re-lay out; unsliced graphs use the full view untouched.
 */
function sliceDataSet(
  col: DataSetColumn,
  full: NormalizedDataSet,
  rows: readonly number[],
): NormalizedDataSet {
  let slices = sliceCache.get(full)
  const hit = slices?.get(rows)
  if (hit) return hit

  const pick = (a: Float64Array) => Float64Array.from(rows, (r) => a[r] ?? Number.NaN)
  let data: ReplicateData | SummaryData
  if (full.data.shape === 'replicates') {
    data = { shape: 'replicates', reps: full.data.reps.map(pick) }
  } else {
    const d = full.data
    data = { shape: 'summary', mean: pick(d.mean), sd: pick(d.sd), sem: pick(d.sem), n: pick(d.n) }
    if (d.lo && d.hi) {
      data.lo = pick(d.lo)
      data.hi = pick(d.hi)
    }
  }
  const counts = { empty: 0, excluded: 0 }
  for (const sub of col.subcolumns) {
    for (const r of rows) {
      if (sub.values[r] === null || sub.values[r] === undefined) counts.empty++
      else if (sub.excluded?.[r]) counts.excluded++
    }
  }
  const out: NormalizedDataSet = {
    ref: full.ref,
    title: full.title,
    rowCount: rows.length,
    rowTitles: full.rowTitles ? rows.map((r) => full.rowTitles![r] ?? null) : null,
    x: full.x ? pick(full.x) : null,
    data,
    counts,
    ...(full.text ? { text: rows.map((r) => full.text![r] ?? null) } : {}),
    ...(full.formula !== undefined ? { formula: full.formula } : {}),
  }
  if (!slices) {
    slices = new WeakMap()
    sliceCache.set(full, slices)
  }
  slices.set(rows, out)
  return out
}

export interface PlotPoint {
  value: number
  /** Table row, for before-after pairing and selection ids. */
  row: number
  /** Replicate subcolumn the value comes from (with `row`, the point identity); absent = 0. */
  sub?: number
}

/** Everything a column graph needs to draw one series. NaN = not available. */
export interface PlotStats {
  points: PlotPoint[]
  n: number
  mean: number
  median: number
  sd: number
  sem: number
  ciLo: number
  ciHi: number
  min: number
  max: number
  q1: number
  q3: number
  /** Median absolute deviation from the median (unscaled). */
  mad: number
  /**
   * Geometric mean, geometric SD factor and the CI of the geometric mean (roadmap 30); NaN
   * unless every value is positive.
   */
  gmean: number
  gsdf: number
  gciLo: number
  gciHi: number
  /** False for pre-computed summary data, where quartiles/range/points don't exist. */
  raw: boolean
  /** Explicit error bounds entered as ±error or upper/lower. */
  lo?: number
  hi?: number
}

const NaN_STATS = {
  mean: Number.NaN,
  median: Number.NaN,
  sd: Number.NaN,
  sem: Number.NaN,
  ciLo: Number.NaN,
  ciHi: Number.NaN,
  min: Number.NaN,
  max: Number.NaN,
  q1: Number.NaN,
  q3: Number.NaN,
  mad: Number.NaN,
  gmean: Number.NaN,
  gsdf: Number.NaN,
  gciLo: Number.NaN,
  gciHi: Number.NaN,
}

/** A single value drawn as a summary (a histogram's bin): its mean, nothing else known. */
export const valueStats = (v: number): PlotStats => ({
  ...NaN_STATS,
  points: [],
  n: 1,
  mean: v,
  raw: false,
})

/** A normalized data set's statistics by confidence level (data sets are cached per column). */
const statsCache = new WeakMap<NormalizedDataSet, Map<number, PlotStats>>()

/**
 * A data set's statistics, kept per data set (normalized data sets are cached per column), so a
 * graph laid out again — a drag, a format change — doesn't sort its columns again (decision
 * 454). The same object for the same data set: never changed by its readers.
 */
export function plotStats(ds: NormalizedDataSet, confLevel = 0.95): PlotStats {
  let byLevel = statsCache.get(ds)
  const hit = byLevel?.get(confLevel)
  if (hit) return hit
  const out = computePlotStats(ds, confLevel)
  if (!byLevel) {
    byLevel = new Map()
    statsCache.set(ds, byLevel)
  }
  byLevel.set(confLevel, out)
  return out
}

function computePlotStats(ds: NormalizedDataSet, confLevel: number): PlotStats {
  // Column tables with summary data have exactly one row.
  if (ds.data.shape === 'summary') return summaryStats(ds.data, 0, confLevel)

  const points: PlotPoint[] = []
  ds.data.reps.forEach((rep, sub) => {
    for (let row = 0; row < rep.length; row++) {
      const v = rep[row]!
      if (!Number.isNaN(v)) points.push({ value: v, row, sub })
    }
  })
  return statsOfPoints(points, confLevel)
}

/** Summary statistics of raw points (a column, or one XY row's replicates). */
export function statsOfPoints(points: PlotPoint[], confLevel = 0.95): PlotStats {
  const values = points.map((p) => p.value)
  const n = values.length
  if (n === 0) return { ...NaN_STATS, points, n, raw: true }

  const m = mean(values)
  const se = sem(values)
  const half = n > 1 ? tQuantile((1 + confLevel) / 2, n - 1) * se : Number.NaN
  // Sorted once for the median and quartiles (the same type 6 quantiles as `quantile`).
  const sorted = sortAscending(values)
  const med = quantileSorted(sorted, 0.5)
  const positive = values.every((v) => v > 0)
  const gci = positive ? geometricMeanCI(values, confLevel) : { lo: Number.NaN, hi: Number.NaN }
  return {
    points,
    n,
    mean: m,
    median: med,
    mad: quantile(
      values.map((v) => Math.abs(v - med)),
      0.5,
    ),
    sd: n > 1 ? sd(values) : Number.NaN,
    sem: n > 1 ? se : Number.NaN,
    ciLo: m - half,
    ciHi: m + half,
    min: min(values),
    max: max(values),
    q1: quantileSorted(sorted, 0.25),
    q3: quantileSorted(sorted, 0.75),
    gmean: positive ? geometricMean(values) : Number.NaN,
    gsdf: positive && n > 1 ? geometricSdFactor(values) : Number.NaN,
    gciLo: gci.lo,
    gciHi: gci.hi,
    raw: true,
  }
}

/** Statistics of one row of entered summary data. */
function summaryStats(d: SummaryData, row: number, confLevel: number): PlotStats {
  const at = (a: Float64Array) => a[row] ?? Number.NaN
  const [mean, sdv, semv, n] = [at(d.mean), at(d.sd), at(d.sem), at(d.n)]
  const half =
    n > 1 && Number.isFinite(sdv) ? tQuantile((1 + confLevel) / 2, n - 1) * semv : Number.NaN
  return {
    ...NaN_STATS,
    points: [],
    n,
    mean,
    sd: sdv,
    sem: semv,
    ciLo: mean - half,
    ciHi: mean + half,
    raw: false,
    lo: d.lo?.[row],
    hi: d.hi?.[row],
  }
}

export interface XYRow {
  row: number
  x: number
  stats: PlotStats
  /** A stacked histogram's bar (roadmap 34f): the total of the data sets below it. */
  base?: number
  /**
   * Roadmap 34g: a histogram bar's bin edges in raw units, when the bins are in an arcsinh or
   * logicle axis' transformed units (then uneven in raw units; `x` is the bin's centre).
   */
  edges?: [number, number]
}

/** One entry per table row with a usable X and at least one Y value. */
export function xyRows(ds: NormalizedDataSet, confLevel = 0.95): XYRow[] {
  const out: XYRow[] = []
  const xs = ds.x
  if (!xs) return out
  for (let row = 0; row < ds.rowCount; row++) {
    const x = xs[row]!
    if (Number.isNaN(x)) continue
    const stats = cellStats(ds, row, confLevel)
    if (stats.n > 0 || Number.isFinite(stats.mean)) out.push({ row, x, stats })
  }
  return out
}

/** Scales the MAD to estimate the SD of normally distributed data (1 / Φ⁻¹(3/4)). */
export const MAD_TO_SD = 1.482602218505602

type CenterStat = NonNullable<NonNullable<SeriesStyle['center']>['stat']>
type Whiskers = NonNullable<NonNullable<SeriesStyle['box']>['whiskers']>

/**
 * The centre a series is drawn at: the median or the geometric mean when chosen (and
 * computable), else the mean.
 */
export const centerOf = (s: PlotStats, stat: CenterStat) =>
  stat === 'median' && s.raw ? s.median : stat === 'geomean' && s.raw ? s.gmean : s.mean

/** Lower/upper ends of an error bar around the centre value, or null if not drawable. */
export function errorBounds(
  s: PlotStats,
  stat: ErrorSpec['stat'],
  center: number,
): [number, number] | null {
  let lo: number
  let hi: number
  switch (stat) {
    case 'none':
      return null
    case 'SD':
      ;[lo, hi] = [center - s.sd, center + s.sd]
      break
    case 'SEM':
      ;[lo, hi] = [center - s.sem, center + s.sem]
      break
    case 'CI':
      ;[lo, hi] = [s.ciLo, s.ciHi]
      break
    case 'range':
      ;[lo, hi] = [s.min, s.max]
      break
    case 'IQR':
      ;[lo, hi] = [s.q1, s.q3]
      break
    case 'MAD':
    case 'MADn': {
      const d = s.mad * (stat === 'MADn' ? MAD_TO_SD : 1)
      ;[lo, hi] = [center - d, center + d]
      break
    }
    // Geometric: the geometric mean ×/÷ its SD factor, or its CI (not around another centre).
    case 'geoSD':
      ;[lo, hi] = [s.gmean / s.gsdf, s.gmean * s.gsdf]
      break
    case 'geoCI':
      ;[lo, hi] = [s.gciLo, s.gciHi]
      break
  }
  // Summary data entered as ±error / upper-lower overrides whatever can't be computed.
  if ((Number.isNaN(lo) || Number.isNaN(hi)) && s.lo !== undefined && s.hi !== undefined) {
    ;[lo, hi] = [s.lo, s.hi]
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

export interface BoxStats {
  q1: number
  /** Where the centre line goes (the median of a box; a floating bar's mean or median). */
  median: number
  q3: number
  whiskerLo: number
  whiskerHi: number
  outliers: PlotPoint[]
}

/**
 * What a box-type series draws for a group: quartiles and whiskers ('box', line at the median),
 * or a floating bar from the minimum to the maximum with the line at the chosen centre (the
 * mean unless the median is chosen; its whiskers have no length). Null for violins (see
 * `violinOf`) and without raw data.
 */
export function boxOf(
  s: PlotStats,
  box: { kind: 'box' | 'floating' | 'violin'; whiskers: Whiskers },
  center: CenterStat,
): BoxStats | null {
  if (box.kind === 'violin') return null
  if (box.kind === 'box') return boxStats(s, box.whiskers)
  if (!s.raw || s.n === 0) return null
  return {
    q1: s.min,
    median: centerOf(s, center === 'none' ? 'mean' : center),
    q3: s.max,
    whiskerLo: s.min,
    whiskerHi: s.max,
    outliers: [],
  }
}

/** Percentile whiskers: the lower percentile (the upper is 1 − it). */
const WHISKER_P: Partial<Record<Whiskers, number>> = {
  p1p99: 0.01,
  p025p975: 0.025,
  p5p95: 0.05,
  p10p90: 0.1,
}

export function boxStats(s: PlotStats, whiskers: Whiskers): BoxStats | null {
  if (!s.raw || s.n === 0) return null
  const values = s.points.map((p) => p.value)
  let lo: number
  let hi: number
  switch (whiskers) {
    case 'minmax':
      ;[lo, hi] = [s.min, s.max]
      break
    case 'tukey': {
      // Whiskers reach the most extreme data within 1.5 IQR of the box (Tukey).
      const f = 1.5 * (s.q3 - s.q1)
      const inside = values.filter((v) => v >= s.q1 - f && v <= s.q3 + f)
      ;[lo, hi] = [min(inside), max(inside)]
      break
    }
    default: {
      const p = WHISKER_P[whiskers]!
      ;[lo, hi] = [quantile(values, p), quantile(values, 1 - p)]
    }
  }
  return {
    q1: s.q1,
    median: s.median,
    q3: s.q3,
    whiskerLo: lo,
    whiskerHi: hi,
    outliers: whiskers === 'minmax' ? [] : s.points.filter((p) => p.value < lo || p.value > hi),
  }
}

/**
 * Statistics of one cell (row) of a series: its values (a graph of variables' uneven cells), its
 * replicates, or the entered summary.
 */
export function seriesCellStats(s: GraphSeries, row: number, confLevel = 0.95): PlotStats {
  const own = s.cells?.[row]
  return own ? statsOfPoints([...own], confLevel) : cellStats(s.ds, row, confLevel)
}

/** Statistics of one cell (row) of a data set: its replicates, or the entered summary. */
export function cellStats(ds: NormalizedDataSet, row: number, confLevel = 0.95): PlotStats {
  if (ds.data.shape === 'summary') return summaryStats(ds.data, row, confLevel)
  const pts: PlotPoint[] = []
  ds.data.reps.forEach((rep, sub) => {
    if (!Number.isNaN(rep[row]!)) pts.push({ value: rep[row]!, row, sub })
  })
  return statsOfPoints(pts, confLevel)
}

/** Whether the table holds replicate values (not entered means: mean / SD / N formats). */
export const hasRawValues = (table: Pick<DataTable, 'yFormat'>): boolean =>
  table.yFormat.type === 'replicates'

/**
 * A variable's values by table row (its first subcolumn's), or null when the table has no such
 * variable — nor, with `numbers`, a number variable of that id (a text variable's are its
 * levels').
 */
export function variableValues(
  table: DataTable,
  key: string | undefined,
  numbers = false,
): Float64Array | null {
  const col = key ? table.dataSets.find((d) => d.id === key) : undefined
  if (!col || (numbers && col.text)) return null
  return primaryValues(normalizeDataSet(table, col))
}
