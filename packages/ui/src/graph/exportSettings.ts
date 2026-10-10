import type { ExportWidth, LengthUnit, SizeMode } from '@ps/graph'
import type { AppPreferences } from '@ps/model'
import { currentPreferences } from '../styles/styleStore.ts'

export { canBeTransparent } from './figureFiles.ts'

// The Export dialog's settings (roadmap 27): format, width and how it is reached, resolution,
// JPEG quality and background. The last ones used are remembered per user (this browser's
// storage, not the document).

export type ExportFormat = 'pdf' | 'svg' | 'png' | 'tiff' | 'jpeg'

export const EXPORT_FORMATS: Record<
  ExportFormat,
  { label: string; ext: string; mime: string; raster: boolean }
> = {
  pdf: { label: 'PDF (vector)', ext: 'pdf', mime: 'application/pdf', raster: false },
  svg: { label: 'SVG (vector)', ext: 'svg', mime: 'image/svg+xml', raster: false },
  png: { label: 'PNG (image)', ext: 'png', mime: 'image/png', raster: true },
  tiff: { label: 'TIFF (image)', ext: 'tif', mime: 'image/tiff', raster: true },
  jpeg: { label: 'JPEG (image)', ext: 'jpg', mime: 'image/jpeg', raster: true },
}

export interface ExportSettings {
  format: ExportFormat
  width: ExportWidth
  /** Graphs: lay out again at the width keeping text sizes, or scale everything. */
  mode: SizeMode
  /** Raster formats: dots per inch. */
  dpi: number
  /** JPEG: 0.1–1. */
  quality: number
  /** No background (PNG, TIFF, SVG, PDF): only what the graph draws, its own background kept. */
  transparent: boolean
  /**
   * Roadmap 34e: layers of many points (drawn as an image on screen) as an image at `dpi`, the
   * rest still vector; off: every point a vector symbol.
   */
  pointsAsImage: boolean
}

export const DPI_PRESETS = [150, 300, 600, 1200] as const
export const DPI_RANGE = { min: 72, max: 2400 } as const
/** Below this, text is hard to read in print (journals ask for 6–8 pt at least). */
export const MIN_TEXT_PT = 6

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'pdf',
  width: { unit: '%', value: 100 },
  mode: 'keepText',
  dpi: 300,
  quality: 0.9,
  transparent: false,
  pointsAsImage: false,
}

const STORAGE_KEY = 'ps.exportSettings'
const UNITS: readonly (LengthUnit | '%')[] = ['mm', 'cm', 'in', 'pt', '%']

/** Settings read back from storage, each field checked (anything odd: the default). */
export function parseExportSettings(raw: unknown): ExportSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_EXPORT
  const num = (v: unknown, min: number, max: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def
  const w = (typeof o.width === 'object' && o.width !== null ? o.width : {}) as Record<
    string,
    unknown
  >
  const unit = UNITS.includes(w.unit as LengthUnit) ? (w.unit as LengthUnit | '%') : null
  return {
    format:
      typeof o.format === 'string' && o.format in EXPORT_FORMATS
        ? (o.format as ExportFormat)
        : d.format,
    width: unit ? { unit, value: num(w.value, 0.01, 100_000, 100) } : d.width,
    mode: o.mode === 'scale' ? 'scale' : 'keepText',
    dpi: Math.round(num(o.dpi, DPI_RANGE.min, DPI_RANGE.max, d.dpi)),
    quality: num(o.quality, 0.1, 1, d.quality),
    transparent: o.transparent === true,
    pointsAsImage: o.pointsAsImage === true,
  }
}

/**
 * The format and resolution chosen in the Export dialog this session (audit 2, U21, decision
 * 690): they win over the Preferences' until the app is opened again or the Preferences change.
 */
let sessionChoice: Pick<ExportSettings, 'format' | 'dpi'> | null = null

/**
 * The Export dialog's first settings: the format and resolution chosen in it this session, else
 * the Preferences' (PDF and 300 dpi unless they say otherwise); the rest (width, sizing, quality,
 * background, points) as last exported, kept between sessions.
 */
export function loadExportSettings(
  prefs: Pick<AppPreferences, 'exportFormat' | 'exportDpi'> = currentPreferences(),
): ExportSettings {
  let stored = DEFAULT_EXPORT
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    stored = parseExportSettings(text ? JSON.parse(text) : null)
  } catch {
    // No storage (or blocked): the defaults.
  }
  return {
    ...stored,
    format: sessionChoice?.format ?? prefs.exportFormat ?? DEFAULT_EXPORT.format,
    dpi: sessionChoice?.dpi ?? prefs.exportDpi ?? DEFAULT_EXPORT.dpi,
  }
}

/** The Preferences' export format or resolution changed: they apply from the next export on. */
export function forgetExportChoice(): void {
  sessionChoice = null
}

export function saveExportSettings(s: ExportSettings): void {
  sessionChoice = { format: s.format, dpi: s.dpi }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Storage full or blocked: the settings just aren't remembered.
  }
}

/** File names for several exports: file-system safe and unique (ignoring case), "Graph 1 (2)". */
export function uniqueFileNames(names: readonly string[], ext: string): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const base = fileBaseOf(name, 'untitled')
    let file = `${base}.${ext}`
    for (let k = 2; used.has(file.toLowerCase()); k++) file = `${base} (${k}).${ext}`
    used.add(file.toLowerCase())
    return file
  })
}

/**
 * A file name from a sheet name: characters file systems refuse (and control characters)
 * replaced, no leading or trailing dots or spaces (Windows drops them).
 */
export const fileBaseOf = (name: string, fallback: string) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: replacing them is the point
  name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '') || fallback
