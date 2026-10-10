import { BINARY_TABLE_CELLS, readProjectFile, tableCells, writeProjectFile } from '@ps/io'
import { APP_VERSION } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { EXAMPLES } from '../src/examples/registry.ts'
import { builtExample } from './exampleBuilds.ts'

// Audit 2 (M13): every example project saved and opened again is the same document, its large
// tables through binary columns included (the published-data examples where their local files
// are; the io tests hold a large table with every optional field set).

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

const NOW = new Date('2026-10-07T00:00:00Z')

describe('example projects saved and opened', () => {
  for (const example of EXAMPLES)
    it(example.id, async ({ skip }) => {
      const project = await builtExample(example)
      if (!project) return skip()
      const opened = readProjectFile(writeProjectFile(project, { now: NOW }))
      expect(opened.notes).toEqual([])
      // The save stamps the time and the app's version.
      const meta = { ...project.meta, modified: NOW.toISOString(), appVersion: APP_VERSION }
      expect(opened.project).toStrictEqual({ ...project, meta })
    }, 180_000)

  it('include large tables (binary columns)', async () => {
    let large = 0
    for (const example of EXAMPLES) {
      const project = await builtExample(example)
      for (const n of Object.values(project?.nodes ?? {}))
        if (n.kind === 'table' && tableCells(n) > BINARY_TABLE_CELLS) large++
    }
    expect(large).toBeGreaterThan(0)
  }, 180_000)
})
