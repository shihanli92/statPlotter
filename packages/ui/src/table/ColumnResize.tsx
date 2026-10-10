import type { Command } from '@ps/engine'
import { columnWidthKey, type DataTable, type GridColumn } from '@ps/model'
import { type CSSProperties, type RefObject, useState } from 'react'
import { clampWidth, fitWidth, storedWidth } from './columnWidths.ts'

// Column widths in the grid (roadmap 29): a handle at each header's right edge is dragged to
// resize (stored on release, one undo step) and double-clicked to fit the content.

/** Fixed widths a cell takes: narrower than its content clips it (with an ellipsis). */
export const widthStyle = (w: number | undefined): CSSProperties | undefined =>
  w === undefined ? undefined : { width: w, minWidth: w, maxWidth: w }

export function useColumnWidths({
  table,
  cols,
  readOnly,
  grid,
  dispatch,
}: {
  table: DataTable
  cols: readonly GridColumn[]
  readOnly: boolean
  /** The grid element, whose font a fit measures in. */
  grid: RefObject<HTMLElement | null>
  dispatch: (cmd: Command, label: string) => boolean
}) {
  // The width shown while a handle is dragged.
  const [resizing, setResizing] = useState<{ key: string; w: number } | null>(null)
  const set = (key: string, w: number, label: string) =>
    dispatch({ type: 'table.setColumnWidths', table: table.id, widths: { [key]: w } }, label)

  const start = (e: React.MouseEvent, key: string, span: number) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).parentElement
    if (!th) return
    const startX = e.clientX
    const startW = th.getBoundingClientRect().width / span
    const widthAt = (x: number) => clampWidth(startW + (x - startX) / span)
    const onMove = (m: MouseEvent) => setResizing({ key, w: widthAt(m.clientX) })
    const onUp = (m: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      setResizing(null)
      if (m.clientX !== startX) set(key, widthAt(m.clientX), 'Resize column')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp, { once: true })
  }

  const fit = (key: string) => {
    const ctx = document.createElement('canvas').getContext('2d')
    const family = grid.current ? getComputedStyle(grid.current).fontFamily : 'sans-serif'
    const measure = (text: string, bold: boolean) => {
      if (!ctx) return text.length * 7
      ctx.font = `${bold ? 600 : 400} 13px ${family}`
      return ctx.measureText(text).width
    }
    set(key, fitWidth(table, cols, key, measure), 'Fit column')
  }

  return {
    /** A grid column's width now (stored, or being dragged); undefined: sized to the content. */
    widthOf: (col: GridColumn) =>
      resizing?.key === columnWidthKey(col) ? resizing.w : storedWidth(table, col),
    /** The handle in a header cell spanning `span` grid columns of `key`. */
    handle: (key: string, span: number) =>
      readOnly ? null : (
        // biome-ignore lint/a11y/noStaticElementInteractions: a drag handle (a double-click fits)
        <span
          className="col-resize"
          title="Drag to resize; double-click to fit the content"
          onMouseDown={(e) => start(e, key, span)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            fit(key)
          }}
        />
      ),
  }
}
