import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { registry, SKETCHES } from '@ps/analyses'
import { GRAPH_PRESETS, layoutGraph, sketchGraph } from '@ps/graph'
import {
  createTable,
  type DataTable,
  normalizeTable,
  type SketchSpec,
  type TableKind,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { growthRatio } from '../../stats/test/timing.ts'

// Roadmap 51b (design §5): the live sketch of every analysis that has one, on a fixture table of
// each kind it accepts, with each option on its own: its presets exist, its graphs lay out, and
// nothing in it is a result (no P, CI, r, fitted value or verdict).

/** Words a sketch must never show (§5.8). */
const RESULT_WORDS =
  /\bP\s*[=<>]|\bP value|significan|confidence interval|\bCI\b|\bEC50\b|\bIC50\b|\br\s*=|R²|R squared|preferred model|\bslope\s*=|\bt\s*=|\bF\s*=/i

function fixture(kind: TableKind, columns: number): DataTable {
  const rows = 8
  const t = createTable({
    tableKind: kind,
    columns,
    rows,
    yFormat: { type: 'replicates', count: kind === 'grouped' || kind === 'nested' ? 3 : 1 },
  })
  if (t.x)
    t.x.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) =>
      kind === 'survival' ? 3 + r * 2 : 2 ** r,
    )
  t.dataSets.forEach((ds, c) => {
    ds.title = ['Control', 'Treated', 'High dose', 'Late'][c] ?? `Group ${c}`
    ds.subcolumns.forEach((sub, s) => {
      sub.values = Array.from({ length: rows }, (_, r) => {
        if (kind === 'survival') return (r + c) % 3 === 0 ? 0 : 1
        if (kind === 'contingency') return 3 + ((r * 7 + c * 5) % 11)
        if (kind === 'multipleVariables')
          return c === 0 ? 10 + r * 1.5 + (r % 3) : (r * (c + 2)) % 7
        return 10 + c * 2 + ((r * 5 + s * 3 + c) % 7) * 0.8
      })
    })
  })
  return t
}

/** Each option of the form on its own, and the defaults. */
function variants(id: string): Record<string, unknown>[] {
  const def = registry.get(id)!
  const out: Record<string, unknown>[] = [{}]
  for (const f of def.form)
    if ('options' in f && f.path.length === 1)
      for (const o of f.options) out.push({ [f.path[0]!]: o.value })
  return out
}

const texts = (s: SketchSpec) => [
  s.caption,
  s.description,
  s.counts,
  ...(s.notes ?? []),
  ...s.panels.flatMap((p) => [p.title ?? '', ...(p.brackets ?? []).map((b) => b.label)]),
]

describe('the live sketch (design §5)', () => {
  const ids = Object.keys(SKETCHES)
  it.each(ids)('%s draws data and structure only', (id) => {
    const def = registry.get(id)!
    expect(def.sketch, 'attached').toBeTypeOf('function')
    for (const kind of def.accepts) {
      const columns = Math.min(
        Math.max(def.inputs.min, kind === 'contingency' ? 2 : 3),
        def.inputs.max,
      )
      const input = normalizeTable(fixture(kind, columns))
      for (const raw of variants(id)) {
        const parsed = def.params.safeParse(raw)
        if (!parsed.success) continue
        const spec = def.sketch!(input, parsed.data, { tableKind: kind, xTitle: 'X' })
        if (!spec) continue
        for (const t of texts(spec))
          expect(t, `${kind} ${JSON.stringify(raw)}: ${t}`).not.toMatch(RESULT_WORDS)
        expect(spec.description.length).toBeGreaterThan(10)
        for (const panel of spec.panels) {
          expect(
            GRAPH_PRESETS.some((p) => p.id === panel.preset),
            panel.preset,
          ).toBe(true)
          const { project, graph } = sketchGraph(panel)
          const scene = layoutGraph({ project, graph, fonts })
          expect(scene.width).toBeGreaterThan(0)
        }
      }
    }
  })

  const column = (values: (number | null)[][]) => {
    const t = fixture('column', values.length)
    t.rowCount = Math.max(...values.map((v) => v.length))
    t.dataSets.forEach((d, i) => {
      d.subcolumns[0]!.values = Array.from({ length: t.rowCount }, (_, r) => values[i]![r] ?? null)
    })
    return normalizeTable(t)
  }
  const sketch = (
    id: string,
    input: ReturnType<typeof column>,
    params: Record<string, unknown> = {},
  ) => {
    const def = registry.get(id)!
    return def.sketch!(input, def.params.parse(params), { tableKind: 'column', xTitle: null })!
  }

  it('pairs: lines join a subject’s values and the differences B − A are drawn', () => {
    const input = column([
      [1, 2, 3, 4],
      [2, 4, 3, null],
    ])
    const unpaired = sketch('ttest', input)
    expect(unpaired.panels.map((p) => p.preset)).toEqual(['points'])
    expect(unpaired.panels[0]!.brackets).toEqual([
      { a: input[0]!.ref.key, b: input[1]!.ref.key, label: 'Treated − Control' },
    ])
    const paired = sketch('ttest', input, { design: 'paired' })
    expect(paired.panels.map((p) => p.preset)).toEqual(['beforeAfter', 'pointsMean'])
    const diff = paired.panels[1]!.table.dataSets[0]!.subcolumns[0]!.values
    expect(diff.slice(0, 3)).toEqual([1, 2, 0])
    expect(paired.notes).toContain('1 row without a pair is left out.')
    expect(paired.counts).toMatch(/^3 pairs · matched/)
  })

  it('Welch keeps each group’s SD; Student draws the pooled SD', () => {
    const input = column([
      [1, 2, 3, 4],
      [2, 6, 10, 14],
    ])
    const welch = sketch('ttest', input)
    const student = sketch('ttest', input, { unpaired: { assumeEqualSD: true } })
    expect(welch.caption).toMatch(/own scatter/)
    expect(student.caption).toMatch(/pooled SD/)
    const sds = student.panels[0]!.table.dataSets.map((d) => d.subcolumns[1]!.values[0])
    expect(sds[0]).toBeCloseTo(sds[1]!, 12)
    expect(welch.notes?.[0]).toMatch(/^“Treated”’s SD is 4 × “Control”’s/)
  })

  it('rank tests draw ranks', () => {
    const input = column([
      [10, 30, 20],
      [25, 50, 40],
    ])
    const mw = sketch('mannWhitney', input)
    expect(
      mw.panels[0]!.table.dataSets.map((d) => d.subcolumns[0]!.values.filter((v) => v !== null)),
    ).toEqual([
      [1, 4, 2],
      [3, 6, 5],
    ])
    const kw = sketch(
      'oneWayAnova',
      column([
        [1, 2],
        [5, 6],
        [3, 4],
      ]),
      { gaussian: false },
    )
    expect(kw.panels[0]!.title).toMatch(/Ranks/)
  })

  it('comparisons change the brackets: every pair, or each with the control', () => {
    const input = column([
      [1, 2],
      [5, 6],
      [3, 4],
    ])
    expect(sketch('oneWayAnova', input).panels[0]!.brackets).toHaveLength(3)
    const vs = sketch('oneWayAnova', input, {
      comparisons: 'vsControl',
      control: input[2]!.ref.key,
    })
    expect(vs.panels[0]!.brackets?.map((b) => b.label)).toEqual([
      'Control − High dose',
      'Treated − High dose',
    ])
    expect(vs.panels[0]!.highlight).toEqual([input[2]!.ref.key])
    expect(
      sketch('oneWayAnova', input, { comparisons: 'none' }).panels[0]!.brackets,
    ).toBeUndefined()
  })

  it('samples large tables by rows', () => {
    const big = Array.from({ length: 5000 }, (_, i) => i % 97)
    const s = sketch('ttest', column([big, big]))
    // Every third row: at most 2,000.
    expect(s.sampled).toEqual({ shown: 1667, total: 5000 })
  })

  it('builds in time linear in the rows (CPU time at two sizes)', () => {
    const run = (n: number) => {
      const v = Array.from({ length: n }, (_, i) => (i * 37) % 101)
      const input = column([v, v.map((x) => x + 1), v.map((x) => x * 2)])
      for (let k = 0; k < 5; k++)
        sketch('oneWayAnova', input, { matched: true, gaussian: k % 2 === 0 })
    }
    // Rows below the sample's size: linear work gives about 4.
    expect(growthRatio(run, 300)).toBeLessThan(10)
  })

  it('never imports a test or run (the import boundary of sketch/)', () => {
    const dir = new URL('../../analyses/src/sketch/', import.meta.url).pathname
    const allowedStats = new Set(['mean', 'sd', 'midranks'])
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/import \{([^}]*)\} from '@ps\/stats'/g))
        for (const name of m[1]!
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean))
          expect(allowedStats.has(name), `${f}: ${name}`).toBe(true)
      for (const m of src.matchAll(/from '(\.\.\/[^']+)'/g))
        expect(['../nonlinear.ts'], `${f}: ${m[1]}`).toContain(m[1])
      for (const m of src.matchAll(/import \{([^}]*)\} from '\.\.\/nonlinear\.ts'/g))
        expect(m[1]!.trim(), f).toBe('resolveEquation')
      expect(src, f).not.toMatch(/\.run\(/)
    }
  })
})
