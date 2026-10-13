import { describe, expect, it } from 'vitest'
import { methodChanges } from '../src/dialogEntry.ts'
import { registry } from '../src/index.ts'

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
      'Data sets: reordered (Treated and Control)',
    ])
  })

  it('long lists are bounded and every line fits the history (audit 4 G2)', () => {
    // 40 data sets → 3: the line named all 37 removed and broke the 500-character limit, so the
    // whole change was refused.
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`)
    const name = (k: string) => `A long data set name number ${k.slice(1)}`
    const lines = methodChanges(
      state('ttest', {}, many),
      state('ttest', {}, many.slice(0, 3)),
      name,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^Data sets: removed .* and 31 more$/)
    expect(lines[0]!.length).toBeLessThanOrEqual(500)
    const reordered = methodChanges(
      state('ttest', {}, many),
      state('ttest', {}, [...many].reverse()),
      name,
    )
    expect(reordered[0]).toMatch(/^Data sets: reordered \(.* and 34 more\)$/)
    // A very long name is cut, and the line too.
    const huge = (k: string) => `${k}${'é'.repeat(400)}`
    for (const l of methodChanges(
      state('ttest', {}, ['a', 'b']),
      state('ttest', {}, ['c', 'd']),
      huge,
    ))
      expect([...l].length).toBeLessThanOrEqual(500)
    const user = (t: string) => state('nonlinearFit', { equation: 'user', userEquation: t })
    for (const l of methodChanges(user(`Y = A*X + ${'B'.repeat(3000)}`), user('Y = A*X')))
      expect([...l].length).toBeLessThanOrEqual(500)
  })

  it('curve-fit choices in words, not ids and JSON (audit 4 U9)', () => {
    const fit = (p: object) => state('nonlinearFit', p)
    const hill = 'agonist-response-variable-slope'
    const lines = methodChanges(
      fit({
        equation: hill,
        constraints: { Bottom: { kind: 'constant', value: 0 }, HillSlope: { kind: 'shared' } },
        initialValues: { Top: 100 },
        limits: { LogEC50: { min: -9, max: -3 } },
      }),
      fit({ equation: 'inhibitor-response-variable-slope' }),
    )
    const text = lines.join('\n')
    expect(text).not.toMatch(/[{}"]|agonist-response|inhibitor-response/)
    expect(lines[0]).toMatch(/^Model: .*agonist.* → .*inhibitor/i)
    expect(text).toMatch(/Bottom = 0 \(constant\)/)
    expect(text).toMatch(/HillSlope shared/)
    expect(text).toMatch(/Top starts at 100 → automatic/)
    expect(text).toMatch(/LogEC50 between -9 and -3 → none/)
    const user = methodChanges(fit({}), fit({ equation: 'user', userEquation: 'Y = A*exp(-K*X)' }))
    expect(user[0]).toMatch(/ → User-defined equation$/)
    expect(user.join('\n')).toMatch(/“Y = A\*exp\(-K\*X\)”/)
  })
})
