import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Roadmap 48: the app is statPlotter. Its working name (and the bundle identifier made from it)
// must not come back anywhere a user or a reader of the public repository sees it: the apps,
// every package's source, the workflows and the documents. The history (docs/DECISIONS.md,
// docs/ROADMAP.md) keeps it. Deliberately kept, and not matched here: the file formats'
// `plotting-software-*` tags and the browser databases' names, which saved files and existing
// storage depend on.

const root = new URL('../../../', import.meta.url)
const OLD = new RegExp(['plotting', '\\s?', 'software'].join(''), 'i')

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'target',
  'test-results',
  'playwright-report',
  'gen',
  'icons',
  'fonts',
])
const TEXT = /\.(ts|tsx|mjs|js|json|html|css|md|yml|yaml|toml|rs|nsh|txt)$/
const HISTORY = new Set(['docs/DECISIONS.md', 'docs/ROADMAP.md'])

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(new URL(dir, root))) {
    const path = `${dir}${name}`
    if (statSync(new URL(path, root)).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(`${path}/`, out)
    } else if (TEXT.test(name) && !HISTORY.has(path)) out.push(path)
  }
}

function userFacingFiles(): string[] {
  // CLAUDE.md is not in the public copy (tools/publish-public.mjs): check the files that are here.
  const files = ['README.md', 'NOTICE', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md'].filter((f) =>
    existsSync(new URL(f, root)),
  )
  walk('apps/', files)
  walk('docs/', files)
  walk('.github/', files)
  for (const pkg of readdirSync(new URL('packages/', root))) walk(`packages/${pkg}/src/`, files)
  return files
}

describe('product name', () => {
  it('the working name is gone from everything users and readers see', () => {
    const files = userFacingFiles()
    expect(files.length).toBeGreaterThan(500)
    const found = files.filter((f) => OLD.test(readFileSync(new URL(f, root), 'utf8')))
    expect(found).toEqual([])
  })

  it('the desktop app is statPlotter, with dev.statplotter identifiers', () => {
    const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
    const conf = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'))
    expect(conf.productName).toBe('statPlotter')
    expect(conf.identifier).toBe('dev.statplotter.app')
    expect(conf.app.windows[0].title).toBe('statPlotter')
    const mac = JSON.parse(read('apps/desktop/src-tauri/tauri.macos.conf.json'))
    for (const c of [conf, mac]) {
      // The app's own file types (other apps' data files are only offered "Open with").
      for (const assoc of c.bundle.fileAssociations.filter(
        (a: { exportedType?: unknown }) => a.exportedType,
      )) {
        expect(assoc.name).toMatch(/^statPlotter /)
        expect(assoc.exportedType.identifier).toMatch(/^dev\.statplotter\./)
      }
    }
    // The extensions and MIME types files are opened by stay as they were.
    expect(conf.bundle.fileAssociations.map((a: { ext: string[] }) => a.ext[0])).toEqual([
      'psproj',
      'pspreset',
      'psstyle',
    ])
  })
})
