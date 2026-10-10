import type { FontId, Project, RichText, TextStyle } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  FONT_IDS,
  FONT_VARIANTS,
  FONTS,
  FontRegistry,
  FontsPending,
  fontsUsedBy,
  layoutGraph,
  layoutText,
  sceneToSvg,
  withFonts,
} from '../src/index.ts'
import { nodeFontLoader } from '../src/node.ts'
import { graphOf } from './graphs.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'

// Audit 2 P5: the app starts with Sans and loads the other families when first needed. Text is
// never measured with a family that isn't loaded: `get` throws a thenable `FontsPending`.

/** The node loader, counting the files asked for (and failing those `fail` names). */
function counting(fail: (file: string) => boolean = () => false) {
  const files: string[] = []
  const loader = async (file: string) => {
    files.push(file)
    if (fail(file)) throw new Error(`no ${file}`)
    return nodeFontLoader(file)
  }
  return { files, loader }
}

const style: TextStyle = {
  font: 'serif',
  size: 12,
  color: { rgb: '#000000' },
  bold: false,
  italic: false,
}
const text: RichText = [
  { text: 'Dose ' },
  { text: '(µM)', italic: true },
  { text: ' mono', font: 'mono', bold: true },
]

describe('FontRegistry', () => {
  it('loads every family by default, or only those asked for', async () => {
    const all = counting()
    await FontRegistry.load(all.loader)
    expect(all.files.length).toBe(FONT_IDS.length * FONT_VARIANTS.length)

    const sans = counting()
    const registry = await FontRegistry.load(sans.loader, ['sans'])
    expect(sans.files.sort()).toEqual(Object.values(FONTS.sans.files).sort())
    expect(registry.has('sans')).toBe(true)
    expect(registry.has('serif')).toBe(false)
  })

  it('throws FontsPending for a family still loading, then measures exactly as when loaded', async () => {
    const { files, loader } = counting()
    const registry = await FontRegistry.load(loader, ['sans'])
    let pending: unknown
    try {
      layoutText(registry, text, style)
    } catch (e) {
      pending = e
    }
    expect(pending).toBeInstanceOf(FontsPending)
    expect((pending as FontsPending).family).toBe('serif')
    // A thenable (what React's Suspense waits on), settling once Serif is in.
    await (pending as FontsPending)
    expect(registry.has('serif')).toBe(true)
    // Mono is named by a run: waiting for it in turn.
    const layout = await withFonts(() => layoutText(registry, text, style))
    expect(layout).toEqual(layoutText(fonts, text, style))
    expect(registry.has('mono')).toBe(true)
    // Each family once, asked for by several gets.
    expect(files.length).toBe(3 * FONT_VARIANTS.length)
  })

  it('loads a family once however many wait for it', async () => {
    const { files, loader } = counting()
    const registry = await FontRegistry.load(loader, ['sans'])
    const waits = [1, 2, 3].map(() => {
      try {
        registry.get('narrow', 'bold')
      } catch (e) {
        return e as FontsPending
      }
      throw new Error('expected FontsPending')
    })
    await Promise.all([...waits.map((w) => w.settled), registry.ensure(['narrow', 'sans'])])
    expect(files.filter((f) => f.startsWith('LiberationSansNarrow')).length).toBe(4)
    expect(registry.get('narrow', 'bold').unitsPerEm).toBe(fonts.get('narrow', 'bold').unitsPerEm)
  })

  it('throws the error of a family that failed to load, and loads it again when ensured', async () => {
    let broken = true
    const { loader } = counting((f) => broken && f.startsWith('LiberationMono'))
    const registry = await FontRegistry.load(loader, ['sans'])
    const pending = (() => {
      try {
        registry.get('mono', 'regular')
      } catch (e) {
        return e as FontsPending
      }
    })()!
    await pending.settled
    expect(() => registry.get('mono', 'regular')).toThrow(/no LiberationMono/)
    await expect(withFonts(() => registry.get('mono', 'italic'))).rejects.toThrow(
      /no LiberationMono/,
    )
    broken = false
    await registry.ensure(['mono'])
    expect(registry.get('mono', 'regular').unitsPerEm).toBe(fonts.get('mono', 'regular').unitsPerEm)
  })

  it('rejects a load whose families fail', async () => {
    const { loader } = counting((f) => f.startsWith('LiberationSans-'))
    await expect(FontRegistry.load(loader, ['sans'])).rejects.toThrow(/no LiberationSans/)
  })

  it('lays a graph out the same once its fonts have loaded', async () => {
    const registry = await FontRegistry.load(nodeFontLoader, ['sans'])
    const table = sampleTable('column')
    const graph = graphOf(table, 'barsPoints', () => ({
      title: { content: [{ text: 'Serif title' }], style: { font: 'serif' as FontId } },
    }))
    const ctx = { project: projectOf(table, graph), graph, fonts: registry }
    const scene = await withFonts(() => layoutGraph(ctx))
    const svg = sceneToSvg(scene)
    expect(svg).toContain('Serif title')
    expect(svg).toBe(sceneToSvg(layoutGraph({ ...ctx, fonts })))
  })
})

describe('fontsUsedBy', () => {
  it('finds every family a document names, at any depth', () => {
    const doc = {
      settings: { style: { font: 'narrow' } },
      nodes: {
        a: { title: [{ text: 'x', font: 'mono' }, { text: 'y' }], fonts: ['serif'] },
        b: { text: { font: 'sans' }, label: 'font', other: { font: 'comic' } },
      },
    }
    expect([...fontsUsedBy(doc)].sort()).toEqual(['mono', 'narrow', 'sans'])
    expect(fontsUsedBy(null).size).toBe(0)
    expect(fontsUsedBy({ cells: [1, 2, null, 'serif'] }).size).toBe(0)
  })

  it('answers for the parts of a new version that changed', () => {
    const shared = { font: 'mono' }
    const v1 = { nodes: { a: shared, b: { font: 'sans' } } } as unknown as Project
    expect([...fontsUsedBy(v1)].sort()).toEqual(['mono', 'sans'])
    const v2 = { nodes: { a: shared, b: { font: 'serif' } } }
    expect([...fontsUsedBy(v2)].sort()).toEqual(['mono', 'serif'])
  })
})
