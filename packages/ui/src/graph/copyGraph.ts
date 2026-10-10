import type { ImageAsset, LayoutItem, NodeId } from '@ps/model'
import type { Platform } from '../services.ts'
import { errorMessage } from '../util.ts'
import type { FigureSvg, FigureTarget } from '../worker/figureCore.ts'
import { type FigureExporter, type FigureSource, figureExports } from '../worker/figureExport.ts'
import { imageSize } from './figureFiles.ts'

// Copy as vector (roadmap 23): a graph or a layout page on the system clipboard as vector
// graphics other applications paste as editable artwork, with a PNG beside it for those that
// only take images. The SVG is the export's (`exportSvg`); the desktop app on macOS adds the
// export's PDF (`exportPdf`, fonts embedded), which Illustrator, Word, PowerPoint and Keynote all
// paste as vectors. Browsers get SVG where they can write it, and the SVG code
// as text (Illustrator turns pasted SVG code into artwork). Beside the system clipboard the app
// keeps which graph was copied, so it can be pasted onto a layout page (linked, like "Graph on
// page"), as long as the clipboard still holds that copy.

/** What went on the clipboard: vector PDF, vector SVG, a PNG image, the SVG code as text. */
export type ClipboardFormat = 'pdf' | 'svg' | 'png' | 'text'

/** The PNG's resolution beside the vector formats. */
export const COPY_PNG_DPI = 300
/** At most this many pixels (a Letter page at 300 dpi is 8.4 million). */
export const COPY_PNG_MAX_PIXELS = 16_000_000
/** And at most this many per side (browsers' canvas limit). */
export const COPY_PNG_MAX_SIDE = 16_384

/** The PNG resolution for a copy of this size (points): `dpi`, lowered to fit the limits. */
export function copyPngDpi(widthPt: number, heightPt: number, dpi = COPY_PNG_DPI): number {
  const w = (widthPt * dpi) / 72
  const h = (heightPt * dpi) / 72
  const f = Math.min(
    1,
    Math.sqrt(COPY_PNG_MAX_PIXELS / (w * h)),
    COPY_PNG_MAX_SIDE / Math.max(w, h),
  )
  return f < 1 ? Math.floor(dpi * f) : dpi
}

// ---- Browsers -----------------------------------------------------------------------------------

/** What the browser's asynchronous clipboard can take. */
interface WebClipboardSupport {
  /** `navigator.clipboard.write` with `ClipboardItem`. */
  write: boolean
  /** `image/svg+xml` (Chromium 124+, via `ClipboardItem.supports`). */
  svg: boolean
  /** `image/png` (every browser with `write`, unless `supports` says otherwise). */
  png: boolean
  /** `navigator.clipboard.writeText`. */
  writeText: boolean
}

type ClipboardItemClass = {
  new (items: Record<string, Blob | Promise<Blob>>): unknown
  supports?: (type: string) => boolean
}

/** Feature detection (no clipboard access, no permission prompt). */
export function webClipboardSupport(
  nav: { clipboard?: Partial<Clipboard> } | undefined = globalThis.navigator,
  Item: ClipboardItemClass | undefined = (globalThis as { ClipboardItem?: ClipboardItemClass })
    .ClipboardItem,
): WebClipboardSupport {
  const write = typeof nav?.clipboard?.write === 'function' && typeof Item === 'function'
  const supports = (type: string, fallback: boolean) => {
    if (!write) return false
    if (typeof Item?.supports !== 'function') return fallback
    try {
      return Item.supports(type)
    } catch {
      return false
    }
  }
  return {
    write,
    svg: supports('image/svg+xml', false),
    png: supports('image/png', true),
    writeText: typeof nav?.clipboard?.writeText === 'function',
  }
}

const MIME: Record<'svg' | 'png' | 'text', string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  text: 'text/plain',
}

/**
 * The attempts to make, richest first: one clipboard item with every format the browser takes
 * (SVG, PNG, the SVG code as text), then without SVG (a browser that says it takes SVG but
 * refuses it), then the text alone. Empty when the browser can't write at all.
 */
export function webClipboardAttempts(s: WebClipboardSupport): ClipboardFormat[][] {
  const out: ClipboardFormat[][] = []
  if (s.write) {
    const all: ClipboardFormat[] = [
      ...(s.svg ? ['svg' as const] : []),
      ...(s.png ? ['png' as const] : []),
      'text',
    ]
    out.push(all)
    if (s.svg && s.png) out.push(['png', 'text'])
  }
  if (s.writeText || s.write) out.push(['text'])
  return out
}

/**
 * Writes with the browser's clipboard. The first write starts before this returns (nothing is
 * awaited first), inside the user's key press or click, which Safari and Firefox require; the
 * SVG (made in the export worker, roadmap 42) and the PNG are handed over as promises the
 * browser waits for. Only a browser without `ClipboardItem` (text alone) waits for the SVG first.
 */
export async function writeWebClipboard(
  svg: string | Promise<string>,
  png: () => Promise<Blob>,
  support: WebClipboardSupport = webClipboardSupport(),
): Promise<ClipboardFormat[]> {
  const attempts = webClipboardAttempts(support)
  if (!attempts.length) throw new Error('This browser can’t write to the clipboard.')
  let pngBlob: Promise<Blob> | null = null
  const blob = (f: ClipboardFormat): Blob | Promise<Blob> => {
    if (f === 'png') {
      pngBlob ??= png()
      return pngBlob
    }
    const type = MIME[f as 'svg' | 'text']
    return typeof svg === 'string'
      ? new Blob([svg], { type })
      : svg.then((text) => new Blob([text], { type }))
  }
  const Item = (globalThis as { ClipboardItem?: ClipboardItemClass }).ClipboardItem
  let error: unknown = null
  for (const formats of attempts) {
    try {
      if (formats.length === 1 && formats[0] === 'text' && !support.write)
        await navigator.clipboard.writeText(await svg)
      else {
        const data = Object.fromEntries(formats.map((f) => [MIME[f as 'svg'], blob(f)]))
        await navigator.clipboard.write([new Item!(data) as ClipboardItem])
      }
      return formats
    } catch (e) {
      error = e
    }
  }
  throw error
}

// ---- Copying ------------------------------------------------------------------------------------

/** A figure to copy: what it draws, and the document it is laid out from. */
export interface CopySource {
  source: FigureSource
  target: FigureTarget
}

/** A copy's PNG: at its own size, `copyPngDpi`. */
const copyPng = (exporter: FigureExporter, c: CopySource, size: FigureSvg) =>
  exporter.render(c.source, c.target, {
    format: 'png',
    mode: 'keepText',
    dpi: copyPngDpi(size.width, size.height),
    transparent: false,
    pointsAsImage: false,
  }) as Promise<Uint8Array>

/**
 * Puts a figure on the clipboard: the platform's own clipboard where it has one (macOS desktop:
 * PDF, PNG and SVG), else the browser's. Must be called straight from the key press or click
 * (see `writeWebClipboard`). Resolves to the formats written, the clipboard's change count
 * afterwards (desktop) and the SVG with the figure's size.
 */
function copyFigureToClipboard(
  platform: Platform,
  exporter: FigureExporter,
  c: CopySource,
  svg: Promise<FigureSvg>,
): Promise<{ formats: ClipboardFormat[]; stamp: number | null; svg: FigureSvg }> {
  const { copyGraphics } = platform
  if (copyGraphics)
    return svg.then(async (s) => {
      const png = await copyPng(exporter, c, s)
      const pdf = (await exporter.render(c.source, c.target, {
        format: 'pdf',
        mode: 'keepText',
        dpi: COPY_PNG_DPI,
        transparent: false,
        pointsAsImage: false,
      })) as Uint8Array
      return { ...(await copyGraphics(s.svg, png, pdf)), svg: s }
    })
  // Handled below; the clipboard is handed the SVG's text (a failure there is the write's).
  svg.catch(() => {})
  const png = () =>
    svg
      .then((s) => copyPng(exporter, c, s))
      .then((b) => new Blob([b as BlobPart], { type: 'image/png' }))
  return writeWebClipboard(
    svg.then((s) => s.svg),
    png,
  ).then(async (formats) => ({ formats, stamp: null, svg: await svg }))
}

/** The message after a copy: "Copied “Graph 1” as vector (PDF, SVG) and image (PNG)." */
export function describeCopied(what: string, formats: readonly ClipboardFormat[]): string {
  const has = (f: ClipboardFormat) => formats.includes(f)
  const vector = [has('pdf') && 'PDF', has('svg') && 'SVG'].filter(Boolean).join(', ')
  const parts = [
    vector && `vector (${vector})`,
    has('png') && 'image (PNG)',
    !vector && has('text') && 'SVG code (text: Illustrator pastes it as vector)',
  ].filter(Boolean)
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '')
  return `Copied ${what} as ${list}.`
}

// ---- The app's own record of the copy -----------------------------------------------------------

/** What was copied last, for pasting onto a layout page. */
export interface CopiedGraph {
  /** The graph copied; null for a layout page (which can't be pasted onto a page). */
  graph: NodeId | null
  /**
   * Items copied from a layout page (roadmap 32), pasted as copies, with the images they place
   * (so they paste into another project too).
   */
  items?: { items: LayoutItem[]; assets: ImageAsset[] }
  /** The SVG code put on the clipboard as text (web), to recognise it when pasted. */
  text: string | null
  /** The clipboard's change count after the copy (macOS desktop). */
  stamp: number | null
  /**
   * The copy's PNG size in pixels: an image of this size pasted back is taken for the copy
   * itself (a browser's paste carries the PNG as a file), not as a new picture.
   */
  png?: { width: number; height: number }
}

/** Whether an image of this pixel size is the copy's own PNG (to a pixel). */
const isCopiedPng = (copied: CopiedGraph | null, px: { width: number; height: number }) =>
  !!copied?.png &&
  Math.abs(copied.png.width - px.width) <= 1 &&
  Math.abs(copied.png.height - px.height) <= 1

/**
 * Whether a paste carrying one image file is the app's own copy (to paste as the copy) rather
 * than a new picture (to place as an image): the clipboard's text is the copy's, else the image
 * is the copy's PNG — or can't be read (`image` null: WebKit hands a copied PNG over as TIFF).
 */
export function pastedImageIsCopy(
  copied: CopiedGraph | null,
  text: string | null,
  image: { width: number; height: number } | null,
): boolean {
  if (!copied || (!copied.graph && !copied.items)) return false
  if (copied.text !== null && text) return normalise(text) === normalise(copied.text)
  return image === null || isCopiedPng(copied, image)
}

/** What the clipboard holds when pasting, as far as it can be seen. */
export interface ClipboardSeen {
  /** The clipboard's change count now (macOS desktop). */
  stamp?: number | null
  /** Its plain text (a paste event's), '' or absent when there is none or it can't be read. */
  text?: string | null
}

const normalise = (s: string) => s.replace(/\r\n?/g, '\n').trim()

/**
 * The copy a paste should place (a graph or page items): the one copied last, unless the
 * clipboard visibly holds something else since (another change on the desktop; other text in a
 * browser). When the clipboard can't be seen (a paste from the menu, or no text written), the
 * app's record stands.
 */
export function copiedToPaste(copied: CopiedGraph | null, seen: ClipboardSeen): CopiedGraph | null {
  if (!copied || (!copied.graph && !copied.items)) return null
  if (copied.stamp !== null && seen.stamp != null)
    return seen.stamp === copied.stamp ? copied : null
  if (copied.text !== null && seen.text)
    return normalise(seen.text) === normalise(copied.text) ? copied : null
  return copied
}

/** The app's clipboard record (one per window), with change notifications for command states. */
export class GraphClipboard {
  private value: CopiedGraph | null = null
  private listeners = new Set<() => void>()

  get(): CopiedGraph | null {
    return this.value
  }

  set(value: CopiedGraph | null): void {
    this.value = value
    for (const fn of [...this.listeners]) fn()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const graphClipboard = new GraphClipboard()

/**
 * Copies a graph or page and records it; resolves to the message to show. `graph`: the graph's
 * id (null for a page). A graph is recorded even when the system clipboard refused it, so it can
 * still be pasted onto a page. Refused while another export runs (`ExportBusy`).
 */
export function copyToClipboard(
  platform: Platform,
  c: CopySource,
  opts: { what: string; graph: NodeId | null; items?: CopiedGraph['items'] },
  exporter: FigureExporter = figureExports,
): Promise<string> {
  return exporter.exclusive(`Copying ${opts.what}`, () => {
    const svg = exporter.svg(c.source, c.target, 'copy')
    /** The record's extras: the items, and the PNG's pixel size (once the size is known). */
    const extra = async () => {
      const s = await svg.catch(() => null)
      const px = s && imageSize(s, copyPngDpi(s.width, s.height))
      return {
        ...(opts.items ? { items: opts.items } : {}),
        ...(px ? { png: { width: px.w, height: px.h } } : {}),
      }
    }
    return copyFigureToClipboard(platform, exporter, c, svg).then(
      async ({ formats, stamp, svg: s }) => {
        graphClipboard.set({
          graph: opts.graph,
          text: formats.includes('text') ? s.svg : null,
          stamp,
          ...(await extra()),
        })
        return describeCopied(opts.what, formats)
      },
      async (e: unknown) => {
        const keep = opts.graph || opts.items
        graphClipboard.set(
          keep ? { graph: opts.graph, text: null, stamp: null, ...(await extra()) } : null,
        )
        const why = errorMessage(e)
        const still = opts.items
          ? ' The items can still be pasted onto a layout page.'
          : opts.graph
            ? ' The graph can still be pasted onto a layout page.'
            : ''
        throw new Error(
          `The clipboard could not be written here (${why}).${still} Export… saves it as a file.`,
        )
      },
    )
  })
}

/**
 * Copies a graph or page as its SVG code alone, as text. Affinity Designer, Figma and Inkscape
 * paste that as editable vectors, but take a PNG beside it over the SVG, and a browser can't put
 * the PDF they would prefer on the clipboard; so this is a separate command from Copy graph. An
 * SVG still being made (in the export worker) goes as a promise in a `ClipboardItem`, written
 * inside the user's click; a browser without one gets it once made.
 */
export function copySvgCode(
  svg: string | Promise<string>,
  opts: { what: string; graph: NodeId | null },
) {
  const Item = (globalThis as { ClipboardItem?: ClipboardItemClass }).ClipboardItem
  const write =
    typeof svg !== 'string' && typeof navigator.clipboard?.write === 'function' && Item
      ? navigator.clipboard.write([
          new Item({
            'text/plain': svg.then((text) => new Blob([text], { type: 'text/plain' })),
          }) as ClipboardItem,
        ])
      : Promise.resolve(svg).then((text) => navigator.clipboard.writeText(text))
  return write.then(
    async () => {
      graphClipboard.set({ graph: opts.graph, text: await svg, stamp: null })
      return `Copied ${opts.what} as SVG code: Affinity Designer, Figma and Inkscape paste it as vector graphics.`
    },
    (e: unknown) => {
      throw new Error(`The clipboard could not be written here (${errorMessage(e)}).`)
    },
  )
}

/** Copy as SVG code of a figure laid out with every point (in the export worker). */
export const copyFigureSvgCode = (
  c: CopySource,
  opts: { what: string; graph: NodeId | null },
  exporter: FigureExporter = figureExports,
) =>
  exporter.exclusive(`Copying ${opts.what}`, () =>
    copySvgCode(
      exporter.svg(c.source, c.target, 'copy').then((s) => s.svg),
      opts,
    ),
  )
