import { readFileSync } from 'node:fs'
import { writeProjectFile } from '@ps/io'
import { createProject, createTable } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { SYNTHETIC_EXAMPLES } from '../src/examples/synthetic/index.ts'
import { createServices, load, serialize, verifyLoadedResults } from '../src/services.ts'
import { builtExample } from './exampleBuilds.ts'

// The examples are built once per run for every file using them (`exampleBuilds.ts`).
vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

describe('load', () => {
  it('keeps only a selection that names a node of the project', () => {
    const services = createServices({ fonts: {} as never, platform: {} as never })
    const project = createProject('P', new Date('2026-01-01T00:00:00Z'))
    const table = createTable({ rows: 1, columns: 1 })
    project.nodes[table.id] = table
    project.order.push(table.id)
    const open = (view: unknown) => load(services, writeProjectFile(project, { view }))
    expect(open({ selected: table.id })).toEqual({ selected: table.id, notes: [] })
    for (const view of [
      { selected: 'constructor' },
      { selected: 'toString' },
      { selected: 7 },
      1,
    ]) {
      expect(open(view)).toEqual({ selected: table.id, notes: [] })
    }
  })

  it('opens a v1 file updated, with what the update changed for the notice', () => {
    const services = createServices({ fonts: {} as never, platform: {} as never })
    const v1 = JSON.parse(
      readFileSync(
        new URL(
          '../../graph/test/fixtures/v1/exotic/approximated-grouped-mean-points.json',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const view = load(services, writeProjectFile(v1))
    expect(services.store.getState().schemaVersion).toBe(3)
    expect(view.notes).toEqual([
      expect.objectContaining({ kind: 'approximated', graph: 'Bars with mean symbols' }),
    ])
    // Saved, it is a v2 file: nothing to tell when it opens again.
    expect(load(services, writeProjectFile(services.store.getState())).notes).toEqual([])
  })
})

// Audit 2 X8: a file's results are shown at once and recomputed when the app is idle.
describe('results from a file', () => {
  const services = () => createServices({ fonts: {} as never, platform: {} as never })

  it('every example’s saved results recompute the same (no notice on opening)', async () => {
    let checked = 0
    for (const example of SYNTHETIC_EXAMPLES) {
      const made = createServices({
        fonts,
        platform: {} as never,
        project: (await builtExample(example))!,
      })
      await made.engine.idle()
      const bytes = serialize(made, { selected: null })
      const opened = services()
      load(opened, bytes)
      const shown = opened.engine.snapshot()
      const verified = await opened.engine.verifySeeded()
      expect(verified, example.id).toMatchObject({ differed: 0 })
      checked += verified.checked
      for (const [id, entry] of opened.engine.snapshot())
        expect(entry.result, `${example.id} ${id}`).toBe(shown.get(id)!.result)
    }
    expect(checked).toBeGreaterThan(20)
  }, 120_000)

  it('a forged result is replaced when the app is idle, with a notice', async () => {
    const made = createServices({
      fonts,
      platform: {} as never,
      project: (await builtExample(SYNTHETIC_EXAMPLES[0]!))!,
    })
    await made.engine.idle()
    const results = made.engine.snapshot()
    const [id, entry] = [...results][0]!
    const forged = structuredClone(entry)
    forged.result.diagnostics = [{ level: 'info' as const, message: 'forged' }]
    results.set(id, forged)
    const project = made.store.getState()
    const opened = services()
    load(opened, writeProjectFile(project, { results }))
    expect(opened.engine.latest(id)?.diagnostics).toEqual(forged.result.diagnostics)
    const notices: string[] = []
    verifyLoadedResults(opened, (m) => notices.push(m))
    await vi.waitFor(() =>
      expect(notices).toEqual(['Results recomputed: 1 differed from the saved file.']),
    )
    expect(opened.engine.latest(id)).toEqual(entry.result)
  })
})
