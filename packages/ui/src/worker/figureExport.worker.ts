import { browserFontLoader, FontRegistry } from '@ps/graph'
import { type FigureReply, type FigureRequest, figureWorker } from './figureWorker.ts'

// Minimal worker scope typing (the DOM and WebWorker libs can't share one program).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<FigureRequest>) => void) | null
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
}

// Figure exports off the main thread (roadmap 42): graphs and pages laid out with every point and
// written as SVG or PDF, or as the SVGs the main thread draws images from. The fonts come from the
// same bundled files the page loads (from the browser's cache), each family when first needed.
const handle = figureWorker({
  fonts: FontRegistry.load(browserFontLoader, []),
  fontFile: browserFontLoader,
  post: (msg, transfer) => scope.postMessage(msg, transfer),
})
scope.onmessage = (e) => handle(e.data)

scope.postMessage({ ready: true } satisfies FigureReply)
