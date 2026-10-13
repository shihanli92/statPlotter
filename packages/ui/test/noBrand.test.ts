import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Roadmap 48b: the commercial product whose .pzfx files the app imports is named nowhere in the
// repository: not in the app, the documents, comments, identifiers, tests or file names; nor is
// its vendor (audit 4, T10: before, only stats, analyses and the oracle checked the vendor). The
// .pzfx format is described by its extension only. Left out of the check: the private history
// and instructions (docs/DECISIONS.md, CLAUDE.md; neither is in the public copy). Allowed, and
// only where listed: literals the file formats themselves fix (`ALLOWED`).

const root = new URL('../../../', import.meta.url)
/** The name, case ignored (built from pieces so that this file doesn't hold it). */
const NAME = ['pr', 'ism'].join('')
/** The vendor's name, likewise. */
const VENDOR = ['graph', 'pad'].join('')
const NAME_RE = new RegExp(`${NAME}|${VENDOR}`, 'i')
/** The vendor as the schema and the lockfile write it. */
const Vendor = `${'Gr'}aph${'P'}ad`

/** Files never checked: the private history and instructions. */
const EXEMPT = new Set(['docs/DECISIONS.md', 'CLAUDE.md'])

/** The .pzfx XML schema's root element and its version attribute (every .pzfx file has them). */
const SCHEMA = [`${Vendor}${'Pr'}ismFile`, `${'Pr'}ismXMLVersion`]

/**
 * Literals that must match a file format, by the files that may hold them (a path, or a folder
 * ending in /, or `*.ext`): the .pzfx schema names where .pzfx XML is read or written, and the
 * extension of the binary project format (refused on import with a pointer to .pzfx), and the
 * R package pzfx's own description in the oracle's lockfile.
 */
const ALLOWED: [files: string[], literals: string[]][] = [
  [['*.pzfx', 'packages/io/src/import/pzfx.ts', 'packages/io/test/'], SCHEMA],
  [['packages/io/src/import/index.ts'], [`case '${NAME}':`]],
  [['packages/io/test/import.test.ts'], [`'new.${NAME}'`, `/\\.${NAME} files are not supported/`]],
  // The R package pzfx's own title and description in the oracle's lockfile (renv writes them).
  [['tools/oracle/renv.lock'], [`'${Vendor} ${'Pr'}ism'`]],
]

const matches = (path: string, pattern: string) =>
  pattern.startsWith('*.')
    ? path.endsWith(pattern.slice(1))
    : pattern.endsWith('/')
      ? path.startsWith(pattern)
      : path === pattern

const checked = (path: string) => !EXEMPT.has(path)

/** A line with the literals its file may hold taken out. */
function strip(path: string, line: string): string {
  let out = line
  for (const [files, literals] of ALLOWED) {
    if (!files.some((f) => matches(path, f))) continue
    for (const l of literals) out = out.split(l).join('')
  }
  return out
}

const git = (args: string[]) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

describe('no brand', () => {
  it('names the product or its vendor in no tracked file, except the format literals listed', () => {
    // Every line that matches, binary files included ("Binary file … matches").
    const r = git(['grep', '-n', '-i', '-e', NAME, '-e', VENDOR])
    expect(r.status === 0 || r.status === 1, r.stderr).toBe(true)
    const found: string[] = []
    for (const hit of r.stdout.split('\n').filter(Boolean)) {
      const m = /^(.+?):(\d+):(.*)$/s.exec(hit)
      const path = m ? m[1]! : hit.replace(/^Binary file (.+) matches$/, '$1')
      if (!checked(path)) continue
      if (!m || NAME_RE.test(strip(path, m[3]!))) found.push(hit.slice(0, 200))
    }
    expect(found).toEqual([])
  })

  it('allows each format literal only where it is still needed', () => {
    // A literal listed in ALLOWED that no longer occurs in one of its files is a stale entry.
    for (const [files, literals] of ALLOWED) {
      for (const literal of literals) {
        const r = git(['grep', '-l', '-F', '-e', literal])
        const paths = r.stdout.split('\n').filter(Boolean)
        expect(
          paths.some((p) => files.some((f) => matches(p, f))),
          literal,
        ).toBe(true)
      }
    }
  })

  it('has no tracked file or folder with either name in its path', () => {
    const paths = git(['ls-files']).stdout.split('\n').filter(Boolean)
    expect(paths.filter((p) => checked(p) && NAME_RE.test(p))).toEqual([])
  })
})
