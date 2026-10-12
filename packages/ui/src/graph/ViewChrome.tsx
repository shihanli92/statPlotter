import { type SampledPoints, SCREEN_POINTS, sampledNote } from '@ps/graph'
import type { NodeId } from '@ps/model'
import { useState, useSyncExternalStore } from 'react'
import { isMacPlatform, zoomHint } from '../commands/index.ts'
import { Tooltip } from '../components/Tooltip.tsx'
import { zoomChoices } from './zoom.ts'

// Parts the graph and layout views share around their canvas.

/**
 * The view toolbar's zoom menu: its levels, and the zoom between them the wheel or a pinch left
 * (roadmap 50), its tooltip the keys and gestures.
 */
export function ZoomSelect({
  zooms,
  zoom,
  onChange,
}: {
  zooms: readonly number[]
  zoom: number
  onChange: (zoom: number) => void
}) {
  const [isMac] = useState(isMacPlatform)
  return (
    <Tooltip content={zoomHint(isMac)}>
      <label className="inline">
        Zoom{' '}
        <select value={zoom} onChange={(e) => onChange(Number(e.target.value))}>
          {zoomChoices(zooms, zoom).map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
      </label>
    </Tooltip>
  )
}

/** What laying out the scene could not do as asked, under the canvas. */
export function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (!warnings.length) return null
  return (
    <ul className="warnings">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  )
}

// Points on screen (decision 450): a graph or page drawn with every point instead of at most
// `SCREEN_POINTS` per column or group — the view's choice for this session (not saved in the
// document; exports always draw every point).

const everyPoint = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (f: () => void) => {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Whether a graph or page (`id`) is drawn with every point on screen, and the switch. */
export function useEveryPoint(id: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => everyPoint.has(id))
  const set = (v: boolean) => {
    if (v === everyPoint.has(id)) return
    if (v) everyPoint.add(id)
    else everyPoint.delete(id)
    for (const f of listeners) f()
  }
  return [on, set]
}

/** The View menu's label for drawing every point on screen. */
export const EVERY_POINT_LABEL = 'Every point on screen'
export const EVERY_POINT_HINT = `Draw every point standing for a row, not at most ${SCREEN_POINTS.toLocaleString('en-US')} per column or group (many points are drawn as images); exports always draw every point`

/**
 * The note under a canvas that draws fewer points than the data has (decision 450), with the
 * switch to draw them all; when they all are drawn by choice, the switch back.
 */
export function ScreenSampleNote({
  sampled,
  every,
  onEvery,
}: {
  sampled: SampledPoints | undefined
  every: boolean
  onEvery: (on: boolean) => void
}) {
  if (!sampled && !every) return null
  return (
    <p className="screen-sample-note" role="note">
      {sampled ? sampledNote(sampled) : 'Every point is drawn on screen'}{' '}
      <button type="button" className="link" onClick={() => onEvery(!every)}>
        {every
          ? `Show at most ${SCREEN_POINTS.toLocaleString('en-US')} per column`
          : 'Show all on screen'}
      </button>
    </p>
  )
}

/**
 * Roadmap 43: the note under the toolbar of a graph whose table has no values yet (its frame is
 * drawn empty), with the way to the table. On screen only: exports draw the graph as it is.
 */
export function EmptyGraphNote({
  table,
  onOpen,
}: {
  table: { id: NodeId; name: string } | undefined
  onOpen?: (id: NodeId) => void
}) {
  if (!table) return null
  return (
    <p className="screen-sample-note empty-graph-note" role="note">
      No values yet: enter data in “{table.name}”
      {onOpen && (
        <>
          {' '}
          <button type="button" className="link" onClick={() => onOpen(table.id)}>
            Go to table
          </button>
        </>
      )}
    </p>
  )
}
