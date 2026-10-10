import { limitPointOverrides, showsLimitPoints } from '@ps/graph'
import {
  ABOVE_METHODS,
  type AboveMethod,
  BELOW_METHODS,
  type BelowMethod,
  countLimitFlags,
  type DataTable,
  DEFAULT_LIMIT_RULE,
  type GraphNode,
  type LimitRule,
  type LimitValues,
  parseLimitText,
} from '@ps/model'
import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Checkbox, Field, Select } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'

// Values at detection limits (roadmap 39): the substitution rule's fields, shared by the import
// dialog and Table › Limits…, and that dialog.

/** A column the rule's typed limits can name, with its cells at a limit without a number. */
export interface LimitColumn {
  /** Data set id (Limits…) or title (the import dialog). */
  key: string
  title: string
  words: { below: number; above: number }
}

/** A number typed in a field, or undefined when empty or not a number. */
const typed = (s: string): number | undefined => {
  const t = s.trim().replace(',', '.')
  if (!t) return undefined
  const v = Number(t)
  return Number.isFinite(v) ? v : undefined
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  return (
    <Field label={label} className="limit-number">
      {(id) => (
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(typed(e.target.value))
          }}
        />
      )}
    </Field>
  )
}

const setValues = (v: LimitValues | undefined, key: 'all' | string, n: number | undefined) => {
  const out: LimitValues = { ...v, columns: { ...v?.columns } }
  if (key === 'all') {
    if (n === undefined) delete out.all
    else out.all = n
  } else if (n === undefined) delete out.columns![key]
  else out.columns![key] = n
  if (!Object.keys(out.columns!).length) delete out.columns
  return Object.keys(out).length ? out : undefined
}

/** The rule's fields: what replaces values below and above, and limits for cells without one. */
export function LimitRuleFields({
  rule,
  onChange,
  columns,
}: {
  rule: LimitRule
  onChange: (rule: LimitRule) => void
  columns: readonly LimitColumn[]
}) {
  const words = {
    below: columns.filter((c) => c.words.below > 0),
    above: columns.filter((c) => c.words.above > 0),
  }
  const side = (s: 'below' | 'above') => {
    const values = s === 'below' ? rule.lower : rule.upper
    const cols = words[s]
    if (!cols.length) return null
    const n = cols.reduce((k, c) => k + c.words[s], 0)
    const put = (key: string, v: number | undefined) => {
      const next = setValues(values, key, v)
      const { [s === 'below' ? 'lower' : 'upper']: _, ...rest } = rule
      onChange({ ...rest, ...(next ? { [s === 'below' ? 'lower' : 'upper']: next } : {}) })
    }
    return (
      <fieldset className="field limit-words">
        <legend>
          {s === 'below' ? 'Lower' : 'Upper'} limit of the {n} {n === 1 ? 'cell' : 'cells'} without
          a number (“{s === 'below' ? 'BLQ' : 'ULOQ+'}”)
        </legend>
        <div className="field-row">
          <NumberInput label="For all" value={values?.all} onChange={(v) => put('all', v)} />
          {cols
            .filter((c) => c.key !== '')
            .map((c) => (
              <NumberInput
                key={c.key}
                label={c.title}
                value={values?.columns?.[c.key]}
                onChange={(v) => put(c.key, v)}
              />
            ))}
        </div>
      </fieldset>
    )
  }
  return (
    <>
      <div className="field-row">
        <Select<BelowMethod>
          label="Below a limit, use"
          value={rule.below.method}
          options={BELOW_METHODS.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(method) => onChange({ ...rule, below: { ...rule.below, method } })}
        />
        {rule.below.method === 'fixed' && (
          <NumberInput
            label="Value"
            value={rule.below.value}
            onChange={(value) => onChange({ ...rule, below: { method: 'fixed', value } })}
          />
        )}
      </div>
      <div className="field-row">
        <Select<AboveMethod>
          label="Above a limit, use"
          value={rule.above.method}
          options={ABOVE_METHODS.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(method) => onChange({ ...rule, above: { ...rule.above, method } })}
        />
        {rule.above.method === 'fixed' && (
          <NumberInput
            label="Value"
            value={rule.above.value}
            onChange={(value) => onChange({ ...rule, above: { method: 'fixed', value } })}
          />
        )}
      </div>
      {side('below')}
      {side('above')}
    </>
  )
}

/** A table's data sets with their flagged cells that name no limit. */
function tableLimitColumns(table: DataTable): LimitColumn[] {
  return table.dataSets.map((d) => {
    const words = { below: 0, above: 0 }
    for (const c of d.subcolumns)
      for (const f of c.limit ?? [])
        if (f && (parseLimitText(f.text)?.limit ?? null) === null) words[f.side]++
    return { key: d.id, title: d.title, words }
  })
}

/** Table › Limits…: the rule of a table's values at detection limits, changed and applied. */
export function LimitsDialog({ table, onClose }: { table: DataTable; onClose: () => void }) {
  const { store } = useServices()
  const nodes = useDoc((p) => p.nodes)
  const order = useDoc((p) => p.order)
  const graphs = useMemo(
    () =>
      order
        .map((id) => nodes[id])
        .filter((n): n is GraphNode => n?.kind === 'graph' && n.seriesSource.table === table.id),
    [nodes, order, table.id],
  )
  const [rule, setRule] = useState<LimitRule>(table.limits ?? DEFAULT_LIMIT_RULE)
  const shownOpen = graphs.length > 0 && graphs.every((g) => showsLimitPoints(g, table))
  const [open, setOpen] = useState(shownOpen)
  const counts = countLimitFlags(table)
  const total = counts.below + counts.above

  const symbolCommands = (on: boolean) =>
    graphs.flatMap((g) => {
      const next = limitPointOverrides(g, table, on)
      return JSON.stringify(next ?? null) === JSON.stringify(g.pointOverrides ?? null)
        ? []
        : [{ type: 'node.set' as const, id: g.id, path: ['pointOverrides'], value: next }]
    })
  const apply = () => {
    store.dispatch(
      [{ type: 'table.setLimits', table: table.id, rule }, ...symbolCommands(open)],
      'Limits',
    )
    onClose()
  }
  const remove = () => {
    store.dispatch(
      [...symbolCommands(false), { type: 'table.setLimits', table: table.id, rule: null }],
      'Remove limit flags',
    )
    onClose()
  }
  return (
    <Dialog
      title={`Limits of “${table.name}”`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={remove}
            title="Keep the values and forget the original text"
          >
            Remove flags
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <p>
        {total === 0
          ? 'No cells of this table were imported at a detection limit.'
          : `${counts.below} ${counts.below === 1 ? 'cell' : 'cells'} below a limit and ${counts.above} above were imported from text such as “<0.5” or “BLQ”. They are substituted again from that text when you apply.`}
      </p>
      <LimitRuleFields rule={rule} onChange={setRule} columns={tableLimitColumns(table)} />
      {graphs.length > 0 && (
        <Checkbox
          label={`Draw them as open symbols on ${graphs.length === 1 ? 'the graph' : `the ${graphs.length} graphs`} of this table`}
          checked={open}
          onChange={setOpen}
        />
      )}
      <p className="muted">Analyses use the substituted values.</p>
    </Dialog>
  )
}

/** The grid's tooltip of a cell imported at a limit. */
export function limitTitle(
  limit: { side: 'below' | 'above'; text: string },
  table: Pick<DataTable, 'limits'>,
): string {
  const rule = table.limits ?? DEFAULT_LIMIT_RULE
  const how =
    limit.side === 'below'
      ? (BELOW_METHODS.find((m) => m.id === rule.below.method)?.label ?? '')
      : (ABOVE_METHODS.find((m) => m.id === rule.above.method)?.label.toLowerCase() ?? '')
  return `Imported as “${limit.text}” (${limit.side} a limit; ${how}). Table › Limits… changes the rule.`
}
