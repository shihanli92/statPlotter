import { AssetError } from '@ps/io'
import type { LayoutItem, LayoutNode, NodeId } from '@ps/model'
import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Select } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'
import { newPageOf } from '../layout/figure.ts'
import { imageAsset } from '../layout/images.ts'
import { imageItemFor } from '../layout/tools.ts'
import { errorMessage, nextName } from '../util.ts'

// Images dropped anywhere but on a layout page (roadmap 39): put them on a page (one of the
// project's, or a new one), or ignore them.

const NEW = '\u0000new'
/** Images after the first are placed this far down and right of the one before. */
const STEP = 18

export function ImageDropDialog({
  files,
  onDone,
}: {
  files: readonly { name: string; bytes: Uint8Array }[]
  onDone: (result: { placed: number; page: NodeId | null; problems: string[] }) => void
}) {
  const { store, assets } = useServices()
  const nodes = useDoc((p) => p.nodes)
  const order = useDoc((p) => p.order)
  const layouts = useMemo(
    () => order.map((id) => nodes[id]).filter((n): n is LayoutNode => n?.kind === 'layout'),
    [nodes, order],
  )
  const [page, setPage] = useState<string>(layouts[0]?.id ?? NEW)
  const n = files.length

  const add = () => {
    const project = store.getState()
    const existing = page === NEW ? null : (project.nodes[page as NodeId] as LayoutNode | undefined)
    const problems: string[] = []
    /** The images on a page of this size: the first in the middle, the rest stepped from it. */
    const place = (spec: LayoutNode['page']) => {
      const room = { width: spec.width - 72, height: spec.height - 72 }
      const items: LayoutItem[] = []
      files.forEach((f, i) => {
        try {
          const { dpi, ...img } = imageAsset(f.bytes)
          const held = assets.add(img)
          const at =
            i === 0 ? null : { x: spec.width / 2 + i * STEP, y: spec.height / 2 + i * STEP }
          items.push(imageItemFor({ ...held, ...(dpi ? { dpi } : {}) }, room, at))
        } catch (e) {
          problems.push(e instanceof AssetError ? `${f.name}: ${e.message}` : errorMessage(e))
        }
      })
      return items
    }
    const label = (n: number) => (n > 1 ? 'Add images' : 'Add image')
    let id: NodeId | null = null
    let placed = 0
    if (existing) {
      const items = place(existing.page)
      placed = items.length
      if (placed) {
        store.dispatch(
          {
            type: 'node.set',
            id: existing.id,
            path: ['items'],
            value: [...existing.items, ...items],
          },
          label(placed),
        )
        id = existing.id
      }
    } else {
      // A new page of the preferred size (audit 2, U24), without panel labels.
      const layout = newPageOf(nextName(project, 'layout'), place, { labels: { show: false } })
      placed = layout.items.length
      if (placed) {
        store.dispatch({ type: 'node.add', node: layout }, label(placed))
        id = layout.id
      }
    }
    onDone({ placed, page: id, problems })
  }

  return (
    <Dialog
      title={n === 1 ? `Add “${files[0]!.name}” to a page?` : `Add ${n} images to a page?`}
      onClose={() => onDone({ placed: 0, page: null, problems: [] })}
      footer={
        <>
          <button type="button" onClick={() => onDone({ placed: 0, page: null, problems: [] })}>
            Ignore
          </button>
          <button type="button" className="primary" onClick={add}>
            Add to page
          </button>
        </>
      }
    >
      <p>Images go on layout pages. Drop them on a page to place them where you drop them.</p>
      <Select<string>
        label="Page"
        value={page}
        options={[
          ...layouts.map((l) => ({ value: l.id as string, label: l.name })),
          { value: NEW, label: 'A new page' },
        ]}
        onChange={setPage}
      />
    </Dialog>
  )
}
