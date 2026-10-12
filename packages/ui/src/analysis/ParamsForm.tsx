import type { FormField, FormOption, OptionExplain, ShowIf } from '@ps/model'
import { type ReactNode, useId, useState } from 'react'
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

/** Roadmap 51a: an option's tag reason, as a sentence ("Recommended: …"). */
export const tagText = (e: OptionExplain | undefined): string | null =>
  e?.tag
    ? `${e.tag.kind === 'recommended' ? 'Recommended' : 'Not recommended'}: ${e.tag.why}.`
    : null

/** An option's line and its tag's reason. */
const optionText = (o: FormOption) =>
  [o.explain?.line, tagText(o.explain)].filter(Boolean).join(' ')

/**
 * Roadmap 51a: ⓘ beside a question, showing its card and its options' cards under it (the side
 * panel arrives with the new dialog, 51b).
 */
function Info({ field, label }: { field: FormField; label: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const options = 'options' in field ? field.options.filter((o) => o.explain?.card) : []
  if (!field.explain?.card && !options.length) return null
  return (
    <>
      <button
        type="button"
        className="info-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`About “${label}”`}
        title={`About “${label}”`}
        onClick={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
      >
        ⓘ
      </button>
      {open && (
        <span id={id} className="explain-card" role="note">
          {field.explain?.card && <span className="explain-para">{field.explain.card}</span>}
          {options.map((o) => (
            <span key={String(o.value)} className="explain-para">
              <strong>{o.label}:</strong> {o.explain!.card}
            </span>
          ))}
        </span>
      )}
    </>
  )
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
        // The radio buttons' shared name, and the ids of the lines that describe them.
        const name = `${base}-${i}`
        const lineId = `${name}-line`
        const current = getPath(value, f.path)
        const update = (v: unknown) => onChange(setPath(value, f.path, v))
        const line = f.explain?.line
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
                {line && <div className="help explain">{line}</div>}
              </div>
            ) : null
          }
          case 'checkbox':
            return (
              <div key={f.path.join('.')} className="field check-field">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!current}
                    aria-describedby={line ? lineId : undefined}
                    onChange={(e) => update(e.target.checked)}
                  />
                  {f.label}
                </label>
                {line && (
                  <div id={lineId} className="help explain">
                    {line}
                    <Info field={f} label={f.label} />
                  </div>
                )}
              </div>
            )
          case 'radio':
            return (
              <fieldset
                key={f.path.join('.')}
                className="field radio"
                aria-describedby={line ? lineId : undefined}
              >
                <legend>{f.label}</legend>
                {line && (
                  <div id={lineId} className="help explain">
                    {line}
                    <Info field={f} label={f.label} />
                  </div>
                )}
                {f.options.map((o, k) => {
                  const text = optionText(o)
                  const oid = `${name}-o${k}`
                  return (
                    <div key={String(o.value)} className="radio-option">
                      <label className="check">
                        <input
                          type="radio"
                          name={name}
                          checked={current === o.value}
                          aria-describedby={text ? oid : undefined}
                          onChange={() => update(o.value)}
                        />
                        {o.label}
                      </label>
                      {text && (
                        <div id={oid} className="option-line">
                          {text}
                        </div>
                      )}
                    </div>
                  )
                })}
              </fieldset>
            )
          case 'select': {
            const chosen = f.options.find((o) => o.value === current)
            // The reason beside every "(recommended)" the list shows, and the chosen one's line.
            const tagged = f.options.filter((o) => o.explain?.tag && o !== chosen)
            return (
              <Field
                key={f.path.join('.')}
                label={f.label}
                help={
                  line || chosen?.explain || tagged.length ? (
                    <>
                      {line && (
                        <span className="explain">
                          {line}
                          <Info field={f} label={f.label} />
                        </span>
                      )}
                      {chosen?.explain && (
                        <span className="option-line">
                          {chosen.label}: {optionText(chosen)}
                        </span>
                      )}
                      {tagged.map((o) => (
                        <span key={String(o.value)} className="option-line">
                          {o.label}: {tagText(o.explain)}
                        </span>
                      ))}
                    </>
                  ) : undefined
                }
              >
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
          }
          case 'number':
            return (
              <Field key={f.path.join('.')} label={f.label} help={line}>
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
