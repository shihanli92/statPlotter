import { describe, expect, it } from 'vitest'
import {
  applyRoles,
  assignRoles,
  carryOver,
  comparingText,
  DIALOG_PATCHES,
  ROLES,
  roleProblem,
  rolesOf,
  sharedValues,
  startingRoles,
} from '../src/dialog/index.ts'
import { registry } from '../src/index.ts'

// Roadmap 51b (design §4.2, §4.3, §4.5, §4.7): the dialog's tiers on every field, the patches
// naming fields that exist, the comparison sentence in the sign convention, switching methods
// keeping the shared choices, and the roles writing the params analyses read.

type Params = Record<string, unknown>
const def = (id: string) => registry.get(id)!
const defaults = (id: string) => def(id).params.parse({}) as Params

describe('tiers (§4.2)', () => {
  it('every field of every analysis has a tier', () => {
    for (const d of registry.list())
      for (const f of d.form)
        expect(['essentials', 'reporting', 'advanced'], `${d.id}.${f.path.join('.')}`).toContain(
          f.tier,
        )
  })

  it('patches only name fields the forms have', () => {
    for (const [id, patches] of Object.entries(DIALOG_PATCHES)) {
      const d = registry.get(id)
      expect(d, id).toBeDefined()
      for (const path of Object.keys(patches))
        expect(
          d!.form.some((f) => f.path.join('.') === path),
          `${id}.${path}`,
        ).toBe(true)
    }
  })

  it('puts the design questions first, reporting and corrections behind', () => {
    const tier = (id: string, path: string) =>
      def(id).form.find((f) => f.path.join('.') === path)?.tier
    expect(tier('ttest', 'design')).toBe('essentials')
    expect(tier('ttest', 'confidenceLevel')).toBe('reporting')
    expect(tier('ttest', 'tails')).toBe('advanced')
    expect(tier('oneWayAnova', 'comparisons')).toBe('essentials')
    expect(tier('oneWayAnova', 'controlMethod')).toBe('advanced')
    expect(tier('nonlinearFit', 'weighting')).toBe('advanced')
    expect(tier('multipleRegression', 'confidenceLevel')).toBe('reporting')
  })

  it('asks in the experiment’s words (§4.2)', () => {
    const label = (id: string, path: string) =>
      def(id).form.find((f) => f.path.join('.') === path)?.label
    expect(label('ttest', 'design')).toBe('Same subjects in both groups?')
    expect(label('oneWayAnova', 'matched')).toBe('Same subjects in every group?')
    expect(label('oneWayAnova', 'gaussian')).toBe('What kind of values?')
    expect(label('oneWayAnova', 'comparisons')).toBe('Which comparisons?')
    expect(label('twoWayAnova', 'repeated')).toBe(
      'Were the same subjects measured across a factor?',
    )
    expect(label('multipleT', 'approach')).toBe('How should the many rows be corrected?')
  })
})

describe('the comparison sentence (§4.3)', () => {
  it('two groups: the second − the first; matched rows said', () => {
    expect(comparingText(def('ttest'), defaults('ttest'), ['Control', 'Treated'])).toBe(
      'Comparing: “Treated” − “Control”.',
    )
    expect(
      comparingText(def('ttest'), { ...defaults('ttest'), design: 'paired' }, ['A', 'B']),
    ).toMatch(/row by row/)
  })

  it('one factor: every pair, each with the control, a trend', () => {
    const p = defaults('oneWayAnova')
    const g = ['Vehicle', '1 mg', '10 mg']
    expect(comparingText(def('oneWayAnova'), p, g)).toBe(
      'Comparing every pair (3 comparisons), later − earlier.',
    )
    expect(
      comparingText(def('oneWayAnova'), { ...p, comparisons: 'vsControl' }, g, 'Vehicle'),
    ).toBe('Comparing each group − “Vehicle” (2 comparisons).')
    expect(comparingText(def('oneWayAnova'), { ...p, comparisons: 'trend' }, g)).toMatch(/trend/)
  })
})

describe('switching methods keeps the shared choices (§4.5)', () => {
  it('confidence level, tails and direction, matching', () => {
    const t = { ...defaults('ttest'), confidenceLevel: 0.99, design: 'paired' }
    const one = carryOver(
      { def: def('ttest'), params: t },
      { def: def('oneWayAnova'), params: defaults('oneWayAnova') },
    )
    expect(one.confidenceLevel).toBe(0.99)
    expect(one.matched).toBe(true)
    const back = carryOver(
      { def: def('oneWayAnova'), params: one },
      { def: def('ttest'), params: defaults('ttest') },
    )
    expect(back.design).toBe('paired')
    const mw = carryOver(
      { def: def('ttest'), params: { ...t, tails: 'one', predicted: 'increase' } },
      { def: def('mannWhitney'), params: defaults('mannWhitney') },
    )
    expect([mw.tails, mw.predicted, mw.confidenceLevel]).toEqual(['one', 'increase', 0.99])
    // A method matched by what it is: Wilcoxon's pairs carry to the t test.
    expect(sharedValues(def('wilcoxon'), defaults('wilcoxon')).design).toBe(true)
  })

  it('the control, and comparisons only when the target offers the same choice', () => {
    const p = { ...defaults('oneWayAnova'), comparisons: 'vsControl', control: 'k2' }
    const fr = carryOver(
      { def: def('oneWayAnova'), params: p },
      { def: def('friedman'), params: defaults('friedman') },
    )
    expect([fr.comparisons, fr.control]).toEqual(['vsControl', 'k2'])
    const trend = carryOver(
      { def: def('oneWayAnova'), params: { ...p, comparisons: 'trend' } },
      { def: def('friedman'), params: defaults('friedman') },
    )
    expect(trend.comparisons).toBe(defaults('friedman').comparisons)
  })
})

describe('roles (§4.7)', () => {
  const vars = [
    { key: 'y', title: 'Weight', type: 'number' as const },
    { key: 'a', title: 'Age', type: 'number' as const },
    { key: 's', title: 'Male', type: 'binary' as const },
    { key: 'g', title: 'Group', type: 'text' as const },
  ]

  it('a new analysis starts with an empty outcome (Analyze waits for it)', () => {
    const roles = ROLES.multipleRegression!
    const { assignment } = startingRoles(roles, vars)
    expect(assignment).toEqual({ outcome: [], predictors: ['y', 'a', 's', 'g'] })
    expect(roleProblem(roles, assignment)).toBe('Choose the outcome.')
  })

  it('roles write the params and the data sets in role order', () => {
    const roles = rolesOf(def('multipleRegression'))!
    const out = applyRoles(
      roles,
      { outcome: ['y'], predictors: ['a', 'g'] },
      defaults('multipleRegression'),
    )
    expect(out.params.y).toBe('y')
    expect(out.dataSets).toEqual(['y', 'a', 'g'])
    expect(assignRoles(roles, out.dataSets, out.params, false)).toEqual({
      outcome: ['y'],
      predictors: ['a', 'g'],
    })
  })

  it('stored analyses read as the analyses read them (the outcome at its position)', () => {
    const roles = rolesOf(def('coxRegression'))!
    expect(assignRoles(roles, ['t', 'e', 'x'], defaults('coxRegression'), true)).toEqual({
      time: ['t'],
      event: ['e'],
      predictors: ['x'],
    })
  })

  it('PCA leaves coded and text variables out, named', () => {
    const { assignment, leftOut } = startingRoles(ROLES.pca!, vars)
    expect(assignment.variables).toEqual(['y', 'a'])
    expect(leftOut.map((v) => v.title)).toEqual(['Male', 'Group'])
  })
})
