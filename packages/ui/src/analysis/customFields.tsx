import {
  type Constraint,
  EQUATIONS,
  effectiveConstraint,
  equation,
  type FitModel,
  nestedRelatives,
  parseEquation,
  resolveEquation,
  USER_EQUATION,
} from '@ps/analyses'
import { useId } from 'react'
import { NumberBox, OptionalNumber } from '../components/fields.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { type CustomField, getPath, setPath } from './ParamsForm.tsx'

type Params = Record<string, unknown>

export function EquationSelect({
  id,
  value,
  onChange,
  includeNone,
  sameOption,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  includeNone?: boolean
  /** Offer "Same as the model above" under this value (per-data-set equations). */
  sameOption?: string
}) {
  const categories = [...new Set(EQUATIONS.map((e) => e.category))]
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeNone && <option value="none">Don’t compare</option>}
      {sameOption && <option value={sameOption}>Same as the model above</option>}
      {!includeNone && !sameOption && (
        <optgroup label="User-defined">
          <option value={USER_EQUATION}>User-defined equation…</option>
        </optgroup>
      )}
      {categories.map((c) => (
        <optgroup key={c} label={c}>
          {EQUATIONS.filter((e) => e.category === c).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

const USER_EXAMPLE = 'Y = Bottom + (Top - Bottom)/(1 + 10^((LogEC50 - X)*HillSlope))'

/** The text of a user-defined equation, checked as you type. */
const UserEquationField: CustomField = ({ label, params, onChange }) => {
  const id = useId()
  const text = String(params.userEquation ?? '')
  const parsed = text.trim() ? parseEquation(text) : null
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="equation-text"
        rows={4}
        spellCheck={false}
        placeholder={USER_EXAMPLE}
        value={text}
        onChange={(e) => onChange({ ...params, userEquation: e.target.value })}
      />
      {parsed === null ? (
        <div className="help">
          One statement per line, e.g. {USER_EXAMPLE}. Unknown names are parameters; a name assigned
          first on the left is an intermediate variable. The usual functions work (gamma, erf,
          zdist, tdist, besselj…); <code>&lt;A&gt;</code>, <code>&lt;~A&gt;</code>,{' '}
          <code>&lt;B:D&gt;</code> start lines for particular data sets; <code>Y' = …</code> is a
          differential equation (starting from <code>Y[0]</code> at X = 0, or <code>X[0] = …</code>
          ); Y on both sides is an implicit equation.
        </div>
      ) : parsed.ok ? (
        <div className="help">
          {parsed.program.kind === 'differential'
            ? 'Differential equation. '
            : parsed.program.kind === 'implicit'
              ? 'Implicit equation. '
              : ''}
          Parameters: {parsed.parameters.join(', ') || '(none)'}
          {parsed.variables.length ? ` · intermediate: ${parsed.variables.join(', ')}` : ''}
        </div>
      ) : (
        <div className="error-text" role="alert">
          Line {parsed.line}, column {parsed.column}: {parsed.message}
        </div>
      )}
    </>
  )
}

/** The model the params describe (built-in or user-defined), or null while it has an error. */
function modelOf(params: Params): FitModel | null {
  const r = resolveEquation(params as Parameters<typeof resolveEquation>[0])
  return r.ok ? r.model : null
}

/**
 * Roadmap 51e (§9.4): the model to compare with — the models nested with this one first (one a
 * special case of the other: the F test applies), then every other model (AICc only).
 */
const CompareField: CustomField = ({ label, params, onChange }) => {
  const id = useId()
  const current = String(params.equation ?? '')
  const nested = current === USER_EQUATION ? [] : nestedRelatives(current)
  const others = EQUATIONS.filter((e) => e.id !== current && !nested.includes(e.id))
  const categories = [...new Set(others.map((e) => e.category))]
  const value = String(params.compareWith ?? 'none')
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange({ ...params, compareWith: e.target.value })}
      >
        <option value="none">Don’t compare</option>
        {nested.length > 0 && (
          <optgroup label="Nested with this model (F test or AICc)">
            {nested.map((m) => (
              <option key={m} value={m}>
                {equation(m)?.name}
              </option>
            ))}
          </optgroup>
        )}
        {categories.map((c) => (
          <optgroup key={c} label={`${c} (AICc only)`}>
            {others
              .filter((e) => e.category === c)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <div className="help">
        {value === 'none'
          ? 'The models listed first are nested with this one: the F test applies to them.'
          : nested.includes(value)
            ? 'Nested models: compare them by the F test or AICc, chosen below.'
            : 'These models aren’t nested: they are compared by AICc.'}
      </div>
    </>
  )
}

function ConstraintRow({
  eq,
  name,
  params,
  onChange,
}: {
  eq: FitModel
  name: string
  params: Params
  onChange: (p: Params) => void
}) {
  const constraints = (params.constraints ?? {}) as Record<string, Constraint>
  const current = effectiveConstraint(eq, name, { constraints })
  const set = (c: Constraint) => onChange({ ...params, constraints: { ...constraints, [name]: c } })
  const info = eq.paramInfo[name]
  return (
    <tr>
      <td title={info?.description}>
        <strong>{name}</strong>
        {info?.description && <div className="help">{info.description}</div>}
      </td>
      <td>
        <select
          aria-label={`${name} constraint`}
          value={current.kind}
          onChange={(e) => {
            const kind = e.target.value as Constraint['kind']
            set(
              kind === 'constant'
                ? { kind, value: current.kind === 'constant' ? current.value : 0 }
                : { kind },
            )
          }}
        >
          <option value="fit">Fit</option>
          <option value="constant">Constant equal to</option>
          <option value="shared">Shared for all data sets</option>
          <option value="dataSetConstant">Data set constant (the column title)</option>
          <option value="meanX">Data set constant (= mean X)</option>
        </select>
      </td>
      <td>
        {current.kind === 'constant' && (
          <NumberBox
            aria-label={`${name} value`}
            value={current.value}
            onChange={(v) => set({ kind: 'constant', value: v })}
          />
        )}
      </td>
    </tr>
  )
}

const ConstraintsField: CustomField = ({ label, params, onChange }) => {
  const eq = modelOf(params)
  if (!eq) return null
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <tbody>
          {eq.params.map((name) => (
            <ConstraintRow key={name} eq={eq} name={name} params={params} onChange={onChange} />
          ))}
        </tbody>
      </table>
      <div className="help">
        Sharing a parameter fits all data sets together (global fit). A data set constant takes each
        data set’s value from its column title (e.g. the inhibitor concentration).
      </div>
    </fieldset>
  )
}

/** Starting values: automatic (built-in rules) or 1 (user equations) unless set here. */
const InitialValuesField: CustomField = ({ label, params, onChange }) => {
  const eq = modelOf(params)
  if (!eq) return null
  const user = params.equation === USER_EQUATION
  const values = (params.initialValues ?? {}) as Record<string, number>
  const set = (name: string, v: number | undefined) => {
    const next = { ...values }
    if (v === undefined) delete next[name]
    else next[name] = v
    onChange({ ...params, initialValues: next })
  }
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <tbody>
          {eq.params.map((name) => (
            <tr key={name}>
              <td>
                <strong>{name}</strong>
              </td>
              <td>
                <OptionalNumber
                  label={`${name} initial value`}
                  placeholder={user ? '1' : 'Automatic'}
                  value={values[name]}
                  onChange={(v) => set(name, v)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="help">
        {user
          ? 'Parameters start at 1 unless set here; a start near the answer helps the fit.'
          : 'Leave empty to use the equation’s automatic starting values.'}
      </div>
    </fieldset>
  )
}

/** "Must be greater than / less than" limits per parameter. */
const LimitsField: CustomField = ({ label, params, onChange }) => {
  const eq = modelOf(params)
  if (!eq) return null
  const limits = (params.limits ?? {}) as Record<string, { min?: number; max?: number }>
  const set = (name: string, key: 'min' | 'max', v: number | undefined) => {
    const cur = { ...(limits[name] ?? {}) }
    if (v === undefined) delete cur[key]
    else cur[key] = v
    const next = { ...limits }
    if (cur.min === undefined && cur.max === undefined) delete next[name]
    else next[name] = cur
    onChange({ ...params, limits: next })
  }
  return (
    <fieldset className="constraints">
      <legend>{label}</legend>
      <table>
        <thead>
          <tr>
            <th />
            <th>Greater than</th>
            <th>Less than</th>
          </tr>
        </thead>
        <tbody>
          {eq.params.map((name) => (
            <tr key={name}>
              <td>
                <strong>{name}</strong>
              </td>
              {(['min', 'max'] as const).map((k) => (
                <td key={k}>
                  <OptionalNumber
                    label={`${name} ${k === 'min' ? 'lower' : 'upper'} limit`}
                    value={limits[name]?.[k]}
                    onChange={(v) => set(name, k, v)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  )
}

/**
 * Picks one of the analyzed data sets (a control column, a Y variable…) into the field's path;
 * unset, the one at index `fallback`, or with `fallback` null "(none)" ('').
 */
export const dataSetField =
  (fallback: number | null, textOnly = false): CustomField =>
  ({ label, path, params, onChange, context: all }) => {
    const id = useId()
    // Text variables only (a grouping variable, roadmap 34c).
    const context = textOnly ? { ...all, dataSets: all.dataSets.filter((d) => d.text) } : all
    const current = getPath(params, path)
    const value = context.dataSets.some((d) => d.key === current)
      ? String(current)
      : fallback === null
        ? ''
        : (context.dataSets[Math.min(fallback, context.dataSets.length - 1)]?.key ?? '')
    return (
      <>
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(setPath(params, path, e.target.value))}
        >
          {fallback === null && <option value="">(none)</option>}
          {context.dataSets.map((d) => (
            <option key={d.key} value={d.key}>
              {d.title || '(untitled)'}
            </option>
          ))}
        </select>
      </>
    )
  }

export const CUSTOM_FIELDS: Record<string, CustomField> = {
  'dataset.control': dataSetField(0),
  'dataset.pick': dataSetField(0),
  'dataset.pick:1': dataSetField(1),
  // Roadmap 34c: an optional text variable among those analyzed (PCA's "Group by").
  'dataset.pickText': dataSetField(null, true),
  'nlfit.equation': ModelPicker,
  'nlfit.userEquation': UserEquationField,
  'nlfit.constraints': ConstraintsField,
  'nlfit.initialValues': InitialValuesField,
  'nlfit.limits': LimitsField,
  'nlfit.compare': CompareField,
}
