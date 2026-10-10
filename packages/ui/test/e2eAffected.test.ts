import { describe, expect, it } from 'vitest'

// Audit 3 (T3): tools/e2e-affected.mjs maps a branch's changed paths to the end-to-end specs they
// can affect. A spec the map leaves out of a path's list is never run on a branch changing it.

interface AffectedTool {
  affectedSpecs(paths: string[]): { specs: string[] | 'all'; reasons: string[] }
}
const root = new URL('../../../', import.meta.url)
const tool = (): Promise<AffectedTool> =>
  import(new URL('tools/e2e-affected.mjs', root).href as string) as Promise<AffectedTool>

const specsOf = async (path: string) => {
  const { specs } = (await tool()).affectedSpecs([path])
  if (specs === 'all') throw new Error(`${path} runs every spec`)
  return specs
}

describe('e2e-affected', () => {
  it('runs every spec drawing a graph, or its format controls, for the graph package', async () => {
    const drawn = [
      'selection',
      'formatPanel',
      'formatBar',
      'richText',
      'fontControls',
      'layoutObjects',
      'accessibility',
      'darkMode',
      'toolbar',
      'navigatorSelection',
      'gettingStarted',
      'legendEditing',
      'layerSelection',
    ]
    for (const path of [
      'packages/graph/src/layout/compose.ts',
      'packages/graph/src/layers/matrix.ts',
      'packages/graph/src/text/measure.ts',
      'packages/graph/src/presets.ts',
    ]) {
      expect(await specsOf(path), path).toEqual(expect.arrayContaining(drawn))
    }
  })

  it('runs the table specs for number parsing', async () => {
    expect(await specsOf('packages/io/src/numbers.ts')).toEqual(
      expect.arrayContaining(['tableEditing', 'cellsTables', 'import', 'tables']),
    )
  })

  it('runs no spec for docs and unit tests, and every spec for the model', async () => {
    const { affectedSpecs } = await tool()
    expect(affectedSpecs(['docs/ARCHITECTURE.md']).specs).toEqual([])
    expect(affectedSpecs(['packages/graph/test/golden.test.ts']).specs).toEqual([])
    expect(affectedSpecs(['packages/model/src/graph.ts']).specs).toBe('all')
  })
})
