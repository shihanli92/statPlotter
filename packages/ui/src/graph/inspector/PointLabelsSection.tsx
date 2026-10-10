import { resolveText } from '@ps/graph'
import type { LabelThreshold, NumberDisplay, PointLabels } from '@ps/model'
import { useState } from 'react'
import { Checkbox, Field, NumberInput, Section, Select } from '../../components/fields.tsx'
import { ColorRefField, DASHES, TextStyleFields } from '../../components/formatFields.tsx'
import type { PanelContext } from './context.ts'
import {
  currentLabels,
  DEFAULT_POINT_LABELS,
  defaultThresholds,
  filterRows,
  type LabelItems,
  labelCommands,
  rowChoices,
  toggleRow,
} from './pointLabels.ts'

const TESTS = [
  { value: 'abs', label: '|value| ≥' },
  { value: 'above', label: '≥' },
  { value: 'below', label: '≤' },
] as const

/**
 * Label points (roadmap 22): row titles or X / Y values beside the points of one data set, of
 * every data set (fields that differ show as mixed; a change applies to each, keeping its other
 * fields), or of an analysis output (a volcano plot's points).
 */
export function PointLabelsSection({
  ctx,
  items,
  hasX,
}: {
  ctx: PanelContext
  items: LabelItems
  /** The points have X values (XY and bubble graphs). */
  hasX: boolean
}) {
  const { graph, theme, palette } = ctx
  const all = currentLabels(graph, theme, items)
  const shown = all.map((l) => l ?? { ...DEFAULT_POINT_LABELS, source: 'none' as const })
  const on = shown.some((l) => l.source !== 'none')
  const differs = (f: (l: PointLabels) => unknown) => {
    const a = JSON.stringify(f(shown[0]!))
    return shown.some((l) => JSON.stringify(f(l)) !== a)
  }
  const update = (f: (l: PointLabels) => PointLabels | undefined, label = 'Label points') =>
    ctx.dispatch(labelCommands(graph, theme, items, f), label)
  const set = <K extends keyof PointLabels>(key: K, v: PointLabels[K], label?: string) =>
    update((l) => ({ ...l, [key]: v }), label)
  const current = shown[0]!
  const format: NumberDisplay = current.format ?? { mode: 'auto' }
  const inherited = resolveText(theme.pointLabel, graph.style.text)
  const leaderOn = (current.leader?.width ?? 0.5) > 0

  return (
    <Section title="Label points" collapsed={!on}>
      <div className="field-row">
        <Select
          label="Label"
          value={current.source}
          mixed={differs((l) => l.source)}
          options={[
            { value: 'none', label: 'None' },
            { value: 'rowTitle', label: 'Row titles' },
            ...(hasX ? [{ value: 'x' as const, label: 'X values' }] : []),
            { value: 'y', label: 'Y values' },
          ]}
          onChange={(v) => set('source', v, v === 'none' ? 'Remove point labels' : 'Label points')}
        />
        {on && (
          <Select
            label="Which points"
            value={current.which}
            mixed={differs((l) => l.which)}
            options={[
              { value: 'all', label: 'All points' },
              { value: 'threshold', label: 'Points past thresholds' },
              { value: 'rows', label: 'Chosen rows' },
            ]}
            onChange={(v) =>
              update(
                (l) => ({
                  ...l,
                  which: v,
                  ...(v === 'threshold' && !l.thresholds?.length
                    ? { thresholds: defaultThresholds(hasX) }
                    : {}),
                }),
                'Which points to label',
              )
            }
          />
        )}
      </div>
      {on && current.which === 'threshold' && (
        <ThresholdsFields
          thresholds={current.thresholds ?? []}
          combine={current.combine ?? 'and'}
          hasX={hasX}
          mixed={differs((l) => [l.thresholds, l.combine])}
          onChange={(thresholds, combine) =>
            update((l) => ({ ...l, thresholds, combine }), 'Label thresholds')
          }
        />
      )}
      {on && current.which === 'rows' && (
        <RowPicker
          ctx={ctx}
          items={items}
          rows={current.rows ?? []}
          mixed={differs((l) => l.rows)}
          onChange={(rows) => set('rows', rows, 'Rows to label')}
        />
      )}
      {on && (current.source === 'x' || current.source === 'y') && (
        <div className="field-row">
          <Select
            label="Number format"
            value={format.mode}
            mixed={differs((l) => l.format?.mode ?? 'auto')}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'fixed', label: 'Fixed decimals' },
              { value: 'scientific', label: 'Scientific (1.2e+3)' },
              { value: 'power10', label: 'Power of ten (1.2×10³)' },
            ]}
            onChange={(mode) => {
              const { digits, ...rest } = format
              set(
                'format',
                mode === 'auto' ? { ...rest, mode } : { ...rest, mode, digits: digits ?? 2 },
                'Label number format',
              )
            }}
          />
          {format.mode !== 'auto' && (
            <NumberInput
              label="Decimals"
              value={format.digits ?? 2}
              mixed={differs((l) => l.format?.digits)}
              min={0}
              max={15}
              onChange={(digits) => set('format', { ...format, digits }, 'Label number format')}
            />
          )}
        </div>
      )}
      {on && (
        <>
          <TextStyleFields
            value={current.text}
            inherited={inherited}
            palette={palette}
            onChange={(text) => set('text', text, 'Label font')}
          />
          <div className="field-row">
            <Checkbox
              label="Move labels apart (no overlaps)"
              checked={current.repel !== false}
              mixed={differs((l) => l.repel !== false)}
              onChange={(v) => set('repel', v ? undefined : false, 'Move labels apart')}
            />
            <NumberInput
              label="At most (labels per data set)"
              value={current.max ?? 100}
              mixed={differs((l) => l.max ?? 100)}
              min={1}
              max={1000}
              step={1}
              onChange={(v) =>
                set('max', Math.round(v) === 100 ? undefined : Math.round(v), 'Most labels')
              }
            />
          </div>
          <Checkbox
            label="Leader lines to labels moved away from their points"
            checked={leaderOn}
            mixed={differs((l) => (l.leader?.width ?? 0.5) > 0)}
            onChange={(v) =>
              set(
                'leader',
                v ? { ...current.leader, width: 0.5 } : { ...current.leader, width: 0 },
                'Leader lines',
              )
            }
          />
          {leaderOn && (
            <>
              <div className="field-row">
                <NumberInput
                  label="Leader width (pt)"
                  value={current.leader?.width ?? 0.5}
                  mixed={differs((l) => l.leader?.width ?? 0.5)}
                  min={0.1}
                  max={5}
                  step={0.25}
                  onChange={(width) => set('leader', { ...current.leader, width }, 'Leader lines')}
                />
                <Select
                  label="Style"
                  value={current.leader?.dash ?? 'solid'}
                  mixed={differs((l) => l.leader?.dash ?? 'solid')}
                  options={DASHES}
                  onChange={(dash) => set('leader', { ...current.leader, dash }, 'Leader lines')}
                />
              </div>
              <ColorRefField
                label="Leader colour (default: the label’s)"
                value={current.leader?.color}
                palette={palette}
                allowSeries
                fallback="#000000"
                onChange={(color) => set('leader', { ...current.leader, color }, 'Leader lines')}
              />
            </>
          )}
        </>
      )}
      {!on && (
        <p className="muted">
          Row titles (e.g. gene names) or X / Y values beside the points: all of them, those past
          thresholds (a volcano plot’s cut-offs) or chosen rows, moved apart so they don’t overlap.
          Drag a label to place it yourself.
        </p>
      )}
    </Section>
  )
}

/** Up to four conditions on X or Y, all or any of which must hold. */
function ThresholdsFields({
  thresholds,
  combine,
  hasX,
  mixed,
  onChange,
}: {
  thresholds: readonly LabelThreshold[]
  combine: 'and' | 'or'
  hasX: boolean
  mixed: boolean
  onChange: (thresholds: LabelThreshold[], combine: 'and' | 'or' | undefined) => void
}) {
  const write = (next: LabelThreshold[], c: 'and' | 'or' = combine) =>
    onChange(next, c === 'and' ? undefined : c)
  const edit = (i: number, patch: Partial<LabelThreshold>) =>
    write(thresholds.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  return (
    <>
      {mixed && <p className="muted">The data sets’ thresholds differ; shown for the first.</p>}
      {thresholds.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: conditions are positional
        <div className="field-row" key={i}>
          <Select
            label={i === 0 ? 'Value' : combine === 'and' ? 'and' : 'or'}
            value={t.value}
            options={[
              ...(hasX || t.value === 'x' ? [{ value: 'x' as const, label: 'X' }] : []),
              { value: 'y', label: 'Y' },
            ]}
            onChange={(value) => edit(i, { value })}
          />
          <Select
            label="Test"
            value={t.test}
            options={TESTS}
            onChange={(test) => edit(i, { test })}
          />
          <NumberInput label="Limit" value={t.limit} onChange={(limit) => edit(i, { limit })} />
          <button
            type="button"
            className="threshold-remove"
            aria-label="Remove this condition"
            title="Remove this condition"
            onClick={() => write(thresholds.filter((_, k) => k !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="field-row">
        {thresholds.length < 4 && (
          <button
            type="button"
            onClick={() =>
              write([...thresholds, { value: hasX ? 'x' : 'y', test: 'abs', limit: 1 }])
            }
          >
            Add condition
          </button>
        )}
        {thresholds.length > 1 && (
          <Select
            label="Label points meeting"
            value={combine}
            options={[
              { value: 'and', label: 'Every condition (and)' },
              { value: 'or', label: 'Any condition (or)' },
            ]}
            onChange={(c) => write([...thresholds], c)}
          />
        )}
      </div>
    </>
  )
}

/** The rows to label, found by title; long tables show the first matches of the search. */
function RowPicker({
  ctx,
  items,
  rows,
  mixed,
  onChange,
}: {
  ctx: PanelContext
  items: LabelItems
  rows: readonly number[]
  mixed: boolean
  onChange: (rows: number[]) => void
}) {
  const [query, setQuery] = useState('')
  const choices = rowChoices(ctx.project, ctx.graph, items, ctx.lookup)
  const shown = filterRows(choices, query)
  const chosen = new Set(rows)
  const matches = query.trim() ? filterRows(choices, query, Number.POSITIVE_INFINITY).length : 0
  return (
    <div className="row-picker">
      <Field
        label={mixed ? 'Rows (differ between data sets; shown for the first)' : 'Rows to label'}
      >
        {(id) => (
          <input
            id={id}
            type="search"
            placeholder={`Search ${choices.length} rows by title`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </Field>
      <p className="muted">
        {rows.length} chosen{' '}
        {rows.length > 0 && (
          <button type="button" className="link" onClick={() => onChange([])}>
            Clear
          </button>
        )}
        {query.trim() && matches > shown.length ? ` · first ${shown.length} of ${matches}` : ''}
      </p>
      <ul className="row-picker-list">
        {shown.map((c) => (
          <li key={c.row}>
            <Checkbox
              label={c.label}
              checked={chosen.has(c.row)}
              onChange={() => onChange(toggleRow(rows, c.row))}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
