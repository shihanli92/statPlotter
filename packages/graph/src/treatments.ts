import {
  type AnalysisResult,
  barCategoryKey,
  type GraphNode,
  labelPlain,
  levelKey,
  type NodeId,
  type Project,
  type RichText,
  richPlain,
  rowCategoryKey,
  sourceTable,
  type TreatmentRow,
} from '@ps/model'
import { graphRows, resolveSeries, rowTitleOf, seriesTitle, tableRow } from './data.ts'
import { isMapped, mappedData } from './mapped.ts'

// Roadmap 36: the categories a graph's category axis shows (by key, as treatment grids and spans
// name them) and grids seeded from them — from names that read as combinations of treatments
// ("TNF+CHX", "WT TNF", "−/+") or from a table's other text variables. Seeding only proposes a
// grid: the user edits it in the grid editor.

/** A category of a graph's category axis: its key and title. */
export interface AxisCategory {
  key: string
  title: string
}

/** The categories along a graph's category axis: its groups, and (grouped graphs) their bars. */
export interface AxisCategories {
  groups: AxisCategory[]
  /** Grouped graphs: every group's bars (data sets or levels), by bar key. */
  bars: (AxisCategory & { group: string; series: string })[]
}

type ResultLookup = (id: NodeId) => AnalysisResult | undefined

/**
 * The categories a category or grouped graph draws, by key (`CategoryKey`): a category graph's
 * data sets (levels), a grouped graph's rows (levels of a graph of variables) and their bars.
 * Rows of a grouped table without data are left out, as the frame leaves them out.
 */
export function axisCategories(
  project: Project,
  graph: GraphNode,
  result?: ResultLookup,
): AxisCategories {
  const series = resolveSeries(project, graph, result)
  const plain = (rt: RichText) => richPlain(rt)
  if (graph.frame !== 'grouped')
    return { groups: series.map((s) => ({ key: s.key, title: plain(seriesTitle(s)) })), bars: [] }
  const first = series[0]
  const rowCount = first?.ds.rowCount ?? 0
  const mapped = isMapped(graph)
  const rows = Array.from({ length: rowCount }, (_, r) => r).filter((r) =>
    series.some((s) => {
      const cell = s.cells?.[r]
      if (cell) return cell.length > 0
      return s.ds.data.shape === 'replicates'
        ? s.ds.data.reps.some((rep) => Number.isFinite(rep[r]!))
        : Number.isFinite(s.ds.data.mean[r]!)
    }),
  )
  const groups = rows.map((r) => {
    const title = (first && plain(rowTitleOf(first, r) ?? [])) || `Row ${tableRow(first!, r) + 1}`
    const key = mapped
      ? levelKey(first?.ds.rowTitles?.[r] ?? '')
      : rowCategoryKey(tableRow(first!, r))
    return { key, title }
  })
  const bars = groups.flatMap((g) =>
    series.map((s) => ({
      key: barCategoryKey(g.key, s.key),
      title: plain(seriesTitle(s)),
      group: g.key,
      series: s.key,
    })),
  )
  return { groups, bars }
}

// --- Seeding from names ------------------------------------------------------------------------

/** Words naming no treatment (a control's name): every treatment '-' there. */
const CONTROLS = new Set([
  'ctrl',
  'control',
  'controls',
  'vehicle',
  'veh',
  'untreated',
  'none',
  'mock',
  'dmso',
  'pbs',
  'nt',
  'unstimulated',
  'unstim',
  'naive',
  'baseline',
  '-',
])

/** The Unicode minus and dashes as a hyphen-minus. */
const asciiMinus = (s: string) => s.replace(/[−–—‐‑]/g, '-')

/** A sign: '+' or '-' (after `asciiMinus`). */
const isSign = (w: string) => w === '+' || w === '-'

/** One category name read as treatments: named ones present or absent, and signs by position. */
export interface ParsedName {
  /** Treatments named in it, with '+' (present) or '-' (absent: "TNF−"), in order. */
  named: [string, '+' | '-'][]
  /** Signs standing alone ("−/+"), in order: positional treatments. */
  signs: ('+' | '-')[]
  /** A control's name (no treatment): "Ctrl", "Vehicle". */
  control: boolean
}

/**
 * A category name read as a combination of treatments: "TNF+CHX" (TNF and CHX), "TNF + zVAD",
 * "WT TNF" (two words), "TNF−" or "TNF −" (TNF absent), "−/+" or "+ −" (signs by position), any
 * minus sign (−, –, -). Hyphens inside a word stay ("Z-VAD-FMK"). A control's name names none.
 */
export function parseCombination(name: string): ParsedName {
  const text = asciiMinus(name).trim()
  if (isSign(text)) return { named: [], signs: [text as '+' | '-'], control: false }
  if (CONTROLS.has(text.toLowerCase())) return { named: [], signs: [], control: true }
  // Each treatment named, its sign, and whether a sign was written for it.
  const named: { t: string; s: '+' | '-'; signed: boolean }[] = []
  const signs: ('+' | '-')[] = []
  let control = false
  // Words: split at spaces, slashes, commas, semicolons, ampersands and " and "; a letter or a
  // number alone stays with the word before it ("Drug A", "siRNA 2", "day 3").
  const words: string[] = []
  for (const w of text
    .replace(/\s+and\s+/gi, ' ')
    .split(/[\s/,;&]+/)
    .filter(Boolean)) {
    const prev = words.at(-1)
    if (prev && /^([A-Za-z]|\d+(\.\d+)?)$/.test(w) && !/[+-]$/.test(prev))
      words[words.length - 1] = `${prev} ${w}`
    else words.push(w)
  }
  for (const word of words) {
    // Signs alone ("+", "-", "+-"): after a name without a sign of its own, that name's
    // ("TNF −"); else by position.
    if (/^[+-]+$/.test(word)) {
      const prev = named.at(-1)
      if (word.length === 1 && prev && !prev.signed) {
        prev.s = word as '+' | '-'
        prev.signed = true
      } else for (const c of word) signs.push(c as '+' | '-')
      continue
    }
    // "TNF+CHX": several named; a trailing sign ("TNF-", "TNF+") is the last one's; a leading
    // '-' ("-TNF") marks it absent.
    const parts = word.split('+')
    const trailing = word.endsWith('+')
    parts.forEach((part, i) => {
      if (!part) return
      let t = part
      let s: '+' | '-' = '+'
      let signed = trailing && i === parts.length - 2
      if (t.length > 1 && t.endsWith('-') && !t.endsWith('--')) {
        t = t.slice(0, -1)
        s = '-'
        signed = true
      } else if (t.length > 1 && t.startsWith('-')) {
        t = t.slice(1)
        s = '-'
        signed = true
      }
      if (CONTROLS.has(t.toLowerCase())) {
        control = true
        return
      }
      named.push({ t, s, signed })
    })
  }
  if (!named.length && !signs.length) control = true
  return { named: named.map((n): [string, '+' | '-'] => [n.t, n.s]), signs, control }
}

/** Treatments are matched ignoring case and hyphens ("zVAD" = "Z-VAD"). */
const norm = (t: string) => t.toLowerCase().replace(/-/g, '')

/**
 * A treatment grid seeded from category names that read as combinations (see
 * `parseCombination`): a row per treatment in the order first named, '+' where a category names
 * it, '-' elsewhere; names of two words or more whose first words take turns over the categories
 * (genotypes: "WT TNF", "KO TNF") a row of those words as text; signs standing alone a row per
 * position ("Treatment 1"…). Null when the names don't read as combinations (fewer than two
 * categories, or no treatment shared or combined).
 */
export function seedFromNames(categories: readonly AxisCategory[]): TreatmentRow[] | null {
  if (categories.length < 2) return null
  const parsed = categories.map((c) => parseCombination(c.title))
  // Signs alone: a row per position.
  if (parsed.every((p) => !p.named.length)) {
    const n = Math.max(...parsed.map((p) => p.signs.length))
    if (!(n > 0)) return null
    return Array.from({ length: n }, (_, i) => ({
      title: `Treatment ${i + 1}`,
      cells: Object.fromEntries(categories.map((c, j) => [c.key, parsed[j]!.signs[i] ?? '-'])),
    }))
  }
  // A first word taking turns (a genotype): its own text row, when every name has two words or
  // more and each first word is shared.
  const words = categories.map((c) => asciiMinus(c.title).trim().split(/\s+/).filter(Boolean))
  const firsts = words.map((w) => (w.length > 1 && !/[+]/.test(w[0]!) ? w[0]! : null))
  const counts = new Map<string, number>()
  for (const f of firsts) if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
  const factor =
    firsts.every((f) => f !== null) && counts.size > 1 && [...counts.values()].every((n) => n > 1)
  const rows: TreatmentRow[] = []
  const named = factor
    ? categories.map((c, j) => parseCombination(words[j]!.slice(1).join(' ') || c.title))
    : parsed
  if (factor)
    rows.push({
      title: '',
      cells: Object.fromEntries(categories.map((c, j) => [c.key, firsts[j]!])),
    })
  // Treatments in the order first named; a treatment's own sign where named, '-' elsewhere.
  const order: string[] = []
  const shown = new Map<string, string>()
  for (const p of named)
    for (const [t] of p.named) {
      const k = norm(t)
      if (!shown.has(k)) {
        shown.set(k, t)
        order.push(k)
      }
    }
  const shared = order.some(
    (k) => named.filter((p) => p.named.some(([t]) => norm(t) === k)).length > 1,
  )
  const combined = named.some((p) => p.named.length > 1)
  if (!factor && !shared && !combined) return null
  if (order.length > 12) return null
  for (const k of order)
    rows.push({
      title: shown.get(k)!,
      cells: Object.fromEntries(
        categories.map((c, j) => {
          const hit = named[j]!.named.find(([t]) => norm(t) === k)
          return [c.key, hit ? hit[1] : '-']
        }),
      ),
    })
  return rows.length ? rows : null
}

// --- Seeding from text variables -----------------------------------------------------------------

/** Text read as yes or no (a yes/no variable's levels). */
const YES = new Set(['yes', 'y', 'true', '+', '1', 'treated', 'on'])
const NO = new Set(['no', 'n', 'false', '-', '0', 'untreated', 'off'])

/**
 * A treatment grid seeded from a graph of variables' other text variables: a row per text
 * variable not on the graph's axes or colour, each category's cell its rows' one value of it
 * (blank where they differ); a yes/no variable's cells '+' and '-'. Variables with the same value
 * in every category, or none, are left out. Null when the graph isn't of a table's variables.
 */
export function seedFromVariables(
  project: Project,
  graph: GraphNode,
  by: 'group' | 'bar' = 'group',
  result?: ResultLookup,
): TreatmentRow[] | null {
  if (!isMapped(graph) || !graph.mapping) return null
  const table = sourceTable(project, graph.seriesSource.table, result)
  if (!table) return null
  const d = mappedData(table, graph, graphRows(graph, table))
  if (!d) return null
  const used = new Set(
    [
      graph.mapping.x,
      graph.mapping.y,
      graph.frame === 'grouped' ? graph.mapping.color : undefined,
    ].filter((k): k is string => !!k),
  )
  const vars = table.dataSets.filter((v) => v.text && !used.has(v.id))
  // Each category's (bar's) rows, by key.
  const slots: { key: string; rows: number[] }[] = []
  const bars = graph.frame === 'grouped' && by === 'bar' && d.groups.length > 0
  d.cats.forEach((c, i) => {
    const cell = d.cells[i] ?? []
    if (bars)
      d.groups.forEach((g, j) => {
        slots.push({ key: barCategoryKey(levelKey(c), levelKey(g)), rows: cell[j] ?? [] })
      })
    else slots.push({ key: levelKey(c), rows: cell.flat() })
  })
  const rows: TreatmentRow[] = []
  for (const v of vars) {
    const text = v.text ?? []
    const cells: Record<string, string> = {}
    const values = new Set<string>()
    let any = false
    for (const s of slots) {
      const seen = new Set(s.rows.map((r) => (text[r] ?? '').trim()).filter(Boolean))
      const one = seen.size === 1 ? [...seen][0]! : ''
      cells[s.key] = one
      if (one) {
        any = true
        values.add(one)
      }
    }
    if (!any || values.size < 2) continue
    const lower = [...values].map((x) => asciiMinus(x).toLowerCase())
    const yesNo = lower.every((x) => YES.has(x) || NO.has(x))
    if (yesNo)
      for (const [k, x] of Object.entries(cells))
        cells[k] = x ? (YES.has(asciiMinus(x).toLowerCase()) ? '+' : '-') : ''
    rows.push({ title: v.title || v.id, cells })
  }
  return rows.length ? rows : null
}

/** A grid's row titles as plain text (for tests and the editor). */
export const rowTitles = (rows: readonly TreatmentRow[]): string[] =>
  rows.map((r) => labelPlain(r.title))
