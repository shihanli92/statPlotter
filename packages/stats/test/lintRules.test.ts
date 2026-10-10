import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Decision 131's hot-loop rules are Biome plugins (tools/lint/*.grit, scoped in biome.json) that
// `pnpm lint` runs over the sources (audit 2, S11). This checks the plugins still fire, so a Biome
// upgrade that stops them matching fails here instead of letting the patterns back in silently:
// probe sources are written to a temporary folder at the paths of the package's files (the rules
// are scoped by path) and linted with the repository's configuration.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIOME = join(ROOT, 'node_modules/.bin/biome')
const TMP = mkdtempSync(join(tmpdir(), 'ps-lint-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

/** The plugins' messages for `source` linted as the file `path`. */
function pluginMessages(path: string, source: string): string[] {
  const file = join(TMP, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, source)
  const r = spawnSync(
    BIOME,
    [
      'lint',
      `--config-path=${join(ROOT, 'biome.json')}`,
      '--colors=off',
      '--vcs-enabled=false',
      file,
    ],
    { cwd: TMP, encoding: 'utf8' },
  )
  const out = `${r.stdout}\n${r.stderr}`
  return [...out.matchAll(/^\s*× (.*\(decision 131\).*)$/gm)].map((m) => m[1]!)
}

const PROBE = `export function probe(x: number[], f: (v: number) => number): number {
  const at = (k: number) => x[k]!
  let s = 0
  for (let i = 0; i < x.length; i++) {
    s += at(i) + f(i)
    if ([s].some((v) => v > 1)) s = 0
  }
  return s + Float64Array.from(x, (v) => v * 2)[0]! + Int32Array.from(x, Math.round)[0]!
}
`

describe('decision 131 lint rules', () => {
  it('flags closures in the loops of the hot modules, and typed from() with a map', () => {
    const messages = pluginMessages('packages/stats/src/smoothing/contour.ts', PROBE)
    const closures = messages.filter((m) => m.includes('A closure in a hot loop'))
    const typedFrom = messages.filter((m) => m.includes("A typed array's from()"))
    // at(i), f(i), [s].some(…) and the arrow handed to it.
    expect(closures.length).toBe(4)
    expect(typedFrom.length).toBe(2)
  })

  it('applies the closure rule only to the hot modules, the from() rule to all of stats', () => {
    const messages = pluginMessages('packages/stats/src/anova/oneway.ts', PROBE)
    expect(messages.filter((m) => m.includes('A closure in a hot loop'))).toEqual([])
    expect(messages.filter((m) => m.includes("A typed array's from()")).length).toBe(2)
    expect(pluginMessages('packages/graph/src/scene.ts', PROBE)).toEqual([])
  })

  it('passes a loop without closures', () => {
    const clean = `export function sumOf(x: Float64Array): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i]!)
  return s
}
`
    expect(pluginMessages('packages/stats/src/smoothing/contour.ts', clean)).toEqual([])
  })
})
