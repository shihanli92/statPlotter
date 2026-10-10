import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyTable,
  readPastedText,
  setClipboardData,
  type TableCopy,
  tableCopy,
} from '../src/export/tableClipboard.ts'
import { PALETTES, paletteId } from '../src/graph/palettes.ts'

// Audit 2 (U12): the clipboard routes of a table copy (the copy event, else the asynchronous
// clipboard with HTML and text, else the text alone) and of Edit › Paste (this app's exact text
// from the HTML, else the plain text), with the browser's clipboard faked; and the graph palettes.

/** A copy's text guarded (an apostrophe before a formula) and its exact form. */
const copy: TableCopy = tableCopy(
  (guard) => (guard ? `'=1\t2` : '=1\t2'),
  `<table><tr><td>'=1</td><td>2</td></tr></table>`,
)

/** A clipboard event's data, as recorded. */
const transfer = () => {
  const data: Record<string, string> = {}
  return {
    data,
    setData: (type: string, v: string) => {
      data[type] = v
    },
  }
}

/**
 * Listeners by type and phase, as a document keeps them. (Node's own EventTarget doesn't remove a
 * listener added with `capture: true`.)
 */
class Listeners {
  private readonly all: { type: string; fn: (e: Event) => void; capture: boolean }[] = []
  addEventListener(type: string, fn: (e: Event) => void, capture = false) {
    this.all.push({ type, fn, capture })
  }
  removeEventListener(type: string, fn: (e: Event) => void, capture = false) {
    const i = this.all.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture)
    if (i >= 0) this.all.splice(i, 1)
  }
  dispatchEvent(e: Event) {
    let stopped = false
    const stop = e.stopImmediatePropagation.bind(e)
    e.stopImmediatePropagation = () => {
      stopped = true
      stop()
    }
    for (const l of this.all.filter((l) => l.type === e.type)) if (!stopped) l.fn(e)
    return !e.defaultPrevented
  }
}

/** A document whose `execCommand('copy')` raises a copy event (with data, or `null`). */
function fakeDocument(o: { clipboardData?: boolean; throws?: boolean } = {}) {
  const target = new Listeners()
  const clip = transfer()
  const doc = Object.assign(target, {
    clip,
    /** Whether the last copy event was stopped (kept from the page's other listeners). */
    stopped: false,
    execCommand(command: string) {
      if (o.throws) throw new Error('refused')
      expect(command).toBe('copy')
      const e = Object.assign(new Event('copy', { cancelable: true }), {
        clipboardData: o.clipboardData === false ? null : clip,
      })
      const stop = e.stopImmediatePropagation.bind(e)
      doc.stopped = false
      e.stopImmediatePropagation = () => {
        doc.stopped = true
        stop()
      }
      target.dispatchEvent(e)
      return true
    },
  })
  vi.stubGlobal('document', doc)
  return doc
}

/** An asynchronous clipboard recording what is written, `write` refused if asked. */
function fakeClipboard(o: { refuseWrite?: boolean; items?: ClipboardItems; readFails?: boolean }) {
  const written: { items?: Record<string, Blob>[]; text?: string } = {}
  const clipboard = {
    write: vi.fn(async (items: { parts: Record<string, Blob> }[]) => {
      if (o.refuseWrite) throw new Error('no HTML')
      written.items = items.map((i) => i.parts)
    }),
    writeText: vi.fn(async (text: string) => {
      written.text = text
    }),
    read:
      o.items || o.readFails
        ? vi.fn(async () => {
            if (o.readFails) throw new Error('denied')
            return o.items!
          })
        : undefined,
    readText: vi.fn(async () => 'plain text'),
  }
  vi.stubGlobal('navigator', { clipboard })
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(readonly parts: Record<string, Blob>) {}
    },
  )
  return { clipboard, written }
}

/** A clipboard item of the given types and contents. */
const item = (parts: Record<string, string>): ClipboardItem =>
  ({
    types: Object.keys(parts),
    getType: async (t: string) => new Blob([parts[t]!], { type: t }),
  }) as unknown as ClipboardItem

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('copying a table', () => {
  it('puts both forms on the clipboard event and prevents its default', () => {
    const clip = transfer()
    let prevented = false
    setClipboardData(
      {
        clipboardData: clip,
        preventDefault: () => (prevented = true),
      } as unknown as ClipboardEvent,
      copy,
    )
    expect(clip.data).toEqual({ 'text/plain': copy.text, 'text/html': copy.html })
    expect(prevented).toBe(true)
  })

  it('takes the copy event it raises, kept from the page’s listeners; nothing else is written', async () => {
    const doc = fakeDocument()
    const { clipboard } = fakeClipboard({})
    const focus = { focus: vi.fn() }
    await copyTable(copy, focus as unknown as HTMLElement)
    expect(focus.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(doc.clip.data).toEqual({ 'text/plain': copy.text, 'text/html': copy.html })
    expect(doc.stopped).toBe(true)
    expect(clipboard.write).not.toHaveBeenCalled()
    expect(clipboard.writeText).not.toHaveBeenCalled()
    // Its listeners are gone afterwards: a later copy (the user's own) isn't taken.
    doc.clip.data['text/plain'] = 'mine'
    doc.execCommand('copy')
    expect(doc.stopped).toBe(false)
    expect(doc.clip.data['text/plain']).toBe('mine')
  })

  it('writes HTML and text by the asynchronous clipboard when the copy command is refused', async () => {
    fakeDocument({ throws: true })
    const { written, clipboard } = fakeClipboard({})
    await copyTable(copy)
    expect(written.items).toHaveLength(1)
    const parts = written.items![0]!
    expect(await parts['text/html']!.text()).toBe(copy.html)
    expect(await parts['text/plain']!.text()).toBe(copy.text)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('writes the text alone when the clipboard refuses HTML, or the event had no data', async () => {
    fakeDocument({ throws: true })
    let c = fakeClipboard({ refuseWrite: true })
    await copyTable(copy)
    expect(c.written.text).toBe(copy.text)
    vi.unstubAllGlobals()
    fakeDocument({ clipboardData: false })
    c = fakeClipboard({ refuseWrite: true })
    await copyTable(copy)
    expect(c.clipboard.write).toHaveBeenCalledTimes(1)
    expect(c.written.text).toBe(copy.text)
  })
})

describe('Edit › Paste', () => {
  it('takes this app’s exact text from the HTML, not the guarded plain text', async () => {
    fakeClipboard({ items: [item({ 'text/html': copy.html, 'text/plain': copy.text })] })
    expect(await readPastedText()).toBe('=1\t2')
  })

  it('takes the plain text of another application’s copy', async () => {
    fakeClipboard({
      items: [item({ 'text/html': '<table><tr><td>x</td></tr></table>', 'text/plain': 'x' })],
    })
    expect(await readPastedText()).toBe('x')
    fakeClipboard({ items: [item({ 'image/png': 'png' })] })
    expect(await readPastedText()).toBe('')
  })

  it('reads the text alone where the clipboard can’t be read whole', async () => {
    fakeClipboard({ readFails: true })
    expect(await readPastedText()).toBe('plain text')
    fakeClipboard({})
    expect(await readPastedText()).toBe('plain text')
  })
})

describe('graph palettes', () => {
  it('are eight distinct colours each, under distinct ids', () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length)
    for (const p of PALETTES) {
      expect(p.colors, p.id).toHaveLength(8)
      for (const c of p.colors) expect(c, p.id).toMatch(/^#[0-9a-f]{6}$/)
      expect(new Set(p.colors).size, p.id).toBe(8)
    }
    // The default palette (the first) is the colour-blind safe one.
    expect(PALETTES[0]!.id).toBe('okabe-ito')
  })

  it('names the preset a graph’s colours are, exactly', () => {
    for (const p of PALETTES) expect(paletteId([...p.colors])).toBe(p.id)
    const okabe = PALETTES[0]!.colors
    expect(paletteId(okabe.slice(0, 7))).toBeUndefined()
    expect(paletteId([...okabe.slice(1), okabe[0]!])).toBeUndefined()
    expect(paletteId(undefined)).toBeUndefined()
  })
})
