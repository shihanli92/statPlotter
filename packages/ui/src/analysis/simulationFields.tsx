import {
  defaultParamValue,
  INITIAL_RULES,
  labelOf,
  type MonteCarloParams,
  registry,
  resolveEquation,
  runSimulation,
  SIMULATIONS,
} from '@ps/analyses'
import type { FormField } from '@ps/model'
import { useId, useMemo } from 'react'
import { NumberBox } from '../components/fields.tsx'
import { CUSTOM_FIELDS, dataSetField } from './customFields.tsx'
import { DATA_FIELDS } from './dataFields.tsx'
import { MV_FIELDS } from './mvFields.tsx'
import { type CustomField, getPath, ParamsForm, setPath } from './ParamsForm.tsx'
import { STATS_FIELDS } from './statsFields.tsx'
import { TRANSFORM_FIELDS } from './transformFields.tsx'

// Custom form editors of roadmap 20 (equations and simulation):
//
// - `nlfit.initialRules`: the rules for initial values of a user-defined equation (a number
//   and a multiplier per parameter).
// - `dataset.pickNone`: an optional analyzed data set (the grouping variable of nonlinear
//   regression from a multiple-variables table).
// - `sim.seed`: the random seed, with a button that draws a new one (new random data).
// - `sim.dataSets`: parameter values of each simulated XY data set.
// - `sim.columns`: the columns of simulated column data.
// - `sim.titles2x2`: row and column titles of a simulated contingency table.
// - `mc.simulation`, `mc.analysis`: the simulation and the analysis a Monte Carlo repeats, each
//   edited with its own form (nested); `mc.tabulate`: the result picker, listing the values of a
//   trial run; `mc.hits`: up to two conditions that make a simulation a hit.

type Params = Record<string, unknown>

/** Rules for initial values, one row per parameter of the user equation. */
const InitialRulesField: CustomField = ({ label, path, params, onChange }) => {
  const r = resolveEquation(params as Parameters<typeof resolveEquation>[0])
  if (!r.ok) return null
  const rules = (getPath(params, path) ?? {}) as Record<string, { value: number; rule: string }>
  const set = (name: string, v: { value: number; rule: string } | null) => {
    const next = { ...rules }
    if (v) next[name] = v
    else delete next[name]
    onChange(setPath(params, path, next))
  }
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <tbody>
          {r.model.params.map((name) => {
            const cur = rules[name]
            return (
              <tr key={name}>
                <td>
                  <strong>{name}</strong>
                </td>
                <td>
                  <NumberBox
                    aria-label={`${name} rule value`}
                    value={cur?.value ?? 1}
                    onChange={(v) => set(name, { value: v, rule: cur?.rule ?? 'value' })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`${name} rule`}
                    value={cur ? cur.rule : ''}
                    onChange={(e) =>
                      set(
                        name,
                        e.target.value ? { value: cur?.value ?? 1, rule: e.target.value } : null,
                      )
                    }
                  >
                    <option value="">(no rule: start at 1)</option>
                    {INITIAL_RULES.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="help">
        Each data set’s initial value is the number times (or divided by) the quantity chosen,
        computed from that data set. Values typed under Initial values take precedence.
      </div>
    </fieldset>
  )
}

const SeedField: CustomField = ({ label, path, params, onChange }) => {
  const id = useId()
  const seed = Number(getPath(params, path) ?? 1)
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <span className="inline">
        <NumberBox
          id={id}
          value={seed}
          onChange={(v) => onChange(setPath(params, path, Math.trunc(v)))}
        />
        <button
          type="button"
          onClick={() => onChange(setPath(params, path, Math.floor(Math.random() * 2 ** 31)))}
        >
          New seed
        </button>
      </span>
      <div className="help">The same seed gives the same random numbers; a new seed, new data.</div>
    </>
  )
}

type SimDataSet = { title?: string; values?: Record<string, number> }

const SimDataSetsField: CustomField = ({ label, path, params, onChange }) => {
  const r = resolveEquation({
    equation: String(params.equation ?? ''),
    userEquation: String(params.userEquation ?? ''),
    initialValues: {},
  })
  const sets = (getPath(params, path) ?? [{}]) as SimDataSet[]
  const set = (next: SimDataSet[]) => onChange(setPath(params, path, next))
  if (!r.ok) return <div className="error-text">{r.message}</div>
  const model = r.model
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <thead>
          <tr>
            <th />
            {sets.map((s, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: data sets are positional
              <th key={k}>
                <input
                  type="text"
                  aria-label={`Title of data set ${k + 1}`}
                  placeholder={`Data Set ${String.fromCharCode(65 + (k % 26))}`}
                  value={s.title ?? ''}
                  onChange={(e) =>
                    set(sets.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)))
                  }
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.params.map((name) => (
            <tr key={name}>
              <td>
                <strong>{name}</strong>
              </td>
              {sets.map((s, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: data sets are positional
                <td key={k}>
                  <NumberBox
                    aria-label={`${name} of data set ${k + 1}`}
                    value={s.values?.[name] ?? defaultParamValue(model, name)}
                    onChange={(v) =>
                      set(
                        sets.map((x, j) =>
                          j === k ? { ...x, values: { ...(x.values ?? {}), [name]: v } } : x,
                        ),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="inline">
        <button
          type="button"
          onClick={() => set([...sets, { ...sets[sets.length - 1], title: '' }])}
        >
          Add a data set
        </button>
        <button type="button" disabled={sets.length < 2} onClick={() => set(sets.slice(0, -1))}>
          Remove the last
        </button>
      </span>
    </fieldset>
  )
}

type SimColumn = { title?: string; n?: number; mean?: number }

const SimColumnsField: CustomField = ({ label, path, params, onChange }) => {
  const cols = (getPath(params, path) ?? []) as SimColumn[]
  const random = params.meanMode === 'random'
  const set = (next: SimColumn[]) => onChange(setPath(params, path, next))
  const edit = (k: number, patch: SimColumn) =>
    set(cols.map((c, j) => (j === k ? { ...c, ...patch } : c)))
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Number of values</th>
            {!random && <th>Population mean</th>}
          </tr>
        </thead>
        <tbody>
          {cols.map((c, k) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
            <tr key={k}>
              <td>
                <input
                  type="text"
                  aria-label={`Title of column ${k + 1}`}
                  placeholder={String.fromCharCode(65 + (k % 26))}
                  value={c.title ?? ''}
                  onChange={(e) => edit(k, { title: e.target.value })}
                />
              </td>
              <td>
                <NumberBox
                  aria-label={`Values in column ${k + 1}`}
                  min={1}
                  value={c.n ?? 10}
                  onChange={(v) => edit(k, { n: Math.max(1, Math.round(v)) })}
                />
              </td>
              {!random && (
                <td>
                  <NumberBox
                    aria-label={`Mean of column ${k + 1}`}
                    value={c.mean ?? 10}
                    onChange={(v) => edit(k, { mean: v })}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="inline">
        <button
          type="button"
          onClick={() => set([...cols, { ...cols[cols.length - 1], title: '' }])}
        >
          Add a column
        </button>
        <button type="button" disabled={cols.length < 2} onClick={() => set(cols.slice(0, -1))}>
          Remove the last
        </button>
      </span>
    </fieldset>
  )
}

const Titles2x2Field: CustomField = ({ label, params, onChange }) => {
  const rows = (params.rowTitles ?? ['Treated', 'Control']) as [string, string]
  const cols = (params.columnTitles ?? ['Outcome', 'No outcome']) as [string, string]
  const input = (value: string, aria: string, put: (v: string) => void) => (
    <input type="text" aria-label={aria} value={value} onChange={(e) => put(e.target.value)} />
  )
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <tbody>
          <tr>
            <td />
            {cols.map((c, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two fixed columns
              <td key={j}>
                {input(c, `Column ${j + 1} title`, (v) =>
                  onChange({ ...params, columnTitles: cols.map((x, i) => (i === j ? v : x)) }),
                )}
              </td>
            ))}
          </tr>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two fixed rows
            <tr key={i}>
              <td>
                {input(r, `Row ${i + 1} title`, (v) =>
                  onChange({ ...params, rowTitles: rows.map((x, k) => (k === i ? v : x)) }),
                )}
              </td>
              <td colSpan={2} className="muted">
                row {i + 1}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  )
}

// ---- Monte Carlo -----------------------------------------------------------------------------------

/**
 * Every custom form editor by component id: the Analyze dialog's, and a nested form's (a
 * simulation's or an analysis'). A function, as this module's own editors are among them.
 */
export const allFields = (): Record<string, CustomField> => ({
  ...CUSTOM_FIELDS,
  ...DATA_FIELDS,
  ...TRANSFORM_FIELDS,
  ...STATS_FIELDS,
  ...MV_FIELDS,
  ...SIMULATION_FIELDS,
})

const mcOf = (params: Params) =>
  registry.get('monteCarlo')!.params.safeParse(params).data as MonteCarloParams | undefined

/** A trial run (simulation 0) of the Monte Carlo: its table's data sets and the result values. */
function useTrial(params: Params) {
  const key = JSON.stringify([params.simulation, params.analysis, params.seed])
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the parts that matter
  return useMemo(() => {
    const p = mcOf(params)
    if (!p) return null
    const sim = SIMULATIONS[p.simulation.analysisId]!
    const sp = sim.def.params.safeParse({ ...p.simulation.params, seed: p.seed })
    const table = sp.success ? sim.def.run([], sp.data, sim.context).table : undefined
    const run = runSimulation(p, 0, (id) => registry.get(id))
    return { p, table, run }
  }, [key])
}

const SimulationField: CustomField = ({ label, path, params, onChange, context }) => {
  const id = useId()
  const cur = (getPath(params, path) ?? {}) as { analysisId?: string; params?: Params }
  const simId = cur.analysisId ?? 'simulateColumn'
  const sim = SIMULATIONS[simId]!
  const value = { ...(sim.def.params.parse({}) as Params), ...(cur.params ?? {}) }
  const fields: readonly FormField[] = sim.def.form.filter((f) => f.path[0] !== 'seed')
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <label htmlFor={id}>Simulate</label>
      <select
        id={id}
        value={simId}
        onChange={(e) =>
          onChange(
            setPath(
              setPath(params, path, { analysisId: e.target.value, params: {} }),
              ['analysis'],
              { analysisId: defaultAnalysisFor(e.target.value), params: {}, dataSets: [] },
            ),
          )
        }
      >
        {Object.entries(SIMULATIONS).map(([k, s]) => (
          <option key={k} value={k}>
            {s.def.title}
          </option>
        ))}
      </select>
      <ParamsForm
        fields={fields}
        value={value}
        onChange={(v) => onChange(setPath(params, path, { analysisId: simId, params: v }))}
        custom={allFields()}
        context={context}
      />
    </fieldset>
  )
}

function defaultAnalysisFor(simId: string): string {
  return simId === 'simulateXY'
    ? 'nonlinearFit'
    : simId === 'simulateContingency'
      ? 'contingency'
      : 'ttest'
}

const EXCLUDED = new Set(['monteCarlo', 'simulateXY', 'simulateColumn', 'simulateContingency'])

const AnalysisField: CustomField = ({ label, path, params, onChange }) => {
  const id = useId()
  const trial = useTrial(params)
  const cur = (getPath(params, path) ?? {}) as {
    analysisId?: string
    params?: Params
    dataSets?: string[]
  }
  const kind = trial?.table?.tableKind
  const defs = registry
    .list()
    .filter((d) => !EXCLUDED.has(d.id) && (!kind || d.accepts.includes(kind)) && d.inputs.min > 0)
  const def = registry.get(cur.analysisId ?? 'ttest')
  const dataSets = (trial?.table?.dataSets ?? []).map((d) => ({
    key: d.id as string,
    title: d.title,
  }))
  const value = def ? { ...(def.params.parse({}) as Params), ...(cur.params ?? {}) } : {}
  const put = (patch: Partial<typeof cur>) => onChange(setPath(params, path, { ...cur, ...patch }))
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <label htmlFor={id}>Analysis</label>
      <select
        id={id}
        value={def?.id ?? ''}
        onChange={(e) =>
          onChange({
            ...setPath(params, path, { analysisId: e.target.value, params: {}, dataSets: [] }),
            tabulate: [],
            hits: { combine: 'both', conditions: [] },
          })
        }
      >
        {defs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </select>
      {dataSets.length > 1 && (
        <div className="field">
          Data sets analyzed:{' '}
          {dataSets.map((d) => {
            const chosen = cur.dataSets ?? []
            const on = chosen.length === 0 || chosen.includes(d.key)
            return (
              <label key={d.key} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const all = chosen.length ? chosen : dataSets.map((x) => x.key)
                    const next = e.target.checked ? [...all, d.key] : all.filter((k) => k !== d.key)
                    put({ dataSets: next.length === dataSets.length ? [] : next })
                  }}
                />
                {d.title}
              </label>
            )
          })}
        </div>
      )}
      {def && (
        <ParamsForm
          fields={def.form}
          value={value}
          onChange={(v) => put({ params: v })}
          custom={allFields()}
          context={{ dataSets }}
        />
      )}
    </fieldset>
  )
}

/** The values a trial run of the analysis produces, with labels and example values. */
function useChoices(params: Params) {
  const trial = useTrial(params)
  const res = trial?.run.result
  const titles = trial?.run.titles
  const choices = res
    ? Object.entries(res.values)
        .filter(
          ([, v]) =>
            v.kind === 'number' || v.kind === 'integer' || v.kind === 'pvalue' || v.kind === 'bool',
        )
        .map(([k, v]) => ({
          key: k,
          label: labelOf(k, titles),
          example: 'v' in v ? Number(v.v) : Number.NaN,
        }))
    : []
  return {
    choices,
    error:
      trial?.run.error ?? (res?.status === 'error' ? res.diagnostics.at(-1)?.message : undefined),
  }
}

const TabulateField: CustomField = ({ label, path, params, onChange }) => {
  const chosen = (getPath(params, path) ?? []) as string[]
  const { choices, error } = useChoices(params)
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      {error && <div className="error-text">A trial run failed: {error}</div>}
      {choices.map((c) => (
        <label key={c.key} className="check">
          <input
            type="checkbox"
            checked={chosen.includes(c.key)}
            onChange={(e) =>
              onChange(
                setPath(
                  params,
                  path,
                  e.target.checked ? [...chosen, c.key] : chosen.filter((k) => k !== c.key),
                ),
              )
            }
          />
          {c.label}
          <span className="muted">
            {' '}
            (e.g. {Number.isFinite(c.example) ? +c.example.toPrecision(4) : '—'})
          </span>
        </label>
      ))}
      <div className="help">
        One column per value in the Monte Carlo’s table, one row per simulation.
      </div>
    </fieldset>
  )
}

const OPS = ['<', '<=', '>', '>=', '=', '<>'] as const

const HitsField: CustomField = ({ label, path, params, onChange }) => {
  const hits = (getPath(params, path) ?? {
    combine: 'both',
    conditions: [],
  }) as MonteCarloParams['hits']
  const { choices } = useChoices(params)
  const put = (next: MonteCarloParams['hits']) => onChange(setPath(params, path, next))
  const conds = hits.conditions
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      {conds.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: at most two, positional
        <div key={i} className="inline">
          <select
            aria-label={`Condition ${i + 1} value`}
            value={c.value}
            onChange={(e) =>
              put({
                ...hits,
                conditions: conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
              })
            }
          >
            {!choices.some((o) => o.key === c.value) && <option value={c.value}>{c.value}</option>}
            {choices.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`Condition ${i + 1} comparison`}
            value={c.op}
            onChange={(e) =>
              put({
                ...hits,
                conditions: conds.map((x, j) =>
                  j === i ? { ...x, op: e.target.value as (typeof OPS)[number] } : x,
                ),
              })
            }
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <NumberBox
            aria-label={`Condition ${i + 1} threshold`}
            value={c.than}
            onChange={(v) =>
              put({ ...hits, conditions: conds.map((x, j) => (j === i ? { ...x, than: v } : x)) })
            }
          />
          <button
            type="button"
            onClick={() => put({ ...hits, conditions: conds.filter((_, j) => j !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      {conds.length === 2 && (
        <select
          aria-label="Combine the conditions"
          value={hits.combine}
          onChange={(e) => put({ ...hits, combine: e.target.value as 'both' | 'either' })}
        >
          <option value="both">Both conditions hold</option>
          <option value="either">Either condition holds</option>
        </select>
      )}
      {conds.length < 2 && (
        <button
          type="button"
          disabled={!choices.length}
          onClick={() =>
            put({
              ...hits,
              conditions: [...conds, { value: choices[0]!.key, op: '<', than: 0.05 }],
            })
          }
        >
          Add a condition
        </button>
      )}
      <div className="help">
        A simulation is a hit when the condition(s) hold, e.g. P &lt; 0.05 (the fraction of hits is
        then the power) or both CI limits around the true value (the coverage).
      </div>
    </fieldset>
  )
}

/** Custom form editors of roadmap 20, by component id. */
export const SIMULATION_FIELDS: Record<string, CustomField> = {
  'nlfit.initialRules': InitialRulesField,
  'dataset.pickNone': dataSetField(null),
  'sim.seed': SeedField,
  'sim.dataSets': SimDataSetsField,
  'sim.columns': SimColumnsField,
  'sim.titles2x2': Titles2x2Field,
  'mc.simulation': SimulationField,
  'mc.analysis': AnalysisField,
  'mc.tabulate': TabulateField,
  'mc.hits': HitsField,
}
