import { registry } from '@ps/analyses'
import type { DataSetColumn } from '@ps/model'
import { useId, useState } from 'react'
import { OptionalNumber } from '../components/fields.tsx'
import { type CustomField, type FormContext, getPath, setPath } from './ParamsForm.tsx'

// Custom analysis-form editors for the statistics of multiple-variables tables (roadmap 19):
// categorical predictors, reference levels, interactions, prediction points, factors and levels.
//
// Component ids are `mv.<editor>:<roles>`, where <roles> names the params holding the variables
// that play another role (outcome, time, event…) with their fallback positions, e.g. 'y=0' or
// 'time=0,event=1' — the editors list the other analyzed variables. Every id the analyses'
// forms use is registered (`MV_FIELDS`), so a new roles spec needs no change here.
//
// - mv.categorical: numeric predictors to treat as categorical (text variables always are).
// - mv.reference: a reference level per categorical predictor ('' = the automatic rule).
// - mv.interactions: two- and three-way interactions of the predictors ([] = none).
// - mv.anovaTerms: the same for multifactor ANOVA, where null means every two- and three-way one.
// - mv.factors / mv.variables: variables to use ([] = all of them / none).
// - mv.predictions: rows of predictor values (blank numbers and levels take the analysis' default).
// - mv.level: one level of the variable in the first role (a text status value).

type Params = Record<string, unknown>
type Var = FormContext['dataSets'][number]

/** Levels to offer for a table variable: a text variable's values, or up to 50 distinct numbers. */
export function variableInfo(ds: Pick<DataSetColumn, 'text' | 'subcolumns'>): {
  text?: boolean
  levels?: string[]
} {
  const seen = new Set<string>()
  if (ds.text) {
    for (const t of ds.text) {
      const s = t?.trim()
      if (s) seen.add(s)
    }
    return { text: true, levels: [...seen] }
  }
  for (const v of ds.subcolumns[0]?.values ?? []) {
    if (v === null) continue
    seen.add(String(v))
    if (seen.size > 50) return {}
  }
  return { levels: [...seen] }
}

/** The analyzed variables other than those the roles spec names. */
export function otherVariables(dataSets: readonly Var[], params: Params, roles: string): Var[] {
  const skip = new Set(roleIndices(dataSets, params, roles))
  return dataSets.filter((_, i) => !skip.has(i))
}

function roleIndices(dataSets: readonly Var[], params: Params, roles: string): number[] {
  return roles
    .split(',')
    .filter(Boolean)
    .map((r) => {
      const [name, fb] = r.split('=')
      const i = dataSets.findIndex((d) => d.key === params[name!])
      return i >= 0 ? i : Math.min(Number(fb ?? 0), dataSets.length - 1)
    })
}

const isCategorical = (v: Var, params: Params) =>
  !!v.text || ((params.categorical ?? []) as string[]).includes(v.key)

const name = (v: Var) => v.title || '(untitled)'

const categoricalField =
  (roles: string): CustomField =>
  ({ label, path, params, onChange, context }) => {
    const vars = otherVariables(context.dataSets, params, roles)
    const chosen = (getPath(params, path) ?? []) as string[]
    const set = (key: string, on: boolean) =>
      onChange(setPath(params, path, on ? [...chosen, key] : chosen.filter((k) => k !== key)))
    return (
      <fieldset className="constraints">
        <legend>{label}</legend>
        {vars.map((v) => (
          <label key={v.key} className="check">
            <input
              type="checkbox"
              checked={!!v.text || chosen.includes(v.key)}
              disabled={!!v.text}
              onChange={(e) => set(v.key, e.target.checked)}
            />
            {name(v)}
            {v.text ? ' (text)' : ''}
          </label>
        ))}
        <div className="help">
          Text variables are always categorical. Check a numeric variable whose values are codes
          (group numbers) to give each value its own parameter.
        </div>
      </fieldset>
    )
  }

const referenceField =
  (roles: string): CustomField =>
  ({ label, path, params, onChange, context }) => {
    const id = useId()
    const vars = otherVariables(context.dataSets, params, roles).filter((v) =>
      isCategorical(v, params),
    )
    const map = (getPath(params, path) ?? {}) as Record<string, string>
    const set = (key: string, level: string) => {
      const next = { ...map }
      if (level) next[key] = level
      else delete next[key]
      onChange(setPath(params, path, next))
    }
    if (!vars.length) return null
    return (
      <fieldset className="constraints">
        <legend>{label}</legend>
        <table>
          <tbody>
            {vars.map((v, i) => (
              <tr key={v.key}>
                <td>
                  <label htmlFor={`${id}-${i}`}>{name(v)}</label>
                </td>
                <td>
                  <select
                    id={`${id}-${i}`}
                    value={map[v.key] ?? ''}
                    onChange={(e) => set(v.key, e.target.value)}
                  >
                    <option value="">Automatic (rule above)</option>
                    {(v.levels ?? []).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="help">
          The reference level gets no parameter; every other level is compared with it.
        </div>
      </fieldset>
    )
  }

/** Every two- and three-way combination of the variables, in order. */
export function combinations(keys: readonly string[]): string[][] {
  const out: string[][] = []
  for (let a = 0; a < keys.length; a++)
    for (let b = a + 1; b < keys.length; b++) out.push([keys[a]!, keys[b]!])
  for (let a = 0; a < keys.length; a++)
    for (let b = a + 1; b < keys.length; b++)
      for (let c = b + 1; c < keys.length; c++) out.push([keys[a]!, keys[b]!, keys[c]!])
  return out
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k) => b.includes(k))

/**
 * Interactions of the variables. `defaultAll`: a null value means every combination (multifactor
 * ANOVA); the first change stores the explicit list.
 */
const interactionsField =
  (roles: string, defaultAll: boolean): CustomField =>
  ({ label, path, params, onChange, context }) => {
    const [showThree, setShowThree] = useState(false)
    let vars = otherVariables(context.dataSets, params, roles)
    const factors = (params.factors ?? []) as string[]
    if (defaultAll && factors.length) vars = vars.filter((v) => factors.includes(v.key))
    const keys = vars.map((v) => v.key)
    const all = combinations(keys)
    const stored = getPath(params, path) as string[][] | null | undefined
    const chosen = stored == null ? (defaultAll ? all : []) : stored
    const has = (c: readonly string[]) => chosen.some((x) => same(x, c))
    const set = (c: string[], on: boolean) =>
      onChange(setPath(params, path, on ? [...chosen, c] : chosen.filter((x) => !same(x, c))))
    const title = (c: readonly string[]) =>
      c.map((k) => name(vars.find((v) => v.key === k)!)).join(' × ')
    const three = all.filter((c) => c.length === 3)
    if (keys.length < 2) return null
    return (
      <fieldset className="constraints">
        <legend>{label}</legend>
        {all
          .filter((c) => c.length === 2)
          .map((c) => (
            <label key={c.join()} className="check">
              <input type="checkbox" checked={has(c)} onChange={(e) => set(c, e.target.checked)} />
              {title(c)}
            </label>
          ))}
        {three.length > 0 && (
          <>
            <button type="button" onClick={() => setShowThree(!showThree)}>
              {showThree ? 'Hide' : 'Show'} three-way interactions
              {three.some(has) ? ` (${three.filter(has).length} chosen)` : ''}
            </button>
            {showThree &&
              three.map((c) => (
                <label key={c.join()} className="check">
                  <input
                    type="checkbox"
                    checked={has(c)}
                    onChange={(e) => set(c, e.target.checked)}
                  />
                  {title(c)}
                </label>
              ))}
          </>
        )}
        <div className="help">
          {defaultAll
            ? 'Every main effect is in the model; by default so is every two- and three-way interaction (none of higher order).'
            : 'An interaction multiplies the variables’ columns (each non-reference level of a categorical one).'}
        </div>
      </fieldset>
    )
  }

/** Variables to use: `emptyMeansAll` shows [] as every variable checked. */
const variablesField =
  (roles: string, emptyMeansAll: boolean): CustomField =>
  ({ label, path, params, onChange, context }) => {
    const vars = otherVariables(context.dataSets, params, roles)
    const stored = (getPath(params, path) ?? []) as string[]
    const chosen = emptyMeansAll && !stored.length ? vars.map((v) => v.key) : stored
    const set = (key: string, on: boolean) => {
      const next = on ? [...chosen, key] : chosen.filter((k) => k !== key)
      onChange(setPath(params, path, emptyMeansAll && next.length === vars.length ? [] : next))
    }
    return (
      <fieldset className="constraints">
        <legend>{label}</legend>
        {vars.map((v) => (
          <label key={v.key} className="check">
            <input
              type="checkbox"
              checked={chosen.includes(v.key)}
              onChange={(e) => set(v.key, e.target.checked)}
            />
            {name(v)}
            {v.text ? ' (text)' : ''}
          </label>
        ))}
      </fieldset>
    )
  }

type Point = Record<string, number | string>

const predictionsField =
  (roles: string): CustomField =>
  ({ label, path, params, onChange, context }) => {
    const vars = otherVariables(context.dataSets, params, roles)
    const points = (getPath(params, path) ?? []) as Point[]
    const set = (next: Point[]) => onChange(setPath(params, path, next))
    const put = (i: number, key: string, value: number | string | undefined) =>
      set(
        points.map((p, j) => {
          if (j !== i) return p
          const q = { ...p }
          if (value === undefined || value === '') delete q[key]
          else q[key] = value
          return q
        }),
      )
    return (
      <fieldset className="constraints">
        <legend>{label}</legend>
        {points.length > 0 && (
          <table>
            <thead>
              <tr>
                <th />
                {vars.map((v) => (
                  <th key={v.key}>{name(v)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: points have no identity but their order
                <tr key={i}>
                  <td>{i + 1}</td>
                  {vars.map((v) => (
                    <td key={v.key}>
                      {isCategorical(v, params) && v.levels ? (
                        <select
                          aria-label={`${name(v)} of point ${i + 1}`}
                          value={p[v.key] === undefined ? '' : String(p[v.key])}
                          onChange={(e) => put(i, v.key, e.target.value)}
                        >
                          <option value="">Reference level</option>
                          {v.levels.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <OptionalNumber
                          label={`${name(v)} of point ${i + 1}`}
                          placeholder="default"
                          value={typeof p[v.key] === 'number' ? (p[v.key] as number) : undefined}
                          onChange={(x) => put(i, v.key, x)}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <button type="button" onClick={() => set(points.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" disabled={!vars.length} onClick={() => set([...points, {}])}>
          Add a row of values
        </button>
        <div className="help">
          A blank number takes its default (the mean of the variable for predictions, 0 for Cox
          survival curves); a categorical variable left at “Reference level” takes its reference
          level.
        </div>
      </fieldset>
    )
  }

const levelField =
  (roles: string): CustomField =>
  ({ label, path, params, onChange, context }) => {
    const id = useId()
    const [i] = roleIndices(context.dataSets, params, roles)
    const v = i === undefined ? undefined : context.dataSets[i]
    if (!v?.text) return null
    const current = String(getPath(params, path) ?? '')
    return (
      <>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={current}
          onChange={(e) => onChange(setPath(params, path, e.target.value))}
        >
          <option value="">—</option>
          {(v.levels ?? []).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </>
    )
  }

const EDITORS: Record<string, (roles: string) => CustomField> = {
  'mv.categorical': categoricalField,
  'mv.reference': referenceField,
  'mv.interactions': (r) => interactionsField(r, false),
  'mv.anovaTerms': (r) => interactionsField(r, true),
  'mv.factors': (r) => variablesField(r, true),
  'mv.variables': (r) => variablesField(r, false),
  'mv.predictions': predictionsField,
  'mv.level': levelField,
}

/** An editor for a component id `mv.<editor>:<roles>`, or undefined. */
export function mvField(component: string): CustomField | undefined {
  const [editor, roles = ''] = component.split(/:(.*)/s)
  const make = EDITORS[editor!]
  return make ? make(roles) : undefined
}

/** Editors for every `mv.*` component the registered analyses' forms use. */
export const MV_FIELDS: Record<string, CustomField> = Object.fromEntries(
  registry
    .list()
    .flatMap((d) => d.form)
    .flatMap((f) => (f.kind === 'custom' && f.component.startsWith('mv.') ? [f.component] : []))
    .map((c) => [c, mvField(c)!] as const)
    .filter(([, f]) => f !== undefined),
)
