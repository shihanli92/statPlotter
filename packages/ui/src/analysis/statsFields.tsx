import { resolveEquation, USER_EQUATION } from '@ps/analyses'
import { useId } from 'react'
import { NumberBox } from '../components/fields.tsx'
import { EquationSelect } from './customFields.tsx'
import { type CustomField, getPath, setPath } from './ParamsForm.tsx'

// Custom analysis-form editors for the statistics additions of roadmap item 18.
//
// - `row.pick`: one row of the analyzed table, stored as its index in a string (the control row
//   of the contingency pairwise comparisons).
// - `gof.expected`: the expected count or percentage of each row (category) for "Compare
//   observed distribution with expected" (`goodnessOfFit`), stored as an array by table row. An
//   empty array means equal expected values, which is what the editor starts from.
// - `nlfit.compareParams`: which parameters of the chosen model to compare between data sets.
// - `nlfit.equationByDataSet`: a different built-in equation for some of the analyzed data sets.

const RowPickField: CustomField = ({ label, path, params, onChange, context }) => {
  const id = useId()
  const rows = context.rows ?? []
  const current = String(getPath(params, path) ?? '0')
  const value = rows.some((r) => String(r.index) === current)
    ? current
    : String(rows[0]?.index ?? 0)
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(setPath(params, path, e.target.value))}
      >
        {rows.map((r) => (
          <option key={r.index} value={String(r.index)}>
            {r.title}
          </option>
        ))}
      </select>
    </>
  )
}

const ExpectedField: CustomField = ({ label, path, params, onChange, context }) => {
  const rows = context.rows ?? []
  const stored = (getPath(params, path) ?? []) as number[]
  const asPercent = params.expectedAs !== 'counts'
  const equal = asPercent ? 100 / Math.max(1, rows.length) : 1
  const values = rows.map((r) => stored[r.index] ?? equal)
  const set = (index: number, v: number) => {
    const next = rows.map((r) => (r.index === index ? v : (stored[r.index] ?? equal)))
    onChange(setPath(params, path, next))
  }
  const sum = values.reduce((s, v) => s + v, 0)
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.index}>
              <td>{r.title}</td>
              <td>
                <NumberBox
                  aria-label={`Expected ${asPercent ? 'percentage' : 'count'} for ${r.title}`}
                  value={values[i]!}
                  min={0}
                  onChange={(v) => set(r.index, v)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="help">
        {asPercent
          ? `Total ${+sum.toFixed(6)}% (percentages must add up to 100).`
          : `Total ${+sum.toFixed(6)} (must equal the total of the observed counts).`}
        {stored.length === 0 ? ' Equal expected values until you change one.' : ''}
      </div>
    </fieldset>
  )
}

const CompareParamsField: CustomField = ({ label, path, params, onChange }) => {
  const chosen = (getPath(params, path) ?? []) as string[]
  const r = resolveEquation(params as Parameters<typeof resolveEquation>[0])
  const names = r.ok ? r.model.params : []
  const toggle = (n: string, on: boolean) =>
    onChange(
      setPath(
        params,
        path,
        on ? [...chosen.filter((c) => c !== n), n] : chosen.filter((c) => c !== n),
      ),
    )
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      {names.map((n) => (
        <label key={n} className="check">
          <input
            type="checkbox"
            checked={chosen.includes(n)}
            onChange={(e) => toggle(n, e.target.checked)}
          />
          {n}
        </label>
      ))}
      <div className="help">
        Each parameter checked is shared by all data sets in the null model (extra sum-of-squares F
        test and AICc).
      </div>
    </fieldset>
  )
}

type ByDataSet = Record<string, { equation: string; userEquation?: string }>

const SAME = '(same)'

const EquationByDataSetField: CustomField = ({ label, path, params, onChange, context }) => {
  const id = useId()
  const map = (getPath(params, path) ?? {}) as ByDataSet
  const set = (key: string, eq: string) => {
    const next = { ...map }
    if (eq === SAME) delete next[key]
    else next[key] = { equation: eq, userEquation: map[key]?.userEquation ?? '' }
    onChange(setPath(params, path, next))
  }
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <tbody>
          {context.dataSets.map((d, i) => {
            const cur = map[d.key]?.equation
            return (
              <tr key={d.key}>
                <td>
                  <label htmlFor={`${id}-${i}`}>{d.title || '(untitled)'}</label>
                </td>
                <td>
                  {cur === USER_EQUATION ? (
                    <span className="muted">User-defined equation</span>
                  ) : (
                    <EquationSelect
                      id={`${id}-${i}`}
                      value={cur ?? SAME}
                      onChange={(v) => set(d.key, v)}
                      sameOption={SAME}
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="help">
        Data sets with another equation are fit with it (default constraints and initial values),
        separately from the others.
      </div>
    </fieldset>
  )
}

/** Custom form editors of the roadmap-18 analyses, by component id. */
export const STATS_FIELDS: Record<string, CustomField> = {
  'row.pick': RowPickField,
  'gof.expected': ExpectedField,
  'nlfit.compareParams': CompareParamsField,
  'nlfit.equationByDataSet': EquationByDataSetField,
}
