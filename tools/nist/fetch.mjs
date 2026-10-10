#!/usr/bin/env node

// Downloads NIST Statistical Reference Datasets (StRD) and converts them to oracle fixtures.
// https://www.itl.nist.gov/div898/strd/  (US Government work, public domain)
//
//   pnpm nist
//
// Raw .dat files are cached in tools/nist/raw/ (gitignored); parsed fixtures are committed to
// packages/stats/test/fixtures/nist/<suite>/. Suites: univariate (Phase 0), linear and nonlinear
// least squares (Phase 2). ANOVA is added in the phase that needs it.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const RAW = join(HERE, 'raw')
const OUT = join(ROOT, 'packages', 'stats', 'test', 'fixtures', 'nist')
const BASE = 'https://www.itl.nist.gov/div898/strd'

const SUITES = {
  univariate: {
    path: 'univ/data',
    datasets: [
      'PiDigits',
      'Lottery',
      'Lew',
      'Mavro',
      'Michelso',
      'NumAcc1',
      'NumAcc2',
      'NumAcc3',
      'NumAcc4',
    ],
    parse: parseUnivariate,
  },
  linear: {
    path: 'lls/data/LINKS/DATA',
    datasets: [
      'Norris',
      'Pontius',
      'NoInt1',
      'NoInt2',
      'Filip',
      'Longley',
      'Wampler1',
      'Wampler2',
      'Wampler3',
      'Wampler4',
      'Wampler5',
    ],
    parse: parseLinear,
  },
  nonlinear: {
    path: 'nls/data/LINKS/DATA',
    datasets: [
      'Misra1a',
      'Chwirut2',
      'Chwirut1',
      'Lanczos3',
      'Gauss1',
      'Gauss2',
      'DanWood',
      'Misra1b',
      'Kirby2',
      'Hahn1',
      'Nelson',
      'MGH17',
      'Lanczos1',
      'Lanczos2',
      'Gauss3',
      'Misra1c',
      'Misra1d',
      'Roszman1',
      'ENSO',
      'MGH09',
      'Thurber',
      'BoxBOD',
      'Rat42',
      'MGH10',
      'Eckerle4',
      'Rat43',
      'Bennett5',
    ],
    parse: parseNonlinear,
  },
}

async function fetchRaw(suite, name) {
  const file = join(RAW, suite, `${name}.dat`)
  if (existsSync(file)) return readFile(file, 'utf8')
  const url = `${BASE}/${SUITES[suite].path}/${name}.dat`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
  return text
}

const num = (s) => {
  const v = Number(s)
  if (!Number.isFinite(v)) throw new Error(`not a number: ${s}`)
  return v
}

/** Like num, but NIST writes an infinite F statistic as 'Infinity'; JSON gets the oracle's 'Inf'. */
const numOrInf = (s) => (s === 'Infinity' ? 'Inf' : num(s))

/**
 * The data table: numeric rows after the 'Data:  y  x ...' header line (the earlier 'Data:'
 * line describes the variables). Returns the column names and the columns.
 */
function dataColumns(name, text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^Data:\s+y\b/.test(l))
  if (start < 0) throw new Error(`${name}: data section not found`)
  const names = lines[start]
    .replace(/^Data:/, '')
    .trim()
    .split(/\s+/)
  const cols = names.map(() => [])
  for (const l of lines.slice(start + 1)) {
    const t = l.trim()
    if (!t) continue
    const parts = t.split(/\s+/)
    if (parts.length !== names.length) throw new Error(`${name}: bad data row '${t}'`)
    parts.forEach((p, i) => {
      cols[i].push(num(p))
    })
  }
  return { names, cols }
}

/** The model statement: the indented lines after 'Model:' up to the next blank line. */
function modelText(text) {
  const lines = text.split(/\r?\n/)
  const i = lines.findIndex((l) => /^Model:/.test(l))
  const out = []
  for (let j = i + 2; j < lines.length; j++) {
    const t = lines[j].trim()
    if (!t) {
      if (out.length) break
      continue
    }
    out.push(t)
  }
  return out.join(' ').replace(/\s+/g, ' ')
}

function nObservations(name, text) {
  const m = text.match(/(\d+)\s+Observations/) ?? text.match(/Number of Observations:\s+(\d+)/)
  if (!m) throw new Error(`${name}: number of observations not found`)
  return num(m[1])
}

function parseLinear(name, text) {
  const { names, cols } = dataColumns(name, text)
  const n = nObservations(name, text)
  if (cols[0].length !== n) throw new Error(`${name}: expected ${n} rows, got ${cols[0].length}`)
  const coef = []
  const se = []
  for (const m of text.matchAll(/^\s+B(\d+)\s+(\S+)\s+(\S+)\s*$/gm)) {
    coef[Number(m[1])] = num(m[2])
    se[Number(m[1])] = num(m[3])
  }
  // NoInt1/2 have only B1 (no intercept): compact to the parameters present.
  const intercept = coef[0] !== undefined
  const present = intercept ? coef : coef.slice(1)
  const presentSe = intercept ? se : se.slice(1)
  const model = modelText(text)
  const anova = (label) => {
    const m = text.match(new RegExp(`^${label}\\s+(\\d+)\\s+(\\S+)\\s+(\\S+)(?:\\s+(\\S+))?`, 'm'))
    if (!m) throw new Error(`${name}: ANOVA row ${label} not found`)
    return m
  }
  const reg = anova('Regression')
  const res = anova('Residual')
  const predictors = names.slice(1)
  const input =
    predictors.length === 1 ? { y: cols[0], x: cols[1] } : { y: cols[0], xs: cols.slice(1) }
  let degree = 1
  const powers = [...model.matchAll(/x\*\*(\d+)/g)].map((m) => Number(m[1]))
  if (predictors.length === 1 && powers.length) degree = Math.max(...powers)
  return {
    name,
    input,
    params: { model, intercept, degree, predictors },
    expected: {
      n,
      coef: present,
      se: presentSe,
      residualSD: num(text.match(/Standard Deviation\s+(\S+)\s*$/m)[1]),
      r2: num(text.match(/R-Squared\s+(\S+)/)[1]),
      dfRegression: num(reg[1]),
      ssRegression: num(reg[2]),
      msRegression: num(reg[3]),
      F: numOrInf(reg[4]),
      dfResidual: num(res[1]),
      ssResidual: num(res[2]),
      msResidual: num(res[3]),
    },
    source: {
      nist: `${BASE}/${SUITES.linear.path}/${name}.dat`,
      difficulty: difficulty(text),
    },
  }
}

function parseNonlinear(name, text) {
  const { names, cols } = dataColumns(name, text)
  const n = nObservations(name, text)
  if (cols[0].length !== n) throw new Error(`${name}: expected ${n} rows, got ${cols[0].length}`)
  const start1 = []
  const start2 = []
  const value = []
  const se = []
  for (const m of text.matchAll(/^\s+b(\d+)\s+=\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/gm)) {
    const k = Number(m[1]) - 1
    start1[k] = num(m[2])
    start2[k] = num(m[3])
    value[k] = num(m[4])
    se[k] = num(m[5])
  }
  const p = Number(text.match(/(\d+) Parameters/)[1])
  if (value.length !== p || value.some((v) => v === undefined)) {
    throw new Error(`${name}: expected ${p} certified parameters`)
  }
  const cert = (label) => num(text.match(new RegExp(`${label}:\\s+(\\S+)`))[1])
  const input = { y: cols[0] }
  names.slice(1).forEach((nm, i) => {
    input[nm] = cols[i + 1]
  })
  return {
    name,
    input,
    params: { model: modelText(text), start1, start2 },
    expected: {
      n,
      params: value,
      se,
      ssResidual: cert('Residual Sum of Squares'),
      residualSD: cert('Residual Standard Deviation'),
      df: cert('Degrees of Freedom'),
    },
    source: {
      nist: `${BASE}/${SUITES.nonlinear.path}/${name}.dat`,
      difficulty: difficulty(text),
    },
  }
}

function difficulty(text) {
  // Not every file states it (e.g. Michelso).
  const m = text.match(/(Lower|Average|Higher) Level of\s+Difficulty/)
  return m ? m[1].toLowerCase() : null
}

function parseUnivariate(name, text) {
  const cert = (label) => {
    // Leading whitespace keeps 's:' from matching the header's 'Values:'.
    const m = text.match(new RegExp(`\\s${label}:\\s+(\\S+)`))
    if (!m) throw new Error(`${name}: certified value ${label} not found`)
    return num(m[1])
  }
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^Data:\s+Y/.test(l))
  if (start < 0) throw new Error(`${name}: data section not found`)
  const values = lines
    .slice(start + 1)
    .map((l) => l.trim())
    .filter((l) => l && !/^-+$/.test(l))
    .flatMap((l) => l.split(/\s+/))
    .map(num)
  const n = num(text.match(/Number of Observations:\s+(\d+)/)[1])
  if (values.length !== n) throw new Error(`${name}: expected ${n} values, parsed ${values.length}`)

  return {
    name,
    input: { values },
    params: {},
    expected: {
      n,
      mean: cert('ybar'),
      sd: cert('s'),
      autocorrelation: cert('r\\(1\\)'),
    },
    source: {
      nist: `${BASE}/${SUITES.univariate.path}/${name}.dat`,
      difficulty: difficulty(text),
    },
  }
}

for (const [suite, def] of Object.entries(SUITES)) {
  const dir = join(OUT, suite)
  await mkdir(dir, { recursive: true })
  for (const name of def.datasets) {
    const fixture = def.parse(name, await fetchRaw(suite, name))
    await writeFile(join(dir, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`)
  }
  console.log(`${suite.padEnd(20)} ${def.datasets.length} fixtures`)
}
