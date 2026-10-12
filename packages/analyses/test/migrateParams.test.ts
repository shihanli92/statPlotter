import { readFileSync } from 'node:fs'
import { paramsOf, pinDefaults } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { registry } from '../src/index.ts'
import { type MonteCarloParams, withInnerVersion } from '../src/monteCarlo.ts'

// Roadmap 51c (design §6.1): an analysis saved before its defaults changed keeps what it
// computed. `fixtures/params-v1/defaults-0.3.8.json` holds the params 0.3.8 wrote for a new
// analysis of each kind whose defaults changed since (its defaults, in full): read at version 1
// they are unchanged, and so are sparse ones (`{}`, as older files and examples hold them), which
// get 0.3.8's defaults back; a new analysis gets the new ones.

const OLD = JSON.parse(
  readFileSync(new URL('./fixtures/params-v1/defaults-0.3.8.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>

/** What a new analysis gets now in place of 0.3.8's default (path → [0.3.8, now]). */
const CHANGED: Record<string, Record<string, [unknown, unknown]>> = {
  ttest: {
    unpaired: [{ assumeEqualSD: true }, { assumeEqualSD: false }],
    reportFTestVariances: [true, false],
  },
  friedman: { correction: ['dunn', 'holm'] },
  multipleT: { q: [1, 5] },
  pStack: { q: [1, 5] },
  normality: {
    dagostino: [true, false],
    andersonDarling: [true, false],
    kolmogorovSmirnov: [true, false],
    qqPlot: [false, true],
  },
  contingency: { trend: [true, false] },
  roc: { direction: ['auto', 'unset'] },
}

/** Values renamed since 0.3.8 (the same choice): path → [0.3.8's name, its name now]. */
const RENAMED: Record<string, Record<string, [unknown, unknown]>> = {
  friedman: { correction: ['dunn', 'bonferroni'] },
}

/** 0.3.8's params in today's names. */
const renamed = (id: string, p: Record<string, unknown>) => {
  const out = { ...p }
  for (const [k, [was, now]] of Object.entries(RENAMED[id] ?? {})) if (out[k] === was) out[k] = now
  return out
}

const def = (id: string) => registry.get(id)!

describe('params saved before 0.3.9', () => {
  it('every analysis with a newer params version has its 0.3.8 params here, and a migration', () => {
    const versioned = registry
      .list()
      .filter((d) => d.version > 1)
      .map((d) => d.id)
      .sort()
    expect(versioned).toEqual(Object.keys(OLD).sort())
    for (const id of versioned) expect(def(id).migrateParams, id).toBeTypeOf('function')
  })

  for (const [id, old] of Object.entries(OLD)) {
    it(`${id}: 0.3.8's params, full or sparse, mean what they meant`, () => {
      for (const saved of [old, {}]) {
        const r = paramsOf(def(id), { params: saved, pluginVersion: 1 })
        expect(r.ok, `${id} ${JSON.stringify(saved)}`).toBe(true)
        if (r.ok) expect(r.params).toMatchObject(renamed(id, old))
      }
      // Without a version, stored params are taken as the current version's.
      const now = paramsOf(def(id), { params: {} })
      expect(now.ok).toBe(true)
      if (now.ok) expect(now.params).toEqual(def(id).params.parse({}))
    })
  }

  it('new analyses get the new defaults (and only those changed)', () => {
    for (const [id, old] of Object.entries(OLD)) {
      if (id === 'monteCarlo') continue
      const fresh = def(id).params.parse({}) as Record<string, unknown>
      const changed = Object.fromEntries(
        Object.keys(old)
          .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(fresh[k]))
          .map((k) => [k, [old[k], fresh[k]]]),
      )
      expect(changed, id).toEqual(CHANGED[id] ?? {})
    }
  })

  // Choices added since 0.3.8: what an analysis saved before gets (its behaviour then) and what a
  // new one gets.
  it('choices added since 0.3.8: [saved before, new]', () => {
    const added: Record<string, Record<string, [unknown, unknown]>> = {}
    for (const [id, old] of Object.entries(OLD)) {
      const fresh = def(id).params.parse({}) as Record<string, unknown>
      const r = paramsOf(def(id), { params: {}, pluginVersion: 1 })
      const was = (r.ok ? r.params : {}) as Record<string, unknown>
      const keys = Object.keys(fresh).filter((k) => !(k in old))
      if (keys.length) added[id] = Object.fromEntries(keys.map((k) => [k, [was[k], fresh[k]]]))
    }
    expect(added).toMatchInlineSnapshot(`
      {
        "contingency": {
          "exposedRow": [
            0,
            0,
          ],
          "outcomeColumn": [
            0,
            0,
          ],
          "predicted": [
            "unset",
            "unset",
          ],
        },
        "correlation": {
          "correction": [
            "none",
            "fdr",
          ],
          "predicted": [
            "unset",
            "unset",
          ],
        },
        "mannWhitney": {
          "predicted": [
            "unset",
            "unset",
          ],
        },
        "multipleOneWay": {
          "alpha": [
            0.05,
            0.05,
          ],
          "approach": [
            "none",
            "fdr",
          ],
          "dunnMethod": [
            "bonferroni",
            "holm",
          ],
          "fdrMethod": [
            "bh",
            "bh",
          ],
          "kwPMethod": [
            "approximate",
            "exactWhenPossible",
          ],
          "q": [
            5,
            5,
          ],
          "sigMethod": [
            "holm-sidak",
            "holm-sidak",
          ],
        },
        "nestedOneWay": {
          "ddf": [
            "containment",
            "satterthwaite",
          ],
        },
        "nestedT": {
          "ddf": [
            "containment",
            "satterthwaite",
          ],
          "predicted": [
            "unset",
            "unset",
          ],
        },
        "nonlinearFit": {
          "compareBy": [
            "both",
            "fTest",
          ],
        },
        "nonlinearFitMV": {
          "compareBy": [
            "both",
            "fTest",
          ],
        },
        "oneSample": {
          "predicted": [
            "unset",
            "unset",
          ],
        },
        "oneWayAnova": {
          "ddf": [
            "containment",
            "satterthwaite",
          ],
          "differenceAs": [
            "earlierMinusLater",
            "laterMinusEarlier",
          ],
          "dunnMethod": [
            "bonferroni",
            "holm",
          ],
          "kwPMethod": [
            "approximate",
            "exactWhenPossible",
          ],
          "reportEqualSdTests": [
            true,
            false,
          ],
          "rmMethod": [
            "auto",
            "auto",
          ],
        },
        "survival": {
          "control": [
            "",
            "",
          ],
          "hazardRatio": [
            "both",
            "mantelHaenszel",
          ],
          "pairwise": [
            "none",
            "none",
          ],
          "pairwiseMethod": [
            "holm",
            "holm",
          ],
          "test": [
            "all",
            "logRank",
          ],
          "trend": [
            true,
            false,
          ],
        },
        "survivalFromVariables": {
          "control": [
            "",
            "",
          ],
          "hazardRatio": [
            "both",
            "mantelHaenszel",
          ],
          "pairwise": [
            "none",
            "none",
          ],
          "pairwiseMethod": [
            "holm",
            "holm",
          ],
          "test": [
            "all",
            "logRank",
          ],
          "trend": [
            true,
            false,
          ],
        },
        "threeWayAnova": {
          "ddf": [
            "containment",
            "satterthwaite",
          ],
        },
        "ttest": {
          "predicted": [
            "unset",
            "unset",
          ],
        },
        "twoWayAnova": {
          "ddf": [
            "containment",
            "satterthwaite",
          ],
          "differenceAs": [
            "earlierMinusLater",
            "laterMinusEarlier",
          ],
          "rmMethod": [
            "auto",
            "auto",
          ],
        },
        "wilcoxon": {
          "predicted": [
            "unset",
            "unset",
          ],
        },
      }
    `)
  })

  it('a stored choice is never overwritten by a pinned default', () => {
    const r = paramsOf(def('ttest'), {
      params: { unpaired: { assumeEqualSD: false }, confidenceLevel: 0.9 },
      pluginVersion: 1,
    })
    expect(r.ok && r.params).toMatchObject({
      unpaired: { assumeEqualSD: false },
      confidenceLevel: 0.9,
    })
    expect(
      pinDefaults({ a: { b: 1 } }, [
        [['a', 'b'], 2],
        [['a', 'c'], 3],
        [['d'], 4],
      ]),
    ).toEqual({
      a: { b: 1, c: 3 },
      d: 4,
    })
  })

  it('a one-tailed test saved before 0.3.9 keeps its observed direction', () => {
    for (const id of ['ttest', 'mannWhitney', 'wilcoxon', 'oneSample', 'nestedT', 'correlation']) {
      const r = paramsOf(def(id), { params: { tails: 'one' }, pluginVersion: 1 })
      expect(r.ok && (r.params as { predicted: string }).predicted, id).toBe('observed')
      const two = paramsOf(def(id), { params: {}, pluginVersion: 1 })
      expect(two.ok && (two.params as { predicted: string }).predicted, id).toBe('unset')
    }
  })

  it('Monte Carlo: the inner analysis saved without its version is read at version 1', () => {
    const r = paramsOf(def('monteCarlo'), { params: {}, pluginVersion: 1 })
    expect(
      r.ok && (r.params as { analysis: { pluginVersion: number } }).analysis.pluginVersion,
    ).toBe(1)
    // A new one records the inner analysis' current version.
    const fresh = withInnerVersion(def('monteCarlo').params.parse({}) as MonteCarloParams, (x) =>
      registry.get(x),
    )
    expect((fresh as { analysis: { pluginVersion: number } }).analysis.pluginVersion).toBe(
      def('ttest').version,
    )
  })
})
