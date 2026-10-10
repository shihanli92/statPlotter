import type { LegendItem } from '@ps/graph'
import { labelRuns, richPlain } from '@ps/model'
import { type KeyboardEvent, useState } from 'react'
import { Checkbox, NumberInput, Section, Select } from '../../components/fields.tsx'
import {
  FillFields,
  RichTextField,
  StrokeFields,
  THIN_BORDER,
} from '../../components/formatFields.tsx'
import { entryOf, type FormatTarget } from '../format/route.ts'
import {
  entriesMovedBy,
  entriesShownCommand,
  entryDropped,
  fillCommand,
  groupItems,
  labelCommand,
  legendColumns,
  moveEntriesCommand,
  orderCommand,
  reverseCommand,
  shownEntries,
  shownLabel,
} from '../legendEdits.ts'
import { effectiveText, type PanelContext } from './context.ts'
import { graphSeries } from './layers.ts'
import { COMMON_TEXT, OTHER_TEXT, TextParts, textLabels } from './textParts.tsx'

// Roadmap 46 (stage 2): the legend's place — Common (shown or not, where, its grid, its text's
// font, size and bold), then its Entries, the rest of its Text and its Box. Roadmap 47b: the
// grid's columns at every position and its fill; Entries lists every entry (data sets, curves,
// functions, Significance classes, result lines, categories, the guides of mapped variables in
// their groups) to drag or move with Alt+↑ / ↓, show or hide and label on the legend alone; a
// legend entry selected on the canvas heads its data set's place with its legend-only actions.

const LEGEND_TEXT = textLabels('Legend text')

/** The legend's entries as laid out, else (no host scene) its data sets. */
export function legendItemsOf(ctx: PanelContext): readonly LegendItem[] {
  if (ctx.legend) return ctx.legend
  const hidden = new Set(ctx.graph.legend.hidden ?? [])
  return graphSeries(ctx.project, ctx.graph, ctx.lookup).map((e) => ({
    key: e.key,
    group: 'dataSets',
    label: e.title || '(untitled)',
    hidden: hidden.has(e.key),
  }))
}

/** An entry's own label as plain text. */
const plainLabel = (e: LegendItem) => richPlain(labelRuns(e.label)) || '(untitled)'

/** One of the legend's sections: Common, Entries, Text, Box. */
export function LegendPanel({
  ctx,
  part,
}: {
  ctx: PanelContext
  part: 'common' | 'entries' | 'text' | 'box'
}) {
  const { graph, theme, palette } = ctx
  const legend = graph.legend
  const set = (path: (string | number)[], v: unknown, label = 'Format legend') =>
    ctx.set(['legend', ...path], v, label)
  const inside = legend.inside ?? { x: 0.65, y: 0.05 }
  const items = legendItemsOf(ctx)
  if (part === 'common') {
    const n = shownEntries(items)
    return (
      <Section title="Common">
        <Checkbox
          label="Show legend"
          checked={legend.show}
          onChange={(v) => set(['show'], v, v ? 'Show legend' : 'Hide legend')}
        />
        <Select
          label="Position"
          value={legend.position}
          options={[
            { value: 'right', label: 'Right of the graph' },
            { value: 'top', label: 'Above the graph' },
            { value: 'inside', label: 'Inside the plot (drag it to place)' },
          ]}
          onChange={(v) => set(['position'], v, 'Move legend')}
        />
        {legend.position === 'inside' && (
          <div className="field-row">
            <NumberInput
              label="Left (0–1 of plot)"
              value={+inside.x.toFixed(3)}
              min={-0.5}
              max={1.5}
              step={0.05}
              onChange={(x) => set(['inside'], { ...inside, x }, 'Move legend')}
            />
            <NumberInput
              label="Top (0–1 of plot)"
              value={+inside.y.toFixed(3)}
              min={-0.5}
              max={1.5}
              step={0.05}
              onChange={(y) => set(['inside'], { ...inside, y }, 'Move legend')}
            />
          </div>
        )}
        <div className="field-row">
          <NumberInput
            label="Columns"
            value={legendColumns(legend, n)}
            min={1}
            max={Math.max(1, n)}
            step={1}
            onChange={(c) => set(['columns'], Math.max(1, Math.round(c)), 'Legend columns')}
          />
          <Select
            label="Fill"
            value={legend.fill ?? 'rows'}
            options={[
              { value: 'rows', label: 'Across rows' },
              { value: 'columns', label: 'Down columns' },
            ]}
            onChange={(v) => ctx.dispatch(fillCommand(graph, v), 'Legend fill')}
          />
        </div>
        <TextParts
          parts={COMMON_TEXT}
          labels={LEGEND_TEXT}
          value={legend.text}
          inherited={effectiveText(ctx, theme.legend)}
          palette={palette}
          onChange={(s) => set(['text'], s)}
        />
      </Section>
    )
  }
  if (part === 'entries')
    return (
      <Section title="Entries">
        <Checkbox
          label="Reverse the order of entries (each data set’s and each variable’s)"
          checked={!!legend.reverse}
          onChange={(v) => ctx.dispatch(reverseCommand(graph, items, v), 'Reverse legend')}
        />
        <EntryList ctx={ctx} items={items} />
        <p className="muted">
          Drag an entry, or Alt+↑ / ↓ on its handle, to change the legend’s order (the graph’s
          drawing order stays). A label here shows on this legend only: the data set keeps its name.
          Double-click an entry on the graph to edit its label there.
        </p>
      </Section>
    )
  if (part === 'text')
    return (
      <Section title="Text">
        <TextParts
          parts={OTHER_TEXT}
          labels={LEGEND_TEXT}
          value={legend.text}
          inherited={effectiveText(ctx, theme.legend)}
          palette={palette}
          reset
          onChange={(s) => set(['text'], s)}
        />
      </Section>
    )
  return (
    <Section title="Box">
      <StrokeFields
        label="Border"
        value={legend.border}
        palette={palette}
        optional={{ defaults: THIN_BORDER }}
        onChange={(s) => set(['border'], s)}
      />
      <FillFields
        label="Background"
        value={legend.background}
        palette={palette}
        onChange={(f) => set(['background'], f)}
      />
    </Section>
  )
}

/**
 * Every entry of the legend in its order, headings between its groups: a handle to drag (or
 * Alt+↑ / ↓ on it) within the entry's group, a box showing it, its legend-only label.
 */
function EntryList({ ctx, items }: { ctx: PanelContext; items: readonly LegendItem[] }) {
  const { graph } = ctx
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null)
  const textStyle = effectiveText(ctx, ctx.theme.legend, graph.legend.text)
  const move = (key: string, by: 1 | -1) => {
    const m = moveEntriesCommand(graph, items, [key], by)
    if (m) ctx.dispatch(m.command, m.label)
  }
  const onHandleKey = (e: KeyboardEvent, key: string) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    move(key, e.key === 'ArrowUp' ? -1 : 1)
  }
  const groupOf = (key: string | null) => items.find((e) => e.key === key)?.group
  return (
    <ul className="legend-entries" aria-label="Legend entries, in the legend’s order">
      {items.map((e, i) => {
        if (e.fixed)
          return typeof e.label === 'string' && !e.label ? null : (
            <li key={`${e.group}/${e.key}`} className="legend-entry-heading muted">
              {plainLabel(e)}
            </li>
          )
        const name = plainLabel(e)
        const group = groupItems(items, e.group)
        const first = group[0]?.key === e.key
        const last = group[group.length - 1]?.key === e.key
        const droppable = dragging !== null && dragging !== e.key && groupOf(dragging) === e.group
        return (
          <li
            key={e.key}
            className={`legend-entry-row ${e.hidden ? 'hidden-entry' : ''} ${
              over?.key === e.key ? (over.after ? 'drop-after' : 'drop-before') : ''
            }`}
            data-entry={e.key}
            onDragOver={(ev) => {
              if (!droppable) return
              ev.preventDefault()
              const r = ev.currentTarget.getBoundingClientRect()
              const after = ev.clientY >= r.top + r.height / 2
              if (over?.key !== e.key || over.after !== after) setOver({ key: e.key, after })
            }}
            onDragLeave={() => setOver((o) => (o?.key === e.key ? null : o))}
            onDrop={(ev) => {
              ev.preventDefault()
              const from = dragging
              const after = over?.key === e.key ? over.after : false
              setDragging(null)
              setOver(null)
              if (!from || !droppable) return
              const seq = entryDropped(items, from, e.key, after)
              if (seq) ctx.dispatch(orderCommand(graph, seq), 'Move legend entry')
            }}
          >
            <button
              type="button"
              className="grip"
              draggable
              aria-label={`Move “${name}” (Alt+↑ or ↓)`}
              title="Drag, or Alt+↑ / ↓, to move it in the legend"
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-disabled={first && last}
              data-position={`${i}`}
              onKeyDown={(ev) => onHandleKey(ev, e.key)}
              onDragStart={(ev) => {
                setDragging(e.key)
                ev.dataTransfer.effectAllowed = 'move'
                ev.dataTransfer.setData('text/plain', e.key)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
            >
              ≡
            </button>
            <Checkbox
              label={name}
              checked={!e.hidden}
              onChange={(on) => {
                const c = entriesShownCommand(graph, [e.key], on)
                if (c) ctx.dispatch(c, shownLabel(1, on))
              }}
            />
            <RichTextField
              label={`Legend label of “${name}”`}
              value={graph.legend.labels?.[e.key] ?? null}
              placeholder={name}
              textStyle={textStyle}
              palette={ctx.palette}
              onChange={(rt) => {
                const c = labelCommand(graph, e.key, rt)
                if (c) ctx.dispatch(c, rt ? 'Legend label' : 'Use data set name')
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Roadmap 47b: the head of a legend entry's place (an entry selected on the canvas): its
 * legend-only actions — Move earlier / later in the legend, Hide from legend, its legend label
 * and "Use data set name". Nothing for other places.
 */
export function LegendEntrySection({ ctx, target }: { ctx: PanelContext; target: FormatTarget }) {
  const key = entryOf(target)
  if (key === undefined) return null
  const { graph } = ctx
  const items = legendItemsOf(ctx)
  const item = items.find((e) => e.key === key && !e.fixed)
  if (!item) return null
  const name = plainLabel(item)
  const own = graph.legend.labels?.[key]
  const move = (by: 1 | -1) => {
    // On the canvas' terms: past the next entry shown.
    const m = moveEntriesCommand(graph, items, [key], by, true)
    if (m) ctx.dispatch(m.command, m.label)
  }
  const setLabel = (rt: Parameters<typeof labelCommand>[2]) => {
    const c = labelCommand(graph, key, rt)
    if (c) ctx.dispatch(c, rt ? 'Legend label' : 'Use data set name')
  }
  return (
    <Section title="Legend entry">
      <div className="field-row legend-entry-actions">
        <button
          type="button"
          disabled={!entriesMovedBy(items, [key], -1, true)}
          onClick={() => move(-1)}
        >
          Move earlier
        </button>
        <button
          type="button"
          disabled={!entriesMovedBy(items, [key], 1, true)}
          onClick={() => move(1)}
        >
          Move later
        </button>
        <button
          type="button"
          onClick={() => {
            const c = entriesShownCommand(graph, [key], !!item.hidden)
            if (c) ctx.dispatch(c, shownLabel(1, !!item.hidden))
          }}
        >
          {item.hidden ? 'Show in legend' : 'Hide from legend'}
        </button>
      </div>
      <RichTextField
        label="Legend label"
        value={own ?? null}
        placeholder={name}
        textStyle={effectiveText(ctx, ctx.theme.legend, graph.legend.text)}
        palette={ctx.palette}
        onChange={setLabel}
      />
      {own && (
        <button type="button" onClick={() => setLabel(null)}>
          Use data set name
        </button>
      )}
      <p className="muted">
        The order and label are this legend’s alone: the drawing order and the data set’s name stay.
        Alt+↑ / ↓ on the canvas moves the entry, Delete hides it.
      </p>
    </Section>
  )
}
