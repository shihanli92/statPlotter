import {
  plural,
  type SchematicArrow,
  type SchematicBox,
  type SchematicDesign,
  type SchematicGlyph,
  type SchematicLink,
  type SchematicSpec,
  type TableFacts,
} from '@ps/model'
import { nameList } from '../sketch/words.ts'

// Roadmap 51f: a design ("What will be tested", merged from Guide me's answers and the params)
// as a schematic — boxes named with the user's names, what is compared in them, the comparisons
// as arrows, the same subjects as links, a grouped table's grid and its independent units, the
// question and what "no effect" means in words. The branching on the design is here; @ps/graph
// draws the boxes, arrows and links without knowing what they are. Never a value of the data,
// never a result: names, counts of the design, and what is compared.

/** Names the table gives the schematic besides its data sets' titles. */
export interface SchematicNames {
  /** The rows' titles (a grouped table's levels of the row factor; a table of counts' groups). */
  rowTitles?: readonly (string | null)[] | null
  /** A grouped table's factor names (51d). */
  factors?: { rows?: string; columns?: string }
  /** The X column's title (XY tables). */
  xTitle?: string | null
}

export interface SchematicOptions {
  /** The question while the design doesn't say it yet (Guide me's question). */
  fallback?: string
  /** What is still to decide ("Next: What kind of values?"). */
  pending?: string
}

/** Boxes in a row before the rest are counted in one ("+ 4 more"). */
const MAX_BOXES = 6
/** A grid's rows drawn before the rest are counted. */
const MAX_ROWS = 4
/** Comparisons drawn as arrows; more are counted in words. */
const MAX_ARCS = 10
/** Arrows drawn in a grid (every row's or column's). */
const MAX_GRID_ARCS = 16

const named = (s: string | null | undefined, fallback: string) => (s?.trim() ? s.trim() : fallback)

/**
 * A label of at most `n` characters (an arrow's words with a name in them), cut at whole
 * characters (code points: never half of an astral one; audit 4 G5).
 */
const short = (s: string, n = 22) => {
  const chars = [...s]
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : s
}

interface Ctx {
  d: SchematicDesign
  facts: TableFacts
  names: SchematicNames
  /** The outcome column's title (tables of counts). */
  outcome: string
}

/** What a box holds: its line and its picture. */
function measureOf(c: Ctx): { line?: string; glyph: SchematicGlyph } {
  const { d, outcome } = c
  const curve: SchematicGlyph =
    d.curve === 'down'
      ? 'curveDown'
      : d.curve === 'line'
        ? 'line'
        : d.curve === 'peak'
          ? 'peak'
          : 'curveUp'
  switch (d.measure) {
    case 'mean':
      return { line: 'mean', glyph: 'mean' }
    case 'logMean':
      return { line: 'mean of log values', glyph: 'mean' }
    case 'difference':
    case 'ratio':
      return { line: 'each subject’s value', glyph: 'mean' }
    case 'signedRanks':
      return { line: 'each subject’s value', glyph: 'ranks' }
    case 'ranks':
      return { line: 'ranks', glyph: 'ranks' }
    case 'distribution':
      return { line: 'distribution', glyph: 'distribution' }
    case 'separation':
      return { line: 'values', glyph: 'distribution' }
    case 'proportion':
      return { line: `% ${outcome}`, glyph: 'proportion' }
    case 'risk':
      return { line: `risk of ${outcome}`, glyph: 'proportion' }
    case 'odds':
      return { line: `odds of ${outcome}`, glyph: 'proportion' }
    case 'diagnostic':
      return { line: `% ${outcome}`, glyph: 'proportion' }
    case 'counts':
      return { line: 'count', glyph: 'proportion' }
    case 'fraction':
      return { line: '% of the total', glyph: 'proportion' }
    case 'survival':
      return { line: 'survival curve', glyph: 'survival' }
    case 'medianSurvival':
      return { line: 'median survival', glyph: 'survival' }
    case 'slope':
      return { line: 'slope', glyph: 'line' }
    case 'parameter':
      return { line: d.parameter ?? 'EC50 (or IC50)', glyph: curve }
    case 'curve':
      return { line: d.parameter ?? 'fitted curve', glyph: curve }
    case 'association':
    case 'agreement':
      return { line: 'values', glyph: 'scatter' }
    case 'summary':
      return { line: 'mean, SD, median', glyph: 'summary' }
    case 'shape':
      return { line: 'shape (QQ plot)', glyph: 'distribution' }
    case 'outliers':
      return { line: 'values far from the rest', glyph: 'mean' }
    case 'area':
      return { line: 'area under the curve', glyph: 'area' }
    case 'smooth':
      return { line: 'smoothed trend', glyph: 'curveUp' }
    default:
      return { glyph: 'none' }
  }
}

/** The noun of what is compared, for the question ("mean", "proportion of Died"). */
function nounOf(c: Ctx): string {
  const { d, outcome } = c
  switch (d.measure) {
    case 'mean':
      return 'mean'
    case 'logMean':
      return 'mean on a log scale'
    case 'ranks':
      return 'typical value (by ranks)'
    case 'proportion':
    case 'diagnostic':
      return `proportion of ${outcome}`
    case 'risk':
      return `risk of ${outcome}`
    case 'odds':
      return `odds of ${outcome}`
    case 'survival':
      return 'survival curve'
    case 'medianSurvival':
      return 'median survival'
    case 'slope':
      return 'slope'
    case 'parameter':
      return d.parameter ?? 'EC50'
    case 'distribution':
      return 'distribution'
    default:
      return 'value'
  }
}

/** The same, plural ("means", "proportions of Died"). */
function nounsOf(c: Ctx): string {
  const { d, outcome } = c
  switch (d.measure) {
    case 'mean':
      return 'means'
    case 'logMean':
      return 'means on a log scale'
    case 'ranks':
      return 'typical values'
    case 'proportion':
    case 'diagnostic':
      return `proportions of ${outcome}`
    case 'risk':
      return `risks of ${outcome}`
    case 'odds':
      return `odds of ${outcome}`
    case 'survival':
      return 'survival curves'
    case 'medianSurvival':
      return 'median survivals'
    case 'slope':
      return 'slopes'
    case 'parameter':
      return `values of ${d.parameter ?? 'EC50'}`
    case 'distribution':
      return 'distributions'
    default:
      return 'values'
  }
}

// ---- Boxes ---------------------------------------------------------------------------------

interface Laid {
  boxes: SchematicBox[]
  /** Group boxes in order (a row's); the reference box apart. */
  groups: SchematicBox[]
  reference?: SchematicBox
  grid?: SchematicSpec['grid']
  /** Grid cells by [row][column] (drawn ones). */
  cells?: SchematicBox[][]
  /** Marginal boxes of a grid's main effects. */
  margins?: SchematicBox[]
  outcomeBox?: SchematicBox
  predictors?: SchematicBox[]
  left: string[]
}

/** The first `MAX_BOXES` of `items` (one fewer and a "+ k more" box when there are more). */
function capped<T>(items: readonly T[], max = MAX_BOXES): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: [...items], more: 0 }
  return { shown: items.slice(0, max - 1), more: items.length - (max - 1) }
}

function moreBox(n: number, row: number, column: number, what: string): SchematicBox {
  return { id: 'more', label: `+ ${n} more`, measure: what, role: 'more', row, column }
}

/** Rows of a table (counts, grouped): their titles, "Row 1" when untitled. */
function rowNames(c: Ctx, n: number): string[] {
  const titles = c.names.rowTitles ?? []
  return Array.from({ length: n }, (_, r) => named(titles[r], `Row ${r + 1}`))
}

function layOut(c: Ctx): Laid {
  const { d, facts } = c
  const m = measureOf(c)
  const box = (id: string, label: string, row: number, column: number): SchematicBox => ({
    id,
    label,
    ...(m.line ? { measure: m.line } : {}),
    glyph: m.glyph,
    role: 'group',
    row,
    column,
  })
  const layout =
    d.layout === 'pair' && facts.kind === 'xy' ? 'xy' : (d.layout ?? defaultLayout(facts))
  const left: string[] = []

  if (layout === 'none') return { boxes: [], groups: [], left }

  if (layout === 'grid') {
    const rows = Math.max(1, facts.rows)
    const { shown: rowShown, more: rowMore } = capped(rowNames(c, rows), MAX_ROWS)
    const { shown: colShown, more: colMore } = capped(facts.groups)
    if (rowMore) left.push(`Showing ${rowShown.length} of ${rows} rows.`)
    if (colMore) left.push(`Showing ${colShown.length} of ${facts.groups.length} data sets.`)
    const cells = rowShown.map((_, r) =>
      colShown.map(
        (g, k): SchematicBox => ({
          id: `c${r}:${g.key}`,
          label: '',
          ...(m.line ? { measure: m.line } : {}),
          glyph: m.glyph,
          role: 'group',
          row: r,
          column: k,
        }),
      ),
    )
    const boxes = cells.flat()
    let margins: SchematicBox[] | undefined
    if (d.comparisons === 'mainColumns') {
      margins = colShown.map((g, k) => ({
        id: `m:${g.key}`,
        label: named(g.title, `Data set ${k + 1}`),
        measure: `mean over ${rowFactor(c)}`,
        glyph: m.glyph,
        role: 'group' as const,
        row: rowShown.length,
        column: k,
      }))
      boxes.push(...margins)
    }
    return {
      boxes,
      groups: boxes,
      cells,
      ...(margins ? { margins } : {}),
      grid: {
        columns: colFactor(c),
        rows: rowFactor(c),
        columnLevels: colShown.map((g, k) => named(g.title, `Data set ${k + 1}`)),
        rowLevels: rowShown,
      },
      left,
    }
  }

  if (layout === 'rows') {
    const n = facts.contingency?.rows ?? facts.rows
    const { shown, more } = capped(rowNames(c, Math.max(0, n)))
    const groups = shown.map((t, r) => box(`r${r}`, t, 0, r))
    if (more) groups.push(moreBox(more, 0, groups.length, 'rows'))
    return { boxes: groups, groups: groups.filter((b) => b.role !== 'more'), left }
  }

  if (layout === 'xy') {
    const x = box('x', named(c.names.xTitle, 'X'), 0, 0)
    const yTitle = named(facts.groups[0]?.title, 'Y')
    const y =
      d.measure === 'probability'
        ? { ...box('y', yTitle, 0, 1), measure: 'probability of “yes”', glyph: 'curveUp' as const }
        : box('y', yTitle, 0, 1)
    if (d.measure === 'probability') {
      x.measure = 'X values'
      x.glyph = 'none'
    }
    return { boxes: [x, y], groups: [x, y], left }
  }

  if (layout === 'standard') {
    const std = box('standards', named(facts.groups[0]?.title, 'Standards'), 0, 0)
    std.measure = 'standard curve'
    const unknown: SchematicBox = {
      id: 'unknowns',
      label: 'Unknowns',
      measure: 'X read off the curve',
      glyph: 'none',
      role: 'outcome',
      row: 0,
      column: 1,
    }
    return { boxes: [std, unknown], groups: [std, unknown], left }
  }

  if (layout === 'predict') return predictLayout(c, left)

  // Groups in a row (pairs: the first two).
  const list = layout === 'pair' ? facts.groups.slice(0, 2) : facts.groups
  const { shown, more } = capped(list)
  const subjects = facts.replicates
  const groups = shown.map((g, k) => {
    const b = box(`g:${g.key}`, named(g.title, `Data set ${k + 1}`), 0, k)
    if (d.nested && subjects > 1)
      b.members = { count: subjects, label: plural(subjects, 'subject') }
    return b
  })
  const control = controlKey(c)
  for (const b of groups) if (b.id === `g:${control}`) b.role = 'control'
  const boxes = [...groups]
  if (more) boxes.push(moreBox(more, 0, boxes.length, 'groups'))
  let reference: SchematicBox | undefined
  if (
    d.comparisons === 'vsValue' ||
    (d.comparisons === 'shared' && groups.length < 2 && d.hypothetical !== undefined)
  ) {
    reference = {
      id: 'value',
      label: d.hypothetical === undefined ? '?' : String(d.hypothetical),
      measure: d.measure === 'slope' ? 'no slope' : 'the value you set',
      glyph: 'none',
      role: 'reference',
      row: 0,
      column: boxes.length,
    }
    boxes.push(reference)
  }
  return { boxes, groups, ...(reference ? { reference } : {}), left }
}

function predictLayout(c: Ctx, left: string[]): Laid {
  const { d, facts } = c
  const v = facts.variables ?? { numbers: [], binary: [], texts: [] }
  const all = [...v.numbers, ...v.binary, ...v.texts]
  const title = (key: string | undefined) => all.find((x) => x.key === key)?.title
  let outcome: { id: string; label: string; measure: string; glyph: SchematicGlyph }
  let predictors: { key: string; title: string }[]
  if (d.measure === 'components') {
    outcome = {
      id: 'components',
      label: 'Principal components',
      measure: 'combinations of the variables',
      glyph: 'none',
    }
    predictors = v.numbers.slice()
  } else if (d.measure === 'survival') {
    const group = v.texts[0]
    outcome = { id: 'survival', label: 'Survival', measure: 'curve per group', glyph: 'survival' }
    predictors = [{ key: group?.key ?? 'group', title: group?.title ?? 'Grouping variable' }]
  } else if (d.measure === 'curve') {
    const group = v.texts[0]
    const x = v.numbers[0]?.title ?? 'X'
    const y = v.numbers[1]?.title ?? 'Y'
    outcome = {
      id: 'curve',
      label: `${y} against ${x}`,
      measure: 'one curve per group',
      glyph: 'curveUp',
    }
    predictors = [{ key: group?.key ?? 'group', title: group?.title ?? 'Grouping variable' }]
  } else {
    const key = d.outcome
    const known = key ? title(key) : undefined
    outcome = {
      id: `o:${key ?? ''}`,
      label: known ?? 'Outcome (to choose)',
      measure: 'outcome',
      glyph: 'none',
    }
    predictors = all.filter((x) => x.key !== key)
    // Multifactor ANOVA: the text variables are the factors.
    if (!key && v.texts.length && d.notes?.some((n) => /multifactor/i.test(n)))
      predictors = v.texts.slice()
  }
  const { shown, more } = capped(predictors, 5)
  const preds: SchematicBox[] = shown.map((p, i) => ({
    id: `p:${p.key}`,
    label: named(p.title, `Variable ${i + 1}`),
    measure: 'predictor',
    glyph: 'none',
    role: 'predictor',
    row: i,
    column: 0,
  }))
  if (more) preds.push({ ...moreBox(more, preds.length, 0, 'variables'), id: 'more' })
  const outcomeBox: SchematicBox = {
    ...outcome,
    role: 'outcome',
    row: Math.floor((preds.length - 1) / 2),
    column: 1,
  }
  return {
    boxes: [...preds, outcomeBox],
    groups: preds.filter((p) => p.role !== 'more'),
    outcomeBox,
    predictors: preds.filter((p) => p.role !== 'more'),
    left,
  }
}

const defaultLayout = (f: TableFacts): NonNullable<SchematicDesign['layout']> =>
  f.kind === 'grouped'
    ? 'grid'
    : f.kind === 'contingency' || f.kind === 'partsOfWhole'
      ? 'rows'
      : f.kind === 'multipleVariables'
        ? 'predict'
        : 'groups'

const rowFactor = (c: Ctx) => named(c.names.factors?.rows, 'Row factor')
const colFactor = (c: Ctx) => named(c.names.factors?.columns, 'Column factor')

/** The control group's key: the one chosen, else the first when comparing with a control. */
function controlKey(c: Ctx): string | undefined {
  const keys = c.facts.groups.map((g) => g.key)
  if (c.d.control && keys.includes(c.d.control)) return c.d.control
  return c.d.comparisons === 'vsControl' ? keys[0] : undefined
}

// ---- Arrows and links ----------------------------------------------------------------------

const arc = (from: string, to: string, label?: string): SchematicArrow => ({
  from,
  to,
  heads: 'both',
  route: 'arc',
  ...(label ? { label } : {}),
})

/** Every pair, or each against the first, of `bs`. */
function pairsOf(bs: readonly SchematicBox[], kind: 'allPairs' | 'vsControl', control?: string) {
  const out: [SchematicBox, SchematicBox][] = []
  if (kind === 'vsControl') {
    const ctl = bs.find((b) => b.id === control) ?? bs[0]
    if (ctl) for (const b of bs) if (b !== ctl) out.push([ctl, b])
  } else
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) out.push([bs[i]!, bs[j]!])
  return out
}

interface Drawn {
  arrows: SchematicArrow[]
  notes: string[]
  /** Comparisons in the family (counted, drawn or not). */
  count: number
}

function arrowsOf(c: Ctx, laid: Laid): Drawn {
  const { d } = c
  const gs = laid.groups
  const notes: string[] = []
  const arrows: SchematicArrow[] = []
  const comparisons = d.comparisons
  const total = c.facts.groups.length
  switch (comparisons) {
    case 'pair': {
      const [a, b] = pairOrder(c, gs)
      if (!a || !b) break
      if (d.direction) {
        const [lo, hi] = d.direction === 'increase' ? [a, b] : [b, a]
        const label =
          d.measure === 'association'
            ? undefined
            : d.measure === 'difference' || d.measure === 'ratio' || d.measure === 'signedRanks'
              ? d.direction === 'increase'
                ? 'predicted: up'
                : 'predicted: down'
              : short(`${hi.label} higher?`)
        arrows.push({
          from: lo.id,
          to: hi.id,
          heads: 'end',
          route: 'arc',
          ...(label ? { label } : {}),
        })
      } else
        arrows.push(
          arc(
            a.id,
            b.id,
            d.measure === 'difference'
              ? 'mean change?'
              : d.measure === 'ratio'
                ? 'mean ratio?'
                : d.measure === 'signedRanks'
                  ? 'up or down?'
                  : undefined,
          ),
        )
      return { arrows, notes, count: 1 }
    }
    case 'allPairs':
    case 'vsControl': {
      const pairs = pairsOf(
        gs,
        comparisons,
        comparisons === 'vsControl' ? `g:${controlKey(c)}` : undefined,
      )
      const count = comparisons === 'allPairs' ? (total * (total - 1)) / 2 : Math.max(0, total - 1)
      if (pairs.length <= MAX_ARCS && pairs.length === count)
        for (const [x, y] of pairs) arrows.push(arc(x.id, y.id))
      else notes.push(`${plural(count, 'comparison')}: too many to draw.`)
      return { arrows, notes, count }
    }
    case 'trend': {
      const [first, last] = [gs[0], gs.at(-1)]
      if (first && last && first !== last)
        arrows.push({
          from: first.id,
          to: last.id,
          heads: 'end',
          route: 'below',
          label: 'steady rise or fall, in this order?',
        })
      notes.push('A trend assumes the groups are in a meaningful order, equally spaced.')
      return { arrows, notes, count: 1 }
    }
    case 'none': {
      const [first, last] = [gs[0], gs.at(-1)]
      if (
        first &&
        last &&
        first !== last &&
        !laid.cells &&
        d.measure &&
        laid.groups.length > 2 &&
        TESTED.has(d.measure)
      )
        arrows.push({
          from: first.id,
          to: last.id,
          heads: 'none',
          route: 'below',
          label: 'any difference?',
        })
      return { arrows, notes, count: 0 }
    }
    case 'vsValue': {
      const ref = laid.reference
      if (!ref) break
      for (const g of gs) {
        if (d.direction)
          arrows.push({
            from: ref.id,
            to: g.id,
            heads: 'end',
            route: 'arc',
            label: d.direction === 'increase' ? `above ${ref.label}?` : `below ${ref.label}?`,
          })
        else arrows.push(arc(g.id, ref.id))
      }
      return { arrows, notes, count: gs.length }
    }
    case 'shared': {
      const [first, last] = [gs[0], gs.at(-1)]
      if (first && last && first !== last)
        arrows.push({
          from: first.id,
          to: last.id,
          heads: 'none',
          route: 'below',
          label:
            d.measure === 'counts'
              ? 'match the expected proportions?'
              : short(`one ${nounOf(c)} for all, or one each?`, 40),
        })
      return { arrows, notes, count: 1 }
    }
    case 'together': {
      const [a, b] = gs
      if (!a || !b) break
      arrows.push({
        from: a.id,
        to: b.id,
        heads: 'none',
        route: 'arc',
        label:
          d.measure === 'agreement'
            ? 'agree?'
            : d.direction === 'increase'
              ? 'rise together?'
              : d.direction === 'decrease'
                ? 'one falls as the other rises?'
                : 'go together?',
      })
      return { arrows, notes, count: 1 }
    }
    case 'predict': {
      if (laid.outcomeBox) {
        for (const p of laid.predictors ?? [])
          arrows.push({ from: p.id, to: laid.outcomeBox.id, heads: 'end', route: 'straight' })
        const more = laid.boxes.find((b) => b.role === 'more')
        if (more)
          arrows.push({ from: more.id, to: laid.outcomeBox.id, heads: 'end', route: 'straight' })
      } else if (laid.groups.length === 2) {
        const [x, y] = laid.groups as [SchematicBox, SchematicBox]
        arrows.push({ from: x.id, to: y.id, heads: 'end', route: 'straight' })
      }
      return { arrows, notes, count: 0 }
    }
    case 'withinRows':
    case 'withinColumns':
    case 'perRow':
      return gridArrows(c, laid, comparisons)
    case 'allCells': {
      const cells = c.facts.groups.length * Math.max(1, c.facts.rows)
      const count = (cells * (cells - 1)) / 2
      notes.push(`Every cell with every other: ${plural(count, 'comparison')}.`)
      return { arrows, notes, count }
    }
    case 'mainColumns': {
      const ms = laid.margins ?? []
      const kind = d.kind ?? 'allPairs'
      const pairs = pairsOf(ms, kind)
      if (pairs.length <= MAX_ARCS) for (const [x, y] of pairs) arrows.push(arc(x.id, y.id))
      notes.push(
        `Main effect: ${colFactor(c)} averaged over ${rowFactor(c)} — misleading when the factors interact.`,
      )
      return { arrows, notes, count: pairs.length }
    }
    case 'mainRows':
      notes.push(`Main effect: ${rowFactor(c)} averaged over ${colFactor(c)}.`)
      return { arrows, notes, count: 0 }
  }
  return { arrows, notes, count: 0 }
}

/**
 * The two groups compared, earlier then later (B − A): a table of counts' reference row, then
 * its exposed row (51c's roles); otherwise in order.
 */
function pairOrder(c: Ctx, gs: readonly SchematicBox[]): (SchematicBox | undefined)[] {
  if (c.d.layout === 'rows' && c.d.exposedRow !== undefined && gs.length === 2) {
    const exposed = gs[c.d.exposedRow === 1 ? 1 : 0]
    const other = gs[c.d.exposedRow === 1 ? 0 : 1]
    return [other, exposed]
  }
  return [gs[0], gs[1]]
}

/** Measures that test something (a description, a fit, a plan don't). */
const TESTED = new Set([
  'mean',
  'logMean',
  'ranks',
  'difference',
  'ratio',
  'signedRanks',
  'distribution',
  'proportion',
  'risk',
  'odds',
  'survival',
  'slope',
  'parameter',
  'association',
  'separation',
  'shape',
  'counts',
  'probability',
  'predict',
])

/** A grid's arrows: within each row (between columns), within each column, or one test per row. */
function gridArrows(
  c: Ctx,
  laid: Laid,
  comparisons: 'withinRows' | 'withinColumns' | 'perRow',
): Drawn {
  const { d } = c
  const cells = laid.cells ?? []
  const notes: string[] = []
  const arrows: SchematicArrow[] = []
  const cols = c.facts.groups.length
  const rows = Math.max(1, c.facts.rows)
  const kind = d.kind ?? 'allPairs'
  const per = (n: number) => (kind === 'vsControl' ? n - 1 : (n * (n - 1)) / 2)
  const blocks =
    comparisons === 'withinColumns'
      ? (cells[0] ?? []).map((_, k) => cells.map((row) => row[k]!))
      : cells
  let drawn = 0
  const perRowNone = comparisons === 'perRow' && cols > 2 && !d.kind
  for (const block of blocks) {
    if (perRowNone) {
      const [first, last] = [block[0], block.at(-1)]
      if (first && last && drawn < MAX_GRID_ARCS) {
        arrows.push({
          from: first.id,
          to: last.id,
          heads: 'none',
          route: 'below',
          label: 'differ?',
        })
        drawn++
      }
      continue
    }
    for (const [x, y] of pairsOf(
      block,
      comparisons === 'perRow' && cols === 2 ? 'allPairs' : kind,
    )) {
      if (drawn >= MAX_GRID_ARCS) break
      arrows.push(arc(x.id, y.id))
      drawn++
    }
  }
  const inBlock = comparisons === 'withinColumns' ? per(rows) : per(cols)
  const blockCount = comparisons === 'withinColumns' ? cols : rows
  if (comparisons === 'perRow') {
    notes.push(`${plural(rows, 'test')}, one per row.`)
    if (d.correction) notes.push(`Corrected across the rows by ${d.correction}.`)
  } else {
    const what = comparisons === 'withinRows' ? rowFactor(c) : colFactor(c)
    const family = d.notes?.includes('All comparisons form one family.')
      ? `All ${plural(inBlock * blockCount, 'comparison')} form one family`
      : `Each level of ${what} is its own family of ${plural(inBlock, 'comparison')}`
    notes.push(`${family}${d.correction ? ` (${d.correction})` : ''}.`)
  }
  return { arrows, notes, count: inBlock * blockCount }
}

function linksOf(c: Ctx, laid: Laid): SchematicLink[] {
  const m = c.d.matched
  if (!m || m === 'no') return []
  const same = 'same subjects'
  if (laid.cells) {
    const out: SchematicLink[] = []
    if (m === 'columns' || m === 'both' || m === 'yes')
      for (const row of laid.cells) out.push({ boxes: row.map((b) => b.id), label: same })
    if (m === 'rows' || m === 'both')
      for (let k = 0; k < (laid.cells[0]?.length ?? 0); k++)
        out.push({ boxes: laid.cells.map((row) => row[k]!.id), label: same })
    return out.filter((l) => l.boxes.length > 1)
  }
  const ids = laid.groups.filter((b) => b.role !== 'reference').map((b) => b.id)
  return ids.length > 1 ? [{ boxes: ids, label: 'same subjects, row by row' }] : []
}

// ---- Words ---------------------------------------------------------------------------------

/** Measures whose words name two groups or variables (A and B). */
const PAIR_MEASURES = new Set(['association', 'agreement', 'separation', 'probability'])

/**
 * The question while a pair is incomplete ("Choose a second group."), or null: a comparison of
 * two groups, or of two variables, with fewer than two chosen.
 */
function missingOfPair(c: Ctx, laid: Laid): string | null {
  const { d } = c
  if (laid.cells || !d.measure) return null
  const pair = d.comparisons === 'pair' || PAIR_MEASURES.has(d.measure)
  if (!pair) return null
  const n = laid.groups.filter((b) => b.role !== 'reference').length
  if (n >= 2) return null
  const what = d.comparisons === 'pair' || d.measure === 'separation' ? 'group' : 'data set'
  return n === 1 ? `Choose a second ${what}.` : `Choose two ${what}s.`
}

function questionOf(c: Ctx, laid: Laid, fallback: string | undefined): string {
  const { d, facts } = c
  const gs = laid.groups.filter((b) => b.role !== 'reference')
  const titles = facts.groups.map((g, k) => named(g.title, `Data set ${k + 1}`))
  const list = nameList(laid.cells ? (laid.grid?.columnLevels ?? titles) : gs.map((g) => g.label))
  const [a, b] = pairOrder(c, gs)
  const [A, B] = [a?.label ?? 'A', b?.label ?? 'B']
  const noun = nounOf(c)
  const of = laid.cells || c.d.layout === 'rows' ? 'in' : 'of'
  const control = gs.find((g) => g.role === 'control')?.label ?? A
  const value = laid.reference?.label ?? '?'
  const higher = d.direction === 'increase' ? 'higher' : 'lower'
  const fb = fallback ?? 'What will be tested?'
  if (!d.measure) return fb
  // Audit 4 (A20): a question about a pair with one of it chosen asks for the other (never
  // "Is the mean of B different from that of Treated?").
  const pending = missingOfPair(c, laid)
  if (pending) return pending
  switch (d.measure) {
    case 'summary':
      return laid.cells
        ? 'What are the mean, SD and n of each cell?'
        : `What are the mean, spread and median of ${list}?`
    case 'shape':
      return `Do the values of ${list} depart from a normal distribution?`
    case 'outliers':
      return `Which values of ${list} lie far from the rest?`
    case 'curve':
      return d.parameter
        ? `What are ${d.parameter} of the curve fitted to ${list}?`
        : `What curve fits ${list}?`
    case 'parameter':
      if (d.comparisons !== 'shared' || gs.length < 2)
        return `What is the ${noun} of ${gs.length > 1 ? `each of ${list}` : A}?`
      break
    case 'area':
      return `What is the area under the curve of ${list}?`
    case 'smooth':
      return `What trend do the points of ${list} follow, without a model?`
    case 'medianSurvival':
      return `What is the median survival of ${list}?`
    case 'fraction':
      return `What fraction of the total is each of ${list}?`
    case 'diagnostic':
      return 'How well does the test’s result match the truth?'
    case 'interpolate':
      return `What X values do the unknowns read off the standard curve of ${A}?`
    case 'plan':
      return 'How many subjects would detect the smallest difference that matters?'
    case 'components':
      return `Which combinations of ${plural(laid.predictors?.length ?? 0, 'variable')} explain most of their variation?`
    case 'agreement':
      return `How well do ${A} and ${B} agree?`
    case 'association':
      return d.direction === 'increase'
        ? `Do ${A} and ${B} rise together?`
        : d.direction === 'decrease'
          ? `Does ${B} fall as ${A} rises?`
          : `Do ${A} and ${B} go up and down together?`
    case 'separation':
      return d.direction
        ? `How well do the values tell ${B} from ${A} (${B} ${higher})?`
        : `How well do the values tell ${B} from ${A}?`
    case 'probability':
      return `Does the probability of “yes” in ${B} change with ${A}?`
    case 'predict': {
      const out = laid.outcomeBox?.label ?? 'the outcome'
      return `How does ${out} change with ${nameList(
        (laid.predictors ?? []).map((p) => p.label),
        4,
      )}, each with the others held fixed?`
    }
    case 'counts':
      return `Do the counts of ${list} match the proportions you expect?`
  }
  if (laid.outcomeBox && d.measure === 'survival')
    return `Do the survival curves differ between the groups of ${laid.predictors?.[0]?.label ?? 'the grouping variable'}?`
  if (laid.cells) {
    const rf = rowFactor(c)
    const cf = colFactor(c)
    switch (d.comparisons) {
      case 'withinRows':
        return `At each level of ${rf}, ${d.kind === 'vsControl' ? `is each ${cf} different from ${laid.grid?.columnLevels[0]}` : `which ${cf} means differ`}?`
      case 'withinColumns':
        return `In each level of ${cf}, ${d.kind === 'vsControl' ? `is each ${rf} different from ${laid.grid?.rowLevels[0]}` : `which ${rf} means differ`}?`
      case 'allCells':
        return 'Which cell means differ from each other?'
      case 'mainColumns':
        return `Averaged over ${rf}, ${d.kind === 'vsControl' ? `is each ${cf} different from ${laid.grid?.columnLevels[0]}` : `which ${cf} means differ`}?`
      case 'perRow':
        return facts.groups.length === 2
          ? `At each row, is the ${noun} of ${titles[1]} different from that of ${titles[0]}?`
          : `At each row, do ${list} differ in their ${noun}?`
      default:
        return `How do ${rf} and ${cf} affect the ${noun}, and does the effect of one depend on the other?`
    }
  }
  switch (d.comparisons) {
    case 'pair':
      switch (d.measure) {
        case 'ranks':
          return d.direction
            ? `Do values in ${B} tend to be ${d.direction === 'increase' ? 'larger' : 'smaller'} than in ${A}?`
            : `Do values in ${B} tend to be larger or smaller than in ${A}?`
        case 'difference':
          return d.direction
            ? `Is the mean change from ${A} to ${B} ${d.direction === 'increase' ? 'above' : 'below'} zero?`
            : `Is the mean change from ${A} to ${B} different from zero?`
        case 'ratio':
          return d.direction
            ? `Is the mean ratio ${B}/${A} ${d.direction === 'increase' ? 'above' : 'below'} 1?`
            : `Is the mean ratio ${B}/${A} different from 1?`
        case 'signedRanks':
          return d.direction
            ? `Do the changes from ${A} to ${B} tend to go ${d.direction === 'increase' ? 'up' : 'down'}?`
            : `Do the changes from ${A} to ${B} tend to go up or down?`
        case 'distribution':
          return `Do the distributions of ${A} and ${B} differ in any way (level or shape)?`
        case 'survival':
          return `Do the survival curves of ${A} and ${B} differ?`
        default:
          return d.direction
            ? `Is the ${noun} ${of} ${B} ${higher} than ${of === 'in' ? 'in' : 'that of'} ${A}?`
            : `Is the ${noun} ${of} ${B} different from ${of === 'in' ? 'that in' : 'that of'} ${A}?`
      }
    case 'allPairs':
      return d.measure === 'ranks'
        ? `Which of ${list} tend to have larger or smaller values than each other?`
        : `Which of ${list} differ from each other in their ${noun}?`
    case 'vsControl':
      return d.measure === 'ranks'
        ? `Do values in each group tend to be larger or smaller than in ${control}?`
        : `Is the ${noun} ${of} each group different from that ${of} ${control}?`
    case 'trend':
      return `Does the ${noun} rise or fall steadily from ${gs[0]?.label} to ${gs.at(-1)?.label}?`
    case 'vsValue':
      if (d.measure === 'slope')
        return gs.length > 1
          ? `Is the slope of each of ${list} different from zero?`
          : `Is the slope of ${A} against ${named(c.names.xTitle, 'X')} different from zero?`
      if (d.measure === 'signedRanks')
        return `Do the values of ${gs.length > 1 ? 'each group' : A} tend to lie ${d.direction === 'increase' ? 'above' : d.direction === 'decrease' ? 'below' : 'above or below'} ${value}?`
      return d.direction
        ? `Is the ${noun} of ${gs.length > 1 ? 'each group' : A} ${d.direction === 'increase' ? 'above' : 'below'} ${value}?`
        : `Is the ${noun} of ${gs.length > 1 ? 'each group' : A} different from ${value}?`
    case 'shared':
      return d.measure === 'slope'
        ? `Do the slopes of ${list} differ?`
        : `Does the ${noun} differ between ${list}?`
    case 'none':
      if (gs.length < 2) return fb
      return d.measure === 'ranks'
        ? `Do values in any of ${list} tend to be larger or smaller than in the others?`
        : `Is the ${noun} ${of} any of ${list} different?`
  }
  return d.measure && gs.length > 1 ? `Do ${list} differ in their ${noun}?` : fb
}

function noEffectOf(c: Ctx, laid: Laid): string | null {
  const { d } = c
  if (!d.measure || !TESTED.has(d.measure) || missingOfPair(c, laid)) return null
  const gs = laid.groups.filter((b) => b.role !== 'reference')
  const [a, b] = pairOrder(c, gs)
  const [A, B] = [a?.label ?? 'A', b?.label ?? 'B']
  const noun = nounOf(c)
  if (laid.cells && d.comparisons === 'perRow')
    return `In a row where the treatment had no effect, the ${nounsOf(c)} would differ only by chance.`
  switch (d.measure) {
    case 'ranks':
      return 'If the treatment had no effect, the values of the groups would be mixed at random: none would tend to be larger.'
    case 'difference':
      return 'If the treatment had no effect, the changes would scatter around zero only by chance.'
    case 'ratio':
      return 'If the treatment had no effect, the ratios would scatter around 1 only by chance.'
    case 'signedRanks':
      return d.comparisons === 'vsValue'
        ? `If the values were centred on ${laid.reference?.label ?? 'the value you set'}, as many would lie above it as below, apart from chance.`
        : 'If the treatment had no effect, as many changes would go down as up, apart from chance.'
    case 'distribution':
      return 'If both groups came from the same distribution, their values would differ only by chance.'
    case 'separation':
      return 'If the values didn’t tell the groups apart, the area under the ROC curve would differ from one half only by chance.'
    case 'association':
      return `If ${A} and ${B} were unrelated, any association between them would be chance.`
    case 'shape':
      return 'If the values came from a normal distribution, they would depart from it only by chance (with few values the test can’t tell).'
    case 'counts':
      return 'If the expected proportions were right, the counts would differ from them only by chance.'
    case 'probability':
      return `If ${A} had no effect, the probability of “yes” would be the same at every X, apart from chance.`
    case 'predict':
      return 'If a variable had no effect, its coefficient would differ from zero only by chance.'
    case 'slope':
      return d.comparisons === 'shared' && gs.length > 1
        ? 'If the slopes were the same, the lines would differ in slope only by chance.'
        : `If Y didn’t change with ${named(c.names.xTitle, 'X')}, the slope would differ from zero only by chance.`
    case 'parameter':
      return d.comparisons === 'shared' && gs.length > 1
        ? `If the ${noun} were the same, one shared ${noun} would fit the curves as well as one each, apart from chance.`
        : null
    case 'survival':
      return 'If the treatment had no effect, the survival curves would differ only by chance.'
  }
  const nouns = nounsOf(c)
  if (laid.cells) {
    if (d.comparisons === 'perRow')
      return `In a row where the treatment had no effect, the ${nouns} would differ only by chance.`
    return `If neither factor had an effect, the cells’ ${nouns} would differ only by chance; with no interaction, the effect of ${colFactor(c)} would be the same at every level of ${rowFactor(c)}.`
  }
  if (d.comparisons === 'vsValue')
    return `If the true ${noun} were ${laid.reference?.label ?? 'the value you set'}, the observed one would differ from it only by chance.`
  if (d.comparisons === 'trend')
    return `If the order had no effect, the ${nouns} would show no steady rise or fall, apart from chance.`
  if (gs.length === 2)
    return `If the treatment had no effect, the ${nouns} of ${A} and ${B} would differ only by chance.`
  if (gs.length > 2)
    return `If the treatment had no effect, the ${nouns} of all ${gs.length} groups would differ only by chance.`
  return null
}

/** The independent units of the design ("6 subjects, not 24 values"). */
function unitsOf(c: Ctx, laid: Laid): string | null {
  const { d, facts } = c
  const values = facts.groups.reduce((s, g) => s + g.n, 0)
  if (!values) return null
  if (d.nested && facts.replicates > 1) {
    const subjects = facts.replicates * facts.groups.length
    return `Independent units: ${plural(subjects, 'subject')} (not ${plural(values, 'value')}).`
  }
  if (laid.cells && d.comparisons !== 'perRow') {
    const reps = Math.max(1, facts.replicates)
    const rows = Math.max(1, facts.rows)
    const cols = facts.groups.length
    const subjects =
      d.matched === 'columns'
        ? rows * reps
        : d.matched === 'rows'
          ? cols * reps
          : d.matched === 'both'
            ? reps
            : undefined
    if (subjects === undefined)
      return d.matched === 'no'
        ? `Independent units: ${plural(values, 'value')}, one subject each.`
        : null
    return `Independent units: ${plural(subjects, 'subject')}, not ${plural(values, 'value')}.`
  }
  if (laid.cells && d.comparisons === 'perRow' && d.matched === 'columns')
    return `Each subject is measured in both groups at every row.`
  if (!laid.cells && d.matched === 'yes' && facts.completeRows > 0 && laid.groups.length > 1)
    return `Independent units: ${plural(facts.completeRows, 'subject')}, each measured in every group.`
  return null
}

function notesOf(c: Ctx, laid: Laid, drawn: Drawn): string[] {
  const { d } = c
  const out: string[] = [...laid.left, ...drawn.notes]
  const gs = laid.groups.filter((b) => b.role !== 'reference')
  if (d.direction && d.comparisons !== 'together' && d.measure !== 'separation')
    out.push('One-tailed: the direction was predicted before the experiment.')
  if (
    !laid.cells &&
    (d.comparisons === 'allPairs' || d.comparisons === 'vsControl') &&
    drawn.count > 1
  )
    out.push(
      `${d.comparisons === 'vsControl' ? `Each group against ${gs.find((g) => g.role === 'control')?.label ?? gs[0]?.label}: ` : 'Every pair: '}${plural(drawn.count, 'comparison')}, one family${d.correction ? ` (${d.correction})` : ''}.`,
    )
  if (d.scatter && (d.measure === 'mean' || d.measure === 'logMean'))
    out.push(
      d.scatter === 'own'
        ? 'Each group keeps its own scatter (Welch).'
        : 'One pooled scatter: the groups are assumed to vary alike.',
    )
  const units = unitsOf(c, laid)
  if (units) out.push(units)
  if (d.decideBy) out.push(`Decided by ${d.decideBy}, chosen before the fit.`)
  if (d.measure === 'risk' || d.measure === 'odds') {
    const exposed = gs[c.d.exposedRow ?? 0]?.label
    const other = gs[c.d.exposedRow === 1 ? 0 : 1]?.label
    if (exposed && other)
      out.push(
        `${d.measure === 'risk' ? 'Relative risk' : 'Odds ratio'}: ${exposed} against ${other}.`,
      )
  }
  out.push(...(d.notes ?? []).filter((n) => n !== 'All comparisons form one family.'))
  return [...new Set(out)]
}

function describe(spec: Omit<SchematicSpec, 'description'>): string {
  const byId = new Map(spec.boxes.map((b) => [b.id, b]))
  const name = (id: string) => {
    const b = byId.get(id)
    if (!b) return id
    if (b.label) return b.label
    const g = spec.grid
    return g ? `${g.rowLevels[b.row] ?? ''} · ${g.columnLevels[b.column] ?? ''}` : id
  }
  const parts: string[] = [`What will be tested. ${spec.question}`]
  if (spec.grid)
    parts.push(
      `A grid of ${spec.grid.rows ?? 'rows'} (${nameList(spec.grid.rowLevels)}) by ${spec.grid.columns ?? 'columns'} (${nameList(spec.grid.columnLevels)}).`,
    )
  const labelled = spec.boxes.filter((b) => b.label)
  if (labelled.length && !spec.grid)
    parts.push(
      `Boxes: ${labelled
        .map(
          (b) =>
            `${b.label}${b.role === 'control' ? ' (control)' : b.role === 'reference' ? ' (the value set)' : ''}${b.measure ? `, ${b.measure}` : ''}`,
        )
        .join('; ')}.`,
    )
  else if (spec.grid && spec.boxes[0]?.measure) parts.push(`Each cell: ${spec.boxes[0].measure}.`)
  if (spec.arrows.length)
    parts.push(
      `Compared: ${spec.arrows
        .map((a) =>
          a.heads === 'end'
            ? `${name(a.from)} to ${name(a.to)}${a.label ? ` (${a.label})` : ''}`
            : `${name(a.from)} with ${name(a.to)}${a.label ? ` (${a.label})` : ''}`,
        )
        .join('; ')}.`,
    )
  for (const l of spec.links)
    parts.push(`Linked, ${l.label ?? 'same subjects'}: ${l.boxes.map(name).join(', ')}.`)
  if (spec.noEffect) parts.push(spec.noEffect)
  parts.push(...spec.notes)
  if (spec.pending) parts.push(spec.pending)
  return parts.join(' ')
}

/** The schematic of a design on a table with these facts. */
export function schematicSpec(
  design: SchematicDesign,
  facts: TableFacts,
  names: SchematicNames = {},
  opts: SchematicOptions = {},
): SchematicSpec {
  const outcomeIndex = design.outcomeColumn ?? 0
  const c: Ctx = {
    d: design,
    facts,
    names,
    outcome: named(facts.groups[outcomeIndex]?.title, `column ${outcomeIndex + 1}`),
  }
  const laid = layOut(c)
  // Two groups: one test of all is their comparison; one curve or line: against the value set.
  const gs = laid.groups
  let comparisons = design.comparisons
  if ((comparisons === 'none' || comparisons === 'allPairs') && gs.length === 2 && !laid.grid)
    comparisons = TESTED.has(design.measure ?? '') ? 'pair' : comparisons
  if (comparisons === 'shared' && gs.length < 2) comparisons = laid.reference ? 'vsValue' : 'none'
  if (comparisons !== design.comparisons)
    c.d = { ...design, ...(comparisons ? { comparisons } : {}) }
  // A table of counts' exposed row: the other row is the reference.
  if (design.layout === 'rows' && (design.measure === 'risk' || design.measure === 'odds')) {
    const other = laid.groups[design.exposedRow === 1 ? 0 : 1]
    if (other) other.role = 'control'
  }
  const drawn = arrowsOf(c, laid)
  const base = {
    question: questionOf(c, laid, opts.fallback),
    noEffect: noEffectOf(c, laid),
    boxes: laid.boxes,
    arrows: drawn.arrows,
    links: linksOf(c, laid),
    ...(laid.grid ? { grid: laid.grid } : {}),
    notes: notesOf(c, laid, drawn),
    ...(opts.pending ? { pending: opts.pending } : {}),
  }
  return { ...base, description: describe(base) }
}
