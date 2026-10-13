import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Roadmap 51c (design §6.1): stored params are read only through `paramsOf` (migrated from the
// version they were saved with, then parsed). A direct parse of an analysis' schema is allowed
// only where the params are new — defaults, a guide's or a dialog's own choices, a creator's —
// never ones read from a document. Each place is listed here with why; a new one must be added
// (or go through `paramsOf`).

const ROOT = new URL('../../', import.meta.url).pathname

const ALLOWED: Record<string, { count: number; why: string }> = {
  'model/src/analysisParams.ts': { count: 2, why: 'paramsOf itself, and its defaults fallback' },
  'analyses/src/monteCarlo.ts': { count: 1, why: 'a simulation’s params (unversioned) and seed' },
  'analyses/src/dialog/check.ts': { count: 1, why: 'the Analyze dialog’s params being edited' },
  'analyses/src/dialog/shared.ts': {
    count: 1,
    why: 'a method switched to in the dialog: whether it accepts a shared choice',
  },
  'ui/src/analysis/ChoosingHelp.tsx': { count: 1, why: 'defaults, for the cards' },
  'ui/src/analysis/analysisSearch.ts': { count: 1, why: 'defaults, for the cards' },
  'ui/src/analysis/AnalyzeDialog.tsx': {
    count: 8,
    why: 'defaults; the params being edited (already read through paramsOf); a guide’s choice',
  },
  'ui/src/analysis/GuidePanel.tsx': { count: 2, why: 'the guide’s own new params' },
  'ui/src/analysis/OptionTiers.tsx': {
    count: 1,
    why: 'defaults, to count the Advanced values that differ from them',
  },
  'ui/src/analysis/simulationFields.tsx': {
    count: 3,
    why: 'the dialog’s Monte Carlo params being edited; a simulation’s defaults',
  },
  'ui/src/graph/results/resultActions.ts': { count: 3, why: 'new analyses made by brackets' },
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p)
    return /\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe('stored params are read through paramsOf', () => {
  it('direct parses of an analysis’ params only where the params are new', () => {
    const found: Record<string, number> = {}
    for (const pkg of readdirSync(ROOT)) {
      let src: string[]
      try {
        src = files(join(ROOT, pkg, 'src'))
      } catch {
        continue
      }
      for (const f of src) {
        const n = (readFileSync(f, 'utf8').match(/\.params\.(safeParse|parse)\(/g) ?? []).length
        if (n) found[f.slice(ROOT.length)] = n
      }
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.count])))
  })
})
