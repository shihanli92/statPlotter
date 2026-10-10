import { createTable, type DataTable, type TableKind } from '@ps/model'
import { round } from './examples/synthetic/builder.ts'

/** Table kinds with a built-in example. */
export type SampleKind = Extract<
  TableKind,
  | 'column'
  | 'xy'
  | 'grouped'
  | 'contingency'
  | 'survival'
  | 'multipleVariables'
  | 'nested'
  | 'partsOfWhole'
>

const SAMPLE_ROWS: Record<SampleKind, number> = {
  column: 8,
  xy: 11,
  grouped: 3,
  contingency: 2,
  survival: 24,
  multipleVariables: 40,
  nested: 4,
  partsOfWhole: 5,
}

/** Park–Miller's minimal standard generator: uniform on (0, 1), the same sequence for a seed. */
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

/** Example for an unpaired t test. Made up for demonstration. */
const COLUMN_SAMPLE = {
  titles: ['Control', 'Treated'],
  values: [
    [34.1, 38.5, 29.8, 41.2, 35.6, 32.3, 36.9, 30.4],
    [45.2, 52.8, 48.1, 39.7, 50.3, 47.6, 44.9, 51.5],
  ],
}

/**
 * Example dose-response data (log molar concentration vs. response, triplicates), simulated from
 * four-parameter logistic curves with deterministic noise. Made up for demonstration.
 */
function xySample(table: DataTable) {
  const xs = Array.from({ length: 11 }, (_, i) => -9 + i * 0.5)
  const u = lcg(7)
  const noise = () => (u() - 0.5) * 8
  const curve = (x: number, logEC50: number, top: number) =>
    4 + (top - 4) / (1 + 10 ** ((logEC50 - x) * 1.1))
  table.x!.title = 'log[Agonist], M'
  table.x!.subcolumns[0]!.values = xs
  const sets = [
    { title: 'Agonist alone', logEC50: -7.2, top: 100 },
    { title: '+ Antagonist', logEC50: -6.1, top: 97 },
  ]
  sets.forEach((s, i) => {
    const ds = table.dataSets[i]!
    ds.title = s.title
    ds.subcolumns.forEach((sub) => {
      sub.values = xs.map((x) => round(curve(x, s.logEC50, s.top) + noise()))
    })
  })
}

/**
 * Example two-way design: genotype (rows) × treatment (columns), 4 replicates, with a
 * treatment effect that is larger in knockouts (an interaction). Made up for demonstration.
 */
function groupedSample(table: DataTable) {
  table.rowTitles = ['Wild type', 'Knockout', 'Heterozygous']
  const means = [
    [42, 47],
    [44, 68],
    [43, 55],
  ]
  const u = lcg(11)
  const noise = () => (u() - 0.5) * 10
  ;['Vehicle', 'Drug'].forEach((title, c) => {
    const ds = table.dataSets[c]!
    ds.title = title
    ds.subcolumns.forEach((sub) => {
      sub.values = means.map((m) => round(m[c]! + noise()))
    })
  })
}

/** Example 2×2 table: outcome by treatment. Made up for demonstration. */
function contingencySample(table: DataTable) {
  table.rowTitles = ['Treated', 'Placebo']
  const counts = [
    [15, 85],
    [30, 70],
  ]
  ;['Progressed', 'No progression'].forEach((title, c) => {
    const ds = table.dataSets[c]!
    ds.title = title
    ds.subcolumns[0]!.values = counts.map((r) => r[c]!)
  })
}

/**
 * Example survival study: 12 subjects per group, days to death (1) or to the end of follow-up /
 * loss (0), each subject on its own row. Made up for demonstration.
 */
function survivalSample(table: DataTable) {
  const groups = [
    {
      title: 'Control',
      days: [12, 19, 25, 31, 38, 38, 44, 52, 60, 67, 75, 90],
      codes: [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0],
    },
    {
      title: 'Treated',
      days: [21, 35, 48, 55, 62, 70, 78, 84, 90, 90, 90, 90],
      codes: [1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0],
    },
  ]
  const x: (number | null)[] = []
  groups.forEach((g, c) => {
    const ds = table.dataSets[c]!
    ds.title = g.title
    const values: (number | null)[] = Array.from({ length: table.rowCount }, () => null)
    g.days.forEach((d, i) => {
      values[x.length] = g.codes[i]!
      x.push(d)
    })
    ds.subcolumns[0]!.values = values
  })
  table.x!.subcolumns[0]!.values = x
}

/**
 * Example cohort: 40 patients with age, BMI and dose, a continuous outcome (systolic BP), a
 * binary response, and follow-up days with death (1) or censoring (0). Simulated with a fixed
 * seed; made up for demonstration.
 */
function multipleVariablesSample(table: DataTable) {
  const u = lcg(23)
  const cols: Record<string, number[]> = {
    Age: [],
    BMI: [],
    Dose: [],
    SBP: [],
    Responder: [],
    Days: [],
    Died: [],
  }
  for (let i = 0; i < table.rowCount; i++) {
    const age = round(40 + 35 * u(), 0)
    const bmi = round(20 + 15 * u())
    const dose = [0, 10, 20, 40][i % 4]!
    cols.Age!.push(age)
    cols.BMI!.push(bmi)
    cols.Dose!.push(dose)
    cols.SBP!.push(round(70 + 0.6 * age + 1.2 * bmi - 0.3 * dose + 16 * (u() - 0.5)))
    const logit = -4 + 0.05 * age + 0.06 * dose
    cols.Responder!.push(u() < 1 / (1 + Math.exp(-logit)) ? 1 : 0)
    const hazard = 0.004 * Math.exp(0.04 * (age - 55) - 0.03 * dose)
    const days = round(-Math.log(1 - u()) / hazard, 0)
    cols.Days!.push(Math.min(days, 365))
    cols.Died!.push(days < 365 && u() > 0.15 ? 1 : 0)
  }
  Object.entries(cols).forEach(([title, values], c) => {
    const ds = table.dataSets[c]!
    ds.title = title
    ds.subcolumns[0]!.values = values
  })
}

/**
 * Example nested study: two groups of three mice, four measurements (e.g. cells imaged) per
 * mouse. Mice differ from each other more than measurements within a mouse, as nested designs
 * assume. Made up for demonstration.
 */
function nestedSample(table: DataTable) {
  const u = lcg(31)
  const noise = () => u() - 0.5
  const groups = [
    { title: 'Control', mean: 20, mice: ['Mouse 1', 'Mouse 2', 'Mouse 3'] },
    { title: 'Treated', mean: 26, mice: ['Mouse 4', 'Mouse 5', 'Mouse 6'] },
  ]
  groups.forEach((g, c) => {
    const ds = table.dataSets[c]!
    ds.title = g.title
    ds.subcolumnTitles = [...g.mice]
    ds.subcolumns.forEach((sub) => {
      const mouse = g.mean + 6 * noise()
      sub.values = sub.values.map(() => round(mouse + 3 * noise()))
    })
  })
}

/**
 * Example parts of whole: cell types (rows) counted in two tissues by flow cytometry. Made up for
 * demonstration.
 */
function partsOfWholeSample(table: DataTable) {
  table.rowTitles = ['T cells', 'B cells', 'NK cells', 'Monocytes', 'Other']
  const sets = [
    { title: 'Blood', values: [412, 128, 64, 236, 60] },
    { title: 'Spleen', values: [355, 402, 41, 88, 114] },
  ]
  sets.forEach((s, i) => {
    const ds = table.dataSets[i]!
    ds.title = s.title
    ds.subcolumns[0]!.values = [...s.values]
  })
}

/** A new table of this kind filled with its example data (all made up for demonstration). */
export function sampleTable(kind: SampleKind, name: string): DataTable {
  const table = createTable({
    name,
    tableKind: kind,
    yFormat: {
      type: 'replicates',
      count: kind === 'xy' || kind === 'nested' ? 3 : kind === 'grouped' ? 4 : 1,
    },
    columns: kind === 'multipleVariables' ? 7 : 2,
    rows: SAMPLE_ROWS[kind],
  })
  switch (kind) {
    case 'column':
      table.dataSets.forEach((ds, i) => {
        ds.title = COLUMN_SAMPLE.titles[i]!
        ds.subcolumns[0]!.values = [...COLUMN_SAMPLE.values[i]!]
      })
      break
    case 'xy':
      xySample(table)
      break
    case 'grouped':
      groupedSample(table)
      break
    case 'contingency':
      contingencySample(table)
      break
    case 'survival':
      survivalSample(table)
      break
    case 'nested':
      nestedSample(table)
      break
    case 'multipleVariables':
      multipleVariablesSample(table)
      break
    case 'partsOfWhole':
      partsOfWholeSample(table)
      break
  }
  return table
}
