import type { Scene } from '@ps/graph'
import { errorMessage } from '../util.ts'
import type { FigureTarget } from '../worker/figureCore.ts'
import { type FigureExporter, type FigureSource, figureExports } from '../worker/figureExport.ts'
import { printSvg } from './figureFiles.ts'

// File › Print… (roadmap 27): the graph or layout page printed at its real size. A print-only
// element holds the scene's SVG sized in points (1/72 in on paper), the print style sheet hides
// the app (`html.printing`, styles.css) and an @page rule sizes the paper: a layout page's own
// size without margins (the page has its own), a graph's size plus half an inch all round.
// Browsers print with window.print(); the desktop app's webview on macOS (WKWebView has no
// window.print) gets it from Tauri, which runs the webview's print operation instead.

/** Margin round a printed graph, in points. */
export const PRINT_MARGIN = 36

const ROOT_CLASS = 'print-root'
const STYLE_ID = 'print-page-style'

/** The @page rule: the paper's size in points and its margin. */
export function pageRule(
  scene: { width: number; height: number },
  page?: { width: number; height: number },
): string {
  const m = page ? 0 : PRINT_MARGIN
  const w = (page?.width ?? scene.width) + 2 * m
  const h = (page?.height ?? scene.height) + 2 * m
  const f = (v: number) => Math.round(v * 100) / 100
  return `@page { size: ${f(w)}pt ${f(h)}pt; margin: ${m}pt; }`
}

/** Removes what `preparePrint` added. */
function clearPrint(doc: Document = document): void {
  doc.documentElement.classList.remove('printing')
  doc.querySelector(`.${ROOT_CLASS}`)?.remove()
  doc.getElementById(STYLE_ID)?.remove()
}

/**
 * Puts the scene into the print-only element and sets the page size, replacing a previous one.
 * `page`: a layout page's size (printed edge to edge).
 */
function preparePrint(
  figure: { svg: string; width: number; height: number },
  page?: { width: number; height: number },
  doc: Document = document,
): HTMLElement {
  clearPrint(doc)
  const root = doc.createElement('div')
  root.className = ROOT_CLASS
  // The app's font stacks: the document has the bundled fonts loaded (@font-face).
  root.innerHTML = figure.svg
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = pageRule(figure, page)
  doc.head.append(style)
  doc.body.append(root)
  doc.documentElement.classList.add('printing')
  return root
}

/**
 * Prints the scene at its real size. What was set up is removed after printing; where the
 * browser doesn't say so (the desktop app's print sheet), it stays hidden until the next print.
 */
export function printScene(scene: Scene, page?: { width: number; height: number }): void {
  printFigure({ svg: printSvg(scene), width: scene.width, height: scene.height }, page)
}

/** Prints a figure's print SVG (`printSvg`; made in the export worker for a large one). */
export function printFigure(
  figure: { svg: string; width: number; height: number },
  page?: { width: number; height: number },
): void {
  preparePrint(figure, page)
  window.addEventListener('afterprint', () => clearPrint(), { once: true })
  window.print()
}

/**
 * File › Print… of a view: what it shows when that is every point (at once, as before), else the
 * figure laid out with every point in the export worker (roadmap 42), then printed.
 */
export function printView(
  shown: Scene,
  figure: { source: FigureSource; target: FigureTarget },
  onError: (msg: string) => void,
  page?: { width: number; height: number },
  exporter: FigureExporter = figureExports,
): void {
  if (!shown.sampled) {
    printScene(shown, page)
    return
  }
  exporter
    .exclusive('Preparing to print', () =>
      exporter.svg(figure.source, figure.target, 'print').then((f) => printFigure(f, page)),
    )
    .catch((e: unknown) => onError(`Print failed: ${errorMessage(e)}`))
}
