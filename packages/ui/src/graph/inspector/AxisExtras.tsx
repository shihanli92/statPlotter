import type { Command } from '@ps/engine'
import {
  type AxisCategories,
  axisCategories,
  BREAK_MARK,
  freshLayerId,
  isMapped,
  newLayerIndex,
  RESULT_THEME,
  seedFromNames,
  seedFromVariables,
} from '@ps/graph'
import {
  type AnalysisResult,
  type AxisSpec,
  type CategorySpan,
  type CategorySpans,
  type ContinuousAxisSpec,
  type GraphNode,
  type Layer,
  labelPlain,
  type NodeId,
  type PieceLength,
  type Project,
  type ResultStat,
  type ScaleBar,
  type StrokeStyle,
  type TextStyle,
  type TreatmentGrid,
  type TreatmentRow,
} from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import { Checkbox, NumberInput, Section, Select, TextInput } from '../../components/fields.tsx'
import { ColorRefField, StrokeFields, TextStyleFields } from '../../components/formatFields.tsx'
import type { AxisKey } from '../canvasEdit.ts'
import { effectiveText, type PanelContext } from './context.ts'
import { layerPath, setLayerStat } from './layers.ts'
import { CutoffFields, cutoffOf } from './Volcano.tsx'

// Roadmap 36: the Format axes sections of axis extras — ticks at listed values and text at
// values, broken axes with set piece lengths and break marks, scale bars, a +/− treatment grid
// (edited in its own dialog, seeded from the categories' names or a table's text variables) and
// labels spanning categories; and the Format panel of lines and bands at typed values.

type Continuous = ContinuousAxisSpec
type Categorical = Extract<AxisSpec, { type: 'categorical' }>

/** Numbers typed as a list ("0.01, 1, 100"); null when any isn't a number. */
function parseNumbers(text: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out = parts.map(Number)
  return out.every(Number.isFinite) ? out : null
}

const listText = (v: readonly number[] | undefined) => (v ?? []).join(', ')

/** Ticks at values typed in, and text at values ("1 → Monomer"). */
export function TickValuesSection({
  ctx,
  which,
  axis,
}: {
  ctx: PanelContext
  which: AxisKey
  axis: Continuous
}) {
  const set = (path: (string | number)[], v: unknown, label: string) =>
    ctx.set(['axes', which, ...path], v, label)
  const text = axis.tickText ?? []
  return (
    <Section title="Ticks at values" collapsed={!axis.tickValues && !text.length}>
      <TextInput
        label="Major ticks at (blank = automatic)"
        value={listText(axis.tickValues?.major)}
        placeholder="e.g. 0.01, 1, 100"
        onChange={(v) => {
          const major = parseNumbers(v)
          if (major === null) return ctx.onError('Type numbers separated by commas.')
          set(
            ['tickValues'],
            major.length
              ? { major, ...(axis.tickValues?.minor ? { minor: axis.tickValues.minor } : {}) }
              : undefined,
            'Tick values',
          )
        }}
      />
      {axis.tickValues && (
        <TextInput
          label="Minor ticks at"
          value={listText(axis.tickValues.minor)}
          onChange={(v) => {
            const minor = parseNumbers(v)
            if (minor === null) return ctx.onError('Type numbers separated by commas.')
            set(
              ['tickValues'],
              { major: axis.tickValues!.major, ...(minor.length ? { minor } : {}) },
              'Minor tick values',
            )
          }}
        />
      )}
      <fieldset className="field">
        <legend>Text at values</legend>
        {text.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries have no identity beyond position
          <div key={i} className="field-row">
            <NumberInput
              label="Value"
              value={t.value}
              onChange={(value) =>
                set(
                  ['tickText'],
                  text.map((x, j) => (j === i ? { ...x, value } : x)),
                  'Tick text',
                )
              }
            />
            <TextInput
              label="Text"
              value={labelPlain(t.text)}
              onChange={(s) =>
                set(
                  ['tickText'],
                  text.map((x, j) => (j === i ? { ...x, text: s } : x)),
                  'Tick text',
                )
              }
            />
            <button
              type="button"
              className="small"
              aria-label={`Remove the text at ${t.value}`}
              onClick={() => {
                const rest = text.filter((_, j) => j !== i)
                set(['tickText'], rest.length ? rest : undefined, 'Remove tick text')
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const next = text.length ? Math.max(...text.map((t) => t.value)) + 1 : 1
            set(
              ['tickText'],
              [...text, { value: next, text: `Label ${text.length + 1}` }],
              'Add tick text',
            )
          }}
        >
          Add text at a value
        </button>
        <p className="muted">
          Without listed ticks, the ticks are at these values alone (e.g. 1 → Monomer … 5 →
          Pentamer).
        </p>
      </fieldset>
    </Section>
  )
}

/** A piece's length as typed: blank (in proportion), a fraction (0.5) or points ("40 pt"). */
const pieceText = (p: PieceLength | null | undefined) =>
  !p ? '' : p.unit === 'pt' ? `${p.value} pt` : String(p.value)
function parsePiece(text: string): PieceLength | null | 'bad' {
  const t = text.trim()
  if (!t) return null
  const pt = /^([\d.]+)\s*pt$/i.exec(t)
  if (pt) return Number(pt[1]) > 0 ? { value: Number(pt[1]), unit: 'pt' } : 'bad'
  const pc = /^([\d.]+)\s*%$/.exec(t)
  const v = pc ? Number(pc[1]) / 100 : Number(t)
  return v > 0 && v < 1 ? { value: v, unit: 'fraction' } : 'bad'
}

/** Breaks of an axis: several, each piece's length, the marks at them. */
export function BreaksSection({
  ctx,
  which,
  axis,
}: {
  ctx: PanelContext
  which: AxisKey
  axis: Continuous
}) {
  const set = (path: (string | number)[], v: unknown, label: string) =>
    ctx.set(['axes', which, ...path], v, label)
  const br = axis.breaks
  const setBreaks = (v: Continuous['breaks'], label: string) => {
    ctx.dispatch(
      [
        { type: 'node.set', id: ctx.graph.id, path: ['axes', which, 'breaks'], value: v },
        // Piece lengths are by position: they go when the breaks change in number.
        ...(v.length !== br.length && axis.pieces
          ? [
              {
                type: 'node.set' as const,
                id: ctx.graph.id,
                path: ['axes', which, 'pieces'],
                value: undefined,
              },
            ]
          : []),
      ],
      label,
    )
  }
  const pieces = Array.from({ length: br.length + 1 }, (_, i) => axis.pieces?.[i] ?? null)
  const mark = axis.breakMark ?? {}
  const range = axis.range !== 'auto' ? axis.range : { min: 0, max: 100 }
  const newBreak = () => {
    const last = br.at(-1)
    const lo = last ? last.to : range.min
    const span = range.max - lo
    return { from: lo + span * 0.4, to: lo + span * 0.6, gap: 8 }
  }
  return (
    <Section title="Axis breaks" collapsed={!br.length}>
      <p className="muted">
        Leave out stretches of the axis (e.g. between two clusters of values).
      </p>
      {br.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: breaks have no identity beyond position
        <div key={i} className="field-row">
          <NumberInput
            label="From"
            value={b.from}
            onChange={(from) =>
              from < b.to
                ? setBreaks(
                    br.map((x, j) => (j === i ? { ...x, from } : x)),
                    'Axis break',
                  )
                : ctx.onError('“From” must be below “To”.')
            }
          />
          <NumberInput
            label="To"
            value={b.to}
            onChange={(to) =>
              to > b.from
                ? setBreaks(
                    br.map((x, j) => (j === i ? { ...x, to } : x)),
                    'Axis break',
                  )
                : ctx.onError('“To” must be above “From”.')
            }
          />
          <NumberInput
            label="Gap (pt)"
            value={b.gap}
            min={0}
            max={72}
            onChange={(gap) =>
              setBreaks(
                br.map((x, j) => (j === i ? { ...x, gap } : x)),
                'Axis break',
              )
            }
          />
          <button
            type="button"
            className="small"
            aria-label={`Remove break ${i + 1}`}
            onClick={() =>
              setBreaks(
                br.filter((_, j) => j !== i),
                'Remove axis break',
              )
            }
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setBreaks([...br, newBreak()], 'Add axis break')}>
        {br.length ? 'Add another break' : 'Add a break'}
      </button>
      {br.length > 0 && (
        <>
          <fieldset className="field">
            <legend>Length of each piece, from the low end (blank: in proportion)</legend>
            <div className="field-row">
              {pieces.map((p, i) => (
                <TextInput
                  // biome-ignore lint/suspicious/noArrayIndexKey: pieces are by position
                  key={i}
                  label={`Piece ${i + 1}`}
                  value={pieceText(p)}
                  placeholder="0.5, 50%, 40 pt"
                  onChange={(t) => {
                    const v = parsePiece(t)
                    if (v === 'bad')
                      return ctx.onError('A fraction of the axis (0.5 or 50%) or points (40 pt).')
                    const next = pieces.map((x, j) => (j === i ? v : x))
                    set(['pieces'], next.some((x) => x) ? next : undefined, 'Piece length')
                  }}
                />
              ))}
            </div>
          </fieldset>
          <div className="field-row">
            <Select
              label="Marks"
              value={mark.style ?? 'slash'}
              options={[
                { value: 'slash', label: '// at both edges' },
                { value: 'zigzag', label: 'Zigzag' },
                { value: 'gap', label: 'Plain gap' },
              ]}
              onChange={(style) =>
                set(
                  ['breakMark'],
                  style === 'slash' && mark.size === undefined ? undefined : { ...mark, style },
                  'Break marks',
                )
              }
            />
            <NumberInput
              label="Mark size (pt)"
              value={mark.size ?? BREAK_MARK}
              min={0}
              max={36}
              step={0.5}
              onChange={(size) => set(['breakMark'], { ...mark, size }, 'Break mark size')}
            />
          </div>
        </>
      )}
    </Section>
  )
}

const CORNERS = [
  { value: 'bottomLeft', label: 'Bottom left' },
  { value: 'bottomRight', label: 'Bottom right' },
  { value: 'topLeft', label: 'Top left' },
  { value: 'topRight', label: 'Top right' },
  { value: 'data', label: 'At a data position' },
] as const

/** A scale bar of a set length in data units, optionally in place of the axis. */
export function ScaleBarSection({
  ctx,
  which,
  axis,
}: {
  ctx: PanelContext
  which: AxisKey
  axis: Continuous
}) {
  const bar = axis.scaleBar
  const set = (v: ScaleBar | undefined, label: string) =>
    ctx.set(['axes', which, 'scaleBar'], v, label)
  const place = bar?.place ?? 'bottomRight'
  return (
    <Section title="Scale bar" collapsed={!bar}>
      <Checkbox
        label="Show a scale bar"
        checked={!!bar && bar.show !== false}
        onChange={(v) =>
          set(
            v ? { ...(bar ?? { length: defaultBarLength(axis) }), show: undefined } : undefined,
            v ? 'Add scale bar' : 'Remove scale bar',
          )
        }
      />
      {bar && (
        <>
          <div className="field-row">
            <NumberInput
              label="Length (data units)"
              value={bar.length}
              min={0}
              onChange={(length) =>
                length > 0
                  ? set({ ...bar, length }, 'Scale bar length')
                  : ctx.onError('The length must be above zero.')
              }
            />
            <TextInput
              label="Label (blank: the length and the title’s unit)"
              value={bar.label === undefined ? '' : labelPlain(bar.label)}
              onChange={(t) => {
                const { label: _, ...rest } = bar
                set(t.trim() ? { ...rest, label: t } : rest, 'Scale bar label')
              }}
            />
          </div>
          <Select
            label="Where"
            value={typeof place === 'string' ? place : 'data'}
            options={CORNERS}
            onChange={(v) =>
              set({ ...bar, place: v === 'data' ? { x: 0, y: 0 } : v }, 'Move scale bar')
            }
          />
          {typeof place === 'object' && (
            <div className="field-row">
              <NumberInput
                label="X"
                value={place.x}
                onChange={(x) => set({ ...bar, place: { ...place, x } }, 'Move scale bar')}
              />
              <NumberInput
                label="Y"
                value={place.y}
                onChange={(y) => set({ ...bar, place: { ...place, y } }, 'Move scale bar')}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() =>
              ctx.dispatch(
                [
                  {
                    type: 'node.set',
                    id: ctx.graph.id,
                    path: ['axes', which, 'show'],
                    value: false,
                  },
                  {
                    type: 'node.set',
                    id: ctx.graph.id,
                    path: ['axes', which, 'title'],
                    value: null,
                  },
                ],
                'Scale bar instead of the axis',
              )
            }
          >
            Hide the axis (the scale bar in its place)
          </button>
        </>
      )}
    </Section>
  )
}

/** A round length about a fifth of the axis' range. */
function defaultBarLength(axis: Continuous): number {
  const span = axis.range !== 'auto' ? axis.range.max - axis.range.min : 10
  const raw = Math.abs(span) / 5 || 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag
}

// --- Treatment grids ---------------------------------------------------------------------------

/** The categories a grid has cells for: bars (grid by bar on a grouped graph), else groups. */
const gridColumns = (cats: AxisCategories, grid: Pick<TreatmentGrid, 'by'> | undefined) =>
  grid?.by === 'bar' && cats.bars.length
    ? cats.bars.map((b) => ({
        key: b.key,
        title: `${cats.groups.find((g) => g.key === b.group)?.title ?? ''} · ${b.title}`,
      }))
    : cats.groups

/** The editable grid: rows of treatments, a cell per category; seeded on request. */
export function TreatmentGridDialog({
  project,
  graph,
  lookup,
  onApply,
  onClose,
}: {
  project: Project
  graph: GraphNode
  lookup: (id: NodeId) => AnalysisResult | undefined
  onApply: (grid: TreatmentGrid | undefined) => void
  onClose: () => void
}) {
  const axis = graph.axes.x as Categorical
  const cats = axisCategories(project, graph, lookup)
  const [grid, setGrid] = useState<TreatmentGrid>(() => axis.treatments ?? { rows: [] })
  const [note, setNote] = useState<string | null>(null)
  const cols = gridColumns(cats, grid)
  const setRows = (rows: TreatmentRow[]) => setGrid({ ...grid, rows })
  const setCell = (ri: number, key: string, v: string) =>
    setRows(grid.rows.map((r, i) => (i === ri ? { ...r, cells: { ...r.cells, [key]: v } } : r)))
  const cycle = (v: string | undefined) => (v === '+' ? '-' : v === '-' || v === '−' ? '' : '+')
  const seedNames = () => {
    const rows = seedFromNames(cols)
    if (!rows)
      setNote('The names don’t read as combinations of treatments: start from an empty row.')
    else {
      setRows(rows)
      setNote(`Seeded ${rows.length} row${rows.length === 1 ? '' : 's'} from the names.`)
    }
  }
  const seedVars = () => {
    const rows = seedFromVariables(project, graph, grid.by ?? 'group', lookup)
    if (!rows) setNote('No other text variable takes one value in each category.')
    else {
      setRows(rows)
      setNote(
        `Seeded ${rows.length} row${rows.length === 1 ? '' : 's'} from the table’s text variables.`,
      )
    }
  }
  return (
    <Dialog
      title="Treatment grid"
      wide
      onClose={onClose}
      okLabel="OK"
      onOk={() => {
        onApply(grid.rows.length ? grid : undefined)
        onClose()
      }}
    >
      <p className="muted">
        A row per treatment, a cell per category: click a cell to cycle +, −, blank, or type any
        short text. Cells follow their categories when they are reordered.
      </p>
      <div className="field-row">
        <button type="button" onClick={seedNames}>
          Seed from the category names
        </button>
        {isMapped(graph) && (
          <button type="button" onClick={seedVars}>
            Seed from the table’s text variables
          </button>
        )}
        {cats.bars.length > 0 && (
          <Select
            label="A cell for each"
            value={grid.by ?? 'group'}
            options={[
              { value: 'group', label: 'Group' },
              { value: 'bar', label: 'Bar within a group' },
            ]}
            onChange={(by) => setGrid({ ...grid, by: by === 'group' ? undefined : by })}
          />
        )}
      </div>
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      <table className="treatment-grid">
        <thead>
          <tr>
            <th>Treatment</th>
            {cols.map((c) => (
              // Roadmap 41: a long level name is cut short, whole in its tooltip.
              <th key={c.key} scope="col" title={c.title}>
                {c.title}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are by position
            <tr key={ri}>
              <td>
                <input
                  type="text"
                  aria-label={`Row ${ri + 1} title`}
                  value={labelPlain(row.title)}
                  onChange={(e) =>
                    setRows(
                      grid.rows.map((r, i) => (i === ri ? { ...r, title: e.target.value } : r)),
                    )
                  }
                />
              </td>
              {cols.map((c) => (
                <td key={c.key}>
                  <input
                    type="text"
                    className="treatment-cell"
                    aria-label={`${labelPlain(row.title) || `Row ${ri + 1}`}, ${c.title}`}
                    value={row.cells[c.key] ?? ''}
                    maxLength={40}
                    onChange={(e) => setCell(ri, c.key, e.target.value)}
                    onDoubleClick={() => setCell(ri, c.key, cycle(row.cells[c.key]))}
                    onKeyDown={(e) => {
                      if (e.key === ' ' && !(row.cells[c.key] ?? '').trim()) {
                        e.preventDefault()
                        setCell(ri, c.key, cycle(row.cells[c.key]))
                      }
                    }}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="small"
                  aria-label={`Remove row ${ri + 1}`}
                  onClick={() => setRows(grid.rows.filter((_, i) => i !== ri))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() =>
          setRows([
            ...grid.rows,
            {
              title: `Treatment ${grid.rows.length + 1}`,
              cells: Object.fromEntries(cols.map((c) => [c.key, '-'])),
            },
          ])
        }
      >
        Add a row
      </button>
      {!cols.length && <p className="muted">This graph has no categories.</p>}
    </Dialog>
  )
}

/** The grid's options in Format axes, and a button opening its editor. */
export function TreatmentGridSection({ ctx, axis }: { ctx: PanelContext; axis: Categorical }) {
  const [editing, setEditing] = useState(false)
  const grid = axis.treatments
  const set = (patch: Partial<TreatmentGrid> | undefined, label: string) =>
    ctx.set(['axes', 'x', 'treatments'], patch && grid ? { ...grid, ...patch } : patch, label)
  return (
    <Section title="Treatment grid (+/−)" collapsed={!grid}>
      <button type="button" onClick={() => setEditing(true)}>
        {grid ? 'Edit the grid…' : 'Add a treatment grid…'}
      </button>
      {grid && (
        <>
          <Checkbox
            label="Show the grid"
            checked={grid.show !== false}
            onChange={(v) => set({ show: v ? undefined : false }, 'Show treatment grid')}
          />
          <Select
            label="Symbols"
            value={grid.symbols ?? 'plusMinus'}
            options={[
              { value: 'plusMinus', label: '+ and −' },
              { value: 'dots', label: '● and ○' },
              { value: 'check', label: '✓ and blank' },
            ]}
            onChange={(s) => set({ symbols: s === 'plusMinus' ? undefined : s }, 'Grid symbols')}
          />
          <Select
            label="Category names"
            value={grid.names ?? 'hidden'}
            options={[
              { value: 'hidden', label: 'Hidden (the grid instead)' },
              { value: 'above', label: 'Kept above the grid' },
            ]}
            onChange={(n) => set({ names: n === 'hidden' ? undefined : n }, 'Category names')}
          />
          <Select
            label="Row titles"
            value={grid.titles ?? 'start'}
            options={[
              { value: 'start', label: 'Before the categories (left / top)' },
              { value: 'end', label: 'After them (right / bottom)' },
            ]}
            onChange={(t) => set({ titles: t === 'start' ? undefined : t }, 'Row titles')}
          />
          <NumberInput
            label="Row spacing (pt, 0 = automatic)"
            value={grid.rowSpacing ?? 0}
            min={0}
            max={72}
            onChange={(v) => set({ rowSpacing: v > 0 ? v : undefined }, 'Row spacing')}
          />
          <StrokeFields
            label="Lines between rows"
            value={grid.lines}
            palette={ctx.palette}
            optional={{ defaults: { color: { rgb: '#bfbfbf' }, width: 0.5, dash: 'solid' } }}
            onChange={(lines) => set({ lines }, 'Grid lines')}
          />
          <TextStyleFields
            value={grid.text}
            inherited={effectiveText(ctx, ctx.theme.tickLabel, axis.tickLabels)}
            palette={ctx.palette}
            onChange={(text) => set({ text }, 'Grid font')}
          />
          <button
            type="button"
            className="danger"
            onClick={() => set(undefined, 'Remove treatment grid')}
          >
            Remove the grid
          </button>
        </>
      )}
      {editing && (
        <TreatmentGridDialog
          project={ctx.project}
          graph={ctx.graph}
          lookup={ctx.lookup}
          onApply={(g) => ctx.set(['axes', 'x', 'treatments'], g, 'Treatment grid')}
          onClose={() => setEditing(false)}
        />
      )}
    </Section>
  )
}

// --- Spans of categories -----------------------------------------------------------------------

/** Labels spanning categories: from the data (grouped graphs), renamed, typed by hand. */
export function SpansSection({ ctx, axis }: { ctx: PanelContext; axis: Categorical }) {
  const spans = axis.spans
  const cats = axisCategories(ctx.project, ctx.graph, ctx.lookup)
  const set = (patch: Partial<CategorySpans> | undefined, label: string) =>
    ctx.set(['axes', 'x', 'spans'], patch ? { ...spans, ...patch } : undefined, label)
  const grouped = cats.bars.length > 0
  const list = spans?.list ?? []
  const choices = [...cats.groups, ...cats.bars.map((b) => ({ key: b.key, title: b.title }))]
  const setList = (next: CategorySpan[], label: string) =>
    set({ list: next.length ? next : undefined }, label)
  return (
    <Section title="Labels spanning categories" collapsed={!spans}>
      <Checkbox
        label={
          grouped ? 'Two-level labels (each group spanning its bars)' : 'Labels spanning categories'
        }
        checked={!!spans && spans.show !== false}
        onChange={(v) =>
          set(
            v ? { show: undefined } : undefined,
            v ? 'Two-level labels' : 'Remove spanning labels',
          )
        }
      />
      {spans && (
        <>
          {grouped && (
            <Checkbox
              label="Groups from the data (names under each bar)"
              checked={spans.auto !== false}
              onChange={(v) => set({ auto: v ? undefined : false }, 'Spans from the data')}
            />
          )}
          {grouped &&
            spans.auto !== false &&
            cats.groups.map((g) => (
              <TextInput
                key={g.key}
                label={`“${g.title}” shown as`}
                value={
                  spans.rename?.[g.key] === undefined ? g.title : labelPlain(spans.rename[g.key])
                }
                onChange={(t) => {
                  const { [g.key]: _, ...rest } = spans.rename ?? {}
                  const rename = t === g.title ? rest : { ...rest, [g.key]: t }
                  set({ rename: Object.keys(rename).length ? rename : undefined }, 'Rename group')
                }}
              />
            ))}
          <Select
            label="Over each span"
            value={spans.mark ?? 'line'}
            options={[
              { value: 'line', label: 'A line' },
              { value: 'bracket', label: 'A bracket' },
              { value: 'none', label: 'Nothing' },
            ]}
            onChange={(mark) => set({ mark: mark === 'line' ? undefined : mark }, 'Span mark')}
          />
          <fieldset className="field">
            <legend>Spans typed by hand</legend>
            {list.map((span, si) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: spans are by position
              <fieldset key={si} className="field">
                <div className="field-row">
                  <TextInput
                    label="Label"
                    value={labelPlain(span.label)}
                    onChange={(t) =>
                      setList(
                        list.map((s, j) => (j === si ? { ...s, label: t } : s)),
                        'Span label',
                      )
                    }
                  />
                  <Select
                    label="Level"
                    value={span.level ?? 0}
                    options={[
                      { value: 0, label: 'Next free' },
                      { value: 1, label: '1 (under the names)' },
                      { value: 2, label: '2' },
                      { value: 3, label: '3' },
                    ]}
                    onChange={(level) => {
                      const { level: _, ...rest } = span
                      setList(
                        list.map((s, j) =>
                          j === si ? (level ? { ...rest, level: level as 1 | 2 | 3 } : rest) : s,
                        ),
                        'Span level',
                      )
                    }}
                  />
                  <button
                    type="button"
                    className="small"
                    aria-label={`Remove span ${si + 1}`}
                    onClick={() =>
                      setList(
                        list.filter((_, j) => j !== si),
                        'Remove span',
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
                <div className="checklist">
                  {choices.map((c) => (
                    <Checkbox
                      key={c.key}
                      label={c.title}
                      checked={span.keys.includes(c.key)}
                      onChange={(v) => {
                        const keys = v
                          ? [...span.keys, c.key]
                          : span.keys.filter((k) => k !== c.key)
                        if (!keys.length) return ctx.onError('A span covers one category or more.')
                        setList(
                          list.map((s, j) => (j === si ? { ...s, keys } : s)),
                          'Span categories',
                        )
                      }}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={!choices.length}
              onClick={() =>
                setList(
                  [
                    ...list,
                    {
                      label: `Group ${list.length + 1}`,
                      keys: choices.slice(0, 2).map((c) => c.key),
                    },
                  ],
                  'Add span',
                )
              }
            >
              Add a span
            </button>
          </fieldset>
          <TextStyleFields
            value={spans.text}
            inherited={effectiveText(ctx, ctx.theme.tickLabel, axis.tickLabels)}
            palette={ctx.palette}
            onChange={(text) => set({ text }, 'Span font')}
          />
        </>
      )}
    </Section>
  )
}

// --- Lines and bands at typed values -----------------------------------------------------------

/** A line at a value (or a band between two) of an axis, typed in: a layer with `values` data. */
export function typedLayer(
  graph: Pick<GraphNode, 'layers'>,
  kind: 'line' | 'band',
  values: readonly number[],
  axis: 'x' | 'y' = 'y',
): Layer {
  const num = (v: number) => ({ ref: { from: 'number' as const, v } })
  const stat: ResultStat =
    kind === 'line'
      ? { kind: 'result', fields: { at: num(values[0]!) }, at: 'at' }
      : { kind: 'result', fields: { lo: num(values[0]!), hi: num(values[1]!) }, lo: 'lo', hi: 'hi' }
  return {
    id: freshLayerId(kind === 'line' ? 'line' : 'band', graph.layers),
    geom: kind === 'line' ? 'refline' : 'band',
    stat: axis === 'x' ? { ...stat, axis: 'x' } : stat,
    data: { from: 'values' },
    legend: 'hide',
  } as Layer
}

/** The command adding a typed line or band where its kind goes (fills behind, lines in front). */
export const addTypedLayer = (graph: GraphNode, layer: Layer): Command => ({
  type: 'graph.addLayer',
  id: graph.id,
  layer,
  at: newLayerIndex(graph.layers, layer),
})

type TypedLayer = Layer & { stat: ResultStat; data: { from: 'values' } }

/**
 * Roadmap 46b: a band's stat shading between two values (`values`), between −c and +c, or beyond
 * ±c: c is the band's value (`at`; from its two values, the larger's size), the two values kept.
 */
function mirrorBand(stat: ResultStat, v: 'values' | 'between' | 'outside'): Partial<ResultStat> {
  const num = (name: string | undefined) => {
    const ref = name === undefined ? undefined : stat.fields[name]?.ref
    return ref?.from === 'number' ? ref.v : 0
  }
  if (v === 'values') {
    // Back to two values: −c and +c unless it has its own.
    const c = Math.abs(num(stat.at))
    const has = stat.lo !== undefined && stat.hi !== undefined
    return {
      mirror: undefined,
      outside: undefined,
      ...(has
        ? {}
        : {
            fields: {
              ...stat.fields,
              lo: { ref: { from: 'number', v: -c } },
              hi: { ref: { from: 'number', v: c } },
            },
            lo: 'lo',
            hi: 'hi',
          }),
    }
  }
  const c =
    stat.at !== undefined && stat.fields[stat.at]
      ? Math.abs(num(stat.at))
      : Math.max(Math.abs(num(stat.lo)), Math.abs(num(stat.hi)))
  return {
    mirror: true,
    outside: v === 'outside' || undefined,
    fields: { ...stat.fields, at: { ref: { from: 'number', v: c } } },
    at: 'at',
  }
}

/** The Format panel of a line or band at typed values: values, axis, label, look. */
export function TypedValuesPanel({ ctx, layer }: { ctx: PanelContext; layer: TypedLayer }) {
  const stat = layer.stat
  const band = layer.geom === 'band'
  const style = (layer.style ?? {}) as Record<string, unknown>
  const setStat = (patch: Partial<ResultStat>, label: string) =>
    setLayerStat(ctx, layer, patch, label)
  const setStyle = (name: string, v: unknown, label: string) =>
    ctx.set(layerPath(layer.id, 'style', name), v, label)
  const typedValue = (name: string | undefined) => {
    const ref = name === undefined ? undefined : stat.fields[name]?.ref
    return ref?.from === 'number' ? ref.v : 0
  }
  // A value the stat names already writes its field alone (quick edits of one field merge into
  // one step, never with another field's: the panel's steps are by path).
  const setValue = (name: 'at' | 'lo' | 'hi', v: number, label: string) =>
    stat[name] === name && stat.fields[name]
      ? ctx.set(layerPath(layer.id, 'stat', 'fields', name), { ref: { from: 'number', v } }, label)
      : setStat(
          { fields: { ...stat.fields, [name]: { ref: { from: 'number', v } } }, [name]: name },
          label,
        )
  // Roadmap 46b: a line (band) at one of the graph's cut-offs edits the shared value.
  const cutoff = cutoffOf(layer)
  return (
    <>
      <Section title={band ? 'Band' : 'Line'}>
        {band && !cutoff && (
          <Select
            label="Shade"
            value={stat.mirror ? (stat.outside ? 'outside' : 'between') : 'values'}
            options={[
              { value: 'values', label: 'Between two values' },
              { value: 'between', label: 'Between −c and +c' },
              { value: 'outside', label: 'Beyond ±c (outside)' },
            ]}
            onChange={(v) => setStat(mirrorBand(stat, v), 'Band shading')}
          />
        )}
        {cutoff ? (
          <CutoffFields ctx={ctx} only={cutoff} />
        ) : band && stat.mirror ? (
          <NumberInput
            label="At ± (c)"
            value={typedValue(stat.at)}
            onChange={(v) => setValue('at', v, 'Band value')}
          />
        ) : band ? (
          <div className="field-row">
            <NumberInput
              label="From"
              value={typedValue(stat.lo)}
              onChange={(v) => setValue('lo', v, 'Band from')}
            />
            <NumberInput
              label="To"
              value={typedValue(stat.hi)}
              onChange={(v) => setValue('hi', v, 'Band to')}
            />
          </div>
        ) : (
          <>
            <NumberInput
              label={stat.mirror ? 'At ± (c)' : 'At'}
              value={typedValue(stat.at)}
              onChange={(v) => setValue('at', v, 'Line value')}
            />
            <Checkbox
              label="± (lines at −c and +c)"
              checked={!!stat.mirror}
              onChange={(v) =>
                ctx.set(
                  layerPath(layer.id, 'stat', 'mirror'),
                  v || undefined,
                  v ? 'Line at ±' : 'One line',
                )
              }
            />
          </>
        )}
        {ctx.graph.frame === 'xy' && (
          <Select
            label="Along"
            value={stat.axis ?? 'y'}
            options={[
              {
                value: 'y',
                label: band ? 'Between Y values (across the plot)' : 'A Y value (across the plot)',
              },
              {
                value: 'x',
                label: band ? 'Between X values (up the plot)' : 'An X value (up the plot)',
              },
            ]}
            onChange={(v) => setStat({ axis: v === 'x' ? 'x' : undefined }, 'Line direction')}
          />
        )}
        {band ? (
          <>
            <ColorRefField
              label="Colour"
              value={style.color as never}
              palette={ctx.palette}
              fallback={RESULT_THEME.grey}
              onChange={(c) => setStyle('color', c, 'Band colour')}
            />
            <NumberInput
              label="Opacity"
              value={(style.opacity as number | undefined) ?? RESULT_THEME.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(o) => setStyle('opacity', o, 'Band opacity')}
            />
          </>
        ) : (
          <StrokeFields
            label="Line"
            value={
              {
                ...RESULT_THEME.line,
                color: { rgb: RESULT_THEME.grey },
                ...(style.line as Partial<StrokeStyle>),
              } as StrokeStyle
            }
            palette={ctx.palette}
            onChange={(v) => setStyle('line', v, 'Format line')}
          />
        )}
      </Section>
      <Section title="Label">
        <TextInput
          label="Text"
          value={labelPlain(stat.template)}
          onChange={(t) =>
            setStat(
              {
                template: t.trim() ? t : undefined,
                lineLabel: t.trim() ? (stat.lineLabel ?? 'end') : undefined,
              },
              'Line label',
            )
          }
        />
        <Select
          label="Where"
          value={stat.lineLabel ?? 'none'}
          options={[
            { value: 'none', label: 'Not shown' },
            { value: 'start', label: 'At its start' },
            { value: 'end', label: 'At its end' },
          ]}
          onChange={(v) => setStat({ lineLabel: v === 'none' ? undefined : v }, 'Line label place')}
        />
        <TextStyleFields
          value={style.text as Partial<TextStyle> | undefined}
          inherited={effectiveText(ctx, ctx.theme.pointLabel)}
          palette={ctx.palette}
          onChange={(t) => setStyle('text', t, 'Label text style')}
        />
      </Section>
    </>
  )
}
