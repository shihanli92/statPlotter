import { readFileSync } from 'node:fs'
import { CURRENT_SCHEMA_VERSION } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { COMMAND_TYPES } from '../src/store.ts'

// DATA_MODEL.md states facts the code holds (audit 2, M19): the commands of §8.1 and the schema
// version of §2. A command added, renamed or removed, or a new schema version, fails here until
// the doc says so.

const doc = readFileSync(new URL('../../../docs/DATA_MODEL.md', import.meta.url), 'utf8')

/** The fenced block of DATA_MODEL.md that starts with `opening`. */
function block(opening: string): string {
  const at = doc.indexOf(`\`\`\`ts\n${opening}`)
  expect(at, `DATA_MODEL.md has a block starting "${opening}"`).toBeGreaterThan(0)
  return doc.slice(at, doc.indexOf('```\n', at + 5))
}

describe('DATA_MODEL.md', () => {
  it('lists every command type of the store, and no other (§8.1)', () => {
    const listed = [...block('type Command =').matchAll(/type: '([a-zA-Z]+\.[a-zA-Z]+)'/g)].map(
      (m) => m[1],
    )
    expect([...listed].sort()).toEqual([...COMMAND_TYPES].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('gives the current schema version (§2)', () => {
    const m = /^ {2}schemaVersion: (\d+)/m.exec(block('interface Project {'))
    expect(Number(m?.[1])).toBe(CURRENT_SCHEMA_VERSION)
  })
})
