import { AGGREGATE_STATS, type AggregateStat } from '@ps/analyses'
import { formulaSyntaxError } from '@ps/model'
import { useId, useState } from 'react'
import { Field } from '../components/fields.tsx'
import {
  CONDITION_OPS,
  type Condition,
  type ConditionGroups,
  conditionFormula,
  needsValue,
  parseCondition,
} from './condition.ts'
import { type CustomField, type FormContext, getPath, setPath } from './ParamsForm.tsx'

// Roadmap 38: the Analyze dialog's editors for Filter rows' condition (`filter.condition`) and
// Aggregate's statistics (`aggregate.stats`).

type Variable = FormContext['dataSets'][number]

/** The variable a condition names (as written: any case, `_` for spaces), by title. */
function variableOf(variables: readonly Variable[], name: string): Variable | undefined {
  const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const k = key(name)
  return (
    variables.find((v) => key(v.title) === k) ??
    variables.find((v) => key(v.title) === key(name.replace(/_/g, ' ')))
  )
}

/**
 * A condition on rows: built from (variable, operator, value) rows, AND within a group and OR
 * between groups, or typed as a formula. `onChange` gets the formula (empty: no condition).
 */
function ConditionEditor({
  variables,
  value,
  onChange,
}: {
  variables: readonly Variable[]
  value: string
  onChange: (formula: string) => void
}) {
  const id = useId()
  const parsed = parseCondition(value)
  const [typed, setTyped] = useState(parsed === null)
  const [groups, setGroups] = useState<ConditionGroups>(() => {
    const g = parsed ?? [[]]
    const fixed = g.map((conds) =>
      conds.map((c) => ({
        ...c,
        variable: variableOf(variables, c.variable)?.title ?? c.variable,
      })),
    )
    return fixed.length
      ? fixed.map((c) => (c.length ? c : [blankCondition(variables)]))
      : [[blankCondition(variables)]]
  })
  const isText = (title: string) => !!variableOf(variables, title)?.text
  const write = (next: ConditionGroups) => {
    setGroups(next)
    const f = conditionFormula(next, isText)
    if (f !== null) onChange(f)
  }
  const incomplete = !typed && conditionFormula(groups, isText) === null
  const syntax = typed && value.trim() ? formulaSyntaxError(value) : null

  const edit = (gi: number, ci: number, patch: Partial<Condition>) =>
    write(
      groups.map((g, i) => (i !== gi ? g : g.map((c, j) => (j !== ci ? c : { ...c, ...patch })))),
    )

  return (
    <fieldset className="condition-editor">
      <legend>Keep the rows where</legend>
      <div className="field-row">
        <label className="check">
          <input
            type="radio"
            name={`${id}-mode`}
            checked={!typed}
            onChange={() => {
              const p = parseCondition(value)
              if (p) setGroups(p.map((g) => (g.length ? g : [blankCondition(variables)])))
              setTyped(false)
            }}
            disabled={parseCondition(value) === null && value.trim() !== ''}
          />
          Build the condition
        </label>
        <label className="check">
          <input type="radio" name={`${id}-mode`} checked={typed} onChange={() => setTyped(true)} />
          Type a formula
        </label>
      </div>
      {typed ? (
        <Field label="Condition (formula)">
          {(formulaId) => (
            <>
              <input
                id={formulaId}
                className="formula-input"
                value={value}
                placeholder='sample = "S1" and nCount > 500'
                spellCheck={false}
                aria-describedby={`${formulaId}-help`}
                onChange={(e) => onChange(e.target.value)}
              />
              {/* Not Field's help: it turns red with a syntax error. */}
              <div id={`${formulaId}-help`} className={`help${syntax ? ' error' : ''}`}>
                {syntax ??
                  'The formula language: and, or, not, comparisons, functions (Row, X and Row_title name rows).'}
              </div>
            </>
          )}
        </Field>
      ) : (
        <>
          {groups.map((g, gi) => (
            <fieldset
              className="condition-group"
              // biome-ignore lint/suspicious/noArrayIndexKey: a group is its place in the list
              key={gi}
              aria-label={`Condition group ${gi + 1}`}
            >
              {gi > 0 && <div className="condition-or">or</div>}
              {g.map((c, ci) => {
                const v = variableOf(variables, c.variable)
                const ops = CONDITION_OPS.filter((o) => (v?.text ? o.text : o.number))
                const listId = `${id}-levels-${gi}-${ci}`
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a condition is its place in the group
                  <div className="condition-row" key={ci}>
                    <span className="condition-and">{ci > 0 ? 'and' : ''}</span>
                    <select
                      aria-label="Variable"
                      value={v?.title ?? ''}
                      onChange={(e) => {
                        const next = variables.find((x) => x.title === e.target.value)
                        const op =
                          next?.text && !CONDITION_OPS.find((o) => o.op === c.op)?.text ? '=' : c.op
                        edit(gi, ci, { variable: e.target.value, op })
                      }}
                    >
                      {variables.map((x) => (
                        <option key={x.key} value={x.title}>
                          {x.title || '(untitled)'}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Operator"
                      value={c.op}
                      onChange={(e) => edit(gi, ci, { op: e.target.value as Condition['op'] })}
                    >
                      {ops.map((o) => (
                        <option key={o.op} value={o.op}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {needsValue(c.op) && (
                      <>
                        <input
                          aria-label="Value"
                          value={c.value}
                          list={v?.levels?.length ? listId : undefined}
                          inputMode={v?.text ? undefined : 'decimal'}
                          onChange={(e) => edit(gi, ci, { value: e.target.value })}
                        />
                        {!!v?.levels?.length && (
                          <datalist id={listId}>
                            {v.levels.slice(0, 200).map((l) => (
                              <option key={l} value={l} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      aria-label="Remove condition"
                      title="Remove this condition"
                      onClick={() => {
                        const left = g.filter((_, j) => j !== ci)
                        write(
                          left.length
                            ? groups.map((x, i) => (i === gi ? left : x))
                            : groups.length > 1
                              ? groups.filter((_, i) => i !== gi)
                              : [[blankCondition(variables)]],
                        )
                      }}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() =>
                  write(groups.map((x, i) => (i === gi ? [...x, blankCondition(variables)] : x)))
                }
              >
                + And
              </button>
            </fieldset>
          ))}
          <button type="button" onClick={() => write([...groups, [blankCondition(variables)]])}>
            + Or
          </button>
          <div className={`help${incomplete ? ' error' : ''}`}>
            {incomplete
              ? 'Give each condition a value (numbers for number variables).'
              : value
                ? `Formula: ${value}`
                : ''}
          </div>
        </>
      )}
    </fieldset>
  )
}

const blankCondition = (variables: readonly Variable[]): Condition => ({
  variable: variables[0]?.title ?? '',
  op: '=',
  value: '',
})

const ConditionField: CustomField = ({ path, params, onChange, context }) => (
  <ConditionEditor
    variables={context.dataSets}
    value={String(getPath(params, path) ?? '')}
    onChange={(f) => onChange(setPath(params, path, f))}
  />
)

const STAT_LABELS: Record<AggregateStat, string> = {
  mean: 'Mean',
  median: 'Median',
  sd: 'SD',
  sem: 'SEM',
  n: 'n (values)',
  min: 'Minimum',
  max: 'Maximum',
  sum: 'Sum',
  pctAbove: '% of values above the threshold',
  pctNonzero: '% of values that aren’t zero',
}

const StatsField: CustomField = ({ label, path, params, onChange, context }) => {
  const chosen = (getPath(params, path) ?? []) as AggregateStat[]
  const groups = context.dataSets.filter((d) => d.text)
  return (
    <fieldset className="field radio">
      <legend>{label}</legend>
      {AGGREGATE_STATS.map((s) => (
        <label key={s} className="check">
          <input
            type="checkbox"
            checked={chosen.includes(s)}
            onChange={(e) =>
              onChange(
                setPath(
                  params,
                  path,
                  AGGREGATE_STATS.filter((x) => (x === s ? e.target.checked : chosen.includes(x))),
                ),
              )
            }
          />
          {STAT_LABELS[s]}
        </label>
      ))}
      <div className="help">
        {groups.length
          ? `One row per group of ${groups.map((g) => g.title).join(' × ')}; statistics of each number variable chosen.`
          : 'Choose a text variable among the data sets to group the rows by.'}
      </div>
    </fieldset>
  )
}

/** Roadmap 38's custom form editors, by component id. */
export const DATA_FIELDS: Record<string, CustomField> = {
  'filter.condition': ConditionField,
  'aggregate.stats': StatsField,
}
