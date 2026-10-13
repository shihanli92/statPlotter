import { guideEntry, guideSchematic, type SchematicNames, tableFacts } from '@ps/analyses/dialog'
import { sceneToSvg, schematicScene } from '@ps/graph'
import { type ColumnId, type DataTable, normalizeTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  columnTable,
  countsTable,
  groupedTable,
  makeTable,
  mvTable,
  xyReplicatesTable,
} from '../../analyses/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'

// Roadmap 51f: "What will be tested" for a few of Guide me's paths, laid out by @ps/graph and
// pinned as SVGs (`__snapshots__/schematics/`, light; one dark), so a change to the drawing or
// to a path's schematic shows as a reviewable diff.

const val = (i: number, r: number) => 10 + 3 * i + ((r * 7 + i * 3) % 5)

function column(titles: string[], n = 8): DataTable {
  const t = columnTable(titles.map((_, i) => Array.from({ length: n }, (_, r) => val(i, r))))
  t.dataSets.forEach((d, i) => {
    d.title = titles[i]!
  })
  return t
}

function grouped(): DataTable {
  const t = groupedTable(
    [0, 1, 2].map((r) => [0, 1, 2].map((c) => [0, 1, 2].map((k) => val(c, r + k)))),
    ['0 h', '2 h', '4 h'],
  )
  t.dataSets.forEach((d, i) => {
    d.title = ['WT', 'KO', 'Het'][i]!
  })
  t.factorNames = { rows: 'Time', columns: 'Genotype' }
  return t
}

function schematic(entry: string, t: DataTable, given: Record<string, string>) {
  // Data sets' ids made stable (they name the boxes in the SVG), the answers' keys with them.
  const ids = new Map(t.dataSets.map((d, i) => [d.id as string, `d${i}`]))
  t.dataSets.forEach((d, i) => {
    d.id = `d${i}` as ColumnId
  })
  const answers = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, ids.get(v) ?? v]))
  const input = normalizeTable(t)
  const facts = tableFacts(t.tableKind, input)
  const names: SchematicNames = {
    rowTitles: input[0]?.rowTitles ?? t.rowTitles ?? null,
    factors: t.factorNames ?? {},
    xTitle: t.x?.title ?? null,
  }
  return { spec: guideSchematic(guideEntry(entry)!, facts, answers, names), facts }
}

const three = column(['Vehicle', '1 mg/kg', '10 mg/kg'])
const keyOf = (t: DataTable, i: number) => t.dataSets[i]!.id as string

const CASES: Record<string, () => ReturnType<typeof schematic>> = {
  welch: () =>
    schematic('groupsDiffer', column(['Control', 'Treated']), {
      matched: 'no',
      values: 'measure',
      scatter: 'yes',
    }),
  paired: () =>
    schematic('groupsDiffer', column(['Before', 'After']), { matched: 'yes', values: 'measure' }),
  everyPair: () =>
    schematic('groupsDiffer', three, {
      matched: 'no',
      values: 'measure',
      scatter: 'no',
      comparisons: 'allPairs',
    }),
  vsControl: () =>
    schematic('groupsDiffer', three, {
      matched: 'yes',
      values: 'measure',
      comparisons: 'vsControl',
      control: keyOf(three, 0),
    }),
  trend: () => schematic('trend', three, { matched: 'no' }),
  setValue: () =>
    schematic('setValue', column(['Day 3']), { values: 'measure', hypothetical: '100' }),
  twoWayRepeated: () =>
    schematic('twoFactors', grouped(), {
      repeated: 'columns',
      comparisons: 'withinRows',
      kind: 'vsControl',
    }),
  timeCourse: () =>
    schematic('timeCourse', grouped(), {
      second: 'yes',
      comparisons: 'withinColumns',
      kind: 'allPairs',
    }),
  mainEffect: () =>
    schematic('twoFactors', grouped(), {
      repeated: 'none',
      comparisons: 'mainColumns',
      kind: 'allPairs',
    }),
  nested: () => {
    const t = makeTable(
      'nested',
      [0, 1].map((g) => [0, 1, 2].map((r) => [0, 1, 2, 3].map((s) => val(g, r + s)))),
    )
    t.dataSets[0]!.title = 'Sham'
    t.dataSets[1]!.title = 'Lesion'
    return schematic('nestedGroups', t, {})
  },
  risk: () => {
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
    return schematic('outcomeGroup', t, {
      paired: 'no',
      report: 'risk',
      exposed: 'second',
      outcome: 'first',
    })
  },
  ec50: () => {
    const x = [-9, -8, -7, -6, -5]
    const t = xyReplicatesTable(
      x,
      [[x.map((v) => -v)], [x.map((v) => -v * 2)]],
      ['Drug A', 'Drug B'],
    )
    t.x!.title = 'log[Agonist]'
    return schematic('doseResponse', t, {
      direction: 'rises',
      xScale: 'log',
      normalized: 'no',
      slope: 'variable',
      compare: 'yes',
      compareBy: 'fTest',
    })
  },
  survival: () => {
    const times = [3, 5, 8, 9, 12, 15]
    const t = makeTable(
      'survival',
      [0, 1, 2].map((g) => times.map((_, r) => [(r + g) % 3 ? 1 : 0])),
      times,
    )
    t.dataSets.forEach((d, i) => {
      d.title = ['Wild type', 'Het', 'Mutant'][i]!
    })
    return schematic('curvesDiffer', t, { ordered: 'yes', weight: 'whole', control: keyOf(t, 0) })
  },
  predict: () => {
    const t = mvTable({
      Age: [40, 50, 60],
      Dose: [0, 10, 20],
      SBP: [120, 130, 140],
      Weight: [60, 70, 80],
    })
    return schematic('predictOutcome', t, { outcomeKind: 'measurement', outcome: keyOf(t, 2) })
  },
}

describe('“What will be tested”, pinned', () => {
  it.each(Object.keys(CASES))('%s', async (name) => {
    const { spec } = CASES[name]!()
    const svg = sceneToSvg(schematicScene(spec, fonts), { ids: true, portableFonts: true })
    expect(svg).not.toContain('NaN')
    await expect(svg).toMatchFileSnapshot(`./__snapshots__/schematics/${name}.svg`)
  })

  it('in dark colours', async () => {
    const { spec } = CASES.twoWayRepeated!()
    const svg = sceneToSvg(schematicScene(spec, fonts, { theme: 'dark' }), {
      ids: true,
      portableFonts: true,
    })
    await expect(svg).toMatchFileSnapshot('./__snapshots__/schematics/twoWayRepeated-dark.svg')
  })
})
