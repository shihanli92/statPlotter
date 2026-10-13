import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Audit 4 (T6): the published docs say how the project is built, deployed and published as it is
// today, and name only code that exists in the public tree too.

const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const PUBLISHED_DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/ARCHITECTURE.md',
  'docs/DATA_MODEL.md',
  'docs/FEATURE_COVERAGE.md',
  'docs/PUBLISHING.md',
  'docs/RELEASING.md',
  'docs/design/ANALYSIS_GUIDE.md',
]
const PACKAGES = 'model|engine|stats|analyses|graph|io|ui'

describe('docs', () => {
  it('name only source files that exist (`ui/src/…`, `model/results.ts`, `packages/…`)', () => {
    const path = new RegExp(`\`(?:packages/)?((?:${PACKAGES})/[\\w./-]+\\.(?:tsx?|mjs))\``, 'g')
    const missing: string[] = []
    for (const doc of PUBLISHED_DOCS) {
      read(doc)
        .split('\n')
        .forEach((line, i) => {
          for (const [, p] of line.matchAll(path)) {
            const [pkg, ...rest] = p!.split('/')
            // A path from a package (`analyses/src/…`, `model/results.ts`) or from the UI's source
            // (`graph/format/…` is `ui/src/graph/format/…`).
            const candidates = [
              `packages/${p}`,
              `packages/${pkg}/src/${rest.join('/')}`,
              `packages/ui/src/${p}`,
            ]
            if (!candidates.some((c) => existsSync(new URL(c, root))))
              missing.push(`${doc}:${i + 1} ${p}`)
          }
        })
    }
    expect(missing).toEqual([])
  })

  it('name no file of the private examples (the public tree has none)', () => {
    for (const doc of PUBLISHED_DOCS) {
      expect(read(doc), doc).not.toMatch(/examples\/private\/[\w.-]+\.tsx?/)
    }
  })

  it('say the demo is built by Netlify from the public repository, not deployed by CI', () => {
    const architecture = read('docs/ARCHITECTURE.md')
    expect(architecture).not.toMatch(/deployed to Cloudflare Pages|pass deploy to Cloudflare/)
    expect(architecture).toContain('publish-public.mjs')
    expect(architecture).toContain('Netlify')
    const ci = read('.github/workflows/ci.yml')
    expect(ci).not.toMatch(/^ {2}# Pushes to main that pass[^\n]*go live/m)
  })

  // CLAUDE.md is in the private repository only (the public snapshot leaves it out).
  it.skipIf(!existsSync(new URL('CLAUDE.md', root)))(
    'CLAUDE.md says how versions are published and from when they are tagged',
    () => {
      const claude = read('CLAUDE.md')
      expect(claude).not.toContain('Pushing `main` to GitHub deploys')
      expect(claude).toContain('tools/publish-public.mjs')
      expect(claude).toContain('Netlify')
      expect(claude).toMatch(/tagged from the first release/)
      expect(claude).not.toMatch(/^[^\n]*between phases keep the version\. Tag the merge commit/m)
    },
  )
})
