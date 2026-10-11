import { layoutPage } from '@ps/graph'
import type { LayoutNode } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { buildChen, CHEN } from '../src/examples/published/chen.ts'
import {
  type BuiltPaper,
  buildPaper,
  comparePrinted,
  type PaperSpec,
} from '../src/examples/published/paper.ts'
import { buildSwam, SWAM } from '../src/examples/published/swam.ts'
import { TAWK, tawkSourceFile } from '../src/examples/published/tawk.ts'

// The published-data examples put the P values printed in each figure next to the ones the app
// computes. The CC BY papers embed their data, so these tests run everywhere; the papers read
// from the local source_data folder are checked in `private/privatePapers.test.ts` (roadmap 48:
// left out of the public repository with their specs).

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

/** Building a paper takes long on a busy machine. */
const PAPER_TIMEOUT = 180_000

describe('comparePrinted', () => {
  it('reads P values as figures print them', () => {
    expect(comparePrinted('0.0027', 0.002746)).toBe('agrees')
    expect(comparePrinted('0.0350', 0.03495)).toBe('agrees')
    expect(comparePrinted('0.0034', 0.003452)).toBe('truncated')
    expect(comparePrinted('0.9999', 0.999987)).toBe('truncated')
    expect(comparePrinted('0.019', 0.01244)).toBe('differs')
    expect(comparePrinted('<0.0001', 3e-5)).toBe('agrees')
    expect(comparePrinted('<0.0001', 1.7e-4)).toBe('differs')
    expect(comparePrinted('5e-7', 5.199e-7)).toBe('agrees')
    expect(comparePrinted('**', 0.0057)).toBe('agrees')
    expect(comparePrinted('***', 0.0057)).toBe('differs')
    expect(comparePrinted('ns', 0.0556)).toBe('agrees')
    expect(comparePrinted('<0.025', 0.02508)).toBe('differs')
  })
})

// Tawk et al. (CC BY 4.0) embeds its data (`tawk.ts`, `tawkData.ts`): the P values printed in its
// figures and given in its source data are checked everywhere, not only where source_data exists.
/** Fig. 1: 5 graphs; 2: 6; 3: 16; 4: 7; 5: 4. */
const TAWK_GRAPHS = 38

describe('Tawk et al. (embedded data)', () => {
  const tawk = () => buildPaper(TAWK, { fonts, sourceFile: tawkSourceFile })

  it(
    'agrees with the figures’ and the source data’s P values where they allow',
    async () => {
      const { checks, project } = await tawk()
      const printed = TAWK.panels.flatMap((p) => (p.analyses ?? []).flatMap((a) => a.printed))
      expect(checks).toHaveLength(printed.length)
      for (const c of checks) {
        const label = `${c.analysis} › ${c.comparison}: printed ${c.printed}, app ${c.computed}`
        if (c.expectedToDiffer) expect(c.agreement, label).toBe('differs')
        else expect(c.agreement, label).not.toBe('differs')
      }
      // A page per figure with source data (1–5) and every panel the app draws.
      const nodes = Object.values(project.nodes)
      expect(nodes.filter((n) => n?.kind === 'layout').map((n) => n!.name)).toEqual(
        [1, 2, 3, 4, 5].map((n) => `Fig. ${n} (reproduced)`),
      )
      expect(nodes.filter((n) => n?.kind === 'graph')).toHaveLength(TAWK_GRAPHS)
    },
    PAPER_TIMEOUT,
  )

  it(
    'Fig. 4b: Dunnett’s test gives the printed 0.5834 and 0.3342',
    async () => {
      const { checks } = await tawk()
      const of = (row: string) =>
        checks.find(
          (c) =>
            c.analysis === 'Fig. 4b – Two-way ANOVA, Dunnett vs no vitamin within each column' &&
            c.comparison === `with E. coli (no vitamin) vs with E. coli (${row})`,
        )!.computed
      expect(of('Vitamin B7').toFixed(4)).toBe('0.5834')
      expect(of('Vitamin B12').toFixed(4)).toBe('0.3342')
    },
    PAPER_TIMEOUT,
  )
})

// Chen and Swaminathan et al. (CC BY 4.0) embed their data since audit 3 (`chen.ts`, `swam.ts`
// and their data files; until then they read source_data and were checked, as the papers in
// `private/` are, only where it was on file): the same checks run everywhere, with the values
// the figures print and, for Swaminathan, the P values its source data state.

/** Every page of a built paper draws, without a warning. */
function pageWarnings({ project, results }: BuiltPaper): string[] {
  return Object.values(project.nodes)
    .filter((n): n is LayoutNode => n?.kind === 'layout')
    .flatMap((layout) =>
      layoutPage({ project, layout, fonts, result: (id) => results.get(id) }).warnings.map(
        (w) => `${layout.name}: ${w}`,
      ),
    )
}

/** The printed values agree, or differ where the spec says why. */
function expectAgreement(paper: PaperSpec, { checks }: BuiltPaper) {
  const printed = paper.panels.flatMap((p) => (p.analyses ?? []).flatMap((a) => a.printed))
  expect(checks).toHaveLength(printed.length)
  for (const c of checks) {
    const label = `${c.analysis} › ${c.comparison}: printed ${c.printed}, app ${c.computed}`
    if (c.expectedToDiffer) expect(c.agreement, label).toBe('differs')
    else expect(c.agreement, label).not.toBe('differs')
  }
}

const computedP = (built: BuiltPaper, analysis: string, comparison: string): number => {
  const c = built.checks.find((x) => x.analysis === analysis && x.comparison === comparison)
  if (!c) throw new Error(`no check ${analysis} › ${comparison}`)
  return c.computed
}

describe('Chen et al. (embedded data)', () => {
  let memo: Promise<BuiltPaper> | undefined
  const chen = () => {
    memo ??= buildChen(fonts)
    return memo
  }

  it(
    'agrees with the printed P values where the data allow; a page per figure, every panel',
    async () => {
      const built = await chen()
      expectAgreement(CHEN, built)
      expect(built.checks.filter((c) => c.agreement === 'differs')).toHaveLength(4)
      const nodes = Object.values(built.project.nodes)
      expect(nodes.filter((n) => n?.kind === 'layout').map((n) => n!.name)).toEqual([
        ...[1, 2, 3, 4, 6].map((n) => `Fig. ${n} (reproduced)`),
        ...[2, 3, 4, 5].map((n) => `Extended Data Fig. ${n} (reproduced)`),
      ])
      expect(nodes.filter((n) => n?.kind === 'graph')).toHaveLength(CHEN.panels.length)
      expect(nodes.filter((n) => n?.kind === 'analysis')).toHaveLength(7)
      expect(pageWarnings(built)).toEqual([])
    },
    PAPER_TIMEOUT,
  )

  it(
    'Fig. 1b’s rank-sum P per quartile and Fig. 6e’s Tukey P values as printed',
    async () => {
      const built = await chen()
      const mw = (q: string) =>
        computedP(built, 'Fig. 1b – Mann-Whitney test per quartile', `Age 2–65 vs Age 65–99 (${q})`)
      expect(mw('0–25%').toFixed(3)).toBe('0.002')
      expect(mw('25–50%').toPrecision(1)).toBe('5e-7')
      expect(mw('50–75%').toFixed(2)).toBe('0.08')
      expect(mw('75–100%').toFixed(2)).toBe('0.95')
      const tukey = (b: string) =>
        computedP(
          built,
          'Fig. 6e – One-way ANOVA, Tukey',
          `IIV 1ug + GFP mRNA LNP 3ug vs IIV 1ug + ${b} mRNA LNP 3ug`,
        )
      expect(tukey('IFNb').toFixed(4)).toBe('0.0002')
      expect(tukey('IL21')).toBeLessThan(1e-4)
      // Fig. 4e: the deposited scores give 0.00026, not the printed 0.008 (declared).
      expect(
        computedP(built, 'Fig. 4e – Paired t test: IFNβ vs IIV', 'IFNβ vs IIV').toFixed(5),
      ).toBe('0.00026')
    },
    PAPER_TIMEOUT,
  )
})

describe('Swaminathan et al. (embedded data)', () => {
  let memo: Promise<BuiltPaper> | undefined
  const swam = () => {
    memo ??= buildSwam(fonts)
    return memo
  }

  it(
    'agrees with the printed P values where the data allow; a page per figure, every panel',
    async () => {
      const built = await swam()
      expectAgreement(SWAM, built)
      expect(built.checks.filter((c) => c.agreement === 'differs')).toHaveLength(3)
      const nodes = Object.values(built.project.nodes)
      expect(nodes.filter((n) => n?.kind === 'layout').map((n) => n!.name)).toEqual(
        [2, 3, 4, 5].map((n) => `Fig. ${n} (reproduced)`),
      )
      expect(nodes.filter((n) => n?.kind === 'graph')).toHaveLength(SWAM.panels.length)
      expect(pageWarnings(built)).toEqual([])
    },
    PAPER_TIMEOUT,
  )

  it(
    'gives the P values the source data state (pasted beside the values) to 1e-10',
    async () => {
      const built = await swam()
      const stated: [string, string, number][] = [
        [
          'Fig. 3f – Unpaired t test per cytokine',
          'WT/WT vs R57C/R57C (IL-1B)',
          0.0031299492610822916,
        ],
        [
          'Fig. 3f – Unpaired t test per cytokine',
          'WT/WT vs R57C/R57C (IL-8)',
          0.00009706431556923285,
        ],
        ['Fig. 3f – Unpaired t test per cytokine', 'WT/WT vs R57C/R57C (TNF)', 0.01684770818151634],
        [
          'Fig. 4b – Unpaired t test: WT NLRP3 vs WT NLRP3 + WT OTULIN',
          'WT NLRP3 vs WT NLRP3 + WT OTULIN',
          0.0393360842632551,
        ],
        [
          'Fig. 4b – Unpaired t test: WT NLRP3 + WT OTULIN vs WT NLRP3 + R57C OTULIN',
          'WT NLRP3 + WT OTULIN vs WT NLRP3 + R57C OTULIN',
          0.0007972294910307525,
        ],
        // Printed 0.019 in the figure; the source data and the app say 0.0124.
        [
          'Fig. 4b – Unpaired t test: WT NLRP3 + WT OTULIN vs WT NLRP3 + L272P OTULIN',
          'WT NLRP3 + WT OTULIN vs WT NLRP3 + L272P OTULIN',
          0.012438987065883249,
        ],
        ['Fig. 5b – Unpaired t test: WT+TNF vs KO+TNF', 'WT+TNF vs KO+TNF', 0.017823410627541864],
        [
          'Fig. 5b – Unpaired t test: WT+TNF vs WT complementation+TNF',
          'WT+TNF vs WT complementation+TNF',
          0.006385892332952387,
        ],
        // The legend's “P < 0.025”: this P value truncated.
        [
          'Fig. 5b – Unpaired t test: WT complementation+TNF vs R57C complementation+TNF',
          'WT complementation+TNF vs R57C complementation+TNF',
          0.02507759057257131,
        ],
        [
          'Fig. 5b – Unpaired t test: WT complementation+TNF vs L272P complementation+TNF',
          'WT complementation+TNF vs L272P complementation+TNF',
          0.017488883830164118,
        ],
      ]
      for (const [analysis, comparison, p] of stated) {
        const rel = Math.abs(computedP(built, analysis, comparison) - p) / p
        expect(rel, comparison).toBeLessThan(1e-10)
      }
      // Fig. 2e: the exact Mann-Whitney P with 5 against 5 values, as printed.
      expect(
        computedP(built, 'Fig. 2e – Mann-Whitney test: WT vs R57C', 'WT vs R57C').toFixed(4),
      ).toBe('0.0079')
    },
    PAPER_TIMEOUT,
  )
})
