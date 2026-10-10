import { appendFileSync } from 'node:fs'
import { registry } from '@ps/analyses'
import { DocumentStore } from '@ps/engine'
import {
  cloudHit,
  hitTest,
  layoutGraph,
  type PointsPrim,
  pointsAsImages,
  pointsImagePrim,
  presetGraph,
  type SceneNode,
  sceneToPdf,
  sceneToSvg,
} from '@ps/graph'
import {
  CsvColumnReader,
  columnsToTable,
  importFile,
  packProject,
  readProjectFile,
  sheetToTable,
  writeProjectFile,
} from '@ps/io'
import {
  createProject,
  type DataSetKey,
  type DataTable,
  DocNode,
  type GraphNode,
  gridColumns,
  type Layer,
  type NodeId,
  normalizeTable,
} from '@ps/model'
import { describe, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { syntheticCsv, syntheticTable } from '../../model/test/synthetic.ts'
import { findMatches } from '../src/table/find.ts'
import { sortOrder } from '../src/table/reorder.ts'

// The large-table profile (roadmap 34e): every step from CSV import to export on a synthetic
// single-cell table. Not a test: run by hand with the size in PROFILE_ROWS (e.g. 100000 or
// 1000000), optionally PROFILE_STEPS (comma-separated name prefixes to run), PROFILE_GENES and
// PROFILE_OUT (a file the timings are appended to as JSON lines):
//   PROFILE_ROWS=100000 pnpm vitest run --project @ps/ui largeTables.profile
// Wall-clock milliseconds on whatever machine runs it: for comparing steps and sizes, never as
// test bounds (the CPU-growth guards in the tests are those). The old whole-text import
// (`import: readCsv`) needs the CSV as one string: at a million rows it fails (string length).

const ROWS = Number(process.env.PROFILE_ROWS ?? 0)
const GENES = Number(process.env.PROFILE_GENES ?? 20)
const ONLY = process.env.PROFILE_STEPS?.split(',')
const OUT = process.env.PROFILE_OUT

const heapMb = () => Math.round(process.memoryUsage().heapUsed / 2 ** 20)

function cloudOf(n: SceneNode): (SceneNode & { prim: PointsPrim }) | null {
  if (n.prim?.type === 'points') return n as SceneNode & { prim: PointsPrim }
  for (const c of n.children ?? []) {
    const hit = cloudOf(c)
    if (hit) return hit
  }
  return null
}

describe.skipIf(!ROWS)('large-table profile', () => {
  it(`profiles ${ROWS} rows`, { timeout: 3_600_000 }, async () => {
    const rows: { step: string; ms: number; heap: number; note?: string }[] = []
    const step = async <T>(name: string, f: () => T | Promise<T>, note?: string) => {
      if (ONLY && !ONLY.some((o) => name.startsWith(o))) return undefined
      const t0 = performance.now()
      try {
        const v = await f()
        rows.push({ step: name, ms: Math.round(performance.now() - t0), heap: heapMb(), note })
        return v
      } catch (e) {
        rows.push({ step: name, ms: -1, heap: heapMb(), note: `failed: ${String(e).slice(0, 80)}` })
        return undefined
      }
    }
    const opts = { rows: ROWS, genes: GENES }

    // --- Import --------------------------------------------------------------------------------
    let table: DataTable | undefined
    await step('import: readCsv + sheetToTable (whole text)', () => {
      const bytes = new TextEncoder().encode([...syntheticCsv(opts)].join(''))
      const file = importFile('cells.csv', bytes)
      if (file.kind !== 'sheets') throw new Error('no sheet')
      sheetToTable(file.sheets[0]!, {
        tableKind: 'multipleVariables',
        headerRow: true,
        firstColumn: 'data',
        name: 'cells',
      })
    })
    await step('import: CSV columns, streamed (34e)', () => {
      const reader = new CsvColumnReader({ delimiter: ',', decimal: '.' })
      for (const chunk of syntheticCsv(opts, 20_000)) reader.push(chunk)
      table = columnsToTable(reader.end(), {
        name: 'cells',
        headerRow: true,
        firstColumn: 'data',
      }).table
    })
    table ??= syntheticTable(opts)
    const t = table
    t.id = 't1' as NodeId
    await step('validate: zod DocNode.parse(table)', () => DocNode.parse(t))

    // --- Store ---------------------------------------------------------------------------------
    const store = new DocumentStore(createProject('P', new Date('2026-01-01T00:00:00Z')))
    await step('store: add table', () => store.dispatch({ type: 'node.add', node: t }))
    const byTitle = (title: string) => t.dataSets.find((d) => d.title === title)!.id
    const numKey = byTitle('GENE1')
    await step('store: edit one cell', () =>
      store.dispatch({
        type: 'table.setCells',
        table: t.id,
        edits: [{ col: numKey, sub: 0, row: 5, value: 42 }],
      }),
    )
    await step('store: undo', () => store.undo())
    await step('store: redo', () => store.redo())
    await step('store: rename table', () =>
      store.dispatch({ type: 'node.rename', id: t.id, name: 'cells 2' }),
    )
    await step('store: delete 3 rows (+ undo)', () => {
      store.dispatch({ type: 'table.deleteRows', table: t.id, rows: [1, 2, 3] })
      store.undo()
    })
    const cur = () => store.getState().nodes[t.id] as DataTable

    // --- Grid ----------------------------------------------------------------------------------
    const cols = gridColumns(cur())
    await step('grid: find a word', () =>
      findMatches(cur(), cols, 'C1', { matchCase: false, wholeCell: true }),
    )
    await step('grid: find a number', () =>
      findMatches(cur(), cols, '0.5', { matchCase: false, wholeCell: false }),
    )
    await step('grid: sort by a text variable', () =>
      sortOrder(cur(), [
        { col: cols.find((c) => c.kind === 'data' && c.ds.title === 'cell')!, descending: false },
      ]),
    )

    // --- Derived data and analyses -------------------------------------------------------------
    await step('derived: normalize table', () => normalizeTable(cur()))
    const run = (id: string, params: object, keys: DataSetKey[]) => {
      const def = registry.get(id)!
      const inputs = normalizeTable(cur()).filter((d) => keys.includes(d.ref.key as DataSetKey))
      return def.run(inputs, def.params.parse(params))
    }
    const numeric = cur()
      .dataSets.filter((d) => !d.text)
      .map((d) => d.id as DataSetKey)
    await step('analysis: descriptive (all numeric)', () => run('descriptive', {}, numeric))
    await step('analysis: correlation (10 vars)', () =>
      run('correlation', {}, numeric.slice(0, 10)),
    )
    await step('analysis: PCA grouped by cluster, 12 vars (Kaiser)', () =>
      run('pca', { groupBy: byTitle('cluster'), select: 'kaiser' }, [
        ...numeric.slice(1, 13),
        byTitle('cluster') as DataSetKey,
      ]),
    )
    await step('analysis: PCA grouped, parallel analysis (1000 simulations)', () =>
      run('pca', { groupBy: byTitle('cluster') }, [
        ...numeric.slice(1, 13),
        byTitle('cluster') as DataSetKey,
      ]),
    )

    // --- Graph ---------------------------------------------------------------------------------
    const g0 = presetGraph(cur(), 'bubble')
    const graph: GraphNode = {
      ...g0,
      id: 'g1' as NodeId,
      layers: g0.layers.map((l) =>
        l.aes
          ? ({
              ...l,
              aes: { x: byTitle('UMAP_1'), y: byTitle('UMAP_2'), color: byTitle('cluster') },
            } as Layer)
          : l,
      ),
    }
    await step('store: add graph', () => store.dispatch({ type: 'node.add', node: graph }))
    const project = () => store.getState()
    const scene = await step('graph: layout (UMAP by cluster)', () =>
      layoutGraph({ project: project(), graph, fonts }),
    )
    if (scene) {
      const cloud = cloudOf(scene.root)
      if (cloud) {
        await step('screen: points image at 2 px/pt', () =>
          pointsImagePrim(cloud.prim, 2, { level: 1 }),
        )
        await step('hover: first point (builds the grid)', () =>
          cloudHit(cloud.prim, cloud.prim.x[7]!, cloud.prim.y[7]!),
        )
        await step('hover: 1000 more points', () => {
          for (let k = 0; k < 1000; k++) cloudHit(cloud.prim, cloud.prim.x[k]!, cloud.prim.y[k]!)
        })
      }
      await step('hover: hitTest (scene walk)', () =>
        hitTest(scene.root, scene.plot.x + 100, scene.plot.y + 80),
      )
      await step('export: SVG (vector)', () => sceneToSvg(scene).length)
      await step(
        'export: SVG, points as image (300 dpi)',
        () => sceneToSvg(pointsAsImages(scene, 300 / 72)).length,
      )
      await step('export: PDF (vector)', () => sceneToPdf(scene, fonts).length)
    }
    await step('edit cell + relayout', () => {
      store.dispatch({
        type: 'table.setCells',
        table: t.id,
        edits: [{ col: byTitle('UMAP_1'), sub: 0, row: 7, value: 1.5 }],
      })
      return layoutGraph({ project: project(), graph, fonts })
    })

    // --- Files ---------------------------------------------------------------------------------
    await step('recovery: pack columns (main thread)', () => packProject(project()))
    const bytes = await step('file: write project', () => writeProjectFile(project()))
    if (bytes) {
      rows.at(-1)!.note = `${Math.round(bytes.length / 2 ** 20)} MB`
      await step('file: read project', () => readProjectFile(bytes))
    }

    const lines = rows.map((r) => `| ${r.step} | ${r.ms} | ${r.heap} | ${r.note ?? ''} |`)
    console.log(
      [
        `\n${ROWS} rows × ${t.dataSets.length} columns`,
        '| step | ms | heap MB | note |',
        ...lines,
      ].join('\n'),
    )
    if (OUT)
      appendFileSync(
        OUT,
        `${JSON.stringify({ rows: ROWS, cols: t.dataSets.length, steps: rows })}\n`,
      )
  })
})
