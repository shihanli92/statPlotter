import { accepts, type RoleAssignment, type RoleVariable } from '@ps/analyses/dialog'
import type { AnalysisRole } from '@ps/model'
import { type DragEvent, useId, useRef } from 'react'

// Roadmap 51b (design §4.7, U12): the roles of a multiple-variables analysis as boxes — Outcome,
// Predictors, Factors, Time, Event, Group by — that variables are added to with a menu (or
// dragged between). A variable is in one role at most; the outcome is never also a predictor.

const typeText = { number: 'number', text: 'text', binary: 'coded 0/1' } as const

export function RoleBoxes({
  roles,
  variables,
  assignment,
  onChange,
  leftOut,
}: {
  roles: readonly AnalysisRole[]
  variables: readonly RoleVariable[]
  assignment: RoleAssignment
  onChange: (a: RoleAssignment) => void
  /** Variables left out of a list role at the start, named in a note (PCA's coded and text). */
  leftOut?: readonly RoleVariable[]
}) {
  const id = useId()
  const drag = useRef<string | null>(null)
  const name = (key: string) => variables.find((v) => v.key === key)?.title || '(untitled)'

  const put = (key: string, to: AnalysisRole) => {
    const next: RoleAssignment = {}
    for (const r of roles) next[r.id] = (assignment[r.id] ?? []).filter((k) => k !== key)
    const list = next[to.id] ?? []
    // A role of one variable takes the new one in place of the old.
    next[to.id] = to.max === 1 ? [key] : [...list, key]
    onChange(next)
  }
  const boxes = useRef(new Map<string, HTMLFieldSetElement | null>())
  const remove = (key: string, from: AnalysisRole) => {
    const members = assignment[from.id] ?? []
    const i = members.indexOf(key)
    onChange({ ...assignment, [from.id]: members.filter((k) => k !== key) })
    // Audit 4 (A12): the focus stays in the box — the next ×, else the previous, else Add….
    setTimeout(() => {
      const box = boxes.current.get(from.id)
      const xs = box?.querySelectorAll<HTMLElement>('.chip-remove')
      ;(xs?.[i] ?? xs?.[i - 1] ?? box?.querySelector<HTMLElement>('select'))?.focus()
    }, 0)
  }
  const drop = (e: DragEvent, to: AnalysisRole) => {
    e.preventDefault()
    const key = drag.current
    drag.current = null
    const v = variables.find((x) => x.key === key)
    if (v && accepts(to, v)) put(v.key, to)
  }

  return (
    <div className="role-boxes">
      {roles.map((r) => {
        const members = assignment[r.id] ?? []
        const offered = variables.filter((v) => accepts(r, v) && !members.includes(v.key))
        const boxId = `${id}-${r.id}`
        return (
          <fieldset
            key={r.id}
            ref={(el) => {
              boxes.current.set(r.id, el)
            }}
            className={`role-box${members.length < r.min ? ' missing' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, r)}
            aria-describedby={r.help ? `${boxId}-help` : undefined}
          >
            <legend>
              {r.label}
              {r.min > 0 ? '' : ' (optional)'}
            </legend>
            <ul className="role-members" aria-label={r.label}>
              {members.map((k) => (
                <li
                  key={k}
                  className="chip on"
                  draggable
                  onDragStart={() => {
                    drag.current = k
                  }}
                >
                  <span className="chip-title">{name(k)}</span>
                  <button
                    type="button"
                    className="chip-remove link"
                    aria-label={`Remove “${name(k)}” from ${r.label}`}
                    title={`Remove from ${r.label}`}
                    onClick={() => remove(k, r)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {!members.length && <li className="muted role-empty">None chosen</li>}
            </ul>
            {offered.length > 0 && (members.length < r.max || r.max === 1) && (
              <select
                aria-label={`Add to ${r.label}`}
                value=""
                onChange={(e) => {
                  const v = variables.find((x) => x.key === e.target.value)
                  if (v) put(v.key, r)
                }}
              >
                <option value="">{r.max === 1 && members.length ? 'Change…' : 'Add…'}</option>
                {/* A variable in another role moves here (one role each). */}
                {offered.map((v) => (
                  <option key={v.key} value={v.key}>
                    {`${v.title || '(untitled)'} (${typeText[v.type]})`}
                  </option>
                ))}
              </select>
            )}
            {r.help && (
              <div id={`${boxId}-help`} className="help">
                {r.help}
              </div>
            )}
          </fieldset>
        )
      })}
      {leftOut && leftOut.length > 0 && (
        <p className="help role-left-out">
          {leftOut.length} {leftOut.length === 1 ? 'variable' : 'variables'} left out:{' '}
          {leftOut.map((v) => v.title || '(untitled)').join(', ')} (add{' '}
          {leftOut.length === 1 ? 'it' : 'them'} if{' '}
          {leftOut.length === 1 ? 'it belongs' : 'they belong'}).
        </p>
      )}
    </div>
  )
}
