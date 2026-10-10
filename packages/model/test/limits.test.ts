import { describe, expect, it } from 'vitest'
import {
  type CellColumn,
  countLimitFlags,
  DataTable,
  DEFAULT_LIMIT_RULE,
  describeLimitRule,
  type LimitRule,
  parseLimitText,
  resubstitute,
  substituteLimit,
} from '../src/index.ts'

describe('limit text (roadmap 39)', () => {
  it.each([
    ['<0.5', 'below', 0.5],
    ['< 0.5', 'below', 0.5],
    ['< 0.5', 'below', 0.5],
    ['≤0.5', 'below', 0.5],
    ['<=0.5', 'below', 0.5],
    ['⩽ 2', 'below', 2],
    ['<0,5', 'below', 0.5],
    ['<.25', 'below', 0.25],
    ['<1e-3', 'below', 0.001],
    ['<0.5 ng/mL', 'below', 0.5],
    ['< 0.5ng/ml', 'below', 0.5],
    ['<5%', 'below', 5],
    ['< 10 pg ml-1', 'below', 10],
    ['<20 µg/L', 'below', 20],
    ['>1000', 'above', 1000],
    ['> 1,000', 'above', 1000],
    ['≥ 250', 'above', 250],
    ['>=3.5', 'above', 3.5],
    ['below 0.2', 'below', 0.2],
    ['less than 0.2', 'below', 0.2],
    ['above 40', 'above', 40],
    ['greater than 40', 'above', 40],
    ['&lt;0.5', 'below', 0.5],
  ] as const)('%s → %s %s', (text, side, limit) => {
    expect(parseLimitText(text)).toEqual({ side, limit })
  })

  it.each([
    ['<LOD', 'below'],
    ['< LOD', 'below'],
    ['<LLOQ', 'below'],
    ['<LOQ', 'below'],
    ['BLQ', 'below'],
    ['blq', 'below'],
    ['BLOQ', 'below'],
    ['BQL', 'below'],
    ['BDL', 'below'],
    ['below LOD', 'below'],
    ['Below LOD', 'below'],
    ['below detection limit', 'below'],
    ['below the limit of detection', 'below'],
    ['LLOQ-', 'below'],
    ['LOD', 'below'],
    ['>LOD', 'above'],
    ['>ULOQ', 'above'],
    ['> ULOQ', 'above'],
    ['ULOQ+', 'above'],
    ['ULOQ +', 'above'],
    ['ULOQ', 'above'],
    ['ALQ', 'above'],
    ['above ULOQ', 'above'],
    ['above the range', 'above'],
    ['above the standard curve', 'above'],
  ] as const)('%s → %s without a number', (text, side) => {
    expect(parseLimitText(text)).toEqual({ side, limit: null })
  })

  it.each([
    '0.5',
    'ND',
    'n.d.',
    'not done',
    'NA',
    '',
    'WT',
    '<0.5 and 3',
    '<',
    '< 1 2',
    'LOD 5',
    'x<5',
    '5<',
    'Lodge',
    'over',
  ])('%s is not a limit', (text) => {
    expect(parseLimitText(text)).toBeNull()
  })
})

describe('substitution (roadmap 39)', () => {
  const below = { side: 'below', limit: 0.5 } as const
  const above = { side: 'above', limit: 100 } as const
  const rule = (b: LimitRule['below'], a: LimitRule['above'] = { method: 'limit' }): LimitRule => ({
    below: b,
    above: a,
  })

  it('substitutes below a limit by LOD/2, LOD, LOD/√2, blank or a fixed value', () => {
    expect(substituteLimit(below, DEFAULT_LIMIT_RULE)).toBe(0.25)
    expect(substituteLimit(below, rule({ method: 'limit' }))).toBe(0.5)
    expect(substituteLimit(below, rule({ method: 'sqrt2' }))).toBeCloseTo(0.5 / Math.SQRT2, 15)
    expect(substituteLimit(below, rule({ method: 'blank' }))).toBeNull()
    expect(substituteLimit(below, rule({ method: 'fixed', value: 0.01 }))).toBe(0.01)
  })

  it('substitutes above a limit by the limit, blank or a fixed value', () => {
    expect(substituteLimit(above, DEFAULT_LIMIT_RULE)).toBe(100)
    expect(substituteLimit(above, rule({ method: 'half' }, { method: 'blank' }))).toBeNull()
    expect(substituteLimit(above, rule({ method: 'half' }, { method: 'fixed', value: 999 }))).toBe(
      999,
    )
  })

  it('takes typed limits for words, per data set before the one for all', () => {
    const word = { side: 'below', limit: null } as const
    const typed: LimitRule = {
      ...DEFAULT_LIMIT_RULE,
      lower: { all: 2, columns: { a: 10 } },
      upper: { all: 50 },
    }
    expect(substituteLimit(word, DEFAULT_LIMIT_RULE)).toBeNull()
    expect(substituteLimit(word, typed, 'a')).toBe(5)
    expect(substituteLimit(word, typed, 'b')).toBe(1)
    expect(substituteLimit({ side: 'above', limit: null }, typed, 'a')).toBe(50)
    // A number in the cell wins over typed limits.
    expect(substituteLimit(below, typed, 'a')).toBe(0.25)
  })

  it('re-substitutes flagged cells from their original text, leaving others alone', () => {
    const col: CellColumn = {
      type: 'number',
      values: [1, 0.25, null, 7],
      limit: [null, { side: 'below', text: '<0.5' }, { side: 'below', text: 'BLQ' }, null],
    }
    const again = resubstitute(col, {
      below: { method: 'limit' },
      above: { method: 'limit' },
      lower: { all: 0.1 },
    })
    expect(again.values).toEqual([1, 0.5, 0.1, 7])
    expect(again.limit).toBe(col.limit)
    expect(resubstitute(col, DEFAULT_LIMIT_RULE)).toBe(col)
  })

  it('describes a rule', () => {
    expect(describeLimitRule(DEFAULT_LIMIT_RULE)).toBe('below a limit: LOD/2; above: the limit')
  })

  it('validates flags beside the values and counts them', () => {
    const table = {
      kind: 'table',
      id: 't1',
      name: 'T',
      tableKind: 'column',
      yFormat: { type: 'replicates', count: 1 },
      rowCount: 2,
      rowTitles: null,
      x: null,
      dataSets: [
        {
          id: 'ca',
          title: 'A',
          subcolumns: [
            {
              type: 'number',
              values: [0.25, 3],
              limit: [{ side: 'below', text: '<0.5' }, null],
            },
          ],
        },
      ],
      notes: '',
      limits: DEFAULT_LIMIT_RULE,
    }
    const ok = DataTable.safeParse(table)
    expect(ok.success).toBe(true)
    expect(countLimitFlags(ok.data!)).toEqual({ below: 1, above: 0 })
    const short = structuredClone(table)
    short.dataSets[0]!.subcolumns[0]!.limit = [null]
    expect(DataTable.safeParse(short).success).toBe(false)
    const bad = structuredClone(table)
    ;(bad.dataSets[0]!.subcolumns[0]!.limit as unknown[])[0] = { side: 'left', text: '' }
    expect(DataTable.safeParse(bad).success).toBe(false)
  })
})
