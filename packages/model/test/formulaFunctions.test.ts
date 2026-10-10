import { describe, expect, it } from 'vitest'
import { arr, expectClose, loadFixtures } from '../../stats/test/oracle.ts'
import { cpuRatio, growthRatio } from '../../stats/test/timing.ts'
import { formatG, quantileOfSorted } from '../src/formulaStats.ts'
import {
  createTable,
  type DataTable,
  evaluateFormula,
  FORMULA_FUNCTIONS,
  type FormulaColumn,
  formulaReference,
  levelsInTable,
  normalizeTable,
  parseFormula,
  resolvedTable,
  roundDecimal,
  tableFormulas,
  tableIssues,
} from '../src/index.ts'

// Roadmap 38: the formula language's new functions (statistics over a column or within groups,
// text, logic, maths, running values, categories), checked against R where they are statistics.

function mv(cols: Record<string, (number | null)[] | (string | null)[] | string>): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(1, ...Object.values(cols).map((v) => (Array.isArray(v) ? v.length : 0)))
  const t = createTable({ tableKind: 'multipleVariables', columns: titles.length, rows })
  titles.forEach((title, i) => {
    const ds = t.dataSets[i]!
    ds.title = title
    const v = cols[title]!
    if (typeof v === 'string') ds.formula = v
    else if (v.some((x) => typeof x === 'string')) ds.text = v as (string | null)[]
    else ds.subcolumns[0]!.values = v as (number | null)[]
  })
  expect(tableIssues(t)).toEqual([])
  return t
}

const result = (t: DataTable, title: string) => {
  const ds = t.dataSets.find((d) => d.title === title)!
  const f = tableFormulas(t).get(ds.id)!
  return {
    ...f,
    values: [...f.values].map((v) => (Number.isNaN(v) ? null : v)),
  }
}
const nums = (t: DataTable, title: string) => {
  const r = result(t, title)
  expect(r.error).toBeNull()
  return r.values
}
const texts = (t: DataTable, title: string) => {
  const r = result(t, title)
  expect(r.error).toBeNull()
  return r.text
}

const cols = (x: readonly (number | null)[], g?: readonly (string | null)[]): FormulaColumn[] => [
  { id: 'x', title: 'x', values: x.map((v) => (v === null ? Number.NaN : v)) },
  ...(g ? [{ id: 'g', title: 'g', text: g }] : []),
]
const run = (formula: string, columns: FormulaColumn[], n: number) => {
  const r = evaluateFormula(formula, columns, n)
  expect(r.error, formula).toBeNull()
  return r
}

describe('formula: the language', () => {
  it('has infix and, or and not between conditions', () => {
    const t = mv({
      sample: ['S1', 'S2', 'S1', 'S1', null],
      nCount: [600, 900, 400, 501, 800],
      F: '=sample == "S1" and nCount > 500',
      G: '=sample = "S2" or nCount < 450',
      H: '=not nCount > 500 and sample = "S1"',
      I: '=(sample = "S1" or sample = "S2") and not(nCount > 800)',
    })
    expect(nums(t, 'F')).toEqual([1, 0, 0, 1, null])
    expect(nums(t, 'G')).toEqual([0, 1, 1, 0, null])
    expect(nums(t, 'H')).toEqual([0, 0, 1, 0, null])
    expect(nums(t, 'I')).toEqual([1, 0, 1, 1, null])
    // and binds tighter than or.
    expect(parseFormula('=a or b and c')).toMatchObject({ k: 'call', fn: 'or' })
    expect(() => parseFormula('=a and')).toThrow('incomplete')
    expect(formulaReference('and')).toBe('[and]')
    expect(formulaReference('median')).toBe('[median]')
  })

  it('lists every function it knows in the reference, each with a signature', () => {
    const names = FORMULA_FUNCTIONS.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
    for (const f of FORMULA_FUNCTIONS) {
      expect(f.signature.startsWith(`${f.name}(`)).toBe(true)
      // Each parses with its fewest arguments.
      const args = Array.from({ length: f.args[0] }, () => '1').join(', ')
      expect(() => parseFormula(`=${f.name}(${args})`)).not.toThrow()
    }
    for (const n of ['median', 'quantile', 'rank', 'zscore', 'meanby', 'concat', 'ifs', 'cut'])
      expect(names).toContain(n)
  })
})

describe('formula: maths', () => {
  it('mod, round, clamp, log with a base, logit, expit, asinh', () => {
    const t = mv({
      x: [7, -7, 0.25, 100],
      Mod: '=mod(x, 3)',
      Round: '=round(x / 3, 2)',
      Clamp: '=clamp(x, 0, 10)',
      Log: '=log(x, 2)',
      Logit: '=logit(x)',
      Expit: '=expit(logit(0.25))',
      Asinh: '=asinh(x / 5)',
    })
    expect(nums(t, 'Mod')).toEqual([1, 2, 0.25, 1])
    expect(nums(t, 'Round')).toEqual([2.33, -2.33, 0.08, 33.33])
    expect(nums(t, 'Clamp')).toEqual([7, 0, 0.25, 10])
    expect(nums(t, 'Log')[3]).toBeCloseTo(Math.log2(100), 12)
    expect(nums(t, 'Logit')[2]).toBeCloseTo(Math.log(1 / 3), 14)
    expect(result(t, 'Logit').invalidRows).toEqual([0, 1, 3])
    expect(nums(t, 'Expit')[0]).toBeCloseTo(0.25, 14)
    expect(nums(t, 'Asinh')[0]).toBeCloseTo(Math.asinh(7 / 5), 14)
  })
})

describe('round on the decimal digits, as spreadsheets (audit 2, decision 682)', () => {
  it.each([
    [1.005, 2, 1.01],
    [-1.005, 2, -1.01],
    [2.675, 2, 2.68],
    [1.255, 2, 1.26],
    [0.045, 2, 0.05],
    [4.35, 1, 4.4],
    [9.995, 2, 10],
    [0.5, 0, 1],
    [-2.5, 0, -3],
    [1.4999999999999998, 0, 1],
    [0.0049, 2, 0],
    [0.005, 2, 0.01],
    [0.30000000000000004, 1, 0.3],
    [123.456, 1, 123.5],
    [1234.5, -1, 1230],
    [1250, -2, 1300],
    [-1250, -2, -1300],
    [149, -2, 100],
    [49, -2, 0],
    [7.123, 2.9, 7.12],
    [5e-324, 400, 5e-324],
    [1e21, 2, 1e21],
    [1.7976931348623157e308, -300, 1.79769313e308],
    [-0.4, 0, 0],
  ])('round(%d, %d) = %d', (x, d, want) => {
    expect(roundDecimal(x, d)).toBe(want)
  })

  it('keeps what can’t be rounded', () => {
    expect(roundDecimal(Number.NaN, 2)).toBeNaN()
    expect(roundDecimal(1.5, Number.NaN)).toBeNaN()
    expect(roundDecimal(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY)
    expect(roundDecimal(0, 2)).toBe(0)
    expect(roundDecimal(3.25)).toBe(3)
  })

  it('in formulas', () => {
    const t = mv({ x: [1.005, 2.675, -0.125], R: '=round(x, 2)', R0: '=round(x * 10, -1)' })
    expect(nums(t, 'R')).toEqual([1.01, 2.68, -0.13])
    expect(nums(t, 'R0')).toEqual([10, 30, 0])
  })
})

describe('formula: logic', () => {
  it('ifs, case, iferror, coalesce, isnumber and istext', () => {
    const t = mv({
      x: [1, 5, 20, null],
      g: ['wt', 'KO', null, 'het'],
      Ifs: '=ifs(x < 2, "low", x < 10, "mid", "high")',
      IfsNone: '=ifs(x < 2, 1)',
      Case: '=case(g, "WT", "wild type", "ko", "knockout")',
      CaseElse: '=case(g, "WT", 1, 2)',
      IfErr: '=iferror(ln(x - 2), -1)',
      Coalesce: '=coalesce(x, 0)',
      CoalesceText: '=coalesce(g, "none")',
      IsNum: '=isnumber(x)',
      IsText: '=istext(g)',
      IfText: '=if(x > 3, "big", "small")',
    })
    expect(texts(t, 'Ifs')).toEqual(['low', 'mid', 'high', null])
    expect(nums(t, 'IfsNone')).toEqual([1, null, null, null])
    // Blank by design, not invalid.
    expect(result(t, 'IfsNone').invalidRows).toEqual([])
    expect(texts(t, 'Case')).toEqual(['wild type', 'knockout', null, null])
    expect(nums(t, 'CaseElse')).toEqual([1, 2, null, 2])
    expect(nums(t, 'IfErr')).toEqual([-1, Math.log(3), Math.log(18), null])
    expect(nums(t, 'Coalesce')).toEqual([1, 5, 20, 0])
    expect(texts(t, 'CoalesceText')).toEqual(['wt', 'KO', 'none', 'het'])
    expect(nums(t, 'IsNum')).toEqual([1, 1, 1, 0])
    expect(nums(t, 'IsText')).toEqual([1, 1, 0, 1])
    expect(texts(t, 'IfText')).toEqual(['small', 'big', 'big', null])
    const bad = mv({ x: [1], F: '=if(x > 0, "a", 1)', G: '=case(x, "a", 1)' })
    expect(result(bad, 'F').error).toBe('if’s values are all numbers or all text')
    expect(result(bad, 'G').error).toBe('case matches numbers with numbers')
  })
})

describe('formula: text', () => {
  it('concat, upper, lower, left, right, mid, len, trim, replace, contains…, text, value', () => {
    const t = mv({
      s: ['  Sample One ', 'cd4_T', null],
      n: [1.5, 2, 3],
      Cat: '=concat(trim(s), "-", n)',
      Up: '=upper(s)',
      Low: '=lower(s)',
      Left: '=left(trim(s), 3)',
      Right: '=right(trim(s))',
      Mid: '=mid(trim(s), 2, 3)',
      Len: '=len(s)',
      Rep: '=replace(s, "_", " ")',
      Has: '=contains(s, "ONE")',
      Starts: '=startswith(trim(s), "cd")',
      Ends: '=endswith(s, "_t")',
      Txt: '=text(n, 2)',
      Txt0: '=text(n / 3)',
      Val: '=value(text(n * 2)) + 1',
    })
    expect(texts(t, 'Cat')).toEqual(['Sample One-1.5', 'cd4_T-2', null])
    // Text cells are read as their levels: trimmed.
    expect(texts(t, 'Up')).toEqual(['SAMPLE ONE', 'CD4_T', null])
    expect(texts(t, 'Low')).toEqual(['sample one', 'cd4_t', null])
    expect(texts(t, 'Left')).toEqual(['Sam', 'cd4', null])
    expect(texts(t, 'Right')).toEqual(['e', 'T', null])
    expect(texts(t, 'Mid')).toEqual(['amp', 'd4_', null])
    expect(nums(t, 'Len')).toEqual([10, 5, null])
    expect(texts(t, 'Rep')).toEqual(['Sample One', 'cd4 T', null])
    expect(nums(t, 'Has')).toEqual([1, 0, null])
    expect(nums(t, 'Starts')).toEqual([0, 1, null])
    expect(nums(t, 'Ends')).toEqual([0, 1, null])
    expect(texts(t, 'Txt')).toEqual(['1.50', '2.00', '3.00'])
    expect(texts(t, 'Txt0')).toEqual(['0.5', '0.666666666666667', '1'])
    expect(nums(t, 'Val')).toEqual([4, 5, 7])
    const v = mv({ s: ['1,5', 'abc'], F: '=value(s)' })
    expect(nums(v, 'F')).toEqual([1.5, null])
    expect(result(v, 'F').invalidRows).toEqual([1])
  })

  it('makes a text variable of a text result, for levels, graphs and analyses', () => {
    const t = mv({
      sample: ['S1', 'S2', 'S1'],
      cond: ['ctrl', 'stim', 'stim'],
      Key: '=concat(sample, "_", cond)',
    })
    const r = resolvedTable(t)
    expect(r).not.toBe(t)
    expect(resolvedTable(t)).toBe(r)
    const key = r.dataSets[2]!
    expect(key.text).toEqual(['S1_ctrl', 'S2_stim', 'S1_stim'])
    expect(key.formula).toBeUndefined()
    expect(levelsInTable(key)).toEqual(['S1_ctrl', 'S2_stim', 'S1_stim'])
    const norm = normalizeTable(t)[2]!
    expect(norm.text).toEqual(['S1_ctrl', 'S2_stim', 'S1_stim'])
    expect(norm.formula).toBe('=concat(sample, "_", cond)')
    // A table without text formulas is itself.
    const plain = mv({ a: [1], F: '=a + 1' })
    expect(resolvedTable(plain)).toBe(plain)
    // Formulas can use a text formula's values.
    const u = mv({ g: ['a', 'b'], R: '=recode(g, "a", "A")', N: '=if(R = "A", 1, 0)' })
    expect(nums(u, 'N')).toEqual([1, 0])
  })
})

describe('cut() labels: C’s %g (audit 2, decision 683)', () => {
  it.each([
    [1.125, 3, '1.12'],
    [-1.125, 3, '-1.12'],
    [0.3125, 3, '0.312'],
    [7.875, 3, '7.88'],
    [2.5, 1, '2'],
    [3.5, 1, '4'],
    [999.5, 3, '1e+03'],
    [1125, 3, '1.12e+03'],
    [2.675, 3, '2.67'],
    [9.995, 3, '9.99'],
    [100, 3, '100'],
    [0.1, 3, '0.1'],
    [0.0001234, 3, '0.000123'],
    [1.234e-5, 3, '1.23e-05'],
    [1234567, 3, '1.23e+06'],
    [123456, 6, '123456'],
    [0.12345, 4, '0.1235'],
    [1e21, 3, '1e+21'],
    [5e-324, 3, '4.94e-324'],
    [1.7976931348623157e308, 3, '1.8e+308'],
    [0, 3, '0'],
  ])('%%.%dg of %d', (x, d, want) => {
    expect(formatG(x, d)).toBe(want)
  })

  it('quantiles of Hyndman & Fan’s types at their definitions', () => {
    const x = [1, 2, 3, 4]
    // Type 1 (inverse of the distribution function) and 2 (averaged at its steps) at p = 0.5.
    expect(quantileOfSorted(x, 0.5, 1)).toBe(2)
    expect(quantileOfSorted(x, 0.5, 2)).toBe(2.5)
    // Type 3: np − ½ = 1.5 → x(2); at 0.375, np − ½ = 1 is odd → x(2), at 0.625 even → x(2).
    expect(quantileOfSorted(x, 0.375, 3)).toBe(2)
    expect(quantileOfSorted(x, 0.625, 3)).toBe(2)
    // Types 4–9 at p = 0.5: np + m = 2, 2.5, 2.5, 2.5, 2.5, 2.5.
    ;[2, 2.5, 2.5, 2.5, 2.5, 2.5].forEach((want, i) => {
      expect(quantileOfSorted(x, 0.5, i + 4)).toBeCloseTo(want, 14)
    })
    expect(quantileOfSorted(x, 0, 6)).toBe(1)
    expect(quantileOfSorted(x, 1, 6)).toBe(4)
    expect(quantileOfSorted(x, 1.1, 7)).toBeNaN()
    expect(quantileOfSorted([], 0.5, 7)).toBeNaN()
  })
})

describe('formula: categories', () => {
  it('recode renames and merges levels, keeping others or setting them blank', () => {
    const t = mv({
      type: ['CD4 T', 'CD8 T', 'B', ' CD4 T ', null, 'NK'],
      Merge: '=recode(type, "CD4 T", "T cells", "CD8 T", "T cells")',
      Blank: '=recode(type, "CD4 T", "T", "B", "B cells", "")',
      Other: '=recode(type, "B", "B cells", "other")',
    })
    expect(texts(t, 'Merge')).toEqual(['T cells', 'T cells', 'B', 'T cells', null, 'NK'])
    expect(texts(t, 'Blank')).toEqual(['T', null, 'B cells', 'T', null, null])
    expect(texts(t, 'Other')).toEqual(['other', 'other', 'B cells', 'other', null, 'other'])
    // Exact levels: "b" isn't the level "B".
    const u = mv({ g: ['B', 'b'], F: '=recode(g, "B", "x")' })
    expect(texts(u, 'F')).toEqual(['x', 'b'])
    // Numbers recoded to text.
    const v = mv({ sex: [1, 2, 3], F: '=recode(sex, 1, "Male", 2, "Female")' })
    expect(texts(v, 'F')).toEqual(['Male', 'Female', '3'])
  })

  it('cut with breaks, closure and labels', () => {
    const t = mv({
      x: [0, 1, 2.5, 5, 7, null, 11],
      Right: '=cut(x, 0, 2.5, 5, 10)',
      Left: '=cut(x, "[)", 0, 2.5, 5, 10)',
      Named: '=cut(x, 0, 2.5, 5, 10, "low", "mid", "high")',
    })
    expect(texts(t, 'Right')).toEqual([
      '[0, 2.5]',
      '[0, 2.5]',
      '[0, 2.5]',
      '(2.5, 5]',
      '(5, 10]',
      null,
      null,
    ])
    expect(result(t, 'Right').invalidRows).toEqual([])
    expect(texts(t, 'Left')).toEqual([
      '[0, 2.5)',
      '[0, 2.5)',
      '[2.5, 5)',
      '[5, 10]',
      '[5, 10]',
      null,
      null,
    ])
    expect(texts(t, 'Named')).toEqual(['low', 'low', 'low', 'mid', 'high', null, null])
    const bad = mv({
      x: [1],
      A: '=cut(x, 1, 1)',
      B: '=cut(x, 0, 1, "a", "b")',
      C: '=cut(x, "x", 0, 1)',
    })
    expect(result(bad, 'A').error).toBe('cut’s breaks are not unique')
    expect(result(bad, 'B').error).toBe('cut has 1 intervals but 2 labels')
    expect(result(bad, 'C').error).toContain('"(]"')
  })
})

describe('formula: running values', () => {
  it('cumsum, lag, lead, diff', () => {
    const t = mv({
      x: [1, 2, null, 4, 8],
      Cum: '=cumsum(x)',
      Lag: '=lag(x)',
      Lag2: '=lag(x, 2)',
      Lead: '=lead(x)',
      Diff: '=diff(x)',
    })
    expect(nums(t, 'Cum')).toEqual([1, 3, null, 7, 15])
    expect(nums(t, 'Lag')).toEqual([null, 1, 2, null, 4])
    expect(nums(t, 'Lag2')).toEqual([null, null, 1, 2, null])
    expect(nums(t, 'Lead')).toEqual([2, null, 4, 8, null])
    expect(nums(t, 'Diff')).toEqual([null, 1, null, null, 4])
    for (const f of ['Lag', 'Lag2', 'Lead', 'Diff']) expect(result(t, f).invalidRows).toEqual([])
  })
})

describe('formula: statistics, blank and excluded values', () => {
  it('leaves out empty and excluded values; groups without a value are blank', () => {
    const t = mv({
      x: [1, 2, 3, 100, null],
      g: ['a', 'a', 'b', 'b', 'b'],
      M: '=median(x)',
      Z: '=zscore(x, g)',
      N: '=countby(x, g)',
    })
    t.dataSets[0]!.subcolumns[0]!.excluded = [false, false, false, true, false]
    expect(nums(t, 'M')).toEqual([2, 2, 2, 2, 2])
    // Group b has one value: no SD, so no z-score (blank, not invalid).
    expect(nums(t, 'Z')[2]).toBeNull()
    expect(result(t, 'Z').invalidRows).toEqual([])
    expect(nums(t, 'N')).toEqual([2, 2, 1, 1, 1])
    const u = mv({
      x: [3, 1, null, 7],
      g: ['a', 'a', 'b', 'b'],
      Lo: '=minby(x, g)',
      Hi: '=maxby(x)',
    })
    expect(nums(u, 'Lo')).toEqual([1, 1, 7, 7])
    expect(nums(u, 'Hi')).toEqual([7, 7, 7, 7])
  })

  it('reads a quantile type and rank ties from their arguments', () => {
    const r = run('rank(x, "min")', cols([3, 1, 3]), 3)
    expect([...r.values]).toEqual([2, 1, 2])
    expect(evaluateFormula('rank(x, "best")', cols([1]), 1).error).toContain('"average"')
    expect([...run('quantile(x, 0.5, 1)', cols([1, 2, 3, 4]), 4).values]).toEqual([2, 2, 2, 2])
    expect(Number.isNaN(run('quantile(x, 0.5, 10)', cols([1, 2]), 2).values[0]!)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// R oracle (suite `formula`)
// ---------------------------------------------------------------------------------------------

type Num = number | number[]
const numbers = (v: unknown): (number | null)[] =>
  (arr(v as Num) as number[]).map((x) => (Number.isNaN(x) ? null : x))

describe('formula: R oracle (suite formula)', () => {
  const fixtures = loadFixtures<Record<string, unknown>, Record<string, unknown>>('formula')

  it('has fixtures of every kind', () => {
    const kinds = new Set(fixtures.map((f) => f.params.kind))
    for (const k of ['quantile', 'rank', 'groups', 'cut', 'cutwidth', 'cutquantile'])
      expect(kinds.has(k)).toBe(true)
  })

  for (const f of fixtures) {
    it(f.name, () => {
      const x = numbers(f.input.x)
      const n = x.length
      const g = f.input.g ? (arr(f.input.g as string[]) as (string | null)[]) : undefined
      const c = cols(
        x,
        g?.map((v) => (v === 'NA' ? null : v)),
      )
      const kind = f.params.kind as string
      if (kind === 'quantile') {
        const p = arr(f.input.p as Num) as number[]
        for (let type = 1; type <= 9; type++) {
          const want = arr(f.expected[`type${type}`] as Num) as number[]
          p.forEach((pk, i) => {
            const got = run(`quantile(x, ${pk}, ${type})`, c, n).values[0]!
            expectClose(got, want[i]!, {}, `type ${type}, p ${pk}`)
          })
        }
      } else if (kind === 'rank') {
        for (const ties of ['average', 'min', 'max', 'first']) {
          const want = arr(f.expected[ties] as Num) as number[]
          const got = run(`rank(x, "${ties}")`, c, n).values
          want.forEach((w, i) => {
            expectClose(got[i]!, w, {}, `${ties} row ${i}`)
          })
        }
        // average is the default.
        expect([...run('rank(x)', c, n).values]).toEqual([
          ...run('rank(x, "average")', c, n).values,
        ])
      } else if (kind === 'groups') {
        const formulas: Record<string, string> = {
          meanby: 'meanby(x, g)',
          medianby: 'medianby(x, g)',
          sumby: 'sumby(x, g)',
          countby: 'countby(x, g)',
          sdby: 'sdby(x, g)',
          varby: 'var(x, g)',
          zscoreby: 'zscore(x, g)',
          mean: 'meanby(x)',
          median: 'median(x)',
          sd: 'sd(x)',
          var: 'var(x)',
          zscore: 'zscore(x)',
        }
        for (const [key, formula] of Object.entries(formulas)) {
          const want = arr(f.expected[key] as Num) as number[]
          const got = run(formula, c, n).values
          want.forEach((w, i) => {
            expectClose(got[i]!, w, {}, `${formula} row ${i}`)
          })
        }
        // The group statistics as their aliases.
        expect([...run('median(x, g)', c, n).values]).toEqual([
          ...run('medianby(x, g)', c, n).values,
        ])
        expect([...run('sd(x, g)', c, n).values]).toEqual([...run('sdby(x, g)', c, n).values])
      } else {
        const right = f.params.right === true
        const closure = right ? '"(]"' : '"[)"'
        const formula =
          kind === 'cut'
            ? `cut(x, ${closure}, ${(arr(f.input.breaks as Num) as number[]).join(', ')})`
            : `${kind}(x, ${closure}, ${f.input.n})`
        const r = run(formula, c, n)
        const labels = arr(f.expected.labels as string | string[]) as string[]
        const codes = arr(f.expected.code as Num) as number[]
        const got = r.text!
        codes.forEach((code, i) => {
          if (Number.isNaN(code)) expect(got[i], `row ${i}`).toBeNull()
          else expect(got[i], `row ${i}`).toBe(labels[code - 1])
        })
        // Every label R gives appears (the intervals are the same).
        const distinct = new Set(got.filter((v) => v !== null))
        for (const l of distinct) expect(labels).toContain(l)
      }
    })
  }
})

// ---------------------------------------------------------------------------------------------
// Growth guards: whole-column statistics are computed once per evaluation (100k vs 1M rows)
// ---------------------------------------------------------------------------------------------

describe('formula: growth at 100k vs 1M rows', () => {
  const columnsOf = (n: number): FormulaColumn[] => {
    const x = new Float64Array(n)
    const g: string[] = new Array(n)
    let s = 1
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647
      x[i] = s / 2147483647
      g[i] = `S${s % 12}`
    }
    return [
      { id: 'x', title: 'x', values: x },
      { id: 'g', title: 'g', text: g },
    ]
  }
  const big = columnsOf(1_000_000)
  const sizes = new Map<number, FormulaColumn[]>()
  const at = (n: number) => {
    let c = sizes.get(n)
    if (!c) {
      c = big.map((col) => ({
        ...col,
        ...(col.values ? { values: (col.values as Float64Array).subarray(0, n) } : {}),
        ...(col.text ? { text: col.text.slice(0, n) } : {}),
      }))
      sizes.set(n, c)
    }
    return c
  }
  for (const formula of [
    'zscore(x, g)',
    'x - medianby(x, g)',
    'rank(x)',
    'quantile(x, 0.9)',
    'cutquantile(x, 4)',
    'cumsum(x) + lag(x)',
    'meanby(x, g) + countby(x, g)',
  ]) {
    it(formula, () => {
      const ratio = growthRatio((n) => evaluateFormula(formula, at(n), n), 100_000, 10, 2)
      // Linear work gives about 10, n log n about 12; quadratic 100.
      expect(ratio).toBeLessThan(25)
    }, 120_000)
  }

  it('a column statistic costs about as much as a row-wise function', () => {
    const c = at(200_000)
    const ratio = cpuRatio(
      () => evaluateFormula('sqrt(x) * 2', c, 200_000),
      () => evaluateFormula('x - meanby(x)', c, 200_000),
      3,
    )
    expect(ratio).toBeLessThan(10)
  }, 120_000)
})
