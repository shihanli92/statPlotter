import { describe, expect, it } from 'vitest'
import { methodChanges, registry } from '../src/index.ts'

// Roadmap 51c (design §7.1): what changed in a method, in the form's words; reporting choices
// (confidence level, extra output, the sign of differences) are not a change of method.

const def = (id: string) => registry.get(id)!
const state = (id: string, params: object, dataSets = ['a', 'b']) => ({
  def: def(id),
  params: def(id).params.parse(params),
  dataSets,
})
const titles = (k: string) => ({ a: 'Control', b: 'Treated', c: 'Vehicle' })[k] ?? k

describe('method changes', () => {
  it('none when only reporting choices change', () => {
    expect(
      methodChanges(
        state('ttest', {}),
        state('ttest', { confidenceLevel: 0.99, reportFTestVariances: true }),
      ),
    ).toEqual([])
    expect(
      methodChanges(
        state('oneWayAnova', {}),
        state('oneWayAnova', { differenceAs: 'earlierMinusLater' }),
      ),
    ).toEqual([])
  })

  it('a test-defining choice, by its label and the options’ labels', () => {
    const lines = methodChanges(
      state('ttest', {}),
      state('ttest', { tails: 'one', predicted: 'increase' }),
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^P value: Two-tailed.* → One-tailed/)
    expect(lines[1]).toMatch(/ → /)
    expect(
      methodChanges(state('ttest', {}), state('ttest', { unpaired: { assumeEqualSD: true } })),
    ).toEqual([expect.stringMatching(/Welch.* → .*Student/)])
  })

  it('the analysis itself, and the data sets', () => {
    expect(methodChanges(state('ttest', {}), state('mannWhitney', {}))).toEqual([
      'Analysis: t test → Mann-Whitney test',
    ])
    expect(methodChanges(state('ttest', {}), state('ttest', {}, ['a', 'c']), titles)).toEqual([
      'Data sets: removed Treated; added Vehicle',
    ])
    expect(methodChanges(state('ttest', {}), state('ttest', {}, ['b', 'a']), titles)).toEqual([
      'Data sets: reordered (Treated, Control)',
    ])
  })
})
