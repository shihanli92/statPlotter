import {
  type AnalysisResult,
  normalizeTable,
  paramsOf,
  resultSummary,
  summaryText,
} from '@ps/model'
import { EQUATIONS, modelFor } from '@ps/stats'
import { describe, expect, it } from 'vitest'
import {
  analysisFacts,
  comparisonFacts,
  curveWarnings,
  EQUATION_META,
  equationMeta,
  fieldStates,
  goalOf,
  MODEL_GOALS,
  modelsNested,
  modelThumbnail,
  nestedRelatives,
  nonlinearFitDef,
  nonlinearFitMVDef,
  registry,
  unitWords,
  withLog10X,
  xLooks,
  xScaleChecks,
} from '../src/index.ts'
import { runDef, v, xyReplicatesTable, xyTable } from './helpers.ts'

// Roadmap 51e (design §9): the curve-fit picker's metadata, the X-scale checks, the dose-response
// warnings, profile CIs by default with saved fits pinned, and one model comparison chosen in
// advance between nested models (F test) or any two (AICc).

const run = (t: Parameters<typeof runDef>[1], p: Record<string, unknown>) =>
  runDef(nonlinearFitDef, t, p, { tableKind: 'xy', xTitle: 'log[Agonist], M' })

const LOG_X = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5, -4.5, -4]
const NOISE = [0.8, -1.1, 0.4, 1.3, -0.6, -0.9, 1.0, -0.3, 0.7, -1.2, 0.5]
const hill = (x: number, b: number, t: number, l: number, h: number) =>
  b + (t - b) / (1 + 10 ** ((l - x) * h))
const curve = (xs: number[], b: number, t: number, l: number, h: number, k = 1) =>
  xs.map((x, i) => hill(x, b, t, l, h) + k * NOISE[i % NOISE.length]!)

const GP = { pValueStyle: 'GP', pValueDigits: 4 } as const

/** The summary sentence (P in the default style). */
const said = (r: AnalysisResult): string => {
  const b = resultSummary(r.sheets)
  return b ? summaryText(b, GP) : ''
}

const warnings = (r: AnalysisResult) =>
  r.diagnostics.filter((d) => d.level === 'warning').map((d) => d.message)

describe('equation metadata (design §9.1)', () => {
  it('covers every built-in equation: goals, X scale, every parameter’s meaning and unit', () => {
    expect(EQUATION_META.size).toBe(EQUATIONS.length)
    for (const e of EQUATIONS) {
      const m = equationMeta(e.id)!
      expect(m, e.id).toBeDefined()
      expect(['log', 'concentration', 'time', 'linear']).toContain(m.xScale)
      expect(m.shape.length, e.id).toBeGreaterThan(5)
      expect(Object.keys(m.params)).toEqual([...e.params])
      for (const [name, p] of Object.entries(m.params)) {
        expect(p.meaning.length, `${e.id}.${name}`).toBeGreaterThan(3)
        expect(unitWords(p.unit), `${e.id}.${name}`).toBeTruthy()
      }
      expect(m.typical.p.length, e.id).toBe(e.params.length)
      for (const k of ['midpoint', 'top', 'bottom'] as const)
        if (m[k]) expect(e.params, `${e.id}.${k}`).toContain(m[k])
    }
  })

  it('lists every equation under a goal or under All equations only (the classic forms)', () => {
    const listed = new Set(MODEL_GOALS.flatMap((g) => g.models))
    const unlisted = EQUATIONS.filter((e) => !listed.has(e.id)).map((e) => e.id)
    expect(unlisted.every((id) => id.startsWith('classic-'))).toBe(true)
    expect(unlisted).toHaveLength(6)
    for (const g of MODEL_GOALS) {
      expect(g.models.length, g.id).toBeGreaterThan(0)
      expect(new Set(g.models).size, g.id).toBe(g.models.length)
      for (const id of g.models) expect(equationMeta(id)?.goals, `${g.id} ${id}`).toContain(g.id)
    }
    expect(goalOf('inhibitor-response-variable-slope')).toBe('inhibition')
    expect(MODEL_GOALS.find((g) => g.id === 'standard')!.sets).toEqual({ interpolate: true })
    // The usual choice first.
    expect(MODEL_GOALS[0]!.models[0]).toBe('agonist-response-variable-slope')
    expect(MODEL_GOALS[1]!.models[0]).toBe('inhibitor-response-variable-slope')
  })

  it('pairs each log model with its concentration form (and back)', () => {
    for (const m of EQUATION_META.values()) {
      if (!m.otherScale) continue
      const o = equationMeta(m.otherScale)!
      expect(o.otherScale, m.id).toBe(m.id)
      expect(o.params && Object.keys(o.params).length).toBe(Object.keys(m.params).length)
      expect([m.xScale, o.xScale].sort()).toEqual(['concentration', 'log'])
    }
  })

  // The declared special cases are checked by evaluating both models: the complex one with the
  // stated values equals the simpler one at every X.
  const RENAME: Record<string, Record<string, string>> = {
    'agonist-response>agonist-response-variable-slope': {},
    'inhibitor-response-variable-slope>asymmetric-5pl': { LogEC50: 'LogIC50' },
    'inhibitor-conc-response-variable-slope>asymmetric-5pl-conc': { EC50: 'IC50' },
    'michaelis-menten>allosteric-sigmoidal': { Khalf: 'Km' },
    'straight-line>polynomial-2': { B0: 'YIntercept', B1: 'Slope' },
    'horizontal-line>straight-line': { YIntercept: 'Mean' },
    'horizontal-line>polynomial-1': { B0: 'Mean' },
    'one-site-specific>two-sites-specific': { BmaxHi: 'Bmax', KdHi: 'Kd' },
    'one-site-total-and-nonspecific>two-sites-total-and-nonspecific': {
      BmaxHi: 'Bmax',
      KdHi: 'Kd',
    },
    'one-site-fit-logic50>two-sites-fit-logic50': { LogIC50Hi: 'LogIC50' },
    'one-phase-decay>two-phase-decay': { KFast: 'K' },
    'one-phase-association>two-phase-association': { KFast: 'K' },
    'two-phase-decay>three-phase-decay': { KMedium: 'KSlow', KSlow: 'KFast__' },
    'gaussian>gaussian-sum-two': { Amplitude1: 'Amplitude', Mean1: 'Mean', SD1: 'SD' },
    'lorentzian>lorentzian-sum-two': {
      Amplitude1: 'Amplitude',
      Center1: 'Center',
      Width1: 'Width',
    },
    'classic-one-phase-decay>classic-two-phase-decay': { Span1: 'Span', K1: 'K' },
    'classic-one-phase-association>classic-two-phase-association': { Ymax1: 'Ymax', K1: 'K' },
  }
  const parseWhen = (when: string): Record<string, number> =>
    Object.fromEntries(
      when
        .replace(/\s*\(.*\)$/, '')
        .split(' and ')
        .map((a) => {
          const [k, val] = a.split('=').map((s) => s.trim())
          return [k!, Number(val!.replace('−', '-'))]
        }),
    )

  it('declares nested models that are special cases (checked by evaluating both)', () => {
    let pairs = 0
    for (const m of EQUATION_META.values()) {
      const simple = EQUATIONS.find((e) => e.id === m.id)!
      for (const rel of m.specialCaseOf) {
        const complex = EQUATIONS.find((e) => e.id === rel.model)!
        expect(complex, `${m.id} → ${rel.model}`).toBeDefined()
        expect(complex.params.length, `${m.id} < ${rel.model}`).toBeGreaterThan(
          simple.params.length,
        )
        const set = parseWhen(rel.when)
        const rename = RENAME[`${m.id}>${rel.model}`] ?? {}
        const sp = Object.fromEntries(simple.params.map((n, j) => [n, m.typical.p[j]!]))
        const cp = complex.params.map((n) => {
          if (n in set) return set[n]!
          const from = rename[n] ?? n
          return sp[from] ?? 0.7 // a parameter the special case makes irrelevant
        })
        const sm = modelFor(simple, { dataSet: 0 })
        const cm = modelFor(complex, { dataSet: 0 })
        const [lo, hi] = m.typical.x
        for (let i = 0; i <= 8; i++) {
          const x =
            m.typical.spacing === 'log' ? lo * (hi / lo) ** (i / 8) : lo + ((hi - lo) * i) / 8
          const a = sm.f(x, m.typical.p)
          const b = cm.f(x, cp)
          expect(Math.abs(a - b), `${m.id} ⊂ ${rel.model} at ${x}`).toBeLessThanOrEqual(
            1e-9 * Math.max(1, Math.abs(a)),
          )
        }
        pairs++
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(35)
  })

  it('nesting is structural, transitive and symmetric; equivalent forms are not nested', () => {
    expect(modelsNested('agonist-response', 'agonist-response-variable-slope')).toBe(true)
    expect(modelsNested('agonist-response-variable-slope', 'agonist-response')).toBe(true)
    // Transitively: the standard slope is the 5PL with S = 1 and HillSlope = 1.
    expect(modelsNested('agonist-response', 'asymmetric-5pl')).toBe(true)
    // Same number of parameters, different shapes: not nested.
    expect(modelsNested('gaussian', 'lorentzian')).toBe(false)
    // Equivalent parameterisations aren't special cases of each other.
    expect(modelsNested('straight-line', 'polynomial-1')).toBe(false)
    expect(modelsNested('michaelis-menten', 'substrate-inhibition')).toBe(false)
    expect(modelsNested('agonist-response', 'agonist-response')).toBe(false)
    expect(nestedRelatives('inhibitor-response')).toContain('inhibitor-response-variable-slope')
  })

  it('draws a thumbnail of every model (finite, the plateaus and midpoint named)', () => {
    for (const e of EQUATIONS) {
      const t = modelThumbnail(e.id)!
      expect(t, e.id).not.toBeNull()
      const ys = t.table.dataSets[0]!.subcolumns[0]!.values.filter((y) => y !== null)
      expect(ys.length, e.id).toBeGreaterThan(10)
    }
    const t = modelThumbnail('agonist-response-variable-slope')!
    expect(t.labels?.map((l) => l.text)).toEqual(['Top', 'Bottom', 'EC50'])
    expect(t.axes).toEqual({ bare: true })
    expect(modelThumbnail('agonist-conc-response-variable-slope')!.axes).toEqual({
      bare: true,
      xLog: true,
    })
    expect(modelThumbnail('user')).toBeNull()
  })
})

describe('log-X checks (design §9.2, S8)', () => {
  it('reads X as log molar or as concentrations', () => {
    expect(xLooks([-10, -9, -8, -7, -6, -5])).toMatchObject({
      looksLog: true,
      looksConcentration: false,
    })
    expect(xLooks([0, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5])).toMatchObject({
      looksLog: false,
      looksConcentration: true,
      zeros: 1,
    })
    expect(xLooks([1, 2, 3, 4, 5])).toMatchObject({ looksLog: false, looksConcentration: false })
    // A span of 9 log units or more isn't log molar.
    expect(xLooks([-12, -2])?.looksLog).toBe(false)
    expect(xLooks([])).toBeNull()
  })

  it('concentrations under a log model: a note with Transform and the concentration form', () => {
    const [c] = xScaleChecks('agonist-response-variable-slope', [1e-10, 1e-9, 1e-8, 1e-7, 1e-5])
    expect(c).toMatchObject({
      level: 'note',
      message:
        'X looks like concentrations (1e-10 to 1e-5), but this model expects log(concentration).',
    })
    expect(c!.fix).toEqual([
      { label: 'Transform X to log10', action: 'transformLog10X' },
      {
        label: 'Use the concentration form of this model',
        set: [{ path: ['equation'], value: 'agonist-conc-response-variable-slope' }],
      },
    ])
    const zero = xScaleChecks('inhibitor-response', [0, 1e-9, 1e-8, 1e-7, 1e-6])
    expect(zero).toHaveLength(2)
    expect(zero[1]!.message).toBe(
      '1 row has X = 0, which has no logarithm and is left out once X is on a log scale. Fit on the concentration scale, or enter the vehicle as a very low dose.',
    )
  })

  it('log values under a concentration model: a note with the log form', () => {
    const [c] = xScaleChecks('inhibitor-conc-response-variable-slope', [-10, -9, -8, -7, -6, -5])
    expect(c!.message).toBe(
      'X looks like log molar (−10 to −5), but this model expects concentrations.',
    )
    expect(c!.fix).toEqual([
      {
        label: 'Use the log form of this model',
        set: [{ path: ['equation'], value: 'inhibitor-response-variable-slope' }],
      },
    ])
    expect(xScaleChecks('michaelis-menten', [-3, -2, -1])).toHaveLength(1)
  })

  it('nothing when X matches the model, for lines and peaks, or user equations', () => {
    expect(xScaleChecks('agonist-response', LOG_X)).toEqual([])
    expect(xScaleChecks('agonist-conc-response', [1e-9, 1e-7, 1e-5])).toEqual([])
    expect(xScaleChecks('gaussian', [-10, -8, -6, -2])).toEqual([])
    expect(xScaleChecks('straight-line', [1e-9, 1e-7, 1e-5])).toEqual([])
    const t = xyTable([1e-9, 1e-8, 1e-7, 1e-6, 1e-5], [[1, 5, 30, 80, 95]])
    const input = normalizeTable(t)
    expect(nonlinearFitDef.check!(input, nonlinearFitDef.params.parse({}))).toHaveLength(1)
    expect(
      nonlinearFitDef.check!(input, nonlinearFitDef.params.parse({ equation: 'user' })),
    ).toEqual([])
  })

  it('Transform X to log10: the dialog’s preview of the transformed X', () => {
    const t = xyTable([0, 1e-9, 1e-6], [[1, 2, 3]])
    const [d] = withLog10X(normalizeTable(t))
    expect([...d!.x!]).toEqual([Number.NaN, -9, -6])
  })
})

describe('dose-response warnings (design §9.3)', () => {
  it('a complete curve raises none', () => {
    const r = run(xyTable(LOG_X, [curve(LOG_X, 5, 95, -6.5, 1.1)]), {})
    expect(warnings(r)).toEqual([])
  })

  it('an EC50 beyond the doses, the top plateau not reached: Fix Top = 100 for percentages', () => {
    const xs = LOG_X.slice(0, 7) // −9 … −6: only the bottom half of a curve at −5
    const r = run(xyTable(xs, [curve(xs, 2, 100, -5.6, 1, 0.3)]), {})
    const w = r.diagnostics.filter((d) => d.level === 'warning')
    const outside = w.find((d) => d.message.startsWith('The EC50 lies outside the doses tested'))
    expect(outside?.message).toMatch(
      /^The EC50 lies outside the doses tested \(LogEC50 = −[\d.]+; −9 to −6\): it is an extrapolation\. Test higher doses, or constrain Top\.$/,
    )
    expect(outside?.fix).toEqual({
      label: 'Fix Top = 100',
      set: [{ path: ['constraints', 'Top'], value: { kind: 'constant', value: 100 } }],
    })
  })

  it('a top far above the responses names it and how to fix it', () => {
    const xs = LOG_X.slice(0, 8)
    // Responses in their own units (not percentages): no value is offered for Top.
    const r = run(xyTable(xs, [curve(xs, 200, 2000, -4.6, 0.9, 3)]), {})
    const top = warnings(r).find((m) => m.startsWith('The top plateau'))
    expect(top).toMatch(
      /^The top plateau isn’t reached by the data: Top = [\d.e]+ is far above the highest response \([\d.]+\)\. Constrain Top \(e\.g\. 100 for normalized data\) or test higher doses\.$/,
    )
  })

  it('a bottom far below: Fix Bottom = 0, opening Edit with it', () => {
    const xs = LOG_X.slice(4) // −7 … −4: a falling curve whose bottom is past the doses
    const ys = xs.map((x, i) => hill(x, -400, 100, -3.6, -0.8) + NOISE[i]! * 0.5)
    const r = run(xyTable(xs, [ys]), { equation: 'inhibitor-response-variable-slope' })
    const bottom = r.diagnostics.find((d) => d.message.startsWith('The bottom plateau'))
    expect(bottom?.fix?.label).toBe('Fix Bottom = 0')
    expect(bottom?.message).toMatch(/Fix Bottom = 0 or test higher doses\.$/)
  })

  it('an EC50 the data don’t determine: its CI wider than the doses', () => {
    const xs = [-8, -7.5, -7, -6.5, -6, -5.5, -5]
    const ys = [20, 22, 25, 31, 26, 33, 30]
    const r = run(xyTable(xs, [ys]), { equation: 'agonist-response' })
    expect(warnings(r).some((m) => /don’t determine the EC50 well/.test(m))).toBe(true)
  })

  it('an unbounded profile CI is a midpoint the data don’t determine', () => {
    const x = [-9, -8, -7, -6, -5, -4, -3]
    const w = curveWarnings(
      'agonist-response-variable-slope',
      [
        {
          title: 'A',
          x,
          y: [1, 2, 3, 4, 5, 6, 7],
          at: (v) => v,
          param: (n) =>
            n === 'LogEC50'
              ? { value: -6, lo: Number.NEGATIVE_INFINITY, hi: -5.5, fitted: true }
              : { value: n === 'Top' ? 7 : 1, lo: 0, hi: 8, fitted: true },
          status: 'converged',
          free: 4,
        },
      ],
      0.95,
    )
    expect(w.map((d) => d.message)).toEqual([
      'The data don’t determine the EC50 well: its 95% CI spans more than the doses tested. Constrain a plateau the data don’t reach, or test doses either side of it.',
    ])
  })

  it('too few doses for the parameters', () => {
    const xs = [-9, -8, -7, -6, -5]
    const r = run(
      xyReplicatesTable(xs, [[curve(xs, 5, 95, -7, 1), curve(xs, 5, 95, -7, 1, -1)]]),
      {},
    )
    expect(warnings(r)).toContain(
      '5 doses for 4 fitted parameters: too few to define the curve. Test more doses, or fit fewer parameters (fix a plateau).',
    )
  })

  it('names the data set when several are fit', () => {
    const xs = LOG_X.slice(0, 7)
    const r = run(
      xyTable(xs, [curve(xs, 2, 98, -7.4, 1), curve(xs, 2, 100, -5, 1, 0.3)], ['Full', 'Half']),
      {},
    )
    const w = warnings(r)
    expect(w.some((m) => m.startsWith('“Half”: The EC50 lies outside'))).toBe(true)
    expect(w.some((m) => m.startsWith('“Full”:'))).toBe(false)
  })
})

describe('profile-likelihood CIs by default (design §9.3)', () => {
  it('new fits report profile CIs; saved fits keep the asymptotic ones', () => {
    expect(nonlinearFitDef.params.parse({}).ciMethod).toBe('profile')
    expect(nonlinearFitDef.version).toBe(3)
    expect(nonlinearFitMVDef.version).toBe(3)
    const read = (pluginVersion: number, params: Record<string, unknown> = {}) => {
      const r = paramsOf(nonlinearFitDef, { params, pluginVersion })
      return r.ok ? (r.params as Record<string, unknown>) : {}
    }
    expect(read(1)).toMatchObject({ compareBy: 'both', ciMethod: 'symmetric' })
    expect(read(2)).toMatchObject({ compareBy: 'fTest', ciMethod: 'symmetric' })
    expect(read(2, { ciMethod: 'profile' })).toMatchObject({ ciMethod: 'profile' })
    expect(read(3)).toMatchObject({ compareBy: 'fTest', ciMethod: 'profile' })
    const r = run(xyTable(LOG_X, [curve(LOG_X, 5, 95, -6.5, 1.1)]), {})
    const titles = r.sheets[0]!.blocks.flatMap((b) => (b.type === 'table' ? [b.title] : []))
    expect(titles).toContain('95% CI (profile likelihood)')
  })
})

describe('one model comparison, chosen in advance (design §9.4, S18)', () => {
  const data = xyTable(LOG_X, [curve(LOG_X, 5, 95, -6.5, 1.6)])

  it('nested models: one verdict by the F test, in the summary too', () => {
    const r = run(data, {
      equation: 'agonist-response-variable-slope',
      compareWith: 'agonist-response',
    })
    const cmp = r.sheets.find((s) => s.key === 'compare')!
    const table = cmp.blocks[0]!
    expect(table.type === 'table' && table.title).toBe('Extra sum-of-squares F test')
    const key = normalizeTable(data)[0]!.ref.key
    expect(r.values[`preferredModel:${key}`]).toEqual({
      kind: 'text',
      v: 'log(agonist) vs. response — Variable slope (four parameters)',
    })
    expect(v(r.values[`modelP:${key}`])).toBeLessThan(0.05)
    expect(said(r)).toMatch(
      /Preferred model: log\(agonist\) vs\. response — Variable slope \(four parameters\) \(extra sum-of-squares F test, P [=<] /,
    )
  })

  it('the simpler model is the special case, whichever is fit first', () => {
    const r = run(data, {
      equation: 'agonist-response',
      compareWith: 'agonist-response-variable-slope',
    })
    const table = r.sheets.find((s) => s.key === 'compare')!.blocks[0]!
    expect(table.type === 'table' && table.rows[0]![1]).toEqual({
      kind: 'text',
      v: 'log(agonist) vs. response (three parameters)',
    })
  })

  it('models that aren’t nested: AICc (the F test, if asked by a file, falls back with a warning)', () => {
    const x = Array.from({ length: 21 }, (_, i) => -5 + i)
    const y = x.map((q, i) => 50 * Math.exp(-0.5 * ((q - 5) / 2) ** 2) + NOISE[i % 11]!)
    const t = xyTable(x, [y])
    const facts = comparisonFacts({ equation: 'gaussian', compareWith: 'lorentzian' })
    expect(facts).toEqual({ modelComparison: true, modelsNested: false })
    const r = run(t, { equation: 'gaussian', compareWith: 'lorentzian', compareBy: 'fTest' })
    expect(warnings(r)).toContain(
      'These models aren’t nested (neither is a special case of the other), so the F test doesn’t apply; they are compared by AICc.',
    )
    const aicc = run(t, { equation: 'gaussian', compareWith: 'lorentzian', compareBy: 'aicc' })
    expect(said(aicc)).toMatch(/Preferred model: Gaussian \(AICc, probability [\d.]+%\)\./)
  })

  it('a user-defined equation is compared by AICc only', () => {
    expect(
      comparisonFacts({ equation: 'user', userEquation: 'Y = A*X', compareWith: 'straight-line' }),
    ).toEqual({ modelComparison: true, modelsNested: false })
    expect(comparisonFacts({ equation: 'agonist-response', compareParams: ['LogEC50'] })).toEqual({
      modelComparison: true,
      modelsNested: true,
    })
    expect(comparisonFacts({ equation: 'agonist-response' })).toEqual({
      modelComparison: false,
      modelsNested: true,
    })
    // A constraint making the counts equal: not a comparison of nested models any more.
    expect(
      comparisonFacts({
        equation: 'agonist-response-variable-slope',
        compareWith: 'agonist-response',
        constraints: { HillSlope: { kind: 'constant', value: 1 } },
      }).modelsNested,
    ).toBe(false)
  })

  it('§4.4 row 22: the dialog greys the F test for models that aren’t nested', () => {
    const def = registry.get('nonlinearFit')!
    const t = normalizeTable(xyTable(LOG_X, [curve(LOG_X, 5, 95, -6.5, 1)]))
    const at = (params: Record<string, unknown>) => {
      const p = def.params.parse(params) as Record<string, unknown>
      const s = fieldStates(def.form, p, analysisFacts('xy', t, p))
      return s.find((x) => x.field.path[0] === 'compareBy')!
    }
    expect(at({}).shown).toBe(false)
    const nested = at({ compareWith: 'agonist-response' })
    expect(nested.shown).toBe(true)
    expect(nested.options.get('fTest')).toBeUndefined()
    const not = at({ compareWith: 'asymmetric-5pl-conc' })
    expect(not.options.get('fTest')).toBe('These models aren’t nested; compare them by AICc.')
    expect(not.problem).toBe('These models aren’t nested; compare them by AICc.')
    expect(at({ compareWith: 'asymmetric-5pl-conc', compareBy: 'aicc' }).problem).toBeNull()
  })

  it('parameters compared between data sets: the verdict by the chosen method', () => {
    const t = xyTable(
      LOG_X,
      [curve(LOG_X, 5, 95, -7.2, 1), curve(LOG_X, 5, 95, -6.1, 1, -1)],
      ['Agonist', '+ Antagonist'],
    )
    const f = run(t, { compareParams: ['LogEC50'] })
    expect(said(f)).toMatch(
      /LogEC50 differs between data sets \(extra sum-of-squares F test, P < 0\.0001\)\.$/,
    )
    const a = run(t, { compareParams: ['LogEC50'], compareBy: 'aicc' })
    expect(said(a)).toMatch(
      /AICc prefers a different LogEC50 for each data set \(probability [\d.]+%\)\.$/,
    )
  })
})
