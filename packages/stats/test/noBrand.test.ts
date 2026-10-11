import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Roadmap 48b: the statistics, the analyses and the R oracle describe their methods without
// naming a commercial graphing program or its vendor — not in code, comments, test names,
// fixture notes or file names. The words are built from pieces so that this file doesn't match.

const root = new URL('../../../', import.meta.url)
const SCOPE = ['packages/stats', 'packages/analyses', 'tools/oracle']
const PRODUCT = ['pri', 'sm'].join('')
const VENDOR = ['graph', 'pad'].join('')
const PATTERN = `${PRODUCT}|${VENDOR}`

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1)
const BRAND = `${cap(VENDOR.slice(0, 5))}${cap(VENDOR.slice(5))} ${cap(PRODUCT)}`

/**
 * Lines kept on purpose, exactly: the renv lockfile records the R package pzfx's own
 * DESCRIPTION (its title and description name the file format's program), which renv writes
 * again on every snapshot.
 */
const KEPT = [
  `tools/oracle/renv.lock:      "Title": "Read and Write '${BRAND}' Files",`,
  `tools/oracle/renv.lock:      "Description": "Read and write '${BRAND}' '.pzfx' files in R.",`,
]

const git = (args: string[]) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)

describe('no brand names in stats, analyses and the oracle', () => {
  it('has no tracked file whose text names them (but the kept lockfile lines)', () => {
    const hits = git(['grep', '-I', '-i', '-E', PATTERN, '--', ...SCOPE])
    expect(hits.filter((line) => !KEPT.includes(line))).toEqual([])
    // The kept lines are still there as written (else this list is stale).
    expect(hits).toEqual(KEPT)
  })

  it('has no tracked file whose path names them', () => {
    const files = git(['ls-files', '--', ...SCOPE])
    expect(files.length).toBeGreaterThan(1000)
    expect(files.filter((f) => new RegExp(PATTERN, 'i').test(f))).toEqual([])
  })
})
