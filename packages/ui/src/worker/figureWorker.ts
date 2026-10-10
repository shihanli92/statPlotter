import { type FontBytesLoader, type FontRegistry, withFonts } from '@ps/graph'
import { errorMessage } from '../util.ts'
import { createFigureCore, type FigureCore } from './figureCore.ts'
import { type SyncMessage, SyncReceiver } from './figureSync.ts'

// The export worker's message handling (roadmap 42), apart from the worker's own script so tests
// run it in-process (messages structured-cloned as the browser would).

/** The figure core's requests the worker answers. */
export type FigureOp = 'measure' | 'file' | 'raster' | 'tile' | 'put' | 'finish' | 'abort' | 'svg'

export type FigureRequest =
  | SyncMessage
  | { type: 'call'; id: number; op: FigureOp; args: unknown[] }

/** `ready` once loaded, then one answer per call. */
export type FigureReply =
  | { ready: true }
  | { id: number; value: unknown }
  | { id: number; error: string }

/**
 * Answers requests in the order they come, one at a time (a request waiting for a font family
 * holds the next ones, so each sees the document as synced before it).
 */
export function figureWorker(opts: {
  fonts: Promise<FontRegistry>
  /** Loads a font file (for the images' inlined fonts). */
  fontFile?: FontBytesLoader
  post: (msg: FigureReply, transfer: Transferable[]) => void
}): (msg: FigureRequest) => void {
  const doc = new SyncReceiver()
  const encoder = new TextEncoder()
  let fonts: FontRegistry | null = null
  const core: FigureCore = createFigureCore({
    context: () => ({
      project: doc.project,
      result: doc.result,
      asset: doc.asset,
      fonts: fonts!,
    }),
    ...(opts.fontFile ? { fontFile: opts.fontFile } : {}),
  })
  let queue: Promise<void> = opts.fonts.then(
    (f) => {
      fonts = f
    },
    () => {},
  )
  const handle = async (msg: FigureRequest) => {
    if (msg.type !== 'call') {
      if (doc.apply(msg)) core.clear()
      return
    }
    const { id, op, args } = msg
    try {
      if (!fonts) throw new Error('The fonts could not be loaded.')
      const fn = core[op] as (...a: unknown[]) => unknown
      const made = await withFonts(() => fn(...args))
      // An SVG file goes as its UTF-8 bytes (what a download or a file of it holds), encoded
      // here and transferred: the main thread neither copies nor encodes 100 MB of text.
      const value = op === 'file' && typeof made === 'string' ? encoder.encode(made) : made
      const transfer = value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : []
      opts.post({ id, value }, transfer)
    } catch (err) {
      opts.post({ id, error: errorMessage(err) }, [])
    }
  }
  return (msg) => {
    queue = queue.then(() => handle(msg))
  }
}
