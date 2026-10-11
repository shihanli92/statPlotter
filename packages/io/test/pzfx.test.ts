import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataTable, type SubcolumnRole, subcolumnRoles } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { parsePzfxNumber } from '../src/import/pzfx.ts'
import { ImportError, importFile, readPzfx } from '../src/index.ts'

const DIR = join(import.meta.dirname, 'fixtures', 'pzfx')

type FixtureValue = number | string | null
interface Fixture {
  file: string
  tables: {
    title: string
    columns: { name: string; values: FixtureValue[]; excluded: boolean[] }[]
  }[]
}

// read_pzfx's column-name suffix for each of our subcolumn roles (SEM is _SEM or _SE).
const SUFFIXES: Record<Exclude<SubcolumnRole, 'value'>, string[]> = {
  mean: ['_MEAN'],
  sd: ['_SD'],
  sem: ['_SEM', '_SE'],
  cv: ['_CV'],
  n: ['_N'],
  plusErr: ['_PLUSERROR'],
  minusErr: ['_MINUSERROR'],
  upper: ['_UPPERLIMIT'],
  lower: ['_LOWERLIMIT'],
}

interface OurColumn {
  values: FixtureValue[]
  excluded: boolean[]
  /** Multiply our value by this to get the file's (CV: fraction → percent). */
  scale: number
}

/** Lays out one of our tables the way read_pzfx names and orders columns. */
function layout(t: DataTable): Map<string, OurColumn> {
  const out = new Map<string, OurColumn>()
  const add = (
    names: string | string[],
    c: { values: FixtureValue[]; excluded?: boolean[] },
    scale = 1,
  ) => {
    const col = { values: c.values, excluded: c.excluded ?? c.values.map(() => false), scale }
    for (const name of [names].flat()) out.set(name, col)
  }
  if (t.rowTitles) add('ROWTITLE', { values: t.rowTitles })
  if (t.x) {
    const [x, err] = t.x.subcolumns
    if (err) {
      add(`${t.x.title}_X`, x!)
      add(`${t.x.title}_ERROR`, err)
    } else add(t.x.title, x!)
  }
  const roles = subcolumnRoles(t.yFormat)
  for (const ds of t.dataSets) {
    if (ds.subcolumns.length === 1) {
      add(ds.title, ds.subcolumns[0]!)
      continue
    }
    ds.subcolumns.forEach((c, k) => {
      const role = roles[k]!
      if (role === 'value') add(`${ds.title}_${k + 1}`, c)
      else
        add(
          SUFFIXES[role].map((s) => `${ds.title}${s}`),
          c,
          role === 'cv' ? 100 : 1,
        )
    })
  }
  return out
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.pzfx'))
  .sort()

describe('pzfx vs read_pzfx fixtures', () => {
  it('has fixtures for every example file', () => {
    expect(files.length).toBeGreaterThanOrEqual(24)
    for (const f of files) expect(readdirSync(DIR)).toContain(f.replace('.pzfx', '.expected.json'))
  })

  for (const file of files) {
    it(file, () => {
      const fixture: Fixture = JSON.parse(
        readFileSync(join(DIR, file.replace('.pzfx', '.expected.json')), 'utf8'),
      )
      const { tables, warnings } = readPzfx(readFileSync(join(DIR, file), 'utf8'))

      for (const t of tables) expect(DataTable.safeParse(t).success).toBe(true)

      for (const ft of fixture.tables) {
        const ours = tables.find((t) => t.name === ft.title)
        if (!ours) {
          // Skipped on purpose: unsupported kinds and tables without data columns.
          expect(
            warnings.some((w) => w.startsWith(`"${ft.title}"`) && /skipped/.test(w)),
            `${ft.title} should be imported or skipped with a warning`,
          ).toBe(true)
          expect(file).toMatch(/parts_of_whole|^empty|synthetic/)
          continue
        }
        const cols = layout(ours)
        const matched = new Set<OurColumn>()
        for (const fc of ft.columns) {
          const name = fc.name.trim()
          const col = cols.get(name)
          expect(col, `${ft.title}: column ${name}`).toBeDefined()
          matched.add(col!)
          expect(col!.values.length, `${name} length`).toBe(fc.values.length)
          fc.values.forEach((v, r) => {
            const got = col!.values[r] ?? null
            const at = `${ft.title} ${name}[${r}]`
            if (name === 'ROWTITLE') expect(got, at).toBe(v)
            else if (v === null) expect(got, at).toBeNull()
            else {
              // read_pzfx keeps a whole column as text when any cell isn't a number.
              const want = typeof v === 'string' ? parsePzfxNumber(v) : v
              if (want === null) expect(got, at).toBeNull()
              else if (col!.scale === 1) expect(got, at).toBe(want)
              else expect(((got as number) * col!.scale) / want, at).toBeCloseTo(1, 12)
            }
            const excluded = fc.excluded[r]! && v !== null
            expect(col!.excluded[r], `${at} excluded`).toBe(excluded)
          })
        }
        // Anything read_pzfx doesn't show must be empty (e.g. N for Mean/CV data) — except
        // row titles we fill from the dates of a date X column.
        for (const [name, col] of cols) {
          if (matched.has(col)) continue
          if (name === 'ROWTITLE' && warnings.some((w) => /dates/.test(w))) continue
          expect(
            col.values.every((v) => v === null),
            `${ft.title}: extra column ${name}`,
          ).toBe(true)
        }
      }
    })
  }
})

const read = (file: string) => readPzfx(readFileSync(join(DIR, file), 'utf8'))

describe('pzfx mapping', () => {
  it('maps table kinds, Y formats, and X formats', () => {
    const kinds = (f: string) => read(f).tables.map((t) => [t.tableKind, t.yFormat, t.x?.xFormat])
    expect(kinds('column.pzfx')).toEqual([['column', { type: 'replicates', count: 1 }, undefined]])
    expect(kinds('x_y_rep.pzfx')).toEqual([['xy', { type: 'replicates', count: 2 }, 'numbers']])
    expect(kinds('x_error_y_sdn.pzfx')).toEqual([
      ['xy', { type: 'summary', preset: 'meanSdN' }, 'numbersWithError'],
    ])
    expect(kinds('survival.pzfx')).toEqual([
      ['survival', { type: 'replicates', count: 1 }, 'numbers'],
    ])
    expect(kinds('contingency.pzfx')[0]![0]).toBe('contingency')
    const presets: Record<string, string> = {
      column_sd: 'meanSd',
      column_se: 'meanSem',
      column_sdn: 'meanSdN',
      column_sen: 'meanSemN',
      column_cv: 'meanCvN',
      column_cvn: 'meanCvN',
      'column_low-high': 'meanPlusMinus',
      'column_upper-lower-limits': 'meanUpperLower',
    }
    for (const [f, preset] of Object.entries(presets)) {
      expect(kinds(`${f}.pzfx`), f).toEqual([['grouped', { type: 'summary', preset }, undefined]])
    }
    expect(read('column_hugetable.pzfx').tables[0]!.yFormat).toEqual({
      type: 'replicates',
      count: 53,
    })
  })

  it('converts CV from percent to a fraction and warns when N is missing', () => {
    const cvn = read('column_cvn.pzfx').tables[0]!
    expect(cvn.dataSets[0]!.subcolumns[1]!.values).toEqual([0.1, 0.2, 0.3])
    const cv = read('column_cv.pzfx')
    expect(cv.tables[0]!.dataSets[0]!.subcolumns[2]!.values).toEqual([null, null, null])
    expect(cv.warnings).toContain('"Data 1": Mean/CV data imported as Mean/CV/N with N empty.')
  })

  it('keeps excluded values with an exclusion mask', () => {
    const t = read('x_y_with_strike.pzfx').tables[0]!
    expect(t.dataSets[0]!.subcolumns[0]).toEqual({
      type: 'number',
      values: [100, 90, 80],
      excluded: [false, true, false],
    })
    expect(t.dataSets[2]!.subcolumns[0]!.excluded).toBeUndefined()
    expect(t.rowTitles).toEqual(['A', 'B', 'C'])
    expect(t.x!.title).toBe('XX')
  })

  it('imports date X as the file’s numbers and keeps the dates as row titles', () => {
    const { tables, warnings } = read('x_date.pzfx')
    expect(tables[0]!.x!.subcolumns[0]!.values.slice(0, 2)).toEqual([0, 5.22929500342231])
    expect(tables[0]!.rowTitles!.slice(0, 2)).toEqual(['16-Jan-2004', '9-Apr-2009'])
    expect(warnings.some((w) => /X dates imported/.test(w))).toBe(true)
  })

  it('reads decimal commas, unequal column lengths, and empty tables', () => {
    expect(read('comma_decimal.pzfx').tables[0]!.dataSets[0]!.subcolumns[0]!.values).toEqual([3.5])
    const t = read('column_unequal_lengths.pzfx').tables[0]!
    expect(t.rowCount).toBe(3)
    expect(t.rowTitles).toBeNull()
    expect(t.dataSets[0]!.subcolumns[0]!.values).toEqual([1, 2, null])
    const empty = read('empty.pzfx')
    expect(empty.tables).toEqual([])
    expect(empty.warnings[0]).toMatch(/"Data 1": the table has no data columns; table skipped/)
  })

  it('reports what was not imported', () => {
    const { warnings } = read('parts_of_whole.pzfx')
    expect(warnings).toEqual([
      '"Data 2": parts of whole tables are not supported yet; table skipped.',
      '1 info sheet not imported.',
      'Analyses, graphs and layouts in the file were not imported.',
    ])
  })

  it('reads the synthetic multi-table file', () => {
    const { tables, warnings } = read('synthetic_multi.pzfx')
    expect(tables.map((t) => [t.name, t.tableKind])).toEqual([
      ['Column & exclusions', 'column'],
      ['Grouped SDN', 'grouped'],
      ['XY SEN', 'xy'],
      ['Grouped CVN', 'grouped'],
      ['Column SDN', 'column'],
      ['Counts', 'contingency'],
      ['Nested', 'nested'],
      ['Text cell', 'column'],
    ])
    expect(warnings).toEqual([
      '"Text cell": 1 non-numeric cell imported as empty (first: "abc").',
      '1 info sheet not imported.',
    ])
    const [col, grouped, xy, cvn, colSdn, counts] = tables
    expect(col!.dataSets.map((d) => d.title)).toEqual(['Bold A', 'B'])
    expect(col!.dataSets[1]!.subcolumns[0]!.values).toEqual([4, null, 6, -0.7])
    expect(grouped!.notes).toBe('First line\nSecond line')
    expect(grouped!.rowTitles).toEqual(['Day 1', 'Day 2'])
    expect(grouped!.dataSets[0]!.subcolumns[1]!.excluded).toEqual([false, true])
    expect(xy!.x!.subcolumns[0]!.excluded).toEqual([false, false, true])
    expect(xy!.yFormat).toEqual({ type: 'summary', preset: 'meanSemN' })
    expect(cvn!.dataSets[0]!.subcolumns[1]!.values).toEqual([0.1, 0.025])
    expect(colSdn!.rowCount).toBe(1)
    expect(colSdn!.yFormat).toEqual({ type: 'summary', preset: 'meanSdN' })
    expect(counts!.rowTitles).toEqual(['Exposed', 'Unexposed'])
  })
})

const pzfx = (tables: string) =>
  `<?xml version="1.0"?><GraphPadPrismFile PrismXMLVersion="5.00">${tables}</GraphPadPrismFile>`

describe('pzfx formatted titles (roadmap 28)', () => {
  it('keeps the formatting of data set, X, row and subject titles beside the plain text', () => {
    const { tables, warnings } = readPzfx(
      pzfx(`<Table TableType="XY" XFormat="numbers" YFormat="replicates" Replicates="1">
        <Title>T</Title>
        <RowTitlesColumn><Subcolumn><d>WT</d><d><TextAlign align="Left"><I>KO</I></TextAlign></d>
          <d>Het<sup>+/−</sup></d></Subcolumn></RowTitlesColumn>
        <XColumn><Title><TextAlign align="Center">Time (<U>h</U>)</TextAlign></Title>
          <Subcolumn><d>1</d><d>2</d><d>3</d></Subcolumn></XColumn>
        <YColumn><Title>IC<Sub>50</Sub>  of <B><I>drug</I></B><BR/>A</Title>
          <Subcolumn><d>1</d></Subcolumn></YColumn>
        <YColumn><Title><Font Face="Symbol">m</Font>M <Font Face="Arial"><B>B</B></Font></Title>
          <Subcolumn><d>2</d></Subcolumn></YColumn>
        <YColumn><Title><B> </B>Plain<Superscript></Superscript></Title>
          <Subcolumn><d>3</d></Subcolumn></YColumn></Table>`),
    )
    expect(warnings).toEqual([])
    const t = tables[0]!
    expect(DataTable.safeParse(t).success).toBe(true)
    const [a, b, c] = t.dataSets
    expect(a!.title).toBe('IC50 of drug A')
    expect(a!.titleRich).toEqual([
      { text: 'IC' },
      { text: '50', sub: true },
      { text: ' of ' },
      { text: 'drug', bold: true, italic: true },
      { text: ' A' },
    ])
    // Symbol-font Greek becomes Greek, in the plain title too.
    expect(b!.title).toBe('μM B')
    expect(b!.titleRich).toEqual([{ text: 'μM ' }, { text: 'B', bold: true }])
    expect(c!.title).toBe('Plain')
    expect(c!.titleRich).toBeUndefined()
    expect(t.x).toMatchObject({
      title: 'Time (h)',
      titleRich: [{ text: 'Time (' }, { text: 'h', underline: true }, { text: ')' }],
    })
    expect(t.rowTitles).toEqual(['WT', 'KO', 'Het+/−'])
    expect(t.rowTitlesRich).toEqual([
      null,
      [{ text: 'KO', italic: true }],
      [{ text: 'Het' }, { text: '+/−', sup: true }],
    ])
  })

  it('formats nested subjects and leaves plain files plain', () => {
    const { tables } = readPzfx(
      pzfx(`<Table TableType="Nested" YFormat="replicates" Replicates="2"><Title>N</Title>
        <YColumn Subcolumns="2"><Title>Control</Title>
          <SubColumnTitles><Subcolumn><d>Mouse <Sub>1</Sub></d><d>Mouse 2</d></Subcolumn></SubColumnTitles>
          <Subcolumn><d>1</d></Subcolumn><Subcolumn><d>3</d></Subcolumn>
        </YColumn></Table>`),
    )
    const ds = tables[0]!.dataSets[0]!
    expect(ds.subcolumnTitles).toEqual(['Mouse 1', 'Mouse 2'])
    expect(ds.subcolumnTitlesRich).toEqual([[{ text: 'Mouse ' }, { text: '1', sub: true }], null])
    for (const f of readdirSync(DIR).filter(
      (f) => f.endsWith('.pzfx') && f !== 'synthetic_multi.pzfx',
    )) {
      for (const table of readPzfx(readFileSync(join(DIR, f), 'utf8')).tables) {
        expect(table.rowTitlesRich, f).toBeUndefined()
        expect(table.x?.titleRich, f).toBeUndefined()
        expect(
          table.dataSets.filter((d) => d.titleRich),
          f,
        ).toEqual([])
      }
    }
  })
})

describe('pzfx edge cases', () => {
  it('reads nested tables with their subjects’ titles', () => {
    const { tables, warnings } = readPzfx(
      pzfx(`<Table TableType="Nested" YFormat="replicates" Replicates="3"><Title>N</Title>
        <YColumn Subcolumns="3"><Title>Control</Title>
          <SubColumnTitles OwnSet="1"><Subcolumn><d>Mouse 1</d><d>Mouse 2</d><d/></Subcolumn></SubColumnTitles>
          <Subcolumn><d>1</d><d>2</d></Subcolumn><Subcolumn><d>3</d></Subcolumn><Subcolumn/>
        </YColumn>
        <YColumn Subcolumns="3"><Title>Treated</Title>
          <Subcolumn><d>5</d></Subcolumn><Subcolumn/><Subcolumn><d>6</d></Subcolumn>
        </YColumn></Table>`),
    )
    expect(warnings).toEqual([])
    const t = tables[0]!
    expect(t.tableKind).toBe('nested')
    expect(t.yFormat).toEqual({ type: 'replicates', count: 3 })
    expect(t.dataSets[0]!.subcolumnTitles).toEqual(['Mouse 1', 'Mouse 2', null])
    expect(t.dataSets[1]!.subcolumnTitles).toBeUndefined()
    expect(t.dataSets[1]!.subcolumns.map((c) => c.values)).toEqual([
      [5, null],
      [null, null],
      [6, null],
    ])
  })

  it('turns a column table with several rows of summary data into a grouped table', () => {
    const { tables, warnings } = readPzfx(
      pzfx(`<Table TableType="OneWay" YFormat="SEN"><Title>T</Title>
        <YColumn><Title>A</Title>
          <Subcolumn><d>1</d><d>2</d></Subcolumn><Subcolumn><d>0.1</d></Subcolumn>
        </YColumn></Table>`),
    )
    expect(tables[0]!.tableKind).toBe('grouped')
    expect(tables[0]!.dataSets[0]!.subcolumns.map((c) => c.values)).toEqual([
      [1, 2],
      [0.1, null],
      [null, null],
    ])
    expect(warnings).toEqual([
      '"T": column table with several rows of summary data imported as a grouped table.',
    ])
  })

  it('skips unsupported Y formats and survival tables with replicates', () => {
    const { tables, warnings } = readPzfx(
      pzfx(`<Table TableType="TwoWay" YFormat="SDNSomething"><Title>A</Title>
          <YColumn><Subcolumn><d>1</d></Subcolumn></YColumn></Table>
        <Table TableType="Survival" XFormat="numbers" Replicates="2"><Title>B</Title>
          <XColumn><Subcolumn><d>1</d></Subcolumn></XColumn>
          <YColumn><Subcolumn><d>1</d></Subcolumn><Subcolumn><d>0</d></Subcolumn></YColumn></Table>`),
    )
    expect(tables).toEqual([])
    expect(warnings).toEqual([
      '"A": unsupported Y format "SDNSomething"; table skipped.',
      '"B": Y format "replicates" is not supported for survival tables; table skipped.',
    ])
  })

  it('ignores attribute values that name Object.prototype members', () => {
    const { tables, warnings } = readPzfx(
      pzfx(`<Table TableType="constructor"><Title>A</Title></Table>
        <Table TableType="TwoWay" YFormat="toString"><Title>B</Title>
          <YColumn><Subcolumn><d>1</d></Subcolumn></YColumn></Table>`),
    )
    expect(tables).toEqual([])
    expect(warnings).toEqual([
      '"A": unknown table type "constructor"; table skipped.',
      '"B": unsupported Y format "toString"; table skipped.',
    ])
  })

  it('fills in a missing X column and reads HugeTable elements', () => {
    const { tables, warnings } = readPzfx(
      pzfx(`<HugeTable TableType="XY" XFormat="none"><Title>H</Title>
        <YColumn><Title>Y</Title><Subcolumn><d>1</d><d>2</d></Subcolumn></YColumn></HugeTable>`),
    )
    expect(tables[0]!.x).toEqual({
      title: 'X',
      xFormat: 'numbers',
      subcolumns: [{ type: 'number', values: [null, null] }],
    })
    expect(warnings).toEqual([
      '"H": X format "none" imported as plain numbers.',
      '"H": the table has no X column; X values are empty.',
    ])
  })

  it('rejects files that are not .pzfx XML', () => {
    expect(() => readPzfx('<html></html>')).toThrow(ImportError)
    expect(() => readPzfx('<GraphPadPrismFile><Table>')).toThrow(/Malformed XML/)
  })

  it('parses .pzfx number formats', () => {
    expect(parsePzfxNumber('1.')).toBe(1)
    expect(parsePzfxNumber('3,25')).toBe(3.25)
    expect(parsePzfxNumber('-1,5E-3')).toBe(-0.0015)
    expect(parsePzfxNumber('.5')).toBe(0.5)
    for (const bad of ['abc', '1,2,3', '1.2.3', '', 'NaN', '1e999']) {
      expect(parsePzfxNumber(bad), bad).toBeNull()
    }
  })

  it('is reachable through importFile', () => {
    const bytes = readFileSync(join(DIR, 'contingency.pzfx'))
    const out = importFile('study.PZFX', new Uint8Array(bytes))
    expect(out.kind).toBe('tables')
    if (out.kind === 'tables') expect(out.tables[0]!.tableKind).toBe('contingency')
  })
})
