import type { FieldState } from '@ps/analyses/dialog'
import type { AnalysisDef, FieldTier, FormField } from '@ps/model'
import { type ReactNode, useId, useState } from 'react'
import { type CustomField, type FormContext, getPath, ParamsForm } from './ParamsForm.tsx'

// Roadmap 51b (design §4.2, U9, U14): an analysis' options in three tiers — Essentials (the
// design questions, open), Reporting (collapsed, with a summary of its values) and Advanced
// (collapsed, with a count of the values that differ from the defaults). Only the options
// column scrolls; the tiers keep a long form (curve fits, multiple regression) short.

type Params = Record<string, unknown>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What a field shows now, in a few words ("95%", "Effect sizes", "Tukey"). */
function valueText(f: FormField, params: Params): string | null {
  const v = getPath(params, f.path)
  if (f.kind === 'checkbox') return v ? f.label.replace(/^Also (report|show) /i, '') : null
  if (f.kind === 'select' || f.kind === 'radio') {
    const o = f.options.find((x) => x.value === v)
    return o ? o.label.replace(/ \((recommended|not recommended)[^)]*\)/i, '') : null
  }
  if (f.kind === 'number') return null
  return null
}

/** Reporting's summary line: the values of its shown fields ("95% · Effect sizes"). */
export function reportingSummary(states: readonly FieldState[], params: Params): string {
  const parts = states
    .filter((s) => s.shown && s.tier === 'reporting')
    .map((s) => {
      const t = valueText(s.field, params)
      return t && s.field.path.join('.') === 'confidenceLevel' ? `${t} CI` : t
    })
    .filter((t): t is string => !!t)
  return parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' …' : '')
}

/** Advanced's summary: its first choice and how many values differ from the defaults. */
export function advancedSummary(
  states: readonly FieldState[],
  params: Params,
  defaults: Params,
): { text: string; changed: number } {
  const shown = states.filter((s) => s.shown && s.tier === 'advanced')
  const changed = shown.filter(
    (s) => !same(getPath(params, s.field.path), getPath(defaults, s.field.path)),
  ).length
  const first = shown.map((s) => valueText(s.field, params)).find(Boolean)
  return {
    text: [first, changed ? `${changed} changed` : null].filter(Boolean).join(' · '),
    changed,
  }
}

const TIER_TITLE: Record<Exclude<FieldTier, 'essentials'>, string> = {
  reporting: 'Reporting',
  advanced: 'Advanced',
}

export function OptionTiers({
  def,
  states,
  params,
  onChange,
  custom,
  context,
  onInfo,
  infoPanel,
  infoShown,
  hidden,
  reportingExtra,
  reportingExtraSummary,
}: {
  def: AnalysisDef<unknown>
  states: readonly FieldState[]
  params: Params
  onChange: (p: Params) => void
  custom: Readonly<Record<string, CustomField>>
  context: FormContext
  onInfo?: (f: FormField) => void
  infoPanel?: string
  infoShown?: FormField | null
  /** Paths not shown here (the roles' params, edited in the role boxes). */
  hidden?: ReadonlySet<string>
  /** Roadmap 51b (§4.2, U14): more of Reporting — the results shown on graphs. */
  reportingExtra?: ReactNode
  /** Its part of Reporting's summary ("P on graph"). */
  reportingExtraSummary?: string
}) {
  const id = useId()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const visible = states.map((s) =>
    hidden?.has(s.field.path.join('.')) ? { ...s, shown: false } : s,
  )
  const defaults = def.params.safeParse({})
  const dflt = (defaults.success ? defaults.data : {}) as Params
  const of = (tier: FieldTier) => visible.map((s) => (s.tier === tier ? s : { ...s, shown: false }))
  const form = (tier: FieldTier) => (
    <ParamsForm
      fields={def.form}
      states={of(tier)}
      value={params}
      onChange={onChange}
      custom={custom}
      context={context}
      onInfo={onInfo}
      infoPanel={infoPanel}
      infoShown={infoShown}
    />
  )
  const any = (tier: FieldTier) =>
    visible.some((s) => s.shown && s.tier === tier) || (tier === 'reporting' && !!reportingExtra)
  // A greyed choice still chosen opens its tier: the reason must be seen to be changed.
  const problemIn = (tier: FieldTier) =>
    visible.some((s) => s.shown && s.tier === tier && s.problem)
  return (
    <div className="option-tiers">
      {any('essentials') && <section className="tier essentials">{form('essentials')}</section>}
      {(['reporting', 'advanced'] as const).map((tier) => {
        if (!any(tier)) return null
        const isOpen = open[tier] ?? problemIn(tier)
        const summary =
          tier === 'reporting'
            ? [reportingSummary(visible, params), reportingExtraSummary].filter(Boolean).join(' · ')
            : advancedSummary(visible, params, dflt).text
        return (
          <section key={tier} className={`tier ${tier}${isOpen ? ' open' : ''}`}>
            <h3 className="tier-heading">
              <button
                type="button"
                className="tier-toggle"
                aria-expanded={isOpen}
                aria-controls={`${id}-${tier}`}
                onClick={() => setOpen({ ...open, [tier]: !isOpen })}
              >
                <span className="tier-caret" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className="tier-title">{TIER_TITLE[tier]}</span>
                {summary && <span className="tier-summary">{summary}</span>}
              </button>
            </h3>
            <div id={`${id}-${tier}`} hidden={!isOpen}>
              {isOpen && form(tier)}
              {isOpen && tier === 'reporting' && reportingExtra}
            </div>
          </section>
        )
      })}
    </div>
  )
}
