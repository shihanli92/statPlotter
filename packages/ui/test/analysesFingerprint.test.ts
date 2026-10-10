import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ANALYSES_VERSION, registry } from '@ps/analyses'
import type { AnalysisJob } from '@ps/engine'
import {
  type AnalysisDef,
  type AnalysisResult,
  createTable,
  type DataTable,
  normalizeTable,
  type TableKind,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { startedEngine } from '../../engine/test/helpers.ts'
import { fonts } from '../../graph/test/helpers.ts'
import type { ExampleContext } from '../src/examples/registry.ts'
import { SYNTHETIC_EXAMPLES } from '../src/examples/synthetic/index.ts'
import { type SampleKind, sampleTable } from '../src/samples.ts'

// ANALYSES_VERSION keys the result cache: results must not change unless it does (audit 2, S6).
// This test runs a fixed corpus — every analysis of every synthetic example (through the engine,
// chained ones included), and every analysis with its default parameters on the sample table and
// on degenerate tables (empty, one value, constant) of each kind it accepts — and compares a
// fingerprint of each run with the committed one (analysesFingerprint.json, beside this file),
// which holds the version it was made with. A run is keyed by a hash of what it was given (the
// analysis, its parameters, its input and context), so a changed corpus (an example edited, a
// table normalised differently) only asks for the file to be remade; the same input giving a
// different result fails unless ANALYSES_VERSION changed, and the file is not remade until it
// has. Remake it with UPDATE_ANALYSES_FINGERPRINT=1.
//
// Numbers are rounded to 10 significant digits (-0 is 0) before hashing: the oracle's rtol is
// 1e-10, so smaller differences (a sum reordered, amplified by an iterative fit) aren't result
// changes. On one V8 there is no noise at all: V8's Math functions are its own on every platform,
// so CI (Linux) and macOS agree, and Node 24.2.0 and 24.14.1 gave identical hashes even at 12
// digits. Another V8 is another matter (Node 22 differs from 24 at 12 digits in five curve fits,
// at 10 in an ill-conditioned one), so the file records the Node major it was made with (24, as
// .nvmrc and CI) and the comparison is skipped under another. Ids are counted from zero for
// each run's tables, so they are the same whatever ran before.

const ids = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../model/src/ids.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../model/src/ids.ts')>()
  const next = () => `zid${String(++ids.n).padStart(6, '0')}`
  return {
    ...real,
    newNodeId: next,
    newColumnId: next,
    newSeriesId: next,
    newAnnotationId: next,
    newLayoutItemId: next,
    newGroupId: next,
    newFolderId: next,
  }
})

const FILE = new URL('./analysesFingerprint.json', import.meta.url)
const UPDATE = process.env.UPDATE_ANALYSES_FINGERPRINT === '1'
const REMAKE =
  'UPDATE_ANALYSES_FINGERPRINT=1 pnpm vitest run packages/ui/test/analysesFingerprint.test.ts'
const DIGITS = 10
const NODE = process.versions.node.split('.')[0]!

interface Fingerprint {
  analysesVersion: string
  /** The Node major (V8) it was made with. */
  node: string
  digits: number
  /** Hash of a run's input → hash of its result and the run's name (for reading the file). */
  runs: Record<string, string>
}

/** Plain data in a fixed form: keys sorted, numbers rounded, typed arrays as arrays. */
function canonical(v: unknown): unknown {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf'
    return v === 0 ? 0 : Number(v.toPrecision(DIGITS))
  }
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>, canonical)
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    )
  }
  return v
}

const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex')
    .slice(0, 16)

/** The runs of the corpus: input hash → [result hash, name]. */
const runs = new Map<string, [string, string]>()
const clashes: string[] = []

/** ANALYSES_FINGERPRINT_DIR=<dir> writes each run's result there as hashed, to diff. */
const DUMP = process.env.ANALYSES_FINGERPRINT_DIR

function record(name: string, job: AnalysisJob, result: AnalysisResult) {
  const key = hash(job)
  const value = hash(result)
  if (DUMP) {
    mkdirSync(DUMP, { recursive: true })
    writeFileSync(`${DUMP}/${key}.json`, JSON.stringify(canonical(result), null, 1))
  }
  const seen = runs.get(key)
  if (seen && seen[0] !== value) clashes.push(`${name} and ${seen[1]}: one input, two results`)
  if (!seen) runs.set(key, [value, name])
}

/**
 * Every run hears its progress, as in the app's worker (roadmap 42): a listener changes nothing
 * (the runs without one are `analyses/test/progress.test.ts`').
 */
const progress = () => {}

function run(name: string, def: AnalysisDef<unknown>, table: DataTable) {
  const job: AnalysisJob = {
    analysisId: def.id,
    params: def.params.parse({}),
    input: normalizeTable(table),
    context: { tableKind: table.tableKind, xTitle: table.x?.title ?? null },
  }
  record(name, job, def.run(job.input, job.params as never, job.context, progress))
}

type Fill = 'empty' | 'one value' | 'constant'

/** A degenerate table, as `analyses/test/degenerate.test.ts` makes them. */
function degenerate(def: AnalysisDef<unknown>, kind: TableKind, fill: Fill): DataTable {
  const min = Math.max(def.inputs.min, 1)
  const columns = Math.min(Math.max(min, 2), def.inputs.max)
  const t = createTable({ tableKind: kind, columns, rows: 3 })
  if (t.x && fill !== 'empty') t.x.subcolumns[0]!.values = [1, 2, 3]
  for (const [i, ds] of t.dataSets.entries())
    for (const sub of ds.subcolumns) {
      if (fill === 'one value')
        sub.values = i === 0 && sub === ds.subcolumns[0] ? [1, null, null] : [null, null, null]
      else if (fill === 'constant') sub.values = [2, 2, 2]
    }
  return t
}

const context: ExampleContext = { fonts, sourceFile: async () => null }

const stored: Fingerprint | null = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, 'utf8')) as Fingerprint)
  : null

describe('analysis results fingerprint (ANALYSES_VERSION)', () => {
  // Another V8 rounds iterative fits' last digits differently: compared only under the Node the
  // file was made with (remade under another only on request).
  it.skipIf(stored !== null && stored.node !== NODE && !UPDATE)(
    'matches the committed fingerprint, or ANALYSES_VERSION changed',
    async () => {
      for (const example of SYNTHETIC_EXAMPLES) {
        ids.n = 0
        const project = await example.build(context)
        let k = 0
        const engine = await startedEngine(project, registry, async (job) => {
          const def = registry.get(job.analysisId)!
          const result = def.run(job.input, job.params, job.context, progress)
          record(`example ${example.id}: ${job.analysisId} #${++k}`, job, result)
          return result
        })
        engine.stop()
      }
      for (const def of registry.list())
        for (const kind of def.accepts) {
          ids.n = 0
          run(`${def.id} on the ${kind} sample`, def, sampleTable(kind as SampleKind, 'Data 1'))
          for (const fill of ['empty', 'one value', 'constant'] as const) {
            ids.n = 0
            run(`${def.id} on a ${kind} table: ${fill}`, def, degenerate(def, kind, fill))
          }
        }
      expect(clashes).toEqual([])
      expect(runs.size).toBeGreaterThan(500)

      const now: Fingerprint = {
        analysesVersion: ANALYSES_VERSION,
        node: NODE,
        digits: DIGITS,
        runs: Object.fromEntries(
          [...runs]
            .sort(([ka, [, a]], [kb, [, b]]) => (a < b ? -1 : a > b ? 1 : ka < kb ? -1 : 1))
            .map(([k, [v, name]]) => [k, `${v} ${name}`]),
        ),
      }
      const was = stored
      const result = (s: string | undefined) => s?.slice(0, 16)
      // Hashes made with other rounding or another V8 can't be compared.
      const comparable = was !== null && was.digits === DIGITS && was.node === NODE
      const changed = comparable
        ? Object.keys(now.runs).filter(
            (k) => k in was.runs && result(was.runs[k]) !== result(now.runs[k]),
          )
        : []
      const names = changed.map((k) => now.runs[k]!.slice(17))
      // The same inputs give other results: only with a new version (and not remade before).
      if (changed.length && was!.analysesVersion === ANALYSES_VERSION)
        expect.fail(
          `${changed.length} analysis runs give results other than before (${names.slice(0, 10).join('; ')}${changed.length > 10 ? '; …' : ''}). Results changed, so the result cache must be renewed: bump ANALYSES_VERSION (packages/analyses/src/index.ts), then remake the fingerprint: ${REMAKE}`,
        )
      if (UPDATE) {
        writeFileSync(FILE, `${JSON.stringify(now, null, 2)}\n`)
        return
      }
      expect(was, `no fingerprint yet: ${REMAKE}`).not.toBeNull()
      expect(
        was!.analysesVersion,
        `ANALYSES_VERSION changed: remake the fingerprint: ${REMAKE}`,
      ).toBe(ANALYSES_VERSION)
      expect(was!.digits, `the rounding changed: remake the fingerprint: ${REMAKE}`).toBe(DIGITS)
      const added = Object.keys(now.runs).filter((k) => !(k in was!.runs))
      const removed = Object.keys(was!.runs).filter((k) => !(k in now.runs))
      expect(
        { added: added.map((k) => now.runs[k]), removed: removed.map((k) => was!.runs[k]) },
        `the corpus changed (an example, a sample table, how a table is normalised): remake the fingerprint: ${REMAKE}`,
      ).toEqual({ added: [], removed: [] })
    },
    300_000,
  )
})
