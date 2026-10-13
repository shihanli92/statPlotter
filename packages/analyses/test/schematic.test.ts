import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DataTable,
  type GuideStep,
  normalizeTable,
  type SchematicSpec,
  type TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  analysisSchematic,
  designOfParams,
  GUIDE_ENTRIES,
  guideDesign,
  guideEntry,
  guideMap,
  guidePaths,
  guideSchematic,
  reanswer,
  registry,
  SCHEMATIC_ANALYSES,
  type SchematicNames,
  tableFacts,
  walkGuide,
} from '../src/index.ts'
import {
  columnTable,
  countsTable,
  groupedTable,
  makeTable,
  mvTable,
  xyReplicatesTable,
} from './helpers.ts'

// Roadmap 51f: "What will be tested" — the schematic Guide me builds as its questions are
// answered (each answer's `draws`, then the recommendation's params), and the map of the path.
// Every path of every question gives a schematic that names the user's groups, says what is
// compared and how, links the same subjects, and never holds a value of the data or a result.

/** Values with a tail no word of a schematic could have (it never shows the data). */
const val = (i: number, r: number) => 10 + 3 * i + ((r * 7 + i * 3) % 5) + 0.731

function column(titles: string[], n = 8): DataTable {
  const t = columnTable(titles.map((_, i) => Array.from({ length: n }, (_, r) => val(i, r))))
  t.dataSets.forEach((d, i) => {
    d.title = titles[i]!
  })
  return t
}

function grouped(): DataTable {
  const t = groupedTable(
    [0, 1, 2].map((r) => [0, 1].map((c) => [0, 1, 2].map((k) => val(c, r + k)))),
    ['0 h', '2 h', '4 h'],
  )
  t.dataSets.forEach((d, i) => {
    d.title = ['WT', 'KO'][i]!
  })
  t.factorNames = { rows: 'Time', columns: 'Genotype' }
  return t
}

function fixture(kind: TableKind): DataTable {
  switch (kind) {
    case 'column':
      return column(['Vehicle', '1 mg/kg', '10 mg/kg'])
    case 'grouped':
      return grouped()
    case 'xy': {
      const x = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5]
      const curve = (ec: number, k: number) =>
        x.map((xi, r) => 5 + 95 / (1 + 10 ** (ec - xi)) + ((r * 3 + k) % 4) + 0.731)
      const t = xyReplicatesTable(
        x,
        [
          [curve(-7, 0), curve(-7, 1)],
          [curve(-6.5, 1), curve(-6.5, 2)],
        ],
        ['Drug A', 'Drug B'],
      )
      t.x!.title = 'log[Agonist]'
      return t
    }
    case 'contingency': {
      const t = countsTable(
        'contingency',
        [
          [12, 18],
          [20, 10],
        ],
        ['Placebo', 'Drug'],
      )
      t.dataSets[0]!.title = 'Died'
      t.dataSets[1]!.title = 'Survived'
      return t
    }
    case 'survival': {
      const times = [3, 5, 8, 9, 12, 15, 17, 20, 22, 25, 30, 34]
      const t = makeTable(
        'survival',
        [
          times.map((_, r) => [r < 6 ? (r % 3 === 0 ? 0 : 1) : null]),
          times.map((_, r) => [r >= 6 ? (r % 4 === 0 ? 0 : 1) : null]),
        ],
        times,
      )
      t.dataSets[0]!.title = 'Wild type'
      t.dataSets[1]!.title = 'Mutant'
      return t
    }
    case 'partsOfWhole': {
      const t = countsTable('partsOfWhole', [[30], [12], [8]], ['Round', 'Wrinkled', 'Other'])
      t.dataSets[0]!.title = 'Seeds'
      return t
    }
    case 'multipleVariables': {
      const n = 30
      const t = mvTable({
        Age: Array.from({ length: n }, (_, r) => 40 + ((r * 7) % 25) + 0.731),
        Dose: Array.from({ length: n }, (_, r) => (r % 3) * 10),
        SBP: Array.from({ length: n }, (_, r) => 120 + ((r * 11) % 30) + 0.731),
        Died: Array.from({ length: n }, (_, r) => ((r * 5) % 7 < 3 ? 1 : 0)),
        Group: Array.from({ length: n }, () => null),
      })
      t.dataSets[4]!.text = Array.from({ length: n }, (_, r) => ['A', 'B', 'C'][r % 3]!)
      return t
    }
    case 'nested': {
      const t = makeTable(
        'nested',
        [0, 1].map((g) => [0, 1, 2].map((r) => [0, 1, 2].map((s) => val(g, r + s * 2)))),
      )
      t.dataSets[0]!.title = 'Sham'
      t.dataSets[1]!.title = 'Lesion'
      return t
    }
  }
}

function setup(t: DataTable) {
  const input = normalizeTable(t)
  const facts = tableFacts(t.tableKind, input)
  const names: SchematicNames = {
    rowTitles: input[0]?.rowTitles ?? t.rowTitles ?? null,
    factors: t.factorNames ?? {},
    xTitle: t.x?.title ?? null,
  }
  return { input, facts, names }
}

/** Words a schematic must never hold: a test's result, an estimate, a value of the data. */
const STATISTICS = [
  /\bP\s*[=<>≤]/,
  /\bCI\b/,
  /confidence interval/i,
  /\br\s*=/,
  /R²/,
  /\b[tFUWz]\s*=/,
  /(EC|IC)50\s*=/,
  /significan/i,
  /\bSD\s*=/,
  /mean\s*=/i,
  /\.731/,
  /NaN|undefined|\[object/,
]

function expectWellFormed(spec: SchematicSpec, at: string) {
  const ids = spec.boxes.map((b) => b.id)
  expect(new Set(ids).size, at).toBe(ids.length)
  for (const a of spec.arrows) {
    expect(ids, at).toContain(a.from)
    expect(ids, at).toContain(a.to)
  }
  for (const l of spec.links) for (const b of l.boxes) expect(ids, at).toContain(b)
  expect(spec.question.length, at).toBeGreaterThan(5)
  expect(spec.description, at).toContain(spec.question)
  const words = JSON.stringify(spec)
  for (const re of STATISTICS) expect(words, `${at}: ${re}`).not.toMatch(re)
}

/** The answers of a path, given one by one in the order the walk asks them. */
function prefixes(entryId: string, kind: TableKind, answers: Record<string, string>) {
  const entry = guideEntry(entryId)!
  const { facts } = setup(fixture(kind))
  const out: Record<string, string>[] = [{}]
  let given: Record<string, string> = {}
  for (let i = 0; i < 32; i++) {
    const w = walkGuide(entry, facts, given)
    if (!w.current) break
    const a = answers[w.current.id]
    if (a === undefined) break
    given = { ...given, [w.current.id]: a }
    for (const [k, v] of Object.entries(answers))
      if (!(k in given) && !w.current.answers.some((x) => x.id === k)) given[k] ??= v
    out.push({ ...given })
  }
  return out
}

describe('“What will be tested” on every path of Guide me', () => {
  it('draws each step of every path: boxes, arrows and links that exist, and no statistic', () => {
    let count = 0
    for (const e of GUIDE_ENTRIES)
      for (const kind of e.kinds) {
        const t = fixture(kind)
        const { facts, names } = setup(t)
        for (const p of guidePaths(e, facts)) {
          for (const given of prefixes(e.id, kind, p.answers)) {
            const at = `${e.id} on ${kind} ${JSON.stringify(given)}`
            const spec = guideSchematic(e, facts, given, names)
            expectWellFormed(spec, at)
            count++
          }
          // The finished path names the user's groups (or the grid's levels).
          const spec = guideSchematic(e, facts, p.answers, names)
          const shown = [
            ...spec.boxes.map((b) => b.label),
            ...(spec.grid?.columnLevels ?? []),
            ...(spec.grid?.rowLevels ?? []),
          ].join(' ')
          const d = guideDesign(e, facts, p.answers)
          if (d.layout === 'groups' || d.layout === 'grid')
            for (const g of facts.groups.slice(0, 5))
              expect(shown, `${e.id} ${JSON.stringify(p.answers)}`).toContain(g.title)
        }
      }
    expect(count).toBeGreaterThan(300)
  })

  it('agrees with the recommendation’s params about the values and the matching', () => {
    for (const e of GUIDE_ENTRIES)
      for (const kind of e.kinds) {
        const { facts } = setup(fixture(kind))
        for (const p of guidePaths(e, facts)) {
          // The walk the answers take (counting questions answered by the table).
          const walk = walkGuide(e, facts, p.answers)
          if (walk.end?.kind !== 'leaf' || e.start.kind === 'leaf') continue
          const fromParams = designOfParams(walk.end.analysisId, walk.end.params(facts, p.answers))
          if (!fromParams) continue
          // The answers alone (before the params are merged in).
          let answers: Record<string, unknown> = { ...(e.draws ?? {}) }
          for (const s of walk.taken) {
            const a = s.question.answers.find((x) => x.id === s.answer)
            answers = { ...answers, ...(a?.draws ?? {}) }
          }
          const at = `${e.id} ${JSON.stringify(p.answers)} → ${walk.end.analysisId}`
          for (const key of ['measure', 'matched'] as const)
            if (answers[key] !== undefined && fromParams[key] !== undefined)
              expect(fromParams[key], `${at}: ${key}`).toBe(answers[key])
        }
      }
  })

  it('has a design for every analysis Guide me recommends (but Transform and tools)', () => {
    const recommended = new Set<string>()
    const visit = (s: GuideStep) => {
      if (s.kind === 'leaf') {
        recommended.add(s.analysisId)
        for (const a of s.alternatives) recommended.add(a.analysisId)
      } else if (s.kind === 'question') for (const a of s.answers) visit(a.next)
    }
    for (const e of GUIDE_ENTRIES) visit(e.start)
    const without = [...recommended].filter((id) => !SCHEMATIC_ANALYSES.includes(id)).sort()
    expect(without).toEqual(['frequencyDistribution', 'transform'])
    // And every design is of an analysis that exists.
    for (const id of SCHEMATIC_ANALYSES) expect(registry.get(id), id).toBeDefined()
    expect(SCHEMATIC_ANALYSES).toHaveLength(39)
  })
})

describe('the schematic, step by step (two groups)', () => {
  const t = column(['Control', 'Treated'], 10)
  const { facts, names } = setup(t)
  const entry = guideEntry('groupsDiffer')!
  const at = (answers: Record<string, string>) => guideSchematic(entry, facts, answers, names)

  it('starts with the groups, named, and the question to answer next', () => {
    const s = at({})
    expect(s.boxes.map((b) => b.label)).toEqual(['Control', 'Treated'])
    expect(s.boxes.every((b) => !b.measure)).toBe(true)
    expect(s.links).toEqual([])
    expect(s.noEffect).toBeNull()
    expect(s.pending).toBe('Next: Were the same subjects measured in both groups?')
  })

  it('says what is compared once the values are known, in the user’s names', () => {
    const s = at({ matched: 'no', values: 'measure' })
    expect(s.boxes.map((b) => b.measure)).toEqual(['mean', 'mean'])
    expect(s.question).toBe('Is the mean of Treated different from that of Control?')
    expect(s.noEffect).toBe(
      'If the treatment had no effect, the means of Control and Treated would differ only by chance.',
    )
    expect(s.arrows).toEqual([
      { from: s.boxes[0]!.id, to: s.boxes[1]!.id, heads: 'both', route: 'arc' },
    ])
    expect(at({ matched: 'no', values: 'measure', scatter: 'yes' }).notes).toContain(
      'Each group keeps its own scatter (Welch).',
    )
    expect(at({ matched: 'no', values: 'scores' }).question).toBe(
      'Do values in Treated tend to be larger or smaller than in Control?',
    )
    expect(at({ matched: 'no', values: 'shape' }).boxes[0]!.glyph).toBe('distribution')
  })

  it('links the same subjects, and counts them as the independent units', () => {
    const s = at({ matched: 'yes', values: 'measure' })
    expect(s.links).toEqual([
      { boxes: s.boxes.map((b) => b.id), label: 'same subjects, row by row' },
    ])
    expect(s.question).toBe('Is the mean change from Control to Treated different from zero?')
    expect(s.notes).toContain('Independent units: 10 subjects, each measured in every group.')
    expect(at({ matched: 'yes', values: 'factor' }).question).toBe(
      'Is the mean ratio Treated/Control different from 1?',
    )
  })
})

describe('comparisons of three or more groups', () => {
  const t = column(['Vehicle', '1 mg/kg', '10 mg/kg'])
  const { facts, names } = setup(t)
  const [vehicle, low, high] = facts.groups.map((g) => `g:${g.key}`)
  const base = { matched: 'no', values: 'measure', scatter: 'no' }
  const at = (comparisons: string, extra: Record<string, string> = {}) =>
    guideSchematic(guideEntry('groupsDiffer')!, facts, { ...base, comparisons, ...extra }, names)

  it('every pair: an arc per pair, one family with its correction', () => {
    const s = at('allPairs')
    expect(s.arrows.map((a) => [a.from, a.to, a.heads])).toEqual([
      [vehicle, low, 'both'],
      [vehicle, high, 'both'],
      [low, high, 'both'],
    ])
    expect(s.notes).toContain('Every pair: 3 comparisons, one family (Tukey).')
    expect(s.question).toBe(
      'Which of Vehicle, 1 mg/kg and 10 mg/kg differ from each other in their mean?',
    )
  })

  it('each against the control: arcs from the control only, which is marked', () => {
    const s = at('vsControl', { control: facts.groups[1]!.key })
    expect(s.arrows.map((a) => [a.from, a.to])).toEqual([
      [low, vehicle],
      [low, high],
    ])
    expect(s.boxes.find((b) => b.role === 'control')?.label).toBe('1 mg/kg')
    expect(s.notes).toContain('Each group against 1 mg/kg: 2 comparisons, one family (Dunnett).')
    expect(s.question).toBe('Is the mean of each group different from that of 1 mg/kg?')
  })

  it('a trend: one arrow along the order; only whether any differs: one line under all', () => {
    const trend = at('trend')
    expect(trend.arrows).toEqual([
      {
        from: vehicle,
        to: high,
        heads: 'end',
        route: 'below',
        label: 'steady rise or fall, in this order?',
      },
    ])
    expect(trend.question).toBe('Does the mean rise or fall steadily from Vehicle to 10 mg/kg?')
    const none = at('none')
    expect(none.arrows.map((a) => [a.route, a.heads, a.label])).toEqual([
      ['below', 'none', 'any difference?'],
    ])
  })

  it('a set value: a dashed box with the value, an arc from each group', () => {
    const s = guideSchematic(
      guideEntry('setValue')!,
      setup(column(['Day 3'])).facts,
      { values: 'measure', hypothetical: '100' },
      names,
    )
    expect(s.boxes.map((b) => [b.label, b.role])).toEqual([
      ['Day 3', 'group'],
      ['100', 'reference'],
    ])
    expect(s.question).toBe('Is the mean of Day 3 different from 100?')
    expect(s.noEffect).toMatch(/If the true mean were 100/)
  })
})

describe('one-tailed tests: the predicted direction is the arrow’s', () => {
  const { facts } = setup(column(['Control', 'Treated']))
  const [a, b] = facts.groups.map((g) => `g:${g.key}`)
  const ttest = (predicted: string) =>
    analysisSchematic('ttest', { design: 'unpaired', tails: 'one', predicted }, facts)!

  it('points at the group predicted higher, and says so', () => {
    const up = ttest('increase')
    expect(up.arrows).toEqual([
      { from: a, to: b, heads: 'end', route: 'arc', label: 'Treated higher?' },
    ])
    expect(up.question).toBe('Is the mean of Treated higher than that of Control?')
    expect(up.notes).toContain('One-tailed: the direction was predicted before the experiment.')
    const down = ttest('decrease')
    expect(down.arrows).toEqual([
      { from: b, to: a, heads: 'end', route: 'arc', label: 'Control higher?' },
    ])
    expect(down.question).toBe('Is the mean of Treated lower than that of Control?')
  })

  it('two-tailed: both ways; one-tailed without a direction is drawn two-tailed', () => {
    expect(analysisSchematic('ttest', {}, facts)!.arrows[0]!.heads).toBe('both')
    expect(ttest('unset').arrows[0]!.heads).toBe('both')
  })

  it('a set value predicted above: from the value to the group', () => {
    const s = analysisSchematic(
      'oneSample',
      { hypothetical: 1, tails: 'one', predicted: 'increase' },
      setup(column(['Ratio'])).facts,
    )!
    expect(s.arrows[0]).toMatchObject({ from: 'value', heads: 'end', label: 'above 1?' })
    expect(s.question).toBe('Is the mean of Ratio above 1?')
  })
})

describe('a grouped table: the factor grid and its independent units', () => {
  const t = grouped()
  const { facts, names } = setup(t)
  const entry = guideEntry('twoFactors')!

  it('draws the grid with the factors’ names and levels', () => {
    const s = guideSchematic(entry, facts, {}, names)
    expect(s.grid).toEqual({
      columns: 'Genotype',
      rows: 'Time',
      columnLevels: ['WT', 'KO'],
      rowLevels: ['0 h', '2 h', '4 h'],
    })
    expect(s.boxes).toHaveLength(6)
    expect(s.question).toBe(
      'How do Time and Genotype affect the mean, and does the effect of one depend on the other?',
    )
  })

  it('repeated across the columns: a link in each row; 9 subjects, not 18 values', () => {
    const s = guideSchematic(
      entry,
      facts,
      { repeated: 'columns', comparisons: 'withinRows', kind: 'allPairs' },
      names,
    )
    expect(s.links).toHaveLength(3)
    for (const [r, l] of s.links.entries())
      expect(l.boxes.map((id) => s.boxes.find((b) => b.id === id)!.row)).toEqual([r, r])
    expect(s.notes).toContain('Independent units: 9 subjects, not 18 values.')
    expect(s.notes).toContain('Each level of Time is its own family of 1 comparison (Šidák).')
    expect(s.arrows).toHaveLength(3)
    expect(s.question).toBe('At each level of Time, which Genotype means differ?')
  })

  it('repeated down the rows (a time course): a link per column; within each column, arcs', () => {
    const s = guideSchematic(
      entry,
      facts,
      { repeated: 'rows', comparisons: 'withinColumns', kind: 'vsControl' },
      names,
    )
    expect(s.links.map((l) => l.boxes.length)).toEqual([3, 3])
    expect(s.notes).toContain('Independent units: 6 subjects, not 18 values.')
    for (const a of s.arrows) {
      const [p, q] = [s.boxes.find((b) => b.id === a.from)!, s.boxes.find((b) => b.id === a.to)!]
      expect(p.column).toBe(q.column)
      expect(p.row).toBe(0)
    }
    expect(s.question).toBe('In each level of Genotype, is each Time different from 0 h?')
  })

  it('different subjects in every cell: each value its own subject', () => {
    const s = guideSchematic(entry, facts, { repeated: 'none', comparisons: 'none' }, names)
    expect(s.links).toEqual([])
    expect(s.notes).toContain('Independent units: 18 values, one subject each.')
  })

  it('one test per row, corrected across the rows', () => {
    const s = guideSchematic(
      guideEntry('rowsTwo')!,
      facts,
      { matched: 'yes', values: 'measure' },
      names,
    )
    expect(s.arrows).toHaveLength(3)
    expect(s.links).toHaveLength(3)
    expect(s.notes).toContain('Corrected across the rows by the false discovery rate (Q = 5%).')
    expect(s.question).toBe('At each row, is the mean of KO different from that of WT?')
  })
})

describe('other kinds of question', () => {
  it('nested: subjects inside each group are the units', () => {
    const { facts, names } = setup(fixture('nested'))
    const s = guideSchematic(guideEntry('nestedGroups')!, facts, {}, names)
    expect(s.boxes.map((b) => b.members)).toEqual([
      { count: 3, label: '3 subjects' },
      { count: 3, label: '3 subjects' },
    ])
    expect(s.notes).toContain('Independent units: 6 subjects (not 18 values).')
  })

  it('a 2 × 2 table’s risk: from the reference row to the exposed one, in its names', () => {
    const { facts, names } = setup(fixture('contingency'))
    const s = guideSchematic(
      guideEntry('outcomeGroup')!,
      facts,
      { paired: 'no', report: 'risk', exposed: 'second', outcome: 'first' },
      names,
    )
    expect(s.boxes.map((b) => [b.label, b.measure, b.role])).toEqual([
      ['Placebo', 'risk of Died', 'control'],
      ['Drug', 'risk of Died', 'group'],
    ])
    expect(s.arrows.map((a) => [a.from, a.to])).toEqual([['r0', 'r1']])
    expect(s.question).toBe('Is the risk of Died in Drug different from that in Placebo?')
    expect(s.notes).toContain('Relative risk: Drug against Placebo.')
  })

  it('compared EC50s: one shared EC50 or one each, decided as chosen', () => {
    const { facts, names } = setup(fixture('xy'))
    const s = guideSchematic(
      guideEntry('doseResponse')!,
      facts,
      {
        direction: 'falls',
        xScale: 'log',
        normalized: 'no',
        slope: 'variable',
        compare: 'yes',
        compareBy: 'fTest',
        replicates: 'each',
      },
      names,
    )
    expect(s.boxes.map((b) => [b.label, b.glyph])).toEqual([
      ['Drug A', 'curveDown'],
      ['Drug B', 'curveDown'],
    ])
    expect(s.arrows[0]).toMatchObject({ route: 'below', heads: 'none' })
    expect(s.notes).toContain('Decided by the extra sum-of-squares F test, chosen before the fit.')
    expect(s.notes).toContain('X is log(dose).')
    expect(s.noEffect).toMatch(/one shared log IC50 would fit the curves as well as one each/)
  })

  it('predictors point at the outcome chosen', () => {
    const { facts, names } = setup(fixture('multipleVariables'))
    const sbp = facts.variables!.numbers.find((v) => v.title === 'SBP')!.key
    const s = guideSchematic(
      guideEntry('predictOutcome')!,
      facts,
      { outcomeKind: 'measurement', outcome: sbp },
      names,
    )
    const outcome = s.boxes.find((b) => b.role === 'outcome')!
    expect(outcome.label).toBe('SBP')
    expect(s.arrows.every((a) => a.to === outcome.id && a.heads === 'end')).toBe(true)
    expect(s.arrows.map((a) => s.boxes.find((b) => b.id === a.from)!.label)).toEqual([
      'Age',
      'Dose',
      'Died',
      'Group',
    ])
  })

  it('survival curves with a reference group', () => {
    const { facts, names } = setup(fixture('survival'))
    const s = guideSchematic(guideEntry('curvesDiffer')!, facts, { weight: 'whole' }, names)
    expect(s.boxes.map((b) => [b.label, b.glyph])).toEqual([
      ['Wild type', 'survival'],
      ['Mutant', 'survival'],
    ])
    expect(s.question).toBe('Do the survival curves of Wild type and Mutant differ?')
    expect(s.notes).toContain('Log-rank test: the whole follow-up counts alike.')
  })
})

describe('the map of the path', () => {
  const { facts } = setup(column(['Control', 'Treated'], 10))
  const entry = guideEntry('groupsDiffer')!

  it('lists the answers (the table’s marked), the next question, then what follows', () => {
    expect(guideMap(entry, facts, { matched: 'no' })).toEqual([
      {
        kind: 'answered',
        questionId: 'groups',
        question: 'How many groups do you compare?',
        answer: 'Two groups',
        auto: true,
        branches: 3,
      },
      {
        kind: 'answered',
        questionId: 'matched',
        question: 'Were the same subjects measured in both groups?',
        answer: 'No, different subjects in each group',
        auto: false,
        branches: 2,
      },
      { kind: 'next', questionId: 'values', question: 'What kind of values?', branches: 4 },
      { kind: 'later' },
    ])
    expect(
      guideMap(entry, facts, { matched: 'no', values: 'measure', scatter: 'yes' }).at(-1),
    ).toEqual({
      kind: 'leaf',
      analysisId: 'ttest',
    })
    expect(
      guideMap(guideEntry('timeCourse')!, setup(grouped()).facts, { second: 'one' }).at(-1),
    ).toMatchObject({
      kind: 'elsewhere',
    })
  })

  it('changing an earlier answer keeps the later answers that still apply', () => {
    const answers = { matched: 'no', values: 'measure', scatter: 'yes' }
    // Matched: the paired branch asks "What kind of values?" too (kept); not the scatter.
    expect(reanswer(entry, facts, answers, 'matched', 'yes')).toEqual({
      matched: 'yes',
      values: 'measure',
    })
    // An answer the new branch doesn't have stops the walk there (kept to be changed).
    expect(reanswer(entry, facts, { matched: 'no', values: 'shape' }, 'matched', 'yes')).toEqual({
      matched: 'yes',
      values: 'shape',
    })
    // The same answer again keeps everything.
    expect(reanswer(entry, facts, answers, 'values', 'measure')).toEqual(answers)
  })

  it('keeps an asked value while its answer stands, and drops it with the answer', () => {
    const three = setup(column(['Vehicle', '1 mg/kg', '10 mg/kg'])).facts
    const ctl = three.groups[2]!.key
    const answers = {
      matched: 'no',
      values: 'measure',
      scatter: 'no',
      comparisons: 'vsControl',
      control: ctl,
    }
    expect(reanswer(entry, three, answers, 'scatter', 'yes')).toEqual({
      ...answers,
      scatter: 'yes',
    })
    expect(reanswer(entry, three, answers, 'comparisons', 'allPairs')).toEqual({
      matched: 'no',
      values: 'measure',
      scatter: 'no',
      comparisons: 'allPairs',
    })
    // Asked for afresh: the first group to start with.
    expect(
      reanswer(
        entry,
        three,
        { matched: 'no', values: 'measure', scatter: 'no' },
        'comparisons',
        'vsControl',
      ).control,
    ).toBe(three.groups[0]!.key)
  })
})

describe('the import boundary of schematic/', () => {
  it('never imports a test, a run or a statistic', () => {
    const dir = new URL('../src/schematic/', import.meta.url).pathname
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).not.toMatch(/from '@ps\/stats'/)
      for (const m of src.matchAll(/from '(\.\.\/[^']+)'/g))
        expect(
          ['../guide/index.ts', '../explain/equations.ts', '../sketch/words.ts'],
          `${f}: ${m[1]}`,
        ).toContain(m[1])
      expect(src, f).not.toMatch(/\.run\(/)
    }
  })
})
