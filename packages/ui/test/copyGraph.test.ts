import { createGraphFor, layoutGraph, layoutPage } from '@ps/graph'
import { createTable, type LayoutNode, type NodeId, newLayoutItemId, newNodeId } from '@ps/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { CommandRegistry, nativeMenuSpec } from '../src/commands/index.ts'
import { viewOwnsClipboardEvent } from '../src/graph/clipboardEvents.ts'
import {
  COPY_PNG_DPI,
  COPY_PNG_MAX_PIXELS,
  COPY_PNG_MAX_SIDE,
  type CopiedGraph,
  copiedToPaste,
  copyPngDpi,
  copySvgCode,
  describeCopied,
  GraphClipboard,
  graphClipboard,
  pastedImageIsCopy,
  webClipboardAttempts,
  webClipboardSupport,
  writeWebClipboard,
} from '../src/graph/copyGraph.ts'
import { exportSvg } from '../src/graph/figureFiles.ts'
import { copyCommands } from '../src/graph/viewCommands.ts'
import { fitScale, pasteableGraph, pastePlacement, selectedGraphOf } from '../src/layout/paste.ts'

// Roadmap 23: copying graphs and pages as vector graphics, and pasting graphs onto pages.

function setup() {
  const table = createTable({ tableKind: 'column', columns: 2, rows: 3 })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = [1 + i, 2 + i, 4 + i]
  })
  const graph = { ...createGraphFor(table), name: 'Panel A' }
  const layout: LayoutNode = {
    kind: 'layout',
    id: newNodeId(),
    name: 'Figure 1',
    page: { width: 612, height: 792 },
    items: [
      { type: 'graph', id: newLayoutItemId(), graph: graph.id, x: 36, y: 36, scale: 0.5 },
      { type: 'text', id: newLayoutItemId(), x: 300, y: 36, content: { content: [{ text: 'A' }] } },
    ],
    panelLabels: { show: true, style: 'A', size: 14 },
  }
  const project = projectOf(table, graph, layout)
  return { table, graph, layout, project }
}

describe('the copied SVG', () => {
  it('is the export SVG: size in points, text as text in fonts other apps know, self-contained', () => {
    const { graph, project } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const svg = exportSvg(scene)
    const head = svg.slice(0, svg.indexOf('>') + 1)
    expect(head).toContain(`width="${Math.round(scene.width * 1000) / 1000}pt"`)
    expect(head).toContain(`height="${Math.round(scene.height * 1000) / 1000}pt"`)
    expect(head).toContain(`viewBox="0 0 ${Math.round(scene.width * 1000) / 1000} `)
    expect(svg).toMatch(/<tspan [^>]*font-family="'Liberation Sans', Arial, Helvetica, sans-serif"/)
    // The app's own @font-face names mean nothing elsewhere.
    expect(svg).not.toContain('PS Liberation')
    // Nothing outside the file: no links, images, stylesheets or scripts.
    expect(svg).not.toMatch(/href|url\(|<image|<style|<script/)
    expect(svg).toContain('fill="#ffffff"')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('of a page is the page at its size', () => {
    const { layout, project } = setup()
    const scene = layoutPage({ project, layout, fonts })
    expect(exportSvg(scene)).toContain('width="612pt" height="792pt" viewBox="0 0 612 792"')
  })
})

describe('the PNG beside it', () => {
  it('is 300 dpi unless that exceeds the pixel limits', () => {
    expect(copyPngDpi(300, 200)).toBe(COPY_PNG_DPI)
    // A Letter page: 2550 × 3300 px.
    expect(copyPngDpi(612, 792)).toBe(300)
    // 40 × 40 in would be 144 million pixels.
    const big = copyPngDpi(2880, 2880)
    expect(big).toBeLessThan(300)
    expect(((2880 * big) / 72) ** 2).toBeLessThanOrEqual(COPY_PNG_MAX_PIXELS)
    // Long and thin: the side limit.
    const wide = copyPngDpi(200 * 72, 36)
    expect((200 * 72 * wide) / 72).toBeLessThanOrEqual(COPY_PNG_MAX_SIDE)
  })
})

describe('browser clipboard formats', () => {
  const nav = (write = true) => ({
    clipboard: {
      ...(write ? { write: async () => {} } : {}),
      writeText: async () => {},
    },
  })
  /** A ClipboardItem class, with `supports` or without (older browsers). */
  const item = (supports?: (t: string) => boolean) => {
    class ClipboardItem {}
    return Object.assign(ClipboardItem, supports ? { supports } : {})
  }
  const Item = item()
  const ItemWithSupports = item((t) => ['image/svg+xml', 'image/png', 'text/plain'].includes(t))
  const ItemNoSvg = item((t) => t !== 'image/svg+xml')
  const ItemThrows = item(() => {
    throw new Error('no')
  })

  it('are detected without touching the clipboard', () => {
    expect(webClipboardSupport(nav(), ItemWithSupports)).toEqual({
      write: true,
      svg: true,
      png: true,
      writeText: true,
    })
    // No ClipboardItem.supports (older Safari / Firefox): PNG, not SVG.
    expect(webClipboardSupport(nav(), Item)).toMatchObject({ svg: false, png: true })
    expect(webClipboardSupport(nav(), ItemNoSvg)).toMatchObject({ svg: false, png: true })
    expect(webClipboardSupport(nav(), ItemThrows)).toMatchObject({ svg: false, png: false })
    expect(webClipboardSupport(nav(false), Item)).toEqual({
      write: false,
      svg: false,
      png: false,
      writeText: true,
    })
    expect(webClipboardSupport(undefined, undefined).write).toBe(false)
  })

  it('are tried richest first, then without SVG, then the text alone', () => {
    const all = { write: true, svg: true, png: true, writeText: true }
    expect(webClipboardAttempts(all)).toEqual([['svg', 'png', 'text'], ['png', 'text'], ['text']])
    expect(webClipboardAttempts({ ...all, svg: false })).toEqual([['png', 'text'], ['text']])
    expect(webClipboardAttempts({ ...all, write: false, svg: false, png: false })).toEqual([
      ['text'],
    ])
    expect(
      webClipboardAttempts({ write: false, svg: false, png: false, writeText: false }),
    ).toEqual([])
  })
})

describe('writeWebClipboard', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub(fail: (types: string[]) => boolean) {
    const calls: string[][] = []
    class ClipboardItem {
      constructor(readonly data: Record<string, unknown>) {}
    }
    const write = vi.fn(async (items: ClipboardItem[]) => {
      const types = Object.keys(items[0]!.data)
      calls.push(types)
      for (const v of Object.values(items[0]!.data)) await v
      if (fail(types)) throw new DOMException('refused', 'NotAllowedError')
    })
    vi.stubGlobal('ClipboardItem', ClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } })
    return { calls, write }
  }
  const support = { write: true, svg: true, png: true, writeText: true }
  const png = () => Promise.resolve(new Blob([new Uint8Array([0x89])], { type: 'image/png' }))

  it('writes one item with SVG, PNG and the SVG code, starting inside the user gesture', async () => {
    const { calls, write } = stub(() => false)
    const done = writeWebClipboard('<svg/>', png, support)
    // Called before anything was awaited (browsers want the key press or click still current).
    expect(write).toHaveBeenCalledOnce()
    expect(await done).toEqual(['svg', 'png', 'text'])
    expect(calls).toEqual([['image/svg+xml', 'image/png', 'text/plain']])
  })

  it('falls back when the browser refuses SVG, making the PNG once', async () => {
    const { calls } = stub((types) => types.includes('image/svg+xml'))
    const makePng = vi.fn(png)
    expect(await writeWebClipboard('<svg/>', makePng, support)).toEqual(['png', 'text'])
    expect(calls).toEqual([
      ['image/svg+xml', 'image/png', 'text/plain'],
      ['image/png', 'text/plain'],
    ])
    expect(makePng).toHaveBeenCalledOnce()
  })

  it('fails when nothing can be written', async () => {
    stub(() => true)
    await expect(writeWebClipboard('<svg/>', png, support)).rejects.toThrow('refused')
    await expect(
      writeWebClipboard('<svg/>', png, { write: false, svg: false, png: false, writeText: false }),
    ).rejects.toThrow(/can’t write/)
  })
})

describe('describeCopied', () => {
  it('says what went on the clipboard', () => {
    expect(describeCopied('“Graph 1”', ['pdf', 'png', 'svg'])).toBe(
      'Copied “Graph 1” as vector (PDF, SVG) and image (PNG).',
    )
    expect(describeCopied('“Graph 1”', ['svg', 'png', 'text'])).toBe(
      'Copied “Graph 1” as vector (SVG) and image (PNG).',
    )
    expect(describeCopied('the page', ['png', 'text'])).toBe(
      'Copied the page as image (PNG) and SVG code (text: Illustrator pastes it as vector).',
    )
    expect(describeCopied('x', ['text'])).toBe(
      'Copied x as SVG code (text: Illustrator pastes it as vector).',
    )
  })
})

describe('the app’s record of the copy', () => {
  const g = 'g1' as NodeId
  const web: CopiedGraph = { graph: g, text: '<svg>\n</svg>', stamp: null }
  const desktop: CopiedGraph = { graph: g, text: null, stamp: 41 }

  it('pastes the graph while the clipboard still holds the copy', () => {
    const graphToPaste = (copied: CopiedGraph | null, seen: Parameters<typeof copiedToPaste>[1]) =>
      copiedToPaste(copied, seen)?.graph ?? null
    expect(graphToPaste(null, {})).toBeNull()
    expect(graphToPaste({ graph: null, text: 'x', stamp: null }, { text: 'x' })).toBeNull()
    // Desktop: the change count tells.
    expect(graphToPaste(desktop, { stamp: 41 })).toBe(g)
    expect(graphToPaste(desktop, { stamp: 42, text: '' })).toBeNull()
    // Browser: the pasted text (line endings may change on the way).
    expect(graphToPaste(web, { text: '<svg>\r\n</svg>' })).toBe(g)
    expect(graphToPaste(web, { text: 'other text' })).toBeNull()
    // Nothing to compare (a paste from the menu, no text on the clipboard): the record stands.
    expect(graphToPaste(web, {})).toBe(g)
    expect(graphToPaste(web, { text: '' })).toBe(g)
    expect(graphToPaste({ graph: g, text: null, stamp: null }, { text: 'x', stamp: 3 })).toBe(g)
  })

  it('tells its own PNG in a paste from a new picture (roadmap 32)', () => {
    const png = { width: 900, height: 600 }
    const noText: CopiedGraph = { graph: g, text: null, stamp: null, png }
    expect(pastedImageIsCopy(null, null, png)).toBe(false)
    // The copy's text on the clipboard decides.
    expect(pastedImageIsCopy({ ...web, png }, '<svg>\n</svg>', { width: 1, height: 1 })).toBe(true)
    expect(pastedImageIsCopy({ ...web, png }, 'other', png)).toBe(false)
    // Else the image's size: the copy's PNG (to a pixel), or one that can't be read (TIFF).
    expect(pastedImageIsCopy(noText, null, { width: 901, height: 600 })).toBe(true)
    expect(pastedImageIsCopy(noText, null, { width: 640, height: 480 })).toBe(false)
    expect(pastedImageIsCopy(noText, null, null)).toBe(true)
    // Page items copied: the same.
    const items: CopiedGraph = {
      graph: null,
      text: null,
      stamp: null,
      png,
      items: { items: [], assets: [] },
    }
    expect(pastedImageIsCopy(items, null, png)).toBe(true)
  })

  it('notifies subscribers', () => {
    const c = new GraphClipboard()
    const fn = vi.fn()
    const off = c.subscribe(fn)
    c.set(web)
    expect(c.get()).toBe(web)
    off()
    c.set(null)
    expect(fn).toHaveBeenCalledOnce()
  })
})

describe('copy and paste commands', () => {
  const noop = () => {}
  const graphView = () =>
    copyCommands({
      copy: { hint: '', run: noop },
      graph: { enabled: true, run: noop },
      svgCode: noop,
    })
  const layoutView = (one: boolean, pasteable: boolean) =>
    copyCommands({
      copy: { hint: '', run: noop },
      graph: { enabled: one, run: noop },
      page: noop,
      svgCode: noop,
      paste: { enabled: pasteable, run: noop },
    })
  const key = (k: string, shift = false) => ({
    key: k,
    metaKey: true,
    ctrlKey: false,
    shiftKey: shift,
    altKey: false,
  })

  it('graph view: ⇧⌘C is Copy graph (toolbar too); ⌘C stays the browser’s copy event', () => {
    const r = new CommandRegistry()
    r.set('v', 'view', graphView())
    expect(r.match(key('C', true), true, false)?.id).toBe('edit.copyGraph')
    // Never in text fields.
    expect(r.match(key('C', true), true, true)).toBeUndefined()
    expect(r.match(key('c'), true, false)).toBeUndefined()
    expect(r.get('edit.copy')).toMatchObject({ shortcut: 'Mod+C', nativeShortcut: true })
    expect(
      r
        .toolbar()
        .flat()
        .map((c) => c.id),
    ).toEqual(['edit.copyGraph'])
    expect(r.get('edit.paste')).toBeUndefined()
  })

  it('layout: ⇧⌘C is Copy page; Copy graph needs one graph selected, Paste a copied graph', () => {
    const r = new CommandRegistry()
    r.set('v', 'view', layoutView(false, false))
    expect(r.match(key('C', true), true, false)?.id).toBe('edit.copyPage')
    expect(r.get('edit.copyGraph')).toMatchObject({ enabled: false })
    expect(r.get('edit.copyGraph')?.shortcut).toBeUndefined()
    expect(r.get('edit.paste')).toMatchObject({ enabled: false, nativeShortcut: true })
    expect(r.run('edit.copyGraph')).toBe(false)
    r.set('v', 'view', layoutView(true, true))
    expect(r.get('edit.copyGraph')?.enabled).toBe(true)
    expect(r.get('edit.paste')?.enabled).toBe(true)
    expect(r.match(key('v'), true, false)).toBeUndefined()
    const edit = r.menus().find((m) => m.id === 'edit')!
    expect(edit.items.map((i) => (i.kind === 'command' ? i.command.label : i.kind))).toEqual([
      'Copy',
      'Copy graph',
      'Copy page',
      'Copy as SVG code',
      'Paste graph',
    ])
  })

  it('macOS menus: Copy and Paste stay the system’s items, Copy page carries ⇧⌘C', () => {
    const r = new CommandRegistry()
    r.set('v', 'view', layoutView(true, true))
    const spec = nativeMenuSpec(r.menus(), { isMac: true, appName: 'App' })
    const edit = spec.find((m) => m.text === 'Edit')!
    expect(edit.items).toContainEqual({ kind: 'predefined', item: 'Copy', text: 'Copy' })
    expect(edit.items).toContainEqual({ kind: 'predefined', item: 'Paste', text: 'Paste graph' })
    expect(edit.items).toContainEqual(
      expect.objectContaining({ id: 'edit.copyPage', accelerator: 'CmdOrCtrl+Shift+C' }),
    )
  })

  it('the views take ⌘C / ⌘V only away from text', () => {
    const at = { inText: false, inView: true, textSelected: false, dialogOpen: false }
    expect(viewOwnsClipboardEvent('copy', at)).toBe(true)
    expect(viewOwnsClipboardEvent('paste', at)).toBe(true)
    expect(viewOwnsClipboardEvent('copy', { ...at, inText: true })).toBe(false)
    expect(viewOwnsClipboardEvent('paste', { ...at, inText: true })).toBe(false)
    expect(viewOwnsClipboardEvent('copy', { ...at, textSelected: true })).toBe(false)
    expect(viewOwnsClipboardEvent('paste', { ...at, textSelected: true })).toBe(true)
    expect(viewOwnsClipboardEvent('copy', { ...at, dialogOpen: true })).toBe(false)
    expect(viewOwnsClipboardEvent('paste', { ...at, inView: false })).toBe(false)
  })
})

describe('pasting onto a page', () => {
  const page = { width: 612, height: 792 }

  it('centres the graph on the pointer, or on the page', () => {
    expect(pastePlacement(page, { width: 200, height: 100 }, { x: 300, y: 400 }, [])).toEqual({
      x: 200,
      y: 350,
      scale: 1,
    })
    expect(pastePlacement(page, { width: 200, height: 100 }, null, [])).toEqual({
      x: 206,
      y: 346,
      scale: 1,
    })
  })

  it('keeps it on the page and scales a large graph to fit, like Graph on page', () => {
    expect(pastePlacement(page, { width: 200, height: 100 }, { x: 600, y: 5 }, [])).toEqual({
      x: 412,
      y: 0,
      scale: 1,
    })
    const big = { width: 1080, height: 400 }
    expect(fitScale(page, big)).toBeCloseTo(540 / 1080)
    const p = pastePlacement(page, big, null, [])
    expect(p.scale).toBe(0.5)
    expect(p.x).toBe(36)
  })

  it('steps off an item already there (pasting twice)', () => {
    const first = pastePlacement(page, { width: 200, height: 100 }, null, [])
    const second = pastePlacement(page, { width: 200, height: 100 }, null, [first])
    expect(second).toMatchObject({ x: first.x + 12, y: first.y + 12 })
  })

  it('places only this project’s graphs; Copy graph wants one graph selected', () => {
    const { graph, layout, project, table } = setup()
    expect(pasteableGraph(project, graph.id)?.id).toBe(graph.id)
    expect(pasteableGraph(project, table.id)).toBeNull()
    expect(pasteableGraph(project, 'elsewhere' as NodeId)).toBeNull()
    expect(pasteableGraph(project, null)).toBeNull()
    expect(selectedGraphOf(project, layout, [0])?.id).toBe(graph.id)
    expect(selectedGraphOf(project, layout, [1])).toBeNull()
    expect(selectedGraphOf(project, layout, [0, 1])).toBeNull()
    expect(selectedGraphOf(project, layout, [])).toBeNull()
  })
})

describe('Copy as SVG code', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts the SVG alone on the clipboard, as text, and records the graph for pasting', async () => {
    const { graph, project } = setup()
    const scene = layoutGraph({ project, graph, fonts })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const msg = await copySvgCode(exportSvg(scene), { what: '“Panel A”', graph: graph.id })
    expect(writeText).toHaveBeenCalledWith(exportSvg(scene))
    expect(msg).toMatch(/^Copied “Panel A” as SVG code/)
    expect(graphClipboard.get()).toEqual({ graph: graph.id, text: exportSvg(scene), stamp: null })
  })

  it('writes an SVG still being made as a promise, inside the user gesture (roadmap 42)', async () => {
    const { graph, project } = setup()
    const svg = exportSvg(layoutGraph({ project, graph, fonts }))
    class ClipboardItem {
      constructor(readonly data: Record<string, Promise<Blob>>) {}
    }
    let given: Promise<Blob> | null = null
    const write = vi.fn(async (items: ClipboardItem[]) => {
      given = items[0]!.data['text/plain']!
      await given
    })
    vi.stubGlobal('ClipboardItem', ClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } })
    let made!: (s: string) => void
    const done = copySvgCode(new Promise<string>((r) => (made = r)), { what: 'x', graph: null })
    // Written at once, before the SVG is made.
    expect(write).toHaveBeenCalledOnce()
    made(svg)
    expect(await done).toMatch(/^Copied x as SVG code/)
    expect(await (await given!).text()).toBe(svg)
    expect(graphClipboard.get()).toEqual({ graph: null, text: svg, stamp: null })
  })

  it('reports a refused write', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    })
    await expect(copySvgCode('<svg/>', { what: 'x', graph: null })).rejects.toThrow(/denied/)
  })
})
