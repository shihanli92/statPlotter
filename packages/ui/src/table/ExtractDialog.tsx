import { createGraphFor } from '@ps/graph'
import {
  type DataTable,
  type ExtractResult,
  extractVariables,
  type NodeId,
  textCategories,
} from '@ps/model'
import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field } from '../components/fields.tsx'
import { useServices } from '../context.tsx'
import { errorMessage } from '../util.ts'

/**
 * "Extract and rearrange" a multiple-variables table into a column table (variables side by side,
 * or one variable split by the categories of a text variable) or a grouped table (a second text
 * variable as rows), with a graph. The new table is a copy: it doesn't follow later edits.
 */
export function ExtractDialog({
  table,
  onClose,
  onCreated,
}: {
  table: DataTable
  onClose: () => void
  onCreated?: (id: NodeId) => void
}) {
  const { store } = useServices()
  const numeric = table.dataSets.filter((d) => !d.text)
  const texts = table.dataSets.filter((d) => d.text)
  const [values, setValues] = useState<string[]>(numeric[0] ? [numeric[0].id] : [])
  const [groupBy, setGroupBy] = useState<string>(texts[0]?.id ?? '')
  const [rowsBy, setRowsBy] = useState<string>('')
  const [name, setName] = useState('')

  const title = (id: string) => table.dataSets.find((d) => d.id === id)?.title ?? ''
  const defaultName = groupBy
    ? `${title(values[0] ?? '')} by ${title(groupBy)}${rowsBy ? ` and ${title(rowsBy)}` : ''}`
    : `${table.name} (${values.map(title).join(', ')})`
  const result = useMemo((): { ok: ExtractResult } | { error: string } => {
    try {
      return {
        ok: extractVariables(table, {
          values: groupBy ? values.slice(0, 1) : values,
          ...(groupBy ? { groupBy } : {}),
          ...(groupBy && rowsBy ? { rowsBy } : {}),
          name: name.trim() || defaultName,
        }),
      }
    } catch (e) {
      return { error: errorMessage(e) }
    }
  }, [table, values, groupBy, rowsBy, name, defaultName])

  const create = () => {
    if (!('ok' in result)) return
    const t = result.ok.table
    store.dispatch(
      [
        { type: 'node.add', node: t },
        { type: 'node.add', node: createGraphFor(t, t.name) },
      ],
      'Extract and rearrange',
    )
    onCreated?.(t.id)
    onClose()
  }

  const toggle = (id: string, on: boolean) =>
    setValues((v) => (groupBy ? [id] : on ? [...v, id] : v.filter((x) => x !== id)))

  const shape = (r: ExtractResult) => {
    const t = r.table
    const sets = t.dataSets.slice(0, 6).map((d) => d.title)
    return [
      `${t.tableKind === 'grouped' ? 'Grouped' : 'Column'} table`,
      `${t.dataSets.length} data set${t.dataSets.length === 1 ? '' : 's'} (${sets.join(', ')}${t.dataSets.length > 6 ? ', …' : ''})`,
      `${t.rowCount} rows`,
      r.leftOut ? `${r.leftOut} values without a category left out` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <Dialog
      title="Extract and rearrange"
      onClose={onClose}
      okLabel="Create table"
      onOk={create}
      okDisabled={!('ok' in result)}
    >
      <p className="muted">
        Makes a column or grouped table from variables of “{table.name}”, for t tests, ANOVA and
        column or grouped graphs. The new table is a copy: later edits here don’t reach it.
      </p>
      <fieldset className="field radio">
        <legend>Values from</legend>
        {numeric.map((d) => (
          <label key={d.id} className="check">
            <input
              type={groupBy ? 'radio' : 'checkbox'}
              name="ex-values"
              checked={values.includes(d.id)}
              onChange={(e) => toggle(d.id, e.target.checked)}
            />
            {d.title}
            {d.formula !== undefined ? ' (calculated)' : ''}
          </label>
        ))}
      </fieldset>
      <Field label="Data sets">
        {(id) => (
          <select
            id={id}
            value={groupBy}
            onChange={(e) => {
              setGroupBy(e.target.value)
              if (e.target.value) setValues((v) => v.slice(0, 1))
              else setRowsBy('')
            }}
          >
            <option value="">One per variable (rows stay matched)</option>
            {texts.map((d) => (
              <option key={d.id} value={d.id}>
                One per category of {d.title} ({textCategories(d).length})
              </option>
            ))}
          </select>
        )}
      </Field>
      {groupBy && (
        <Field label="Rows">
          {(id) => (
            <select id={id} value={rowsBy} onChange={(e) => setRowsBy(e.target.value)}>
              <option value="">None (a column table)</option>
              {texts
                .filter((d) => d.id !== groupBy)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    One per category of {d.title} (a grouped table)
                  </option>
                ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Table name">
        {(id) => (
          <input
            id={id}
            value={name}
            placeholder={defaultName}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className="field">
        {'ok' in result ? (
          <div className="muted">Makes: {shape(result.ok)}</div>
        ) : (
          <div className="error-text">{result.error}</div>
        )}
      </div>
    </Dialog>
  )
}
