import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matrixMarkdown } from '../src/layers/matrixDoc.ts'

// DATA_MODEL.md §6.2a is generated from the compatibility matrix (`graph/src/layers/matrix.ts`):
// the text between its markers must be `matrixMarkdown()`. After changing the matrix, run this
// test with UPDATE_DOCS=1 to rewrite it, and review the diff.

const DOC = new URL('../../../docs/DATA_MODEL.md', import.meta.url)
const START = '<!-- matrix:start (generated from graph/src/layers/matrix.ts; do not edit) -->'
const END = '<!-- matrix:end -->'

describe('the compatibility matrix in DATA_MODEL.md', () => {
  it('is the matrix, generated', () => {
    const doc = readFileSync(DOC, 'utf8')
    const at = doc.indexOf(START)
    const end = doc.indexOf(END)
    expect(at, 'DATA_MODEL.md has the matrix markers').toBeGreaterThan(0)
    expect(end).toBeGreaterThan(at)
    const want = `${START}\n\n${matrixMarkdown()}\n\n${END}`
    const have = doc.slice(at, end + END.length)
    if (process.env.UPDATE_DOCS && have !== want)
      writeFileSync(DOC, doc.slice(0, at) + want + doc.slice(end + END.length))
    else expect(have).toBe(want)
  })
})
