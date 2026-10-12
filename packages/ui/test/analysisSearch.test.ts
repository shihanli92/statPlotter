import { registry } from '@ps/analyses'
import type { TableKind } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { openingAnalysis } from '../src/analysis/AnalyzeDialog.tsx'
import {
  ANALYSIS_KEYWORDS,
  analysisGroups,
  COMMON_ANALYSES,
  COMMON_TITLE,
  searchAnalyses,
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

  it('opens with the Common group of the table’s kind, then every other analysis by category', () => {
    const groups = titles('column')
    expect(groups[0]).toEqual([COMMON_TITLE, ['ttest', 'oneWayAnova', 'descriptive', 'normality']])
    // Roadmap 51a (U2): every analysis once — the common ones under Common only.
    const rest = groups.slice(1)
    const listed = groups.flatMap((g) => g[1])
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual(
      offered('column')
        .map((d) => d.id)
        .sort(),
    )
    expect(rest.flatMap((g) => g[1])).not.toContain('ttest')
    expect(rest.map((g) => g[0])).toEqual([
      ...new Set(
        offered('column')
          .filter((d) => !groups[0]![1].includes(d.id))
          .map((d) => d.category),
      ),
    ])
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

// Roadmap 51a (U3, design §3.6): search by question, across table kinds.
describe('search by question', () => {
  const search = (kind: TableKind, q: string) => searchAnalyses(offered(kind), kind, q)

  it('finds the chooser’s questions by their words, in any order and by their start', () => {
    expect(search('column', 'compare groups').questions.map((e) => e.id)).toContain('groupsDiffer')
    expect(search('column', 'same animals').questions.map((e) => e.id)).toContain('groupsDiffer')
    expect(search('xy', 'dose resp').questions[0]?.id).toBe('doseResponse')
    expect(search('xy', 'resp dose').questions[0]?.id).toBe('doseResponse')
    expect(search('grouped', 'time course').questions[0]?.id).toBe('timeCourse')
  })

  it('finds this table’s analyses by their methods’ names too', () => {
    expect(search('column', 'dunnett').here.map((d) => d.id)).toContain('oneWayAnova')
    expect(search('column', 'kruskal').here.map((d) => d.id)).toContain('oneWayAnova')
  })

  it('lists, greyed, what another table kind answers, with what it needs', () => {
    const ic50 = search('column', 'ic50')
    expect(ic50.here).toEqual([])
    expect(ic50.elsewhere.map((m) => m.label)).toContain('Fit a dose-response curve (EC50 / IC50)')
    expect(ic50.elsewhere.find((m) => m.def?.id === 'nonlinearFit')?.needs).toBe('xy')
    const surv = search('column', 'surv')
    expect(surv.elsewhere.some((m) => m.needs === 'survival')).toBe(true)
    expect(surv.elsewhere[0]?.line).toMatch(/table/)
    expect(search('column', 'fisher').elsewhere.map((m) => m.def?.id)).toContain('contingency')
    expect(search('column', 'pca').elsewhere.map((m) => m.def?.id)).toContain('pca')
    // Nothing at all: the dialog says so (and offers Guide me).
    expect(search('column', 'zzzz')).toEqual({ questions: [], here: [], elsewhere: [] })
  })
})

// Roadmap 51a (U2): the list opens on the analysis asked for, else the last one used for this
// kind, else the kind's first common one.
describe('the analysis the list opens on', () => {
  it('is asked for, else used last for this kind, else the first common one', () => {
    const defs = offered('column')
    expect(openingAnalysis(defs, 'column', 'mannWhitney', ['ttest'])).toBe('mannWhitney')
    expect(openingAnalysis(defs, 'column', undefined, ['nonlinearFit', 'wilcoxon'])).toBe(
      'wilcoxon',
    )
    expect(openingAnalysis(defs, 'column', 'nonlinearFit', [])).toBe('ttest')
    expect(openingAnalysis(offered('xy'), 'xy')).toBe('linearRegression')
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
