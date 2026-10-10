import { layoutGraph, layoutPage } from '@ps/graph'
import type { GraphNode, LayoutNode, NodeId } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { useDoc, useServices } from '../context.tsx'
import { newPageOf, placeGraphs } from '../layout/figure.ts'
import { pageSources } from '../layout/pageScene.ts'
import { nextName } from '../util.ts'
import { useThumbnail } from './context.tsx'

/**
 * View › Gallery (roadmap 40): every graph and layout page as a thumbnail in a grid. A click
 * opens one; ticked graphs can get a style (37) or go on a page, new or existing, in one step.
 */
export function Gallery({
  onOpen,
  onClose,
  onApplyStyle,
  onMessage,
}: {
  onOpen: (id: NodeId) => void
  onClose: () => void
  onApplyStyle: (graphs: NodeId[]) => void
  onMessage: (msg: string) => void
}) {
  const { store, fonts, engine, assets } = useServices()
  const project = useDoc((d) => d)
  const [chosen, setChosen] = useState<NodeId[]>([])
  const [page, setPage] = useState<string>('new')
  const ofKind = (kind: 'graph' | 'layout') =>
    project.order.filter((id) => project.nodes[id]?.kind === kind)
  const graphs = ofKind('graph')
  const layouts = ofKind('layout')
  const toggle = (id: NodeId) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const chosenGraphs = graphs.filter((id) => chosen.includes(id))

  const addToPage = () => {
    const doc = store.getState()
    const list = chosenGraphs.map((id) => doc.nodes[id] as GraphNode)
    if (!list.length) return
    const scene = (graph: GraphNode) =>
      layoutGraph({ project: doc, graph, fonts, result: (a) => engine.latest(a) })
    if (page === 'new') {
      const layout = newPageOf(nextName(doc, 'layout'), (spec) =>
        placeGraphs(list, scene, spec, { columns: 2 }),
      )
      store.dispatch({ type: 'node.add', node: layout }, 'Add to page')
      onMessage(`${list.length} ${list.length === 1 ? 'graph' : 'graphs'} on “${layout.name}”.`)
      onOpen(layout.id)
      return
    }
    const layout = doc.nodes[page as NodeId] as LayoutNode | undefined
    if (layout?.kind !== 'layout') return
    // Below what the page holds, on the same grid.
    const placed = layoutPage({
      project: doc,
      layout,
      fonts,
      ...pageSources(
        doc,
        (a) => engine.latest(a),
        (a) => assets.get(a),
      ),
    })
    const bottom = Math.max(0, ...placed.items.map((b) => b.y + b.h))
    const room = { width: layout.page.width, height: Math.max(144, layout.page.height - bottom) }
    const items = placeGraphs(list, scene, room, { columns: 2 }).map((it) => ({
      ...it,
      y: it.y + bottom,
    }))
    store.dispatch(
      { type: 'node.replace', node: { ...layout, items: [...layout.items, ...items] } },
      'Add to page',
    )
    onMessage(`${list.length} ${list.length === 1 ? 'graph' : 'graphs'} added to “${layout.name}”.`)
    onOpen(layout.id)
  }

  const tile = (id: NodeId) => {
    const n = project.nodes[id]!
    return (
      <li key={id} className={`gallery-tile ${chosen.includes(id) ? 'chosen' : ''}`}>
        <button
          type="button"
          className="gallery-open"
          onClick={() => onOpen(id)}
          title={`Open “${n.name}”`}
        >
          <GalleryThumb id={id} />
          <span className="gallery-name">{n.name}</span>
        </button>
        {n.kind === 'graph' && (
          <label className="gallery-pick">
            <input
              type="checkbox"
              aria-label={`Choose ${n.name}`}
              checked={chosen.includes(id)}
              onChange={() => toggle(id)}
            />
          </label>
        )}
      </li>
    )
  }

  return (
    <Dialog
      title="Gallery"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="hint gallery-count">
            {chosenGraphs.length
              ? `${chosenGraphs.length} ${chosenGraphs.length === 1 ? 'graph' : 'graphs'} chosen`
              : 'Tick graphs to style them or put them on a page'}
          </span>
          <button
            type="button"
            disabled={!chosenGraphs.length}
            onClick={() => onApplyStyle(chosenGraphs)}
          >
            Apply style…
          </button>
          <label className="gallery-page">
            <span className="visually-hidden">Page</span>
            <select aria-label="Page" value={page} onChange={(e) => setPage(e.target.value)}>
              <option value="new">New page</option>
              {layouts.map((id) => (
                <option key={id} value={id}>
                  {project.nodes[id]!.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!chosenGraphs.length} onClick={addToPage}>
            Add to page
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {!graphs.length && !layouts.length && <p>No graphs or layouts yet.</p>}
      {graphs.length > 0 && (
        <section aria-label="Graphs">
          <h3>Graphs</h3>
          <ul className="gallery-grid">{graphs.map(tile)}</ul>
        </section>
      )}
      {layouts.length > 0 && (
        <section aria-label="Layouts">
          <h3>Layouts</h3>
          <ul className="gallery-grid">{layouts.map(tile)}</ul>
        </section>
      )}
    </Dialog>
  )
}

function GalleryThumb({ id }: { id: NodeId }) {
  const url = useThumbnail(id)
  return (
    <span className="gallery-thumb">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="hint">Drawing…</span>}
    </span>
  )
}
