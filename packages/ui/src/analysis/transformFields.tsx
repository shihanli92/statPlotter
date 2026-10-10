import { useId, useState } from 'react'
import { NumberBox } from '../components/fields.tsx'
import { type CustomField, type FormContext, getPath, setPath } from './ParamsForm.tsx'

// Custom analysis-form editors for Transform (packages/analyses/src/transform.ts).
//
// `transform.kByDataSet` edits the `kByDataSet` param (data set key → K; data sets without an
// entry use the common `k`). It is declared in the Transform plugin's form as
//   { path: ['kByDataSet'], label: 'K for each data set', kind: 'custom',
//     component: 'transform.kByDataSet', showIf: { path: ['y'], in: Y_IDS.filter(usesK) } }
// and shows a "different K for each data set" checkbox with one K per analyzed data set.

type KMap = Record<string, number>

/** One K per analyzed data set, each starting at the common K (a fresh per-data-set table). */
export function fillK(dataSets: FormContext['dataSets'], k: number, current: KMap = {}): KMap {
  return Object.fromEntries(dataSets.map((d) => [d.key, current[d.key] ?? k]))
}

/** The K a data set is transformed with: its own, else the common K. */
export const kFor = (map: KMap, key: string, k: number): number => map[key] ?? k

const KByDataSetField: CustomField = ({ label, path, params, onChange, context }) => {
  const id = useId()
  const map = (getPath(params, path) ?? {}) as KMap
  const k = typeof params.k === 'number' ? params.k : 1
  const [on, setOn] = useState(Object.keys(map).length > 0)
  const set = (next: KMap) => onChange(setPath(params, path, next))
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={on}
          disabled={!context.dataSets.length}
          onChange={(e) => {
            setOn(e.target.checked)
            set(e.target.checked ? fillK(context.dataSets, k, map) : {})
          }}
        />
        A different K for each data set
      </label>
      {on && (
        <table>
          <tbody>
            {context.dataSets.map((d) => (
              <tr key={d.key}>
                <td>{d.title || '(untitled)'}</td>
                <td>
                  <NumberBox
                    aria-label={`K for ${d.title || 'data set'}`}
                    value={kFor(map, d.key, k)}
                    onChange={(v) => set({ ...map, [d.key]: v })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="help">
        {on ? 'Each data set uses its own K.' : `Every data set uses K = ${k}.`}
      </div>
    </fieldset>
  )
}

/** Transform's custom form editors, by component id. */
export const TRANSFORM_FIELDS: Record<string, CustomField> = {
  'transform.kByDataSet': KByDataSetField,
}
