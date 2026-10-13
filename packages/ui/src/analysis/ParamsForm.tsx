import { type FieldState, fieldStates } from '@ps/analyses'
import type { AnalysisFacts, FormField, FormOption, OptionExplain } from '@ps/model'
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
  /**
   * Roadmap 51c, 51b: facts about the chosen data (`FormField.unavailableIf`, `appliesTo` and
   * the options' `unavailable`); the ones not given don't restrict anything.
   */
  facts?: Partial<AnalysisFacts>
}

/**
 * Facts that restrict nothing (a form shown without data, e.g. Monte Carlo's inner analysis):
 * every field and option the params allow is offered.
 */
const OPEN_FACTS: AnalysisFacts = {
  raw: true,
  hasX: true,
  twoByTwo: true,
  missingInMatched: false,
  groups: 99,
  dataSets: 99,
  maxPerCell: 99,
  rows: 99,
  columns: 2,
  factors: 99,
  modelComparison: true,
  modelsNested: true,
}

/** The facts a form is checked against: those given, open for the rest. */
export const factsOf = (context: FormContext): AnalysisFacts => ({
  ...OPEN_FACTS,
  ...(context.facts ?? {}),
})

/**
 * Roadmap 51c: a label with the chosen data sets' names — `{A}` the first, `{B}` the second
 * ("Treated higher than Control" for a one-tailed test's direction).
 */
export function named(label: string, context: FormContext): string {
  if (!label.includes('{')) return label
  const [a, b] = context.dataSets
  return label
    .replaceAll('{A}', a?.title ? `“${a.title}”` : 'the first group')
    .replaceAll('{B}', b?.title ? `“${b.title}”` : 'the second group')
}

/** A fraction shown as a percentage, without binary noise (0.05 → 5). */
const percentOf = (v: number) => +(v * 100).toPrecision(12)

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

/** Whether a field has a card to show behind ⓘ (its own, or an option's). */
export const hasCard = (field: FormField) =>
  !!field.explain?.card || ('options' in field && field.options.some((o) => !!o.explain?.card))

/**
 * Roadmap 51a: ⓘ beside a question. Roadmap 51b: in the Analyze dialog it shows the card in the
 * side panel (`onInfo`, the button controlling it); elsewhere the card opens under the question.
 */
function Info({
  field,
  label,
  onInfo,
  panelId,
  shown,
}: {
  field: FormField
  label: string
  onInfo?: (f: FormField) => void
  panelId?: string
  /** The field whose card the side panel shows. */
  shown?: FormField | null
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!hasCard(field)) return null
  return (
    <>
      <button
        type="button"
        className="info-button"
        aria-expanded={onInfo ? shown === field : open}
        aria-controls={onInfo ? panelId : id}
        aria-label={`About “${label}”`}
        title={`About “${label}”`}
        onClick={(e) => {
          e.preventDefault()
          if (onInfo) onInfo(field)
          else setOpen(!open)
        }}
      >
        ⓘ
      </button>
      {!onInfo && open && <FieldCard id={id} field={field} />}
    </>
  )
}

/** A field's card and its options' cards. */
export function FieldCard({ field, id }: { field: FormField; id?: string }) {
  const options = 'options' in field ? field.options.filter((o) => o.explain?.card) : []
  return (
    <span id={id} className="explain-card" role="note">
      {field.explain?.card && <span className="explain-para">{field.explain.card}</span>}
      {options.map((o) => (
        <span key={String(o.value)} className="explain-para">
          <strong>{o.label}:</strong> {o.explain!.card}
        </span>
      ))}
    </span>
  )
}

/** Renders an analysis' declarative form against a params object. */
export function ParamsForm({
  fields,
  value,
  onChange,
  custom = {},
  context = { dataSets: [] },
  states,
  onInfo,
  infoPanel,
  infoShown,
}: {
  fields: readonly FormField[]
  value: Params
  onChange: (v: Params) => void
  custom?: Readonly<Record<string, CustomField>>
  context?: FormContext
  /**
   * Roadmap 51b: the fields' states (shown, greyed, options greyed) when the caller has worked
   * them out (the dialog, by tier); else from `context.facts`.
   */
  states?: readonly FieldState[]
  /** Roadmap 51b: ⓘ shows the field's card in the dialog's side panel (`infoPanel`, its id). */
  onInfo?: (f: FormField) => void
  infoPanel?: string
  /** The field whose card the side panel shows (its ⓘ is expanded). */
  infoShown?: FormField | null
}) {
  const base = useId()
  const list = states ?? fieldStates(fields, value, factsOf(context))
  return (
    <div className="params-form">
      {list.map((s, i) => {
        const f = s.field
        if (!s.shown) return null
        const unavailable = s.unavailable
        // The radio buttons' shared name, and the ids of the lines that describe them.
        const name = `${base}-${i}`
        const lineId = `${name}-line`
        const problemId = `${name}-problem`
        const current = getPath(value, f.path)
        const update = (v: unknown) => onChange(setPath(value, f.path, v))
        const line = f.explain?.line
        // Copies of a field at one path (Welch's methods under each choice) differ by label.
        const fkey = `${f.path.join('.')}:${f.label}`
        const info = (
          <Info
            key="info"
            field={f}
            label={f.label}
            onInfo={onInfo}
            panelId={infoPanel}
            shown={infoShown}
          />
        )
        const problem = s.problem && (
          <div key="problem" id={problemId} className="help unavailable-reason" role="alert">
            Change this: {s.problem}
          </div>
        )
        switch (f.kind) {
          case 'custom': {
            const Editor = custom[f.component]
            return Editor ? (
              <div
                key={fkey}
                className={`field${unavailable ? ' unavailable' : ''}`}
                aria-disabled={unavailable ? true : undefined}
              >
                {unavailable && <div className="help unavailable-reason">{unavailable}</div>}
                <fieldset className="plain" disabled={!!unavailable}>
                  <Editor
                    label={f.label}
                    path={f.path}
                    params={value}
                    onChange={onChange}
                    context={context}
                  />
                </fieldset>
                {line && (
                  <div className="help explain">
                    {line}
                    {info}
                  </div>
                )}
              </div>
            ) : null
          }
          case 'checkbox':
            return (
              <div key={fkey} className={`field check-field${unavailable ? ' unavailable' : ''}`}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!current}
                    aria-disabled={unavailable ? true : undefined}
                    aria-describedby={
                      [unavailable ? problemId : '', line ? lineId : '']
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    onChange={(e) => {
                      if (!unavailable) update(e.target.checked)
                    }}
                  />
                  {f.label}
                </label>
                {unavailable && (
                  <div id={problemId} className="help unavailable-reason">
                    {unavailable}
                  </div>
                )}
                {line && (
                  <div id={lineId} className="help explain">
                    {line}
                    {info}
                  </div>
                )}
              </div>
            )
          case 'radio':
            return (
              <fieldset
                key={fkey}
                className={`field radio${unavailable ? ' unavailable' : ''}`}
                aria-describedby={line ? lineId : undefined}
                disabled={!!unavailable}
              >
                <legend>{named(f.label, context)}</legend>
                {unavailable && <div className="help unavailable-reason">{unavailable}</div>}
                {problem}
                {line && (
                  <div id={lineId} className="help explain">
                    {line}
                    {info}
                  </div>
                )}
                {f.options.map((o, k) => {
                  const text = optionText(o)
                  const oid = `${name}-o${k}`
                  const rid = `${name}-r${k}`
                  const reason = s.options.get(String(o.value))
                  return (
                    <div
                      key={String(o.value)}
                      className={`radio-option${reason ? ' unavailable' : ''}`}
                    >
                      <label className="check">
                        <input
                          type="radio"
                          name={name}
                          checked={current === o.value}
                          aria-disabled={reason ? true : undefined}
                          aria-describedby={
                            [reason ? rid : '', text ? oid : ''].filter(Boolean).join(' ') ||
                            undefined
                          }
                          onChange={() => {
                            if (!reason) update(o.value)
                          }}
                        />
                        {named(o.label, context)}
                      </label>
                      {reason && (
                        <div id={rid} className="option-line unavailable-reason">
                          {reason}
                        </div>
                      )}
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
            const greyed = f.options.filter((o) => s.options.has(String(o.value)) && o !== chosen)
            return (
              <Field
                key={fkey}
                label={f.label}
                className={unavailable ? 'unavailable' : undefined}
                help={
                  line || chosen?.explain || tagged.length || greyed.length || s.problem ? (
                    <>
                      {s.problem && (
                        <span className="unavailable-reason" role="alert">
                          Change this: {s.problem}
                        </span>
                      )}
                      {line && (
                        <span className="explain">
                          {line}
                          {info}
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
                      {greyed.map((o) => (
                        <span
                          key={`u${String(o.value)}`}
                          className="option-line unavailable-reason"
                        >
                          {o.label}: {s.options.get(String(o.value))}
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
                    disabled={!!unavailable}
                    onChange={(e) =>
                      update(f.options.find((o) => String(o.value) === e.target.value)?.value)
                    }
                  >
                    {f.options.map((o) => (
                      <option
                        key={String(o.value)}
                        value={String(o.value)}
                        disabled={s.options.has(String(o.value)) && o !== chosen}
                      >
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )
          }
          case 'number': {
            // S34: a fraction shown and typed as a percentage.
            const pc = f.percent ? percentOf : (v: number) => v
            return (
              <Field key={fkey} label={f.label} help={line}>
                {(id, describedBy) => (
                  <NumberBox
                    id={id}
                    aria-describedby={describedBy}
                    value={pc(Number(current))}
                    min={f.min === undefined ? undefined : pc(f.min)}
                    max={f.max === undefined ? undefined : pc(f.max)}
                    onChange={(v) => update(f.percent ? v / 100 : v)}
                  />
                )}
              </Field>
            )
          }
        }
        return null
      })}
    </div>
  )
}
