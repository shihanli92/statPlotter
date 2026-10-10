import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Audit 3 (T10): ARCHITECTURE.md §3 (the repository layout) names every app, every tool and
// every folder of the UI package, so a new one can't go undescribed.

const root = new URL('../../../', import.meta.url)
const doc = readFileSync(new URL('docs/ARCHITECTURE.md', root), 'utf8')
const layout = doc.slice(doc.indexOf('## 3. Repository layout'), doc.indexOf('## 4.'))
const entries = (path: string, dirs: boolean) =>
  readdirSync(new URL(path, root), { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && d.isDirectory() === dirs)
    .map((d) => d.name)

describe('ARCHITECTURE.md repository layout', () => {
  it('names every app and every tool', () => {
    for (const app of entries('apps/', true)) expect(layout, app).toContain(`${app}/ `)
    for (const tool of [...entries('tools/', true), ...entries('tools/', false)]) {
      expect(layout, tool).toMatch(
        new RegExp(`^\\s+${tool}${tool.includes('.') ? '' : '/'}\\s`, 'm'),
      )
    }
  })

  it('names every folder of the UI package, and the Format panel’s', () => {
    for (const dir of entries('packages/ui/src/', true)) {
      expect(layout, dir).toMatch(new RegExp(`^\\s+${dir}/\\s`, 'm'))
    }
    // graph/format/, indented under graph/.
    expect(layout).toMatch(/^ {4}graph\/ [^\n]*\n(?: {16}[^\n]*\n)* {6}format\/ /m)
  })

  it('says how the Format panel and the Format dialog make their undo steps', () => {
    const core = doc.slice(doc.indexOf('## 1.'), doc.indexOf('## 2.'))
    expect(core).toContain('COALESCE_MS')
    expect(core).toMatch(/Format dialog[^.]*draft/)
  })
})
