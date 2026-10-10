import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExampleDef } from '../src/examples/registry.ts'
import { builtExample, sourceContext } from './exampleBuilds.ts'

// The example documents' fingerprints (`exampleDocuments.test.ts`), shared with the private
// examples' own (`private/exampleDocuments.test.ts`, roadmap 48: left out of the public repository
// with the examples). Each test file mocks the model's ids itself (`countedIds.ts`).

/** Key-sorted, so the same document gives the same text whatever order its objects were built in. */
export function normalized(project: object): string {
  const json = JSON.stringify(project, (key, value) => {
    if (key === 'created' || key === 'modified') return '<date>'
    // The app's version changes with every phase (CLAUDE.md, Versioning).
    if (key === 'appVersion') return '<version>'
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  })
  const names = new Map<string, string>()
  return json.replace(/zid\d{6}/g, (id) => {
    let name = names.get(id)
    if (!name) {
      name = `id${names.size + 1}`
      names.set(id, name)
    }
    return name
  })
}

/**
 * A test per example: its document hashed (key-sorted, ids renamed in order of first appearance),
 * against the snapshot. Skipped where the example can't be built (its local files are missing).
 */
export function exampleDocumentTests(examples: ExampleDef[]) {
  const context = sourceContext()
  // Published papers with large workbooks take seconds to build (180 s allowed on a busy machine).
  describe('example documents', () => {
    for (const example of examples) {
      it(example.id, async ({ skip }) => {
        const project = await builtExample(example, context)
        if (!project) return skip()
        const json = normalized(project)
        const dir = process.env.EXAMPLE_JSON_DIR
        if (dir) {
          mkdirSync(dir, { recursive: true })
          writeFileSync(`${dir}/${example.id}.json`, json)
        }
        expect(createHash('sha256').update(json).digest('hex')).toMatchSnapshot()
      }, 180_000)
    }
  })
}
