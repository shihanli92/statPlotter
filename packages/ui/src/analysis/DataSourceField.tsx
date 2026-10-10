import { type DataSetMatch, dataSetMap, mapParams } from '@ps/engine'
import type { DataTable, NodeId } from '@ps/model'
import { useId } from 'react'

/**
 * The data set keys and parameters of an analysis of `from`, for the same analysis of `to`
 * (data sets matched by position or title; those without a match left out).
 */
export function remapSelection(
  from: DataTable,
  to: DataTable,
  match: DataSetMatch,
  selected: readonly string[],
  params: Record<string, unknown>,
): { selected: string[]; params: Record<string, unknown> } {
  const keys = dataSetMap(from, to, match)
  return {
    selected: selected.flatMap((k) => {
      const m = keys.has(k) ? keys.get(k) : k
      return m ? [m] : []
    }),
    params: mapParams(params, keys) as Record<string, unknown>,
  }
}

/**
 * Analysis parameters › Data (roadmap 31): the data table analyzed, changeable to another table
 * of the same kind (data sets matched by position or title). The analysis' graphs follow it.
 */
export function DataSourceField({
  tables,
  value,
  match,
  onChange,
  warnings,
}: {
  /** The table analyzed now and the others it could analyze. */
  tables: readonly DataTable[]
  value: NodeId
  match: DataSetMatch
  onChange: (table: NodeId, match: DataSetMatch) => void
  /** What changing the table can't carry over. */
  warnings: readonly string[]
}) {
  const id = useId()
  return (
    <fieldset className="field data-source">
      <legend>Data</legend>
      <div className="inline-fields">
        <label htmlFor={`${id}-source`}>Analyze</label>
        <select
          id={`${id}-source`}
          value={value}
          onChange={(e) => onChange(e.target.value as NodeId, match)}
        >
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-match`}>matching data sets</label>
        <select
          id={`${id}-match`}
          value={match}
          onChange={(e) => onChange(value, e.target.value as DataSetMatch)}
        >
          <option value="position">by position</option>
          <option value="title">by title</option>
        </select>
      </div>
      {warnings.map((w) => (
        <div key={w} className="help error">
          {w}
        </div>
      ))}
    </fieldset>
  )
}
