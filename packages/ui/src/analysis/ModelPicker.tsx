import {
  EQUATIONS,
  type EquationMeta,
  equation,
  equationMeta,
  goalOf,
  MODEL_GOALS,
  type ModelGoalId,
  USER_EQUATION,
  unitWords,
  type XScale,
} from '@ps/analyses'
import { modelThumbnail, THUMBNAIL_PLOT } from '@ps/analyses/dialog'
import type { FontRegistry } from '@ps/graph'
import { type KeyboardEvent, useId, useMemo, useState } from 'react'
import { useServices } from '../context.tsx'
import type { CustomField } from './ParamsForm.tsx'
import { panelImage } from './SketchView.tsx'

// Roadmap 51e (design §9.1, U10): the curve fit's model chosen by goal — goals on the left, the
// goal's models as cards with a thumbnail of their shape (drawn by @ps/graph from typical
// values, never a fit), the shape and parameters in words and the X each expects; "All
// equations" (searchable) and "My own equation" beside them. It replaces the 127-entry select.

type Params = Record<string, unknown>
type GoalTab = ModelGoalId | 'all' | 'user'

/** What a model expects of X, in words. */
export const X_WORDS: Readonly<Record<XScale, string>> = {
  log: 'X: log(concentration)',
  concentration: 'X: concentration',
  time: 'X: time',
  linear: 'X: any values',
}

/** Thumbnails drawn once per session (the fonts never change while the app runs). */
const thumbnails = new Map<string, { src: string; width: number; height: number } | null>()

/** A model's thumbnail image (an SVG data URL), or null when it can't be drawn. */
export function thumbnailImage(id: string, fonts: FontRegistry) {
  if (!thumbnails.has(id)) {
    const panel = modelThumbnail(id)
    thumbnails.set(id, panel ? panelImage(panel, fonts, THUMBNAIL_PLOT) : null)
  }
  return thumbnails.get(id) ?? null
}

function Thumbnail({ id }: { id: string }) {
  const { fonts } = useServices()
  const image = thumbnailImage(id, fonts)
  if (!image) return <span className="model-thumb empty" aria-hidden="true" />
  return (
    <img
      className="model-thumb"
      src={image.src}
      alt=""
      width={Math.round(image.width * 0.75)}
      height={Math.round(image.height * 0.75)}
    />
  )
}

/** The parameters of a model in words ("Top: the response at the highest doses (Y’s units)"). */
function ParamList({ meta }: { meta: EquationMeta }) {
  return (
    <ul className="model-params">
      {Object.entries(meta.params).map(([name, p]) => (
        <li key={name}>
          <strong>{name}</strong>: {p.meaning} <span className="muted">({unitWords(p.unit)})</span>
        </li>
      ))}
    </ul>
  )
}

/** A model's own choices, kept while another is shown (the user's answer Q4, audit 4 A5). */
export interface ModelChoices {
  constraints: unknown
  initialValues: unknown
  limits: unknown
}

/**
 * The params of a newly picked model: its own constraints, the goal's settings. Parameter names
 * differ between models, so each model has its own constraints, starting values and limits:
 * those of the model left are kept in `memory` (the dialog's, for its life) and those of the
 * model picked come back from it (else start over). Picking the chosen model changes nothing.
 */
export function pickModel(
  params: Params,
  id: string,
  goal: GoalTab,
  memory?: Map<string, ModelChoices>,
): Params {
  if (params.equation === id) return params
  if (typeof params.equation === 'string')
    memory?.set(params.equation, {
      constraints: params.constraints ?? {},
      initialValues: params.initialValues ?? {},
      limits: params.limits ?? {},
    })
  const back = memory?.get(id)
  const g = MODEL_GOALS.find((x) => x.id === goal)
  const eq = id === USER_EQUATION ? undefined : equation(id)
  const compared = Array.isArray(params.compareParams) ? (params.compareParams as string[]) : []
  return {
    ...params,
    equation: id,
    constraints: back?.constraints ?? {},
    initialValues: back?.initialValues ?? {},
    limits: back?.limits ?? {},
    ...(params.compareWith === id ? { compareWith: 'none' } : {}),
    compareParams: eq ? compared.filter((n) => eq.params.includes(n)) : [],
    ...(g?.sets ?? {}),
  }
}

/** One model as a card (a radio of the goal's group). */
function ModelCard({
  id,
  checked,
  tabbable,
  onPick,
  onKey,
}: {
  id: string
  checked: boolean
  tabbable: boolean
  onPick: () => void
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  const eq = equation(id)
  const meta = equationMeta(id)
  if (!eq || !meta) return null
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card with a picture and text (a radio button can't hold them)
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={tabbable ? 0 : -1}
      className={`model-card${checked ? ' checked' : ''}`}
      data-model={id}
      onClick={onPick}
      onKeyDown={onKey}
    >
      <Thumbnail id={id} />
      <span className="model-text">
        <span className="model-name">{eq.name}</span>
        <span className="model-shape">{meta.shape}</span>
        <span className="model-x">
          {X_WORDS[meta.xScale]} · {eq.params.length} parameter
          {eq.params.length === 1 ? '' : 's'}
        </span>
      </span>
    </div>
  )
}

export const ModelPicker: CustomField = ({ label, params, onChange, context }) => {
  const id = useId()
  const current = String(params.equation ?? '')
  const [tab, setTab] = useState<GoalTab>(() =>
    current === USER_EQUATION ? 'user' : (goalOf(current) ?? 'all'),
  )
  const [query, setQuery] = useState('')
  const goal = MODEL_GOALS.find((g) => g.id === tab)
  const meta = equationMeta(current)
  const eq = equation(current)
  const pick = (m: string, goalTab: GoalTab = tab) => {
    const next = pickModel(params, m, goalTab, context.models)
    if (next !== params) onChange(next)
  }
  const shown: string[] = useMemo(() => {
    if (goal) return [...goal.models]
    if (tab !== 'all') return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return EQUATIONS.filter((e) => {
      const text = `${e.name} ${e.category} ${e.formula}`.toLowerCase()
      return words.every((w) => text.includes(w))
    }).map((e) => e.id)
  }, [goal, tab, query])
  // Arrow keys move through the models (a radio group: the focused card is the chosen one).
  const onKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      pick(shown[i]!)
      return
    }
    if (!step || !shown.length) return
    e.preventDefault()
    // From the chosen model (audit 4 A5: keys repeated faster than the focus moved stepped from
    // a stale card), and the focus moved at once.
    const at = shown.indexOf(current)
    const next = ((at >= 0 ? at : i) + step + shown.length) % shown.length
    pick(shown[next]!)
    e.currentTarget.parentElement
      ?.querySelector<HTMLElement>(`[data-model="${shown[next]}"]`)
      ?.focus()
  }
  const tabs: { id: GoalTab; title: string }[] = [
    ...MODEL_GOALS.map((g) => ({ id: g.id as GoalTab, title: g.title })),
    { id: 'all', title: 'All equations' },
    { id: 'user', title: 'My own equation' },
  ]
  const checkedIndex = shown.indexOf(current)
  return (
    <fieldset className="model-picker">
      <legend>{label}</legend>
      {/* Not a live region (audit 4 A5): the focused card already says each model picked. */}
      <div className="model-current">
        {current === USER_EQUATION ? (
          <span>Your own equation (written below).</span>
        ) : eq && meta ? (
          <>
            <Thumbnail id={current} />
            <span className="model-text">
              <span className="model-name">{eq.name}</span>
              <span className="model-shape">{meta.shape}</span>
              <span className="model-x">{X_WORDS[meta.xScale]}</span>
              <span className="formula">{eq.formula}</span>
            </span>
          </>
        ) : (
          <span>Choose a model.</span>
        )}
      </div>
      {meta && <ParamList meta={meta} />}
      <div className="model-body">
        <div className="model-goals" role="tablist" aria-orientation="vertical" aria-label="Goals">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${id}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${id}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'active' : ''}
              onClick={() => {
                setTab(t.id)
                if (t.id === 'user') pick(USER_EQUATION, 'user')
              }}
              onKeyDown={(e) => {
                const i = tabs.findIndex((x) => x.id === tab)
                const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
                // Audit 4 (A13): Home and End too.
                const to =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? tabs.length - 1
                      : step
                        ? (i + step + tabs.length) % tabs.length
                        : -1
                if (to < 0) return
                e.preventDefault()
                const next = tabs[to]!
                setTab(next.id)
                const list = e.currentTarget.parentElement
                requestAnimationFrame(() =>
                  list
                    ?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-tab-${next.id}`)}`)
                    ?.focus(),
                )
              }}
            >
              {t.title}
            </button>
          ))}
        </div>
        <div
          className="model-panel"
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${tab}`}
        >
          {goal && (
            <p className="help">
              {goal.description} {goal.sets?.interpolate ? 'Unknowns are interpolated. ' : ''}
              <span className="muted">Expects {goal.xExpected}.</span>
            </p>
          )}
          {tab === 'all' && (
            <input
              type="search"
              className="model-search"
              placeholder="Search equations (name, category, formula)"
              aria-label="Search equations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {tab === 'user' ? (
            current === USER_EQUATION ? (
              <p className="help">
                Write the equation below with X, Y and its parameters. A user-defined equation is
                compared with other models by AICc only.
              </p>
            ) : (
              // Audit 4 (A13): reached by the keys (which show a goal, never pick): picked here.
              <p className="help">
                Your own equation with X, Y and its parameters, compared with other models by AICc
                only.{' '}
                <button type="button" onClick={() => pick(USER_EQUATION, 'user')}>
                  Use my own equation
                </button>
              </p>
            )
          ) : (
            <div
              role="radiogroup"
              aria-label={goal ? `Models: ${goal.title}` : 'All equations'}
              className={`model-cards${tab === 'all' ? ' list' : ''}`}
            >
              {shown.map((m, i) =>
                tab === 'all' ? (
                  // biome-ignore lint/a11y/useSemanticElements: one row of a long list, a radio of its group
                  <div
                    key={m}
                    role="radio"
                    aria-checked={m === current}
                    tabIndex={m === current || (checkedIndex < 0 && i === 0) ? 0 : -1}
                    className={`model-row${m === current ? ' checked' : ''}`}
                    data-model={m}
                    onClick={() => pick(m)}
                    onKeyDown={onKey(i)}
                  >
                    <span className="model-name">{equation(m)?.name}</span>
                    <span className="muted">
                      {' '}
                      · {equation(m)?.category} · {X_WORDS[equationMeta(m)!.xScale]}
                    </span>
                  </div>
                ) : (
                  <ModelCard
                    key={m}
                    id={m}
                    checked={m === current}
                    tabbable={m === current || (checkedIndex < 0 && i === 0)}
                    onPick={() => pick(m)}
                    onKey={onKey(i)}
                  />
                ),
              )}
              {tab === 'all' && !shown.length && <p className="muted">No equation matches.</p>}
            </div>
          )}
        </div>
      </div>
    </fieldset>
  )
}
