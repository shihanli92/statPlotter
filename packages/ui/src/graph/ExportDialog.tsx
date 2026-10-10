import {
  type ExportWidth,
  fromPoints,
  JOURNAL_WIDTHS,
  type LengthUnit,
  VECTOR_POINTS_NOTICE,
  widthInPoints,
} from '@ps/graph'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Checkbox, Field, NumberBox, RadioGroup } from '../components/fields.tsx'
import { useServices } from '../context.tsx'
import type { AppServices } from '../services.ts'
import { errorMessage } from '../util.ts'
import type { FigureItem, FigureMeasure } from '../worker/figureCore.ts'
import { type FigureExporter, type FigureSource, figureExports } from '../worker/figureExport.ts'
import {
  canBeTransparent,
  DPI_PRESETS,
  DPI_RANGE,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportSettings,
  fileBaseOf,
  loadExportSettings,
  MIN_TEXT_PT,
  saveExportSettings,
} from './exportSettings.ts'
import { imageSize, imageTooLarge } from './figureFiles.ts'
import { exportFigure, type ExportFormat as QuickFormat } from './viewCommands.ts'

/** How far an export has got: items done of all, and the fraction of the current one. */
export interface ExportProgress {
  done: number
  total: number
  /** The item being exported, and how much of it (raster bands) is done. */
  current?: { name: string; fraction: number }
}

/** What exports read now: the document, the latest results, the images, the fonts. */
export const figureSourceOf = (
  s: Pick<AppServices, 'store' | 'engine' | 'assets' | 'fonts'>,
): FigureSource => ({
  project: s.store.getState(),
  result: (id) => s.engine.latest(id),
  asset: (id) => s.assets.get(id),
  fonts: s.fonts,
})

/** What export is running, if any (to disable what would start another). */
export function useExportActivity(exporter: FigureExporter = figureExports) {
  return useSyncExternalStore(exporter.subscribe, () => exporter.activity)
}

/**
 * A view's export: `exportAs` writes the figure straight to a file in one format at its own size
 * (File › Export ▸ SVG / PDF / PNG), `open` shows the Export… dialog, and `dialog` is that dialog
 * while it is shown. The files are made in the export worker (roadmap 42).
 */
export function useExport(
  figure: () => FigureItem,
  fallback: 'graph' | 'layout',
  onError: (msg: string) => void,
) {
  const services = useServices()
  const { platform } = services
  const [shown, setShown] = useState<{ item: FigureItem; source: FigureSource } | null>(null)
  const exportAs = (format: QuickFormat) => {
    const item = figure()
    return exportFigure(
      platform,
      figureSourceOf(services),
      item,
      fileBaseOf(item.name, fallback),
      format,
    ).catch((e: unknown) => onError(`${format.toUpperCase()} export failed: ${errorMessage(e)}`))
  }
  const dialog = shown && (
    <ExportDialog
      title={`Export “${shown.item.name}”`}
      items={[shown.item]}
      source={shown.source}
      pages={fallback === 'layout'}
      onRun={(s, progress) => {
        const { item, source } = shown
        const f = EXPORT_FORMATS[s.format]
        return figureExports.exclusive(
          `Exporting “${item.name}”`,
          () =>
            platform.exportFile(
              () =>
                figureExports.render(source, item.target, s, {
                  title: item.name,
                  onProgress: (fraction) =>
                    progress({ done: 0, total: 1, current: { name: item.name, fraction } }),
                }),
              `${fileBaseOf(item.name, fallback)}.${f.ext}`,
              f.mime,
            ),
          { status: false },
        )
      }}
      onError={(e) => onError(`Export failed: ${e}`)}
      onClose={() => setShown(null)}
    />
  )
  return {
    exportAs,
    open: () => setShown({ item: figure(), source: figureSourceOf(services) }),
    dialog,
  }
}

const UNITS: { value: LengthUnit | '%'; label: string }[] = [
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'in' },
  { value: 'pt', label: 'pt' },
  { value: '%', label: '%' },
]

/** The width in another unit, the size unchanged (percentages of the natural width). */
function convertWidth(w: ExportWidth, unit: LengthUnit | '%', natural: number): ExportWidth {
  const pt = widthInPoints(w, natural)
  return {
    unit,
    value: unit === '%' ? Math.round((pt / natural) * 1000) / 10 : fromPoints(pt, unit),
  }
}

const sameWidth = (a: ExportWidth, b: ExportWidth) => a.unit === b.unit && a.value === b.value

/** "85 × 63.2 mm". */
function sizeText(size: { width: number; height: number }, unit: LengthUnit) {
  return `${fromPoints(size.width, unit)} × ${fromPoints(size.height, unit)} ${unit}`
}

/** The figures measured at a size (the key), or why they couldn't be. */
type Measured = { key: string; list: FigureMeasure[] } | { key: string; error: string }

/**
 * The figures measured at the dialog's size, in the export worker (laying a large graph out with
 * every point takes seconds): one request at a time, the latest size asked for next. `current`
 * is false while the size shown is not the one set.
 */
function useMeasured(
  exporter: FigureExporter,
  source: FigureSource,
  items: readonly FigureItem[],
  size: Pick<ExportSettings, 'width' | 'mode'>,
) {
  const key = JSON.stringify([size.width, size.mode])
  const [measured, setMeasured] = useState<Measured | null>(null)
  const running = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the size
  useEffect(() => {
    if (running.current || measured?.key === key) return
    running.current = true
    const targets = items.map((it) => it.target)
    exporter
      .measure(source, targets, { width: size.width, mode: size.mode })
      .then(
        (list): Measured => ({ key, list }),
        (e: unknown): Measured => ({ key, error: errorMessage(e) }),
      )
      .then((m) => {
        running.current = false
        if (live.current) setMeasured(m)
      })
  }, [key, measured])
  return { measured, current: measured?.key === key }
}

/**
 * Export… of a graph or layout page, or of all of them (File › Export ▸ All graphs… / All layout
 * pages…): the format, the width (a unit, a percentage or a journal's column width) and whether
 * text keeps its size, the resolution of images, JPEG quality, a transparent background. It
 * shows the resulting size, the pixel size and the smallest text (measured in the export worker,
 * roadmap 42), and the progress while the files are made. The settings are remembered for next
 * time.
 */
export function ExportDialog({
  title,
  items,
  source,
  pages,
  noun,
  onRun,
  onError,
  onClose,
  exporter = figureExports,
}: {
  title: string
  /** What is exported: one graph or page, or several. */
  items: readonly FigureItem[]
  /** The document as it was when the dialog opened. */
  source: FigureSource
  /** Layout pages: always scaled as a whole. */
  pages: boolean
  /** What several items are called (default "graphs", or "pages"); roadmap 47: both. */
  noun?: string
  /** Makes the files, reporting progress; the dialog closes when it settles. */
  onRun: (s: ExportSettings, progress: (p: ExportProgress) => void) => Promise<void>
  onError: (message: string) => void
  onClose: () => void
  exporter?: FigureExporter
}) {
  const [s, setS] = useState(loadExportSettings)
  const [customDpi, setCustomDpi] = useState(() => !DPI_PRESETS.includes(s.dpi as 300))
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const set = (patch: Partial<ExportSettings>) => setS((old) => ({ ...old, ...patch }))
  const settings: ExportSettings = pages ? { ...s, mode: 'scale' } : s
  const format = EXPORT_FORMATS[s.format]
  const activity = useExportActivity(exporter)

  // The files' sizes, smallest text and points (laid out again or scaled), as last measured.
  const { measured, current } = useMeasured(exporter, source, items, settings)
  const sized = measured && 'list' in measured ? measured.list : []
  const natural = sized[0]?.natural ?? 72
  const minText = Math.min(...sized.map((m) => m.minText ?? Number.POSITIVE_INFINITY))
  const unit: LengthUnit = s.width.unit === '%' ? 'mm' : s.width.unit
  const tooLarge = format.raster
    ? sized.flatMap((m) => {
        const px = imageSize(m, s.dpi)
        const why = imageTooLarge(s.format as 'png', px.w, px.h)
        return why ? [why] : []
      })
    : []
  const single = items.length === 1 ? sized[0] : undefined
  // Layers of many points (roadmap 34e): offered as an image; a notice for many vector points.
  const clouds = sized.some((m) => m.clouds)
  const points = Math.max(0, ...sized.map((m) => m.points))
  const imagePoints = clouds && s.pointsAsImage
  const manyVectors = points > VECTOR_POINTS_NOTICE && !imagePoints
  const failed = measured && 'error' in measured ? measured.error : null
  const blocked =
    !items.length ||
    !current ||
    !!failed ||
    (single ? tooLarge.length > 0 : tooLarge.length === items.length)

  const run = () => {
    saveExportSettings(s)
    setProgress({ done: 0, total: items.length })
    onRun(settings, setProgress).then(onClose, (e: unknown) => {
      onError(errorMessage(e))
      onClose()
    })
  }

  const formats = (Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((f) => ({
    value: f,
    label: EXPORT_FORMATS[f].label,
  }))
  const presets: { label: string; width: ExportWidth }[] = [
    { label: 'Actual size', width: { unit: '%', value: 100 } },
    ...JOURNAL_WIDTHS.map((j) => ({
      label: `${j.label} (${j.mm} mm)`,
      width: { unit: 'mm' as const, value: j.mm },
    })),
  ]
  const running = progress !== null
  // Another export (a copy, File › Export ▸) still running: this one waits for it.
  const otherRunning = !running && activity !== null
  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!running) onClose()
      }}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={blocked || running || otherRunning}
            onClick={run}
          >
            {running ? 'Exporting…' : 'Export…'}
          </button>
        </>
      }
    >
      <fieldset className="export-options" disabled={running}>
        <RadioGroup
          legend="Format"
          name="export-format"
          value={s.format}
          options={formats}
          onChange={(format) => set({ format })}
        />
        <Field label="Width" help="The height follows the proportions.">
          {(id, describedBy) => (
            <>
              <div className="inline">
                <NumberBox
                  id={id}
                  aria-describedby={describedBy}
                  value={s.width.value}
                  min={0.01}
                  max={100_000}
                  onChange={(value) => set({ width: { ...s.width, value } })}
                />
                <select
                  aria-label="Width unit"
                  className="unit"
                  value={s.width.unit}
                  onChange={(e) =>
                    set({ width: convertWidth(s.width, e.target.value as LengthUnit, natural) })
                  }
                >
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="export-presets">
                {presets.map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    className={sameWidth(p.width, s.width) ? 'on' : ''}
                    aria-pressed={sameWidth(p.width, s.width)}
                    onClick={() => set({ width: p.width })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </Field>
        {pages ? (
          <p className="help">Pages are scaled as a whole, text and graphs with them.</p>
        ) : (
          <RadioGroup
            legend="Size"
            name="export-mode"
            value={s.mode}
            options={[
              {
                value: 'keepText',
                label: 'Keep text size',
                title:
                  'Lay the graph out again at this width: fonts, symbols and lines keep their size',
              },
              {
                value: 'scale',
                label: 'Scale everything',
                title: 'Scale the whole graph, text included, like a picture',
              },
            ]}
            onChange={(mode) => set({ mode })}
          />
        )}
        {clouds && (
          <>
            <Checkbox
              label="Points as image"
              checked={s.pointsAsImage}
              onChange={(pointsAsImage) => set({ pointsAsImage })}
            />
            <p className="help">
              Layers of many points as an image at the resolution below; axes, text and other layers
              stay vector. Off: every point a vector symbol.
            </p>
          </>
        )}
        {(format.raster || imagePoints) && (
          <Field label={format.raster ? 'Resolution' : 'Points’ resolution'}>
            {(id) => (
              <div className="inline">
                <select
                  id={id}
                  value={customDpi ? 'custom' : s.dpi}
                  onChange={(e) => {
                    const v = e.target.value
                    setCustomDpi(v === 'custom')
                    if (v !== 'custom') set({ dpi: Number(v) })
                  }}
                >
                  {DPI_PRESETS.map((d) => (
                    <option key={d} value={d}>
                      {d} dpi
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
                {customDpi && (
                  <NumberBox
                    aria-label="Dots per inch"
                    value={s.dpi}
                    min={DPI_RANGE.min}
                    max={DPI_RANGE.max}
                    onChange={(dpi) => set({ dpi: Math.round(dpi) })}
                  />
                )}
              </div>
            )}
          </Field>
        )}
        {s.format === 'jpeg' && (
          <Field label="Quality">
            {(id) => (
              <div className="inline">
                <input
                  id={id}
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(s.quality * 100)}
                  onChange={(e) => set({ quality: Number(e.target.value) / 100 })}
                />
                <span>{Math.round(s.quality * 100)}%</span>
              </div>
            )}
          </Field>
        )}
        {canBeTransparent(s.format) ? (
          <Checkbox
            label="Transparent background"
            checked={s.transparent}
            onChange={(transparent) => set({ transparent })}
          />
        ) : (
          <p className="help">JPEG has no transparency: the background is white.</p>
        )}
      </fieldset>
      <div
        className={`export-summary${current ? '' : ' measuring'}`}
        aria-live="polite"
        aria-busy={!current}
      >
        {failed && <div className="error">{failed}</div>}
        {items.length === 1 && !single && !failed && <div>Measuring…</div>}
        {single ? (
          <div>
            Size: {sizeText(single, unit)}
            {format.raster &&
              ` · ${imageSize(single, s.dpi).w.toLocaleString('en-US')} × ${imageSize(single, s.dpi).h.toLocaleString('en-US')} px`}
          </div>
        ) : items.length > 1 ? (
          <div>
            {items.length} {noun ?? (pages ? 'pages' : 'graphs')}, each{' '}
            {s.width.unit === '%'
              ? `at ${s.width.value}%`
              : `${s.width.value} ${s.width.unit} wide`}
            {format.raster && ` at ${s.dpi} dpi`}
          </div>
        ) : null}
        {Number.isFinite(minText) && (
          <div className={minText < MIN_TEXT_PT ? 'warning' : ''}>
            Smallest text: {Math.round(minText * 10) / 10} pt
            {minText < MIN_TEXT_PT && ' — below 6 pt, hard to read in print'}
          </div>
        )}
        {manyVectors && (
          <div className="warning" role="note">
            {points.toLocaleString('en-US')} points drawn as vectors: the file will be large (about{' '}
            {Math.max(1, Math.round((points * 90) / 2 ** 20)).toLocaleString('en-US')} MB as SVG)
            and slow to open.{clouds ? ' Tick “Points as image” for a small, quick file.' : ''}
          </div>
        )}
        {tooLarge.length > 0 &&
          (single ? (
            <div className="error">{tooLarge[0]}</div>
          ) : (
            <div className="warning">
              {tooLarge.length} of {items.length} are too large at this resolution and will be left
              out.
            </div>
          ))}
        {otherRunning && (
          <div className="warning">
            {activity.label} is still under way: export once it has finished.
          </div>
        )}
        {progress && (
          <div className="export-progress">
            <progress
              max={1}
              value={
                (progress.done + (progress.current?.fraction ?? 0)) / Math.max(1, progress.total)
              }
            />
            <span>
              {progress.total > 1
                ? `${progress.done} of ${progress.total}${progress.current ? `: ${progress.current.name}` : ''}`
                : 'Exporting…'}
            </span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
