import { registry } from '@ps/analyses'
import type { TableKind } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_KEYWORDS,
  analysisGroups,
  COMMON_ANALYSES,
  COMMON_TITLE,
} from '../src/analysis/analysisSearch.ts'
import { needsHint } from '../src/analysis/needs.ts'

// Roadmap 43 (UX review F20, F22): the Analyze dialog's Common group and search; the line a
// results error adds about what the analysis needs.

const offered = (kind: TableKind) => registry.list().filter((d) => d.accepts.includes(kind))
const titles = (kind: TableKind, query = '') =>
  analysisGroups(offered(kind), kind, query).map((g) => [g.title, g.defs.map((d) => d.id)] as const)

describe('the Analyze dialog’s list', () => {
  it('names only analyses that exist, offered for the table kinds they are common for', () => {
    for (const [kind, ids] of Object.entries(COMMON_ANALYSES))
      for (const id of ids)
        expect(registry.get(id)?.accepts, `${kind}: ${id}`).toContain(kind as TableKind)
    for (const id of Object.keys(ANALYSIS_KEYWORDS)) expect(registry.get(id), id).toBeDefined()
  })

  it('opens with the Common group of the table’s kind, then every analysis by category', () => {
    const groups = titles('column')
    expect(groups[0]).toEqual([COMMON_TITLE, ['ttest', 'oneWayAnova', 'descriptive', 'normality']])
    // The full category list follows, each analysis once, in the registry's order.
    const rest = groups.slice(1)
    expect(rest.map((g) => g[0])).toEqual([...new Set(offered('column').map((d) => d.category))])
    expect(rest.flatMap((g) => g[1])).toEqual(
      offered('column')
        .slice()
        .sort(
          (a, b) =>
            rest.findIndex((g) => g[0] === a.category) - rest.findIndex((g) => g[0] === b.category),
        )
        .map((d) => d.id),
    )
    expect(titles('xy')[0]).toEqual([
      COMMON_TITLE,
      ['linearRegression', 'nonlinearFit', 'correlation'],
    ])
    expect(titles('grouped')[0]![1]).toContain('twoWayAnova')
    expect(titles('multipleVariables')[0]![1]).toEqual([
      'multipleRegression',
      'pca',
      'logisticRegression',
      'nonlinearFitMV',
    ])
  })

  it('leaves the Common group out when it would be the whole list', () => {
    const sims = offered('column').filter((d) => d.inputs.min === 0)
    expect(analysisGroups(sims, 'column', '').map((g) => g.title)).not.toContain(COMMON_TITLE)
  })

  it('filters by names and keywords, best first, common ones first among equals', () => {
    // Words, not letters scattered through a title ("Analyze a stack of P values").
    expect(titles('column', 'anova')).toEqual([[null, ['oneWayAnova']]])
    expect(titles('column', 't test')[0]![1][0]).toBe('ttest')
    expect(titles('grouped', 'anova')[0]![1]).toEqual([
      'twoWayAnova',
      'multipleOneWay',
      'threeWayAnova',
    ])
    expect(titles('column', 'welch')[0]![1]).toEqual(['ttest', 'oneWayAnova'])
    expect(titles('survival', 'kaplan')[0]![1]).toEqual(['survival'])
    expect(titles('xy', 'ic50')[0]![1]).toEqual(['nonlinearFit'])
    expect(titles('multipleVariables', 'pca')[0]![1][0]).toBe('pca')
    expect(titles('column', 'zzz')).toEqual([[null, []]])
  })
})

describe('a results error’s hint', () => {
  it('says what the analysis needs when the error is about too few values', () => {
    const t = registry.get('ttest')
    expect(needsHint(t, 'Each group needs at least two values.')).toMatch(/two data sets/)
    expect(
      needsHint(registry.get('nonlinearFit'), 'too few points (2) to fit 4 parameters.'),
    ).toMatch(/more rows with both X and Y/)
    // Analyses without a line of their own: from the data sets they take.
    expect(needsHint(registry.get('friedman'), 'needs at least two complete rows.')).toBe(
      'Friedman test analyzes 3 or more data sets; check they have enough values (empty and excluded cells don’t count).',
    )
  })

  it('says nothing about other errors', () => {
    expect(needsHint(registry.get('ttest'), 'The fit did not converge.')).toBeNull()
    expect(needsHint(undefined, 'Each group needs at least two values.')).toBeNull()
  })
})
