import { type FontRegistry, presetGraph } from '@ps/graph'
import {
  createTable,
  type DataTable,
  extractVariables,
  type GraphNode,
  type Project,
} from '@ps/model'
import { ExampleBuilder, rng, round, title, withLayer } from './builder.ts'

type Column = (number | null)[] | (string | null)[] | { formula: string }

/**
 * A multiple-variables table: numeric columns from numbers, text (categorical) variables from
 * strings, calculated variables from `{ formula }`.
 */
function variablesTable(
  name: string,
  cols: Record<string, Column>,
  rowTitles: string[] | null,
  notes: string,
): DataTable {
  const titles = Object.keys(cols)
  const rows = Math.max(...titles.map((t) => (Array.isArray(cols[t]) ? cols[t].length : 0)))
  const table = createTable({ name, tableKind: 'multipleVariables', columns: titles.length, rows })
  table.rowTitles = rowTitles ? [...rowTitles] : null
  titles.forEach((t, i) => {
    const ds = table.dataSets[i]!
    ds.title = t
    const c = cols[t]!
    if (!Array.isArray(c)) ds.formula = c.formula
    else if (c.some((v) => typeof v === 'string')) ds.text = c as (string | null)[]
    else ds.subcolumns[0]!.values = c as (number | null)[]
  })
  table.notes = notes
  return table
}

/**
 * Multiple variables: text (categorical) variables, calculated variables (BMI, change from
 * baseline, a flag from IF), a bubble plot coloured by a text variable, and a variable extracted
 * by category into a column table for a one-way ANOVA. All data are simulated (fixed seed).
 */
export function createVariablesExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Multiple variables', fonts)
  const r = rng(1919)

  const n = 36
  const arms = ['Placebo', 'Low dose', 'High dose']
  const drop = [0, 6, 12]
  const group: string[] = []
  const sex: (string | null)[] = []
  const age: number[] = []
  const weight: number[] = []
  const height: number[] = []
  const before: number[] = []
  const after: (number | null)[] = []
  for (let i = 0; i < n; i++) {
    const arm = i % 3
    const male = r.uniform() < 0.5
    group.push(arms[arm]!)
    sex.push(male ? 'M' : 'F')
    age.push(Math.round(40 + 30 * r.uniform()))
    const h = round(r.normal(male ? 1.77 : 1.64, 0.07), 2)
    height.push(h)
    weight.push(round(r.normal(26.5, 4) * h * h, 1))
    const sbp = Math.round(r.normal(148, 12))
    before.push(sbp)
    after.push(Math.round(sbp - drop[arm]! + r.normal(0, 7)))
  }
  // Two follow-up visits were missed: their change stays empty.
  after[7] = null
  after[20] = null
  const patients = Array.from({ length: n }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)

  const trial = b.table(
    variablesTable(
      'Blood pressure trial',
      {
        Group: group,
        Sex: sex,
        Age: age,
        'Weight (kg)': weight,
        'Height (m)': height,
        BMI: { formula: '=[Weight (kg)] / [Height (m)]^2' },
        'SBP before': before,
        'SBP after': after,
        Change: { formula: '=[SBP after] - [SBP before]' },
        Obese: { formula: '=IF(BMI >= 30, 1, 0)' },
        Treated: { formula: '=Group <> "Placebo"' },
      },
      patients,
      [
        '36 simulated patients in three arms of a blood-pressure trial.',
        'Group and Sex are text (categorical) variables: they hold words, shown left-aligned and marked “abc” in the header.',
        'BMI, Change, Obese and Treated are calculated variables (ƒx): select one to see its formula in the bar above the grid. They update as soon as a value they use changes; try editing a weight, or a follow-up blood pressure.',
        'Two follow-up visits were missed, so their Change is empty.',
        'The bubble plot is coloured by Group (a text variable: one colour per category). “Change by group” was made with Extract and rearrange (Change split by the categories of Group) and is analyzed by a one-way ANOVA; the multiple regression uses the calculated BMI and Treated as predictors.',
      ].join(' '),
    ),
  )
  const k = (t: string) => b.key(trial, t)

  b.add({
    ...presetGraph(trial, 'bubble', 'Age, BMI and weight (bubble plot)'),
    title: title('Coloured by a text variable'),
  })
  b.edit(
    Object.values(b.project.nodes).find(
      (x): x is GraphNode => x.kind === 'graph' && x.look === 'bubble.scatter',
    )!,
    (g) => ({
      ...withLayer(g, 'bubbles', (l) => ({
        ...l,
        aes: { ...l.aes, x: k('Age'), y: k('BMI'), size: k('Weight (kg)') },
      })),
      scales: { ...g.scales, size: { ...g.scales?.size, max: 22 } },
      axes: {
        x: g.axes.x.type === 'continuous' ? { ...g.axes.x, title: title('Age (years)') } : g.axes.x,
        y:
          g.axes.y.type === 'continuous'
            ? { ...g.axes.y, title: title('BMI (kg/m^{2})') }
            : g.axes.y,
      },
    }),
  )

  // Change by group: extracted into a column table, compared by one-way ANOVA.
  const extracted = extractVariables(trial, {
    values: [k('Change')],
    groupBy: k('Group'),
    name: 'Change by group',
  }).table
  extracted.notes =
    'Made from “Blood pressure trial” with Extract and rearrange: the calculated Change (mmHg) split by the categories of Group. A copy: it does not follow edits to the trial table.'
  const change = b.table(extracted)
  const bars = b.graph(change, {
    preset: 'barsPoints',
    yTitle: 'Change in SBP (mmHg)',
    size: { plotWidth: 150 },
  })
  const anova = b.analyze(
    change,
    'oneWayAnova',
    { comparisons: 'allPairs', allPairsMethod: 'tukey' },
    { name: 'One-way ANOVA of change' },
  )
  b.brackets(bars, anova, { show: 'stars' })

  b.analyze(
    trial,
    'multipleRegression',
    { y: k('SBP after') },
    {
      name: 'Multiple regression (SBP after)',
      keys: ['SBP after', 'SBP before', 'BMI', 'Treated'].map(k),
    },
  )
  return b.project
}
