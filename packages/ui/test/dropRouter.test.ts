import { describe, expect, it } from 'vitest'
import {
  dropHints,
  dropKindOf,
  dropSteps,
  dropSummary,
  kindsOfTypes,
} from '../src/drop/dropRouter.ts'
import { carriesFiles, readFiles, transferFiles } from '../src/drop/transfer.ts'
import { cellRulesOf, initialCellRules, limitCells } from '../src/import/CellRulesFields.tsx'
import { describeGraphs } from '../src/import/PzfxImportDialog.tsx'

// Roadmap 39: files dropped on the window, routed by type; the import dialog's cell rules.

describe('dropped files by type (roadmap 39)', () => {
  it.each([
    ['study.psproj', 'project'],
    ['Study.PSPROJ', 'project'],
    ['growth.csv', 'data'],
    ['plate.tsv', 'data'],
    ['reads.txt', 'data'],
    ['book.xlsx', 'data'],
    ['book.xlsm', 'data'],
    ['supplement.zip', 'data'],
    ['old.pzfx', 'pzfx'],
    ['photo.jpg', 'image'],
    ['photo.JPEG', 'image'],
    ['blot.png', 'image'],
    ['scan.tif', 'image'],
    ['bars.pspreset', 'preset'],
    ['nature.psstyle', 'style'],
    ['notes.docx', 'unsupported'],
    ['legacy.xls', 'unsupported'],
    ['no extension', 'unsupported'],
  ])('%s → %s', (name, kind) => {
    expect(dropKindOf(name)).toBe(kind)
  })

  it('handles files in the order dropped, the first project last and further ones refused', () => {
    const { steps, refused } = dropSteps(['a.psproj', 'b.csv', 'c.psproj', 'd.png'])
    expect(steps.map((s) => s.name)).toEqual(['b.csv', 'd.png', 'a.psproj'])
    expect(refused.map((s) => s.name)).toEqual(['c.psproj'])
  })

  it('names what a drop will do on the overlay, by target and by the kinds dragged', () => {
    expect(dropHints(new Set(['image']), 'page')).toEqual([
      'Images are placed on this page where you drop them',
    ])
    expect(dropHints(new Set(['image']), 'graph')).toEqual([
      'Images: you choose a page to put them on',
    ])
    expect(dropHints(null, 'other')).toHaveLength(5)
    expect(dropHints(new Set(['style']), 'other')[0]).toMatch(/presets .* and styles/)
  })

  it('tells kinds from MIME types only when every item has a known one', () => {
    expect(kindsOfTypes(['text/csv', 'image/png'])).toEqual(new Set(['data', 'image']))
    expect(kindsOfTypes(['text/csv', ''])).toBeNull()
    expect(kindsOfTypes([])).toBeNull()
  })

  it('summarizes several files, and one when it needs saying', () => {
    expect(
      dropSummary([
        { name: 'a.csv', result: 'opened in the import dialog', ok: true },
        { name: 'b.docx', result: 'not a file this app opens', ok: false },
      ]),
    ).toBe(
      '2 files dropped: 1 handled, 1 not. a.csv: opened in the import dialog. b.docx: not a file this app opens.',
    )
    expect(dropSummary([{ name: 'x.pspreset', result: 'added', ok: true }])).toBe(
      'x.pspreset: added.',
    )
  })
})

describe('the import dialog’s missing codes and limits (roadmap 39)', () => {
  const sheet = {
    name: 's',
    rows: [
      ['Control', 'Treated'],
      ['<0.5', 'BLQ'],
      [1, '>ULOQ'],
      ['ND', 2],
    ],
  }

  it('counts limit cells, and those without a number by column title', () => {
    const found = limitCells(sheet, true)
    expect(found).toMatchObject({ total: 3, below: 2, above: 1 })
    expect(found.columns).toEqual([
      { key: 'Treated', title: 'Treated', words: { below: 1, above: 1 } },
    ])
    // Without a header the titles aren't known: one limit for all.
    expect(limitCells(sheet, false).columns).toEqual([
      { key: '', title: 'all columns', words: { below: 1, above: 1 } },
    ])
  })

  it('starts from the preferences’ codes, reading limits when the file has any', () => {
    const state = initialCellRules(['nd', '-999'], [sheet])
    expect(state.missing).toBe('nd, -999')
    expect(state.limits).toBe(true)
    expect(cellRulesOf(state)).toEqual({
      missing: ['nd', '-999'],
      limits: state.rule,
      limitColumnsByTitle: true,
    })
    expect(initialCellRules(undefined, [{ name: 't', rows: [['A'], [1]] }]).limits).toBe(false)
    expect(cellRulesOf({ ...state, missing: ' ', limits: false })).toEqual({})
  })

  it('describes what a Prism file’s graphs gave', () => {
    expect(
      describeGraphs({
        graphs: [],
        found: 3,
        decoded: 1,
        layouts: 0,
        report: [
          { name: 'a', table: 'a', status: 'decoded', matched: [], defaulted: [] },
          { name: 'b', table: 'b', status: 'default', matched: [], defaulted: [] },
          { name: 'c', table: null, status: 'skipped', matched: [], defaulted: [] },
        ],
      }),
    ).toBe(
      '3 graphs: 1 drawn from Prism’s settings, 1 as the table’s default graph, 1 not imported.',
    )
  })
})

describe('the files a drop or a paste carries (audit 2, U24)', () => {
  const file = (name: string, text = name) => new File([text], name)
  /** A DataTransfer as browsers give it: its types, items and files. */
  const transfer = (o: {
    types?: string[]
    items?: { kind: string; file?: File | null; handle?: unknown }[]
    files?: File[]
  }) =>
    ({
      types: o.types ?? [],
      items: (o.items ?? []).map((i) => ({
        kind: i.kind,
        getAsFile: () => i.file ?? null,
        ...(i.handle !== undefined
          ? { getAsFileSystemHandle: () => Promise.resolve(i.handle) }
          : {}),
      })),
      files: o.files ?? [],
    }) as unknown as DataTransfer

  it('tells files from text and the page’s own elements, also when only items list them', () => {
    expect(carriesFiles(null)).toBe(false)
    expect(carriesFiles(transfer({ types: ['text/plain'] }))).toBe(false)
    expect(carriesFiles(transfer({ types: ['Files'] }))).toBe(true)
    // Some browsers list a pasted image only among the items.
    expect(carriesFiles(transfer({ items: [{ kind: 'file' }] }))).toBe(true)
    expect(carriesFiles(transfer({ items: [{ kind: 'string' }] }))).toBe(false)
  })

  it('reads the items’ files with their handles, else the files, and their bytes', async () => {
    const a = file('a.csv', 'x,y')
    const handle = { kind: 'file', name: 'a.csv' }
    const dropped = await transferFiles(
      transfer({
        types: ['Files'],
        items: [
          { kind: 'string' },
          { kind: 'file', file: a, handle },
          // A folder's handle is no file's.
          { kind: 'file', file: file('b.png'), handle: { kind: 'directory' } },
        ],
      }),
    )
    expect(dropped.map((f) => [f.name, f.handle])).toEqual([
      ['a.csv', handle],
      ['b.png', null],
    ])
    expect(dropped[0]!.blob).toBe(a)
    const pasted = await transferFiles(transfer({ types: ['Files'], files: [file('c.png')] }))
    expect(pasted.map((f) => [f.name, f.handle])).toEqual([['c.png', null]])
    expect(await transferFiles(null)).toEqual([])
    const read = await readFiles(dropped)
    expect(read[0]!.name).toBe('a.csv')
    expect(new TextDecoder().decode(read[0]!.bytes)).toBe('x,y')
  })
})
