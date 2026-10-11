import { frontFirst, layerTitle } from '@ps/graph'
import type { GraphNode } from '@ps/model'
import { useRef, useState } from 'react'
import { Menu } from '../../components/Menu.tsx'
import { type FormatTarget, landOn, stepLayer } from './route.ts'

// Roadmap 49b (the user's request: "clicking on a layer will open controls from that layer only;
// small arrows allow moving through the different layers"): a layer's view in the Format panel
// and its window heads its options with ‹ and › — the layer in front and the layer behind, in
// the Layers list's order (the front first, as every list shows layers) — and "2 of 5 ▾", a menu
// of every layer to jump to. The data sets picked stay picked where the layer landed on draws
// them, else every series; the host selects what the view formats (on the canvas: the layer's
// marks highlighted, as choosing it in the Layers list does). No wrap: the arrows stop at the
// ends (decision 1228).

/** The arrows and the layer menu of a layer's view (nothing for other places). */
export function LayerSteps({
  graph,
  target,
  onStep,
  showName = false,
}: {
  graph: Pick<GraphNode, 'layers' | 'frame'>
  target: FormatTarget
  /** Shows a layer's view (the host selecting it where it has a selection). */
  onStep: (t: FormatTarget) => void
  /** Show the layer's name beside its number (the window, whose heading is "Format graph"). */
  showName?: boolean
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  if (target.place !== 'layer') return null
  const rows = frontFirst(graph.layers)
  const i = rows.findIndex((l) => l.id === target.layer)
  const layer = rows[i]
  if (!layer) return null
  const name = (l: (typeof rows)[number]) =>
    `${layerTitle(l, graph.frame)}${l.visible === false ? ' (hidden)' : ''}`
  const front = stepLayer(graph, target, -1)
  const back = stepLayer(graph, target, 1)
  const step = (to: FormatTarget | null, by: -1 | 1) => {
    if (!to) return
    onStep(to)
    // At the end the button pressed is disabled: the focus stays in the control, on the menu.
    if (!stepLayer(graph, to, by)) menuButton.current?.focus()
  }
  const count = `${i + 1} of ${rows.length}`
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of buttons, not a form's fieldset
    <div className="layer-steps" role="group" aria-label="Layers of the graph">
      <button
        type="button"
        className="layer-step"
        aria-label="Layer in front"
        title={front ? `Layer in front: ${name(rows[i - 1]!)}` : 'This is the front layer'}
        disabled={!front}
        onClick={() => step(front, -1)}
      >
        ‹
      </button>
      <button
        ref={menuButton}
        type="button"
        className="layer-steps-menu"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={`Layer ${count}: ${name(layer)}. Choose a layer`}
        title="Choose a layer (the front first, as in the Layers list)"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { x: r.left, y: r.bottom + 2 })
        }}
      >
        {showName && <span className="layer-steps-name">{name(layer)}</span>}
        <span className="layer-steps-count">{count} ▾</span>
      </button>
      <button
        type="button"
        className="layer-step"
        aria-label="Layer behind"
        title={back ? `Layer behind: ${name(rows[i + 1]!)}` : 'This is the back layer'}
        disabled={!back}
        onClick={() => step(back, 1)}
      >
        ›
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label="Layers of the graph"
          items={rows.map((l) => ({
            label: name(l),
            checked: l.id === layer.id,
            onSelect: () => {
              if (l.id !== layer.id) onStep(landOn(graph, target, l.id))
            },
          }))}
          insideRef={menuButton}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
