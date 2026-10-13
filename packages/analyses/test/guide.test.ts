import {
  type DataTable,
  type GuideLeaf,
  type NormalizedDataSet,
  normalizeTable,
  type TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  entriesFor,
  GUIDE_ENTRIES,
  guidePaths,
  notHere,
  tableFacts,
  walkGuide,
} from '../src/dialogEntry.ts'
import { GUIDE_QUESTIONS, registry, topQuestions } from '../src/index.ts'
import {
  columnTable,
  countsTable,
  groupedTable,
  makeTable,
  mvTable,
  xyReplicatesTable,
} from './helpers.ts'

// Roadmap 51a (design §3.2): every path through every tree ends in a recommendation or in what
// another table kind would answer; every recommendation's params parse with its analysis' schema
// (no key the schema doesn't know), it accepts the entry's table kinds, and it runs on a fixture
// table of each kind without throwing (and without failing, on data that suit it).

const KINDS: TableKind[] = [
  'column',
  'xy',
  'grouped',
  'contingency',
  'survival',
  'partsOfWhole',
  'multipleVariables',
  'nested',
]

const v = (i: number, r: number) => 10 + 3 * i + ((r * 7 + i * 3) % 5) + r * 0.4

/** A table of each kind with values that suit its analyses. */
function fixture(kind: TableKind): DataTable {
  switch (kind) {
    case 'column':
      return columnTable(
        Array.from({ length: 4 }, (_, i) => Array.from({ length: 10 }, (_, r) => v(i, r))),
      )
    case 'grouped':
      return groupedTable(
        Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: 4 }, (_, c) => [0, 1, 2].map((k) => v(c, r + k) + r)),
        ),
        ['0', '1', '2', '4', '8'],
      )
    case 'xy': {
      const x = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5]
      const curve = (top: number, ec: number, k: number) =>
        x.map((xi, r) => 5 + (top - 5) / (1 + 10 ** (ec - xi)) + ((r * 3 + k) % 4) - 1.5)
      return xyReplicatesTable(x, [
        [curve(100, -7, 0), curve(100, -7, 1), curve(100, -7, 2)],
        [curve(90, -6.5, 1), curve(90, -6.5, 2), curve(90, -6.5, 3)],
      ])
    }
    case 'contingency':
      return countsTable('contingency', [
        [12, 18],
        [20, 10],
        [25, 6],
      ])
    case 'survival': {
      const times = [3, 5, 8, 9, 12, 15, 17, 20, 22, 25, 30, 34]
      return makeTable(
        'survival',
        [
          times.map((_, r) => [r < 6 ? (r % 3 === 0 ? 0 : 1) : null]),
          times.map((_, r) => [r >= 6 ? (r % 4 === 0 ? 0 : 1) : null]),
        ],
        times,
      )
    }
    case 'partsOfWhole':
      return countsTable('partsOfWhole', [[30], [12], [8]])
    case 'multipleVariables': {
      const n = 30
      const t = mvTable({
        Age: Array.from({ length: n }, (_, r) => 40 + ((r * 7) % 25)),
        Dose: Array.from({ length: n }, (_, r) => (r % 3) * 10),
        SBP: Array.from({ length: n }, (_, r) => 120 + ((r * 11) % 30) - (r % 3) * 4),
        Died: Array.from({ length: n }, (_, r) => ((r * 5) % 7 < 3 ? 1 : 0)),
        Group: Array.from({ length: n }, () => null),
      })
      t.dataSets[4]!.text = Array.from({ length: n }, (_, r) => ['A', 'B', 'C'][r % 3]!)
      return t
    }
    case 'nested':
      return makeTable(
        'nested',
        Array.from({ length: 3 }, (_, g) =>
          Array.from({ length: 3 }, (_, r) => [0, 1, 2].map((s) => v(g, r + s * 2) + s)),
        ),
      )
  }
}

/** The data sets a leaf's analysis reads: as many as it takes, from the table's first. */
function inputFor(analysisId: string, t: DataTable, want?: number): NormalizedDataSet[] {
  const def = registry.get(analysisId)!
  const all = normalizeTable(t)
  // Variables: the dialog's own choice (number variables only for PCA and the like).
  if (t.tableKind === 'multipleVariables')
    return def.numbersByDefault ? all.filter((d) => !d.text) : all
  const n = Math.max(def.inputs.min, Math.min(def.inputs.max, want ?? all.length))
  return all.slice(0, n)
}

/** Every key of `sub` is in `full` (nested objects too; arrays and records by value). */
function knownKeys(sub: unknown, full: unknown, at: string): string[] {
  if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return []
  if (!full || typeof full !== 'object') return [at]
  return Object.entries(sub).flatMap(([k, val]) =>
    k in (full as object)
      ? knownKeys(val, (full as Record<string, unknown>)[k], `${at}.${k}`)
      : [`${at}.${k}`],
  )
}

/** Recommendations that need values the fixture can't give (the user enters them). */
const MAY_FAIL = new Set([
  // Expected proportions are entered in the options after Use this.
  'expectedProportions',
  // Any built-in model: the fixture's dose-response data don't suit them all.
  'otherCurve',
  // Y coded 0 or 1: the XY fixture holds measurements.
  'yesNo',
])

describe('the guide’s trees', () => {
  it('give every table kind questions, with unique ids', () => {
    const ids = GUIDE_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const k of KINDS) expect(entriesFor(k).length, k).toBeGreaterThan(0)
    for (const k of KINDS) {
      const elsewhere = notHere(k)
      expect(elsewhere.length + entriesFor(k).length).toBe(GUIDE_ENTRIES.length)
      for (const e of elsewhere) expect(e.entry.kinds).not.toContain(k)
    }
  })

  it('end every path in a recommendation or another table kind, and keep their lengths', () => {
    for (const e of GUIDE_ENTRIES) {
      expect(e.question.length, e.id).toBeLessThanOrEqual(100)
      expect(e.keywords.length, e.id).toBeGreaterThan(0)
      const facts = tableFacts(e.kinds[0]!, normalizeTable(fixture(e.kinds[0]!)))
      const paths = guidePaths(e, facts)
      expect(paths.length, e.id).toBeGreaterThan(0)
      for (const p of paths) {
        if (p.end.kind === 'elsewhere') {
          if (p.end.needs) expect(e.kinds, e.id).not.toContain(p.end.needs)
          continue
        }
        expect(p.end.reason.length, `${e.id}: ${p.end.reason}`).toBeLessThanOrEqual(200)
        expect(p.end.alternatives.length, e.id).toBeLessThanOrEqual(2)
        for (const a of p.end.alternatives) expect(a.when.length, e.id).toBeLessThanOrEqual(160)
      }
    }
  })

  it('reach every answer of every question', () => {
    for (const e of GUIDE_ENTRIES) {
      const facts = tableFacts(e.kinds[0]!, normalizeTable(fixture(e.kinds[0]!)))
      const seen = new Set(
        guidePaths(e, facts).flatMap((p) => Object.entries(p.answers).map(([q, a]) => `${q}=${a}`)),
      )
      const visit = (s: GuideLeaf | import('@ps/model').GuideStep) => {
        if (s.kind !== 'question') return
        for (const a of s.answers) {
          // Reached, unless this table rules it out (it is shown greyed with the reason).
          if (!a.unavailable?.(facts))
            expect(seen.has(`${s.id}=${a.id}`), `${e.id}: ${s.id}=${a.id}`).toBe(true)
          visit(a.next)
        }
      }
      visit(e.start)
    }
  })

  it('recommend params each analysis parses and runs, on every table kind of its question', () => {
    for (const e of GUIDE_ENTRIES)
      for (const kind of e.kinds) {
        const table = fixture(kind)
        for (const p of guidePaths(e, tableFacts(kind, normalizeTable(table)))) {
          if (p.end.kind !== 'leaf') continue
          const leaf = p.end
          const runs = [{ analysisId: leaf.analysisId, params: leaf.params }, ...leaf.alternatives]
          for (const [i, r] of runs.entries()) {
            const at = `${e.id} ${JSON.stringify(p.answers)} ${i ? `alternative ${i}` : ''}`
            const def = registry.get(r.analysisId)
            expect(def, at).toBeDefined()
            expect(def!.accepts, at).toContain(kind)
            // The number of groups the path is for (two-group tests read two data sets).
            const want = p.answers.groups === 'two' ? 2 : p.answers.groups === 'one' ? 1 : undefined
            const input = inputFor(r.analysisId, table, want)
            const facts = tableFacts(kind, input)
            const answers = { ...p.answers, control: input[0]?.ref.key ?? '' }
            const raw = r.params(facts, answers)
            const parsed = def!.params.safeParse(raw)
            expect(parsed.success, `${at}: ${parsed.error?.issues[0]?.message}`).toBe(true)
            expect(knownKeys(raw, parsed.data, r.analysisId), at).toEqual([])
            const result = def!.run(input, parsed.data, {
              tableKind: kind,
              xTitle: table.x?.title ?? null,
            })
            if (!MAY_FAIL.has(e.id))
              expect(
                result.status,
                `${at}: ${result.diagnostics.map((d) => d.message).join(' ')}`,
              ).not.toBe('error')
          }
        }
      }
  })

  it('are listed with their params (a change to a tree is a reviewed diff)', () => {
    const lines: string[] = []
    for (const e of GUIDE_ENTRIES) {
      const kind = e.kinds[0]!
      const table = fixture(kind)
      const facts = tableFacts(kind, normalizeTable(table))
      for (const p of guidePaths(e, facts)) {
        const answers = Object.entries(p.answers)
          .filter(([k]) => !['control', 'outcome', 'time', 'event', 'hypothetical'].includes(k))
          .map(([k, a]) => `${k}=${a}`)
          .join(' ')
        if (p.end.kind === 'elsewhere')
          lines.push(`${e.id} | ${answers} → needs ${p.end.needs ?? 'nothing yet'}`)
        else {
          const params = p.end.params(facts, { ...p.answers, control: 'C' })
          // Data set keys are random: shown by title.
          let json = JSON.stringify(params)
          for (const d of normalizeTable(table)) json = json.replaceAll(d.ref.key, `<${d.title}>`)
          lines.push(`${e.id} | ${answers} → ${p.end.analysisId} ${json}`)
        }
      }
    }
    expect(lines.length).toBeGreaterThan(100)
    expect(lines.join('\n')).toMatchSnapshot()
  })
})

describe('the questions without their trees (audit 4 P6)', () => {
  it('are the guide’s entries, in rail order, with their words and kinds', () => {
    expect(GUIDE_QUESTIONS).toEqual(
      GUIDE_ENTRIES.map((e) => ({ id: e.id, question: e.question, kinds: e.kinds })),
    )
    for (const kind of ['column', 'xy', 'grouped', 'nested'] as const)
      expect(topQuestions(kind).map((q) => q.id)).toEqual(
        entriesFor(kind)
          .slice(0, 3)
          .map((e) => e.id),
      )
  })
})

describe('walking a tree', () => {
  const compare = GUIDE_ENTRIES.find((e) => e.id === 'groupsDiffer')!

  it('answers counting questions from the table and stops at the first design question', () => {
    const facts = tableFacts('column', normalizeTable(fixture('column')))
    const w = walkGuide(compare, facts, {})
    expect(w.taken).toEqual([expect.objectContaining({ answer: 'many', auto: true })])
    expect(w.current?.id).toBe('matched')
    expect(w.end).toBeNull()
  })

  it('reaches the recommendation, and stops on an answer the table rules out', () => {
    const table = fixture('column')
    const two = tableFacts('column', normalizeTable(table).slice(0, 2))
    const w = walkGuide(compare, two, { matched: 'no', values: 'measure', scatter: 'yes' })
    expect(w.end?.kind).toBe('leaf')
    expect((w.end as GuideLeaf).params(two, {})).toEqual({
      design: 'unpaired',
      unpaired: { assumeEqualSD: false },
    })
    // Summary data can't be paired.
    const summary = { ...two, raw: false }
    expect(walkGuide(compare, summary, { matched: 'yes' }).current?.id).toBe('matched')
  })

  it('audit 4 S14 (Q5): three or more groups at each row ask about the subjects and the scatter', () => {
    const rowsMany = GUIDE_ENTRIES.find((e) => e.id === 'rowsMany')!
    const facts = tableFacts('grouped', normalizeTable(fixture('grouped')))
    expect(walkGuide(rowsMany, facts, {}).current?.id).toBe('matched')
    const matched = walkGuide(rowsMany, facts, { matched: 'yes' }).end as GuideLeaf
    expect(matched.analysisId).toBe('twoWayAnova')
    expect(matched.params(facts, { matched: 'yes' })).toMatchObject({
      repeated: 'columns',
      comparisons: 'withinRows',
    })
    expect(walkGuide(rowsMany, facts, { matched: 'no', values: 'measure' }).current?.id).toBe(
      'scatter',
    )
    const at = (scatter: string) =>
      (
        walkGuide(rowsMany, facts, { matched: 'no', values: 'measure', scatter }).end as GuideLeaf
      ).params(facts, {})
    expect(at('unsure')).toMatchObject({ gaussian: true, equalSD: 'welch' })
    expect(at('yes')).toMatchObject({ equalSD: 'welch' })
    expect(at('no')).toMatchObject({ equalSD: 'yes' })
    // Summary data can't be matched.
    expect(walkGuide(rowsMany, { ...facts, raw: false }, { matched: 'yes' }).current?.id).toBe(
      'matched',
    )
  })
})

describe('table facts', () => {
  it('count groups, values and pairs, and describe the values, never testing them', () => {
    const f = tableFacts(
      'column',
      normalizeTable(
        columnTable([
          [1, 2, 3, 4],
          [2, 3, null, 4],
        ]),
      ),
    )
    expect(f.groups.map((g) => g.n)).toEqual([4, 3])
    expect(f.completeRows).toBe(3)
    expect(f).toMatchObject({ raw: true, allPositive: true, wholeNumbers: true, distinctValues: 4 })
    const xy = tableFacts('xy', normalizeTable(fixture('xy')))
    expect(xy.x).toMatchObject({ looksLog: true, looksConcentration: false, hasZero: false })
    const c = tableFacts('contingency', normalizeTable(fixture('contingency')))
    expect(c.contingency).toMatchObject({ rows: 3, columns: 2 })
    const mv = tableFacts('multipleVariables', normalizeTable(fixture('multipleVariables')))
    expect(mv.variables?.binary.map((v) => v.title)).toEqual(['Died'])
    expect(mv.variables?.texts.map((v) => v.title)).toEqual(['Group'])
  })
})
