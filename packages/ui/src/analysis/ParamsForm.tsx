import type { FormField, ShowIf } from '@ps/model'
import { type ReactNode, useId } from 'react'
import { Field, NumberBox } from '../components/fields.tsx'

type Params = Record<string, unknown>

/** Editors for `kind: 'custom'` fields, keyed by component id. They see and set all params. */
export interface FormContext {
  /**
   * Data sets currently selected for analysis, in table order. Multiple-variables tables: `text`
   * marks a text variable and `levels` lists its values (or a numeric variable's few distinct
   * values) for the editors of categorical variables (`mvFields.tsx`).
   */
  dataSets: { key: string; title: string; text?: boolean; levels?: string[] }[]
  /** Rows of the analyzed table (index and title, "Row n" when untitled). */
  rows?: { index: number; title: string }[]
}

export type CustomField = (props: {
  label: string
  /** Where the field's own value lives in the params. */
  path: readonly string[]
  params: Params
  onChange: (p: Params) => void
  context: FormContext
}) => ReactNode

export function getPath(obj: unknown, path: readonly string[]): unknown {
  let cur = obj
  for (const k of path) cur = (cur as Record<string, unknown> | undefined)?.[k]
  return cur
}

export function setPath(obj: Params, path: readonly string[], value: unknown): Params {
  const [head, ...rest] = path
  if (head === undefined) return obj
  return {
    ...obj,
    [head]: rest.length ? setPath((obj[head] as Params | undefined) ?? {}, rest, value) : value,
  }
}

/** Renders an analysis' declarative form against a params object. */
export function ParamsForm({
  fields,
  value,
  onChange,
  custom = {},
  context = { dataSets: [] },
}: {
  fields: readonly FormField[]
  value: Params
  onChange: (v: Params) => void
  custom?: Readonly<Record<string, CustomField>>
  context?: FormContext
}) {
  const base = useId()
  return (
    <div className="params-form">
      {fields.map((f, i) => {
        const conditions = f.showIf ? (Array.isArray(f.showIf) ? f.showIf : [f.showIf]) : []
        if (!conditions.every((c: ShowIf) => c.in.includes(getPath(value, c.path)))) return null
        // The radio buttons' shared name.
        const name = `${base}-${i}`
        const current = getPath(value, f.path)
        const update = (v: unknown) => onChange(setPath(value, f.path, v))
        switch (f.kind) {
          case 'custom': {
            const Editor = custom[f.component]
            return Editor ? (
              <div key={f.path.join('.')} className="field">
                <Editor
                  label={f.label}
                  path={f.path}
                  params={value}
                  onChange={onChange}
                  context={context}
                />
              </div>
            ) : null
          }
          case 'checkbox':
            return (
              <label key={f.path.join('.')} className="check field">
                <input
                  type="checkbox"
                  checked={!!current}
                  onChange={(e) => update(e.target.checked)}
                />
                {f.label}
                {f.help && <span className="help">{f.help}</span>}
              </label>
            )
          case 'radio':
            return (
              <fieldset key={f.path.join('.')} className="field radio">
                <legend>{f.label}</legend>
                {f.options.map((o) => (
                  <label key={String(o.value)} className="check">
                    <input
                      type="radio"
                      name={name}
                      checked={current === o.value}
                      onChange={() => update(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
                {f.help && <div className="help">{f.help}</div>}
              </fieldset>
            )
          case 'select':
            return (
              <Field key={f.path.join('.')} label={f.label} help={f.help}>
                {(id, describedBy) => (
                  <select
                    id={id}
                    aria-describedby={describedBy}
                    value={String(current)}
                    onChange={(e) =>
                      update(f.options.find((o) => String(o.value) === e.target.value)?.value)
                    }
                  >
                    {f.options.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )
          case 'number':
            return (
              <Field key={f.path.join('.')} label={f.label} help={f.help}>
                {(id, describedBy) => (
                  <NumberBox
                    id={id}
                    aria-describedby={describedBy}
                    value={Number(current)}
                    min={f.min}
                    max={f.max}
                    onChange={update}
                  />
                )}
              </Field>
            )
        }
        return null
      })}
    </div>
  )
}
