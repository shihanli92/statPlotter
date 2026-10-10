import { describe, expect, it, vi } from 'vitest'
import { privateExamples } from '../src/examples/privateExamples.ts'
import { EXAMPLES } from '../src/examples/registry.ts'
import { type SampleKind, sampleTable } from '../src/samples.ts'
import { exampleDocumentTests, normalized } from './exampleDocuments.ts'

// Characterisation: every example builds exactly the same document. Ids are made deterministic
// (the model's generator counts instead) and then renamed in order of first appearance, so only
// the document itself counts, not the order in which its ids were drawn. The snapshot holds a hash
// of each document (the published-data examples are built from local files that are never
// committed, so their documents are not either). EXAMPLE_JSON_DIR=<dir> writes the documents out
// to diff when a hash changes. The New table dialog's sample tables are kept whole. Each example
// is built once per run for every file checking it (`exampleBuilds.ts`).

vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: true }),
)

/** The private examples' fingerprints are in `private/exampleDocuments.test.ts` (roadmap 48). */
const { papers, local } = privateExamples()
const kept = new Set([...papers.map((p) => p.id), ...local.map((e) => e.id)])
exampleDocumentTests(EXAMPLES.filter((e) => !kept.has(e.id)))

describe('sample tables', () => {
  const kinds: SampleKind[] = [
    'column',
    'xy',
    'grouped',
    'contingency',
    'survival',
    'multipleVariables',
    'nested',
    'partsOfWhole',
  ]
  for (const kind of kinds)
    it(kind, () => expect(normalized(sampleTable(kind, 'Data 1'))).toMatchSnapshot())
})
