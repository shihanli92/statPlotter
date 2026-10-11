/**
 * The eight standard dose-response forms of the equation library, in library order: agonist
 * (stimulation) then inhibitor, each with the full response (Bottom, Top) then the normalized
 * one (0 to 100), each with a standard then a variable slope. equations.ts writes them with
 * X = log(concentration), equationsMore.ts with X = concentration.
 */
export interface DoseForm {
  kind: 'agonist' | 'inhibitor'
  normalized: boolean
  hill: boolean
}

export const DOSE_FORMS: readonly DoseForm[] = (['agonist', 'inhibitor'] as const).flatMap((kind) =>
  [false, true].flatMap((normalized) => [false, true].map((hill) => ({ kind, normalized, hill }))),
)

/**
 * Id, name, category and parameters of a form. Ids are
 * `<agonist|inhibitor>[-conc]-[normalized-]response[-variable-slope]`; names
 * `log(agonist) vs. response — Variable slope (four parameters)`,
 * `[Inhibitor] vs. normalized response` and so on; the midpoint parameter (index 0, or 2 after
 * Bottom and Top) is LogEC50 / LogIC50, or EC50 / IC50 for concentrations.
 */
export function doseForm(d: DoseForm, conc: boolean) {
  const agonist = d.kind === 'agonist'
  const mid = `${conc ? '' : 'Log'}${agonist ? 'EC50' : 'IC50'}`
  const label = conc ? (agonist ? '[Agonist]' : '[Inhibitor]') : `log(${d.kind})`
  const count = conc || d.normalized ? '' : d.hill ? ' (four parameters)' : ' (three parameters)'
  return {
    id: `${d.kind}${conc ? '-conc' : ''}-${d.normalized ? 'normalized-' : ''}response${d.hill ? '-variable-slope' : ''}`,
    name: `${label} vs. ${d.normalized ? 'normalized ' : ''}response${d.hill ? ' — Variable slope' : ''}${count}`,
    category: agonist
      ? ('Dose-response — Stimulation' as const)
      : ('Dose-response — Inhibition' as const),
    params: [...(d.normalized ? [] : ['Bottom', 'Top']), mid, ...(d.hill ? ['HillSlope'] : [])],
    mid,
    /** Index of the midpoint parameter. */
    iMid: d.normalized ? 0 : 2,
  }
}
