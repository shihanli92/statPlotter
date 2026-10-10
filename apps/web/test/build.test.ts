import { fileURLToPath } from 'node:url'
import { FONT_VARIANTS, FONTS } from '@ps/graph'
import { build, type Rolldown } from 'vite'
import { beforeAll, describe, expect, it } from 'vitest'

// The production build's output (audit 2 step 3): what the bundle settings promise, checked on
// the files a deployment serves. Built in memory with the app's own Vite config.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

type Output = Rolldown.OutputChunk | Rolldown.OutputAsset
let output: Output[]

beforeAll(async () => {
  // Vitest sets NODE_ENV=test, which would make Vite build for development.
  const env = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const result = await build({
      root: ROOT,
      configFile: `${ROOT}/vite.config.ts`,
      mode: 'production',
      logLevel: 'silent',
      build: { write: false, emptyOutDir: false },
    })
    output = (Array.isArray(result) ? result : [result as Rolldown.RolldownOutput]).flatMap(
      (r) => r.output,
    )
  } finally {
    process.env.NODE_ENV = env
  }
}, 120_000)

const isChunk = (o: Output): o is Rolldown.OutputChunk => o.type === 'chunk'
const text = (o: Output) =>
  isChunk(o) ? o.code : typeof o.source === 'string' ? o.source : new TextDecoder().decode(o.source)
const scripts = () => output.filter((o) => o.fileName.endsWith('.js'))
/** The workers: bundles of their own, emitted as assets. */
const workers = () => scripts().filter((o) => !isChunk(o))
/** The figure export worker (roadmap 42): the one worker that lays graphs out. */
const isFigureWorker = (o: Output) => o.fileName.includes('figureExport.worker')
const chunks = () => output.filter(isChunk)
const entry = () => chunks().find((c) => c.isEntry)!
/** The chunks the page loads before the app starts: the entry and what it imports statically. */
function startChunks(): Rolldown.OutputChunk[] {
  const byName = new Map(chunks().map((c) => [c.fileName, c]))
  const out = new Set<Rolldown.OutputChunk>()
  const visit = (c: Rolldown.OutputChunk) => {
    if (out.has(c)) return
    out.add(c)
    for (const f of c.imports) visit(byName.get(f)!)
  }
  visit(entry())
  return [...out]
}
const modulesOf = (cs: Rolldown.OutputChunk[]) => cs.flatMap((c) => c.moduleIds)
const has = (ids: string[], path: string) => ids.some((id) => id.includes(path))

/** zod is in a script (its `new Function` probe, which mentions Cloudflare's runtime). */
const ZOD = 'Cloudflare'
/** `config({ jitless: true })` (model/src/zodConfig.ts), minified. */
const JITLESS = /\(\{jitless:!0\}\)/

describe('the production build', () => {
  it('sets zod jitless in every worker and before the app starts (decision 657)', () => {
    expect(workers().map((w) => w.fileName.replace(/-[\w-]+\.js$/, ''))).toEqual(
      expect.arrayContaining([
        'assets/analysis.worker',
        'assets/csvRead.worker',
        'assets/figureExport.worker',
      ]),
    )
    for (const w of workers())
      if (text(w).includes(ZOD)) expect(JITLESS.test(text(w)), w.fileName).toBe(true)
    expect(startChunks().some((c) => JITLESS.test(c.code))).toBe(true)
    expect(has(modulesOf(startChunks()), 'model/src/zodConfig.ts')).toBe(true)
  })

  it('keeps the app’s stylesheet, a side-effect import (P2)', () => {
    const html = text(output.find((o) => o.fileName === 'index.html')!)
    const href = html.match(/<link rel="stylesheet" crossorigin href="\/([^"]+\.css)"/)?.[1]
    const css = output.find((o) => o.fileName === href)
    expect(css && text(css)).toMatch(/\.workspace\{/)
  })

  it('keeps the workers to what they use (sideEffects, audit 2 P2)', () => {
    for (const w of workers()) {
      // No React in a worker; fonts and graph drawing only in the figure export worker.
      expect(text(w).includes('react.transitional.element'), w.fileName).toBe(false)
      expect(text(w).includes('unitsPerEm'), w.fileName).toBe(isFigureWorker(w))
    }
    const csv = workers().find((w) => w.fileName.includes('csvRead.worker'))!
    expect(text(csv).length).toBeLessThan(250_000)
  })

  it('builds the figure export worker with the page’s own font files (roadmap 42)', () => {
    const figure = workers().find(isFigureWorker)!
    const code = text(figure)
    // Layouts and the PDF writer (fontkit); the analyses left out (their descriptions).
    expect(code.includes('/FontFile2')).toBe(true)
    const analysis = workers().find((w) => w.fileName.includes('analysis.worker'))!
    expect(text(analysis).includes('Kruskal-Wallis')).toBe(true)
    expect(code.includes('Kruskal-Wallis')).toBe(false)
    // 908 KB when written (303 KB gzipped): the graph package, fontkit, the model and its zod.
    expect(code.length).toBeLessThan(1_100_000)
    // Its fonts are the files the page loads (from the browser's cache), not copies of its own.
    for (const family of Object.values(FONTS))
      for (const v of FONT_VARIANTS) {
        const file = family.files[v].replace(/\.ttf$/, '')
        const assets = output.filter(
          (o) => o.fileName.startsWith(`assets/${file}-`) && o.fileName.endsWith('.ttf'),
        )
        expect(assets.length, file).toBe(1)
        expect(code.includes(`/${assets[0]!.fileName}`), file).toBe(true)
      }
  })

  it('leaves out fontkit’s Brotli decoder, which only WOFF2 fonts need (P9)', () => {
    const all = scripts().map(text).join('\n')
    expect(all.includes('Invalid backward reference')).toBe(false)
    // fontkit is there, with the stub in the decoder's place.
    expect(all.includes('WOFF2 fonts are not supported')).toBe(true)
  })

  it('bundles only TrueType fonts, so the decoder is never needed (P9)', () => {
    for (const family of Object.values(FONTS))
      for (const v of FONT_VARIANTS) {
        const file = family.files[v].replace(/\.ttf$/, '')
        const asset = output.find(
          (o) => o.fileName.startsWith(`assets/${file}-`) && o.fileName.endsWith('.ttf'),
        )
        expect(asset, file).toBeDefined()
        const bytes = (asset as Rolldown.OutputAsset).source as Uint8Array
        // The sfnt version of a TrueType font (WOFF2 files start "wOF2").
        expect([...bytes.subarray(0, 4)], file).toEqual([0, 1, 0, 0])
      }
  })

  it('preloads the default font family, the files the app fetches (P5)', () => {
    const html = text(output.find((o) => o.fileName === 'index.html')!)
    const preloads = [
      ...html.matchAll(/<link rel="preload" href="\/([^"]+)" as="fetch" crossorigin/g),
    ]
    expect(preloads.map((m) => m[1]).sort()).toEqual(
      FONT_VARIANTS.map((v) => {
        const file = FONTS.sans.files[v].replace(/\.ttf$/, '')
        return output.find((o) => o.fileName.startsWith(`assets/${file}-`))!.fileName
      }).sort(),
    )
  })

  it('loads the examples when first needed, and ships no local-data example (P6)', () => {
    const start = modulesOf(startChunks())
    const all = modulesOf(chunks())
    for (const lazy of ['examples/synthetic/builds.ts', 'examples/synthetic/gettingStarted.ts'])
      expect([has(start, lazy), has(all, lazy)], lazy).toEqual([false, true])
    // The CC BY papers, data and all, load only when their example is opened. Johnston (audit 3)
    // is a `PaperSpec`, so the spec machinery is in its chunk too — never at start. Chen and
    // Swaminathan (audit 3) embed their data and are each a chunk of their own.
    for (const lazy of [
      'src/paperExample.ts',
      'src/johnstonExample.ts',
      'src/johnstonData.ts',
      'examples/published/hoffmann.ts',
      'examples/published/paper.ts',
      'examples/published/tawk.ts',
      'examples/published/chen.ts',
      'examples/published/chenData.ts',
      'examples/published/swam.ts',
      'examples/published/swamData.ts',
    ])
      expect([has(start, lazy), has(all, lazy)], lazy).toEqual([false, true])
    // The papers and the user's data read from source_data/ (roadmap 48: `examples/private/`,
    // found by `import.meta.glob`): development builds only.
    for (const local of ['examples/private/', 'examples/privateExamples.ts'])
      expect(has(all, local), local).toBe(false)
  })

  it('ships no Phase 0 font check page (development only)', () => {
    expect(has(modulesOf(chunks()), 'FontCheck.tsx')).toBe(false)
    expect(scripts().some((s) => text(s).includes('Font metrics check'))).toBe(false)
  })
})
