import { describe, expect, it } from 'vitest'
import {
  createTable,
  type DataTable,
  FormulaError,
  formulaReference,
  normalizeTable,
  numberFromText,
  parseFormula,
  renameInFormula,
  tableFormulas,
  tableIssues,
} from '../src/index.ts'

/** A multiple-variables table: numeric columns from arrays, text from string arrays. */
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

const values = (t: DataTable, title: string) => {
  const ds = t.dataSets.find((d) => d.title === title)!
  const f = tableFormulas(t).get(ds.id)!
  return { ...f, values: [...f.values].map((v) => (Number.isNaN(v) ? null : v)) }
}

describe('formula parser', () => {
  it('parses arithmetic with the usual precedence', () => {
    const t = mv({ A: [2, 3], F: '=1 + 2 * 3 ^ 2 - -A / 2' })
    expect(values(t, 'F').values).toEqual([1 + 2 * 9 + 1, 1 + 2 * 9 + 1.5])
    const u = mv({ A: [2], F: '=-A^2', G: '=2^-1', H: '=2^3^2', I: '=(1+2)*3' })
    expect(values(u, 'F').values).toEqual([-4])
    expect(values(u, 'G').values).toEqual([0.5])
    expect(values(u, 'H').values).toEqual([512])
    expect(values(u, 'I').values).toEqual([9])
  })

  it('reports syntax errors with a position', () => {
    for (const [src, msg] of [
      ['=', 'the formula is empty'],
      ['=1 +', 'the formula is incomplete'],
      ['=(1 + 2', 'missing “)”'],
      ['=foo(1)', 'unknown function “foo”'],
      ['=round()', 'round takes 1 or 2 values'],
      ['=1 # 2', 'unexpected “#”'],
      ['=[Weight', 'a [name] is missing its closing ]'],
      ['="abc', 'text is missing its closing quote'],
      ['=1 2', 'unexpected “2”'],
    ] as const) {
      expect(() => parseFormula(src), src).toThrow(msg)
    }
    try {
      parseFormula('=A + * 2')
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError)
      expect((e as FormulaError).at).toBe(5)
    }
  })

  it('names variables bare, in brackets, or with underscores for spaces, without case', () => {
    const t = mv({
      'Body weight (kg)': [80, 60],
      Height: [2, 1.5],
      BMI: '=[body weight (KG)] / height^2',
    })
    expect(values(t, 'BMI').values).toEqual([20, 60 / 2.25])
    const u = mv({ 'Body weight': [80], Twice: '=Body_weight * 2' })
    expect(values(u, 'Twice').values).toEqual([160])
    expect(formulaReference('Height')).toBe('Height')
    expect(formulaReference('Body weight')).toBe('[Body weight]')
    expect(formulaReference('log')).toBe('[log]')
  })
})

describe('formula evaluation', () => {
  it('has functions, IF with comparisons, and constants', () => {
    const t = mv({
      X: [1, 4, -1, 2.5],
      Y: [10, 20, 30, 40],
      Ln: '=ln(X)',
      Log: '=log(Y)',
      Sq: '=sqrt(X)',
      Mx: '=max(X, 2, Y/10)',
      Mean: '=mean(X, Y)',
      R: '=round(X * 1.234, 1)',
      Rh: '=round(X)',
      If: '=IF(X > 1, Y, -Y)',
      And: '=and(X >= 1, Y <> 20)',
      Not: '=not(X = 4)',
      TwoPi: '=pi * 2',
      Abs: '=abs(X) + sign(X) + floor(X) + ceil(X) + int(X)',
    })
    expect(values(t, 'Ln').values).toEqual([0, Math.log(4), null, Math.log(2.5)])
    // ln(-1) has inputs but no value: an invalid cell, not a missing one.
    expect(values(t, 'Ln').invalidRows).toEqual([2])
    expect(values(t, 'Log').values).toEqual([1, Math.log10(20), Math.log10(30), Math.log10(40)])
    expect(values(t, 'Sq').invalidRows).toEqual([2])
    expect(values(t, 'Mx').values).toEqual([2, 4, 3, 4])
    expect(values(t, 'Mean').values).toEqual([5.5, 12, 14.5, 21.25])
    expect(values(t, 'R').values).toEqual([1.2, 4.9, -1.2, 3.1])
    expect(values(t, 'Rh').values).toEqual([1, 4, -1, 3])
    expect(values(t, 'If').values).toEqual([-10, 20, -30, 40])
    expect(values(t, 'And').values).toEqual([1, 0, 0, 1])
    expect(values(t, 'Not').values).toEqual([1, 0, 1, 1])
    expect(values(t, 'TwoPi').values).toEqual([2 * Math.PI, 2 * Math.PI, 2 * Math.PI, 2 * Math.PI])
    expect(values(t, 'Abs').values).toEqual([5, 17, -3, 10.5])
  })

  it('leaves rows with a missing or excluded input empty (not invalid); IF evaluates one branch', () => {
    const t = mv({ A: [1, null, 3, 0], B: '=A * 2', C: '=IF(A > 0, ln(A), 0)', D: '=isblank(A)' })
    t.dataSets[0]!.subcolumns[0]!.excluded = [false, false, true, false]
    expect(values(t, 'B').values).toEqual([2, null, null, 0])
    expect(values(t, 'B').invalidRows).toEqual([])
    expect(values(t, 'C').values).toEqual([0, null, null, 0])
    expect(values(t, 'D').values).toEqual([0, 1, 1, 0])
    expect(values(mv({ A: [0, 1], R: '=1/A' }), 'R').invalidRows).toEqual([0])
  })

  it('compares text variables with text, ignoring case', () => {
    const t = mv({
      Group: ['WT', 'KO', 'wt', null],
      Dose: [1, 2, 3, 4],
      IsWT: '=Group = "WT"',
      Scaled: '=IF(Group <> "ko", Dose * 10, Dose)',
      Blank: '=isblank(Group)',
    })
    expect(values(t, 'IsWT').values).toEqual([1, 0, 1, null])
    expect(values(t, 'Scaled').values).toEqual([10, 2, 30, null])
    expect(values(t, 'Blank').values).toEqual([0, 0, 0, 1])
  })

  it('reports type errors, unknown and ambiguous names as column errors', () => {
    const t = mv({
      Group: ['WT', 'KO'],
      A: [1, 2],
      Plus: '=Group + 1',
      Less: '=Group < "X"',
      Mixed: '=Group = 1',
      Text: '="a"',
      Unknown: '=Weight * 2',
    })
    expect(values(t, 'Plus').error).toBe('“+” needs a number, not text')
    expect(values(t, 'Less').error).toBe('text is compared with = or <> only')
    expect(values(t, 'Mixed').error).toBe('“=” compares text with text, or numbers with numbers')
    // Roadmap 38: a text result makes a text variable.
    expect(values(t, 'Text').error).toBeNull()
    expect(values(t, 'Text').text).toEqual(['a', 'a'])
    expect(values(t, 'Unknown').error).toBe('no variable is called “Weight”')
    expect(values(t, 'Unknown').values).toEqual([null, null])
    const dup = mv({ A: [1], a: [2], F: '=A' })
    expect(values(dup, 'F').error).toBe('2 variables are called “A”')
  })

  it('chains calculated variables and detects circular references', () => {
    const t = mv({ A: [1, 2], B: '=A + 1', C: '=B * 10' })
    expect(values(t, 'C').values).toEqual([20, 30])
    const cyc = mv({ A: [1], B: '=C + 1', C: '=B + 1', D: '=C', E: '=E' })
    expect(values(cyc, 'B').error).toBe('circular reference: “B” → “C” → “B”')
    expect(values(cyc, 'C').error).toMatch(/^circular reference/)
    expect(values(cyc, 'D').error).toMatch(/^circular reference/)
    expect(values(cyc, 'E').error).toBe('circular reference: “E” → “E”')
    const bad = mv({ A: [1], B: '=nope', C: '=B + 1' })
    expect(values(bad, 'C').error).toBe('uses “B”, which has an error')
  })

  it('normalizes a calculated variable to its values, stable while its inputs are unchanged', () => {
    const t = mv({ A: [1, 2, null], B: [5, 5, 5], F: '=A * 2' })
    const [, , f] = normalizeTable(t)
    expect(f!.formula).toBe('=A * 2')
    expect(f!.data.shape === 'replicates' && [...f!.data.reps[0]!]).toEqual([2, 4, Number.NaN])
    expect(f!.counts.empty).toBe(1)
    // Editing B (a new dataSets array and B object) keeps F's view: it doesn't use B.
    const edited: DataTable = {
      ...t,
      dataSets: t.dataSets.map((d, i) =>
        i === 1 ? { ...d, subcolumns: [{ type: 'number', values: [6, 6, 6] }] } : d,
      ),
    }
    expect(normalizeTable(edited)[2]).toBe(f)
    // Editing A recomputes it.
    const editedA: DataTable = {
      ...t,
      dataSets: t.dataSets.map((d, i) =>
        i === 0 ? { ...d, subcolumns: [{ type: 'number', values: [3, 2, 1] }] } : d,
      ),
    }
    const g = normalizeTable(editedA)[2]!
    expect(g).not.toBe(f)
    expect(g.data.shape === 'replicates' && [...g.data.reps[0]!]).toEqual([6, 4, 2])
  })

  it('counts empty text cells as empty in the normalized view', () => {
    const t = mv({ G: ['a', null, ' '] })
    expect(normalizeTable(t)[0]!.counts.empty).toBe(2)
  })
})

describe('renaming and text conversion', () => {
  it('renames references and keeps the rest of the formula', () => {
    expect(renameInFormula('=Weight / [height]^2 + weight', 'Weight', 'Mass (kg)')).toBe(
      '=[Mass (kg)] / [height]^2 + [Mass (kg)]',
    )
    expect(renameInFormula('=Body_weight*2', 'Body weight', 'BW')).toBe('=BW*2')
    expect(renameInFormula('=A + 1', 'B', 'C')).toBeNull()
    expect(renameInFormula('=A +', 'A', 'C')).toBeNull()
  })

  it('reads numbers written as text', () => {
    expect(numberFromText(' 1.5 ')).toBe(1.5)
    expect(numberFromText('-2e3')).toBe(-2000)
    expect(numberFromText('1,5')).toBe(1.5)
    expect(numberFromText('WT')).toBeNull()
    expect(numberFromText('1.2.3')).toBeNull()
    expect(numberFromText('')).toBeNull()
  })
})
