import { type Command, GROUPS, TOOLBAR_GROUPS } from '../commands/index.ts'
import type { Platform } from '../services.ts'
import type { FigureItem } from '../worker/figureCore.ts'
import { type FigureExporter, type FigureSource, figureExports } from '../worker/figureExport.ts'
import { stepZoom } from './zoom.ts'

export { fileBaseOf } from './exportSettings.ts'

// Commands the graph and layout views share: File › Export ▸, File › Print… and View › Zoom.

/** The formats File › Export ▸ writes straight away (the Export… dialog has more). */
export type ExportFormat = 'svg' | 'png' | 'pdf' | 'tiff'

const MIME: Record<ExportFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  pdf: 'application/pdf',
  tiff: 'image/tiff',
}
const EXT: Record<ExportFormat, string> = { svg: 'svg', png: 'png', pdf: 'pdf', tiff: 'tif' }

/**
 * Format… on the graph and layout views (roadmap 43): ⇧⌘E (⌘E is the table's Exclude; F2
 * renames sheets in the navigator and edits cells).
 */
export const FORMAT_SHORTCUT = 'Mod+Shift+E'

/**
 * Offers the figure as a file at its own size: SVG, PNG at `dpi`, or vector PDF (titled
 * `fileBase`), made in the export worker once the location is chosen.
 */
export function exportFigure(
  platform: Platform,
  source: FigureSource,
  item: FigureItem,
  fileBase: string,
  format: ExportFormat,
  dpi = 300,
  exporter: FigureExporter = figureExports,
): Promise<void> {
  const s = { format, mode: 'keepText', dpi, transparent: false, pointsAsImage: false } as const
  return exporter.exclusive(`Exporting “${item.name}”`, (progress) =>
    platform.exportFile(
      () =>
        exporter.render(source, item.target, s, {
          ...(format === 'pdf' ? { title: fileBase } : {}),
          onProgress: progress,
        }),
      `${fileBase}.${EXT[format]}`,
      MIME[format],
    ),
  )
}

const exportMenu = (order: number) => ({
  menu: 'file' as const,
  group: GROUPS.file.export,
  order,
  submenu: 'Export',
})

/**
 * File › Export ▸ SVG / PDF / PNG / TIFF (each straight to a file at the graph's size), the
 * toolbar's Export… (format, size, resolution and background chosen in a dialog first; its ▾
 * offers the four), and File › Print… (⌘P).
 */
export function exportCommands(opts: {
  run: (format: ExportFormat) => void
  openDialog: () => void
  print: () => void
}): Command[] {
  return [
    {
      id: 'file.export.svg',
      label: 'SVG…',
      menu: exportMenu(10),
      keywords: ['export svg', 'vector'],
      hint: 'Export as SVG (vector; opens in Illustrator, Inkscape, browsers)',
      run: () => opts.run('svg'),
    },
    {
      id: 'file.export.pdf',
      label: 'PDF…',
      menu: exportMenu(20),
      keywords: ['export pdf', 'vector'],
      hint: 'Export as vector PDF (fonts embedded, text selectable)',
      run: () => opts.run('pdf'),
    },
    {
      id: 'file.export.png',
      label: 'PNG (300 dpi)…',
      menu: exportMenu(30),
      keywords: ['export png', 'image', 'bitmap'],
      hint: 'Export as a PNG image at 300 dots per inch',
      run: () => opts.run('png'),
    },
    {
      id: 'file.export.tiff',
      label: 'TIFF (300 dpi)…',
      menu: exportMenu(35),
      keywords: ['export tiff', 'tif', 'image', 'bitmap', 'journal'],
      hint: 'Export as a TIFF image at 300 dots per inch',
      run: () => opts.run('tiff'),
    },
    {
      id: 'file.export',
      label: 'Export…',
      icon: 'download',
      menu: exportMenu(5),
      toolbar: {
        group: TOOLBAR_GROUPS.view,
        order: 90,
        split: {
          label: 'Export as',
          items: ['file.export.svg', 'file.export.pdf', 'file.export.png', 'file.export.tiff'],
        },
      },
      keywords: ['export', 'save image', 'tiff', 'jpeg', 'journal', 'mm', 'transparent'],
      hint: 'Export as PDF, SVG, PNG, TIFF or JPEG at a chosen width, resolution and background',
      run: opts.openDialog,
    },
    {
      id: 'file.print',
      label: 'Print…',
      menu: { menu: 'file', group: GROUPS.file.print, order: 10 },
      shortcut: 'Mod+P',
      inTextFields: true,
      icon: 'printer',
      keywords: ['print', 'printer', 'paper'],
      hint: 'Print at the actual size',
      run: opts.print,
    },
  ]
}

const COPY_KEYWORDS = ['copy as vector', 'clipboard', 'svg', 'pdf', 'illustrator', 'powerpoint']

/**
 * Edit › Copy (⌘C), Copy graph, Copy page (⇧⌘C) and Paste (⌘V) of the graph and layout views
 * (roadmap 23). ⌘C and ⌘V stay the browser's (`nativeShortcut`): the views take its copy and
 * paste events only when no text field has focus and no text is selected (`clipboardEvents.ts`),
 * so text keeps its own clipboard keys; chosen from a menu, they run directly. ⇧⌘C copies the
 * whole sheet — the graph, or the page — and is on the icon toolbar.
 */
export function copyCommands(opts: {
  /** Edit › Copy: the graph; on a page, the graph selected alone, else the page. */
  copy: { hint: string; run: () => void }
  /** Copy graph: the view's graph, or the graph selected alone on a page. */
  graph: { enabled: boolean; run: () => void }
  /** Copy page (layouts): takes ⇧⌘C, which is Copy graph's otherwise. */
  page?: () => void
  /** Copy as SVG code: what Copy graph (or, on a page, Copy) would copy, as SVG text alone. */
  svgCode: () => void
  /** Paste (layouts): the copied graph (or page items) onto the page. */
  paste?: { enabled: boolean; run: () => void; label?: string; hint?: string }
}): Command[] {
  const clip = (order: number) => ({ menu: 'edit' as const, group: GROUPS.edit.clipboard, order })
  const sheet = { shortcut: 'Mod+Shift+C', icon: 'clipboard-copy' }
  const toolbar = { toolbar: { group: TOOLBAR_GROUPS.view, order: 85, label: 'Copy' } }
  const cmds: Command[] = [
    {
      id: 'edit.copy',
      label: 'Copy',
      menu: clip(20),
      shortcut: 'Mod+C',
      nativeShortcut: true,
      icon: 'copy',
      hint: opts.copy.hint,
      run: opts.copy.run,
    },
    {
      id: 'edit.copyGraph',
      label: 'Copy graph',
      menu: clip(22),
      ...(opts.page ? {} : { ...sheet, ...toolbar }),
      enabled: opts.graph.enabled,
      keywords: COPY_KEYWORDS,
      hint: 'Copy the graph as vector graphics and an image, to paste into Illustrator, Word, PowerPoint… or onto a layout page',
      run: opts.graph.run,
    },
  ]
  const { page, paste } = opts
  if (page)
    cmds.push({
      id: 'edit.copyPage',
      label: 'Copy page',
      menu: clip(24),
      ...sheet,
      ...toolbar,
      keywords: COPY_KEYWORDS,
      hint: 'Copy the whole page as vector graphics and an image, to paste into Illustrator, Word, PowerPoint…',
      run: page,
    })
  cmds.push({
    id: 'edit.copySvgCode',
    label: 'Copy as SVG code',
    menu: clip(26),
    keywords: COPY_KEYWORDS,
    hint: `Copy ${page ? 'the graph selected alone, else the selected items, else the page,' : 'the graph'} as SVG code only: Affinity Designer, Figma and Inkscape paste it as editable vector graphics`,
    run: opts.svgCode,
  })
  if (paste)
    cmds.push({
      id: 'edit.paste',
      label: paste.label ?? 'Paste graph',
      menu: clip(30),
      shortcut: 'Mod+V',
      nativeShortcut: true,
      icon: 'clipboard-paste',
      enabled: paste.enabled,
      hint:
        paste.hint ??
        'Place the graph copied last on the page (linked: it keeps following its data)',
      run: paste.run,
    })
  return cmds
}

/** View › Zoom in / Zoom out / Actual size, stepping through `zooms`. */
export function zoomCommands(
  zooms: readonly number[],
  zoom: number,
  setZoom: (z: number) => void,
): Command[] {
  const menu = (order: number) => ({ menu: 'view' as const, group: GROUPS.view.zoom, order })
  const zoomIn = {
    label: 'Zoom in',
    enabled: stepZoom(zooms, zoom, 1) !== zoom,
    // Also from the zoom box (a select): nothing to type there.
    inTextFields: true,
    run: () => setZoom(stepZoom(zooms, zoom, 1)),
  }
  return [
    { id: 'view.zoomIn', ...zoomIn, menu: menu(10), shortcut: 'Mod+=', icon: 'zoom-in' },
    // ⌘+ with Shift, and the keypad's +.
    { id: 'view.zoomInShift', ...zoomIn, shortcut: 'Mod+Shift++', hideInPalette: true },
    { id: 'view.zoomInKeypad', ...zoomIn, shortcut: 'Mod++', hideInPalette: true },
    {
      id: 'view.zoomOut',
      label: 'Zoom out',
      menu: menu(20),
      shortcut: 'Mod+-',
      icon: 'zoom-out',
      enabled: stepZoom(zooms, zoom, -1) !== zoom,
      inTextFields: true,
      run: () => setZoom(stepZoom(zooms, zoom, -1)),
    },
    {
      id: 'view.actualSize',
      label: 'Actual size',
      menu: menu(30),
      shortcut: 'Mod+0',
      hint: '100%: the printed size (1 pt = 1/72 in)',
      enabled: zoom !== 1,
      inTextFields: true,
      run: () => setZoom(1),
    },
  ]
}
