import type { Command } from '@ps/engine'
import {
  canMoveLayers,
  frontFirst,
  layersBetween,
  layerTitle,
  nestedOf,
  newLayerIndex,
  newStyleLayer,
  PLOT_FAMILIES,
  rowMarkNotices,
  rowToIndex,
  stacked,
  styleAllowed,
  styleContext,
  stylesFor,
  withNested,
} from '@ps/graph'
import { type Layer, sourceTable } from '@ps/model'
import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from 'react'
import { isMacPlatform } from '../../commands/index.ts'
import { Section, Select } from '../../components/fields.tsx'
import { Menu, type MenuItem } from '../../components/Menu.tsx'
import { useConfirm } from '../../components/modals.tsx'
import type { PanelContext } from './context.ts'
import {
  duplicateLayersCommands,
  layersLabel,
  moveLayersCommands,
  moveLayersToCommands,
  removeLayersCommands,
  removeLayersQuestion,
  visibilityCommands,
} from './layers.ts'

// Format graph › Appearance › Layers (roadmap 33c, design §7.2): the graph's layers front first
// (the top row is drawn in front, roadmap 33e; the document keeps them back to front), each shown
// or hidden, moved (Alt+↑ / ↓ or drag; up is towards the front), duplicated or removed; Add offers
// the plot styles the matrix allows for the table, the others with their reason, and puts a new
// mark on top, a new fill behind the marks, attached ones in front of their host. The selected
// layer's fields follow below the list. Roadmap 47: several rows are selected with ⌘- (Ctrl-) and
// Shift-click, Shift+↑ / ↓ and ⌘A; they are the view's selection (whole layers on the canvas),
// and hiding, moving, dragging, duplicating and removing act on all of them, one undo step each.

/** The commands adding a plot style's layer to a graph (nested tables: drawn by subject). */
export function addStyleCommands(ctx: PanelContext, styleId: string): Command[] {
  const { graph } = ctx
  const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.lookup)
  if (!table) return []
  const c = styleContext(table, graph.frame, graph.layers, graph.mapping)
  const style = stylesFor({ kind: c.kind, frame: graph.frame }).find((s) => s.id === styleId)
  if (!style || style.frameChoice) return []
  if (!styleAllowed(style, c).allowed) return []
  const position = graph.layers.find((l) => !l.on && l.position)?.position
  let layer = newStyleLayer(style, c, position)
  if (table.tableKind === 'nested' && (layer.geom === 'points' || layer.geom === 'center'))
    layer = withNested([layer], nestedOf(graph.layers))[0] ?? layer
  return [
    {
      type: 'graph.addLayer',
      id: graph.id,
      layer,
      at: newLayerIndex(graph.layers, layer),
    },
  ]
}

/**
 * Roadmap 46: choosing a row shows that layer's place, where the list is drawn anew; the list
 * chosen from keeps the focus there (a module flag the next list to mount takes).
 */
let listFocus = false

/**
 * Roadmap 47: where a Shift range starts (the row last clicked or stepped to without Shift), kept
 * across the lists drawn anew as rows are chosen.
 */
let anchor: string | undefined

/** The Layers list. */
export function LayersSection({
  ctx,
  selected,
  onSelect: select,
  collapsed,
}: {
  ctx: PanelContext
  /** The layer whose place is shown (selected when the view holds no layers selected). */
  selected: string | undefined
  /** Shows a layer's place (where no view holds the list's selection). */
  onSelect: (id: string) => void
  collapsed?: boolean
}) {
  const { graph } = ctx
  const confirm = useConfirm()
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (listFocus && listRef.current) listRef.current.focus()
    listFocus = false
  }, [])
  /** Audit 3 (A6): where + Add ▾'s menu opened (the app's menu: focus in it, arrows, Escape). */
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.lookup)
  const name = (l: Layer) => layerTitle(l, graph.frame)
  const optionId = (id: string) => `${listId}-${id}`
  /** The list's rows: the front first. */
  const shown = frontFirst(graph.layers)
  const n = shown.length
  const inGraph = (id: string | undefined): id is string =>
    id !== undefined && graph.layers.some((l) => l.id === id)

  // What is selected: the view's whole layers, else the layer whose place is shown.
  const host = ctx.layerSelection
  const held = host?.ids.filter(inGraph) ?? []
  const chosen: string[] = held.length ? held : inGraph(selected) ? [selected] : []
  const primary = host?.primary && chosen.includes(host.primary) ? host.primary : chosen.at(-1)
  const current = graph.layers.find((l) => l.id === primary)
  const isChosen = (id: string) => chosen.includes(id)

  /** Selects these rows, `p` shown in the panel (none: the graph). */
  const choose = (ids: readonly string[], p: string | null) => {
    listFocus = !!listRef.current && document.activeElement === listRef.current
    if (host) host.select(ids, p)
    else if (p) select(p)
    // Taken by a list drawn in this change, else forgotten.
    setTimeout(() => {
      listFocus = false
    }, 0)
  }
  const one = (id: string) => {
    anchor = id
    choose([id], id)
  }
  /** Shift: the rows from the anchor to `id`, `id` shown. */
  const range = (id: string) => {
    const from = anchor && inGraph(anchor) ? anchor : (primary ?? id)
    choose(layersBetween(graph.layers, from, id), id)
  }
  /** ⌘ / Ctrl: the row added or taken out. */
  const toggleRow = (id: string) => {
    anchor = id
    if (!isChosen(id)) choose([...chosen, id], id)
    else {
      const rest = chosen.filter((x) => x !== id)
      choose(rest, rest.at(-1) ?? null)
    }
  }
  const onRowClick = (e: MouseEvent, id: string) => {
    if (e.shiftKey) range(id)
    else if (e.metaKey || e.ctrlKey) toggleRow(id)
    else one(id)
  }

  /** Up (1): towards the front; down (−1): towards the back. Every selected layer, together. */
  const move = (by: -1 | 1) => {
    const cmds = moveLayersCommands(graph, chosen, by)
    if (cmds.length)
      ctx.dispatch(
        cmds,
        by > 0
          ? layersLabel('Bring', chosen.length, 'forward')
          : layersLabel('Send', chosen.length, 'backward'),
      )
  }
  /** Shows or hides layers: a selected row's eye, Space and Hide act on every selected one. */
  const setVisible = (ids: readonly string[], visible: boolean) => {
    const cmds = visibilityCommands(graph, ids, visible)
    if (cmds.length) ctx.dispatch(cmds, layersLabel(visible ? 'Show' : 'Hide', cmds.length))
  }
  const toggleVisible = (l: Layer) =>
    setVisible(isChosen(l.id) ? chosen : [l.id], l.visible === false)
  const remove = async () => {
    if (!chosen.length) return
    const q = removeLayersQuestion(graph, chosen)
    if (q && !(await confirm(q))) return
    const { commands, along } = removeLayersCommands(graph, chosen)
    // The row that takes the first one's place is selected (else the one above).
    const row = shown.findIndex((l) => isChosen(l.id))
    ctx.dispatch(commands, layersLabel('Delete', chosen.length))
    const rest = shown.filter((l) => !isChosen(l.id) && !along.includes(l))
    const next = rest[Math.min(row, rest.length - 1)]
    if (next) one(next.id)
    else choose([], null)
  }
  const duplicate = () => {
    const { commands, copies } = duplicateLayersCommands(graph, chosen)
    if (!commands.length) return
    ctx.dispatch(commands, layersLabel('Duplicate', chosen.length))
    // The copies selected, the primary's copy shown.
    const at = primary ? chosen.indexOf(primary) : -1
    const p = copies[at] ?? copies.at(-1)!
    anchor = p
    choose(copies, p)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = shown.findIndex((l) => l.id === primary)
    const l = shown[row]
    // Rows: up is the row above (in front), down the row below.
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    const mod = isMacPlatform() ? e.metaKey : e.ctrlKey
    const at = (r: number) => shown[Math.max(0, Math.min(n - 1, r))]
    if (step && e.altKey && l) move(step === -1 ? 1 : -1)
    else if (step) {
      const next = at((row < 0 ? 0 : row) + (row < 0 ? 0 : step))
      if (next) (e.shiftKey ? range : one)(next.id)
    } else if (e.key === 'Home' && shown[0]) (e.shiftKey ? range : one)(shown[0].id)
    else if (e.key === 'End' && shown.at(-1)) (e.shiftKey ? range : one)(shown.at(-1)!.id)
    else if (mod && e.key.toLowerCase() === 'a' && n) {
      // Every row; the one shown stays (else the front one).
      anchor = shown[0]!.id
      choose(
        shown.map((x) => x.id),
        primary ?? shown[0]!.id,
      )
    } else if (e.key === ' ' && l) toggleVisible(l)
    else if ((e.key === 'Delete' || e.key === 'Backspace') && l) void remove()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const c = table ? styleContext(table, graph.frame, graph.layers, graph.mapping) : null
  const kind = c?.kind ?? 'column'
  const styles = stylesFor({ kind, frame: graph.frame }).filter((s) => !s.frameChoice)
  // Roadmap 34f: layers of a cells table's graph drawing a mark per row, with their summary.
  const notices = table?.kind === 'table' ? rowMarkNotices(graph, table) : []
  const several = chosen.length > 1
  /**
   * + Add ▾'s items: a submenu per family of plot styles; a style the matrix doesn't allow for
   * the table is shown disabled with its reason.
   */
  const addItems = (c: ReturnType<typeof styleContext>): MenuItem[] =>
    PLOT_FAMILIES.flatMap((f) => {
      const mine = styles.filter((st) => st.family === f.id)
      if (!mine.length) return []
      return [
        {
          label: f.label,
          submenu: mine.map((st): MenuItem => {
            const a = styleAllowed(st, c)
            return {
              label: a.allowed ? st.label : `${st.label} (${a.reason})`,
              disabled: !a.allowed,
              ...(a.reason ? { title: a.reason } : {}),
              onSelect: () => {
                const cmds = addStyleCommands(ctx, st.id)
                if (!cmds.length) return
                ctx.dispatch(cmds, `Add ${st.label.toLowerCase()}`)
                const added = cmds[0]
                if (added?.type === 'graph.addLayer') one(added.layer.id)
              },
            }
          }),
        },
      ]
    })
  const hiding = current?.visible !== false

  return (
    <Section title="Layers" {...(collapsed === undefined ? {} : { collapsed })}>
      <div className="layers-toolbar">
        <button
          ref={addButton}
          type="button"
          aria-haspopup="menu"
          aria-expanded={!!adding}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setAdding(adding ? null : { x: r.left, y: r.bottom + 2 })
          }}
        >
          + Add ▾
        </button>
        <button type="button" disabled={!current} onClick={duplicate}>
          Duplicate
        </button>
        <button
          type="button"
          disabled={!current}
          title={`${hiding ? 'Hide' : 'Show'} the selected layer${several ? 's' : ''} (Space)`}
          onClick={() => setVisible(chosen, !hiding)}
        >
          {hiding ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="danger" disabled={!current} onClick={() => void remove()}>
          Delete
        </button>
        <button
          type="button"
          aria-label="Bring layer forward"
          title="Bring forward: up the list (Alt+↑)"
          disabled={!current || !canMoveLayers(graph.layers, chosen, 1)}
          onClick={() => move(1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Send layer backward"
          title="Send backward: down the list (Alt+↓)"
          disabled={!current || !canMoveLayers(graph.layers, chosen, -1)}
          onClick={() => move(-1)}
        >
          ↓
        </button>
      </div>
      {adding && c && (
        <Menu
          x={adding.x}
          y={adding.y}
          label="Add a layer"
          items={addItems(c)}
          insideRef={addButton}
          onClose={() => setAdding(null)}
        />
      )}
      {notices.map((n) => (
        <div key={n.layer.id} className="layers-notice" role="note">
          <span>
            {name(n.layer)}: {n.reason}
          </span>
          <button
            type="button"
            onClick={() =>
              ctx.dispatch(
                { type: 'graph.setLayers', id: graph.id, layers: n.fix.layers },
                n.fix.label === 'Hide it' ? 'Hide layer' : n.fix.label,
              )
            }
          >
            {n.fix.label}
          </button>
        </div>
      ))}
      <div
        ref={listRef}
        className="layer-list"
        role="listbox"
        aria-label="Layers, front to back"
        aria-multiselectable="true"
        tabIndex={0}
        aria-activedescendant={primary ? optionId(primary) : undefined}
        onKeyDown={onKeyDown}
      >
        {shown.map((l, row) => {
          const on = graph.layers.find((h) => h.id === l.on)
          const end = n > 1 && (row === 0 ? 'front' : row === n - 1 ? 'back' : null)
          const picked = isChosen(l.id)
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys
            // biome-ignore lint/a11y/useFocusableInteractive: the listbox holds the focus (aria-activedescendant)
            <div
              key={l.id}
              id={optionId(l.id)}
              role="option"
              aria-label={`${name(l)}${on ? ` on ${name(on)}` : ''}${
                l.visible === false ? ' (hidden)' : ''
              }`}
              aria-selected={picked}
              aria-description={end ? `in ${end}` : undefined}
              className={`layer-row ${picked ? 'on' : ''} ${on ? 'attached' : ''} ${
                l.visible === false ? 'hidden-layer' : ''
              }`}
              draggable
              onDragStart={(e) => {
                setDragging(l.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', l.id)
              }}
              onDragOver={(e) => {
                if (dragging && dragging !== l.id) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (!dragging) return
                // A selected row drags every selected layer, in their order.
                const ids = isChosen(dragging) ? chosen : [dragging]
                const cmds = moveLayersToCommands(graph, ids, dragging, rowToIndex(n, row))
                if (cmds.length) ctx.dispatch(cmds, layersLabel('Move', ids.length))
                setDragging(null)
              }}
              onDragEnd={() => setDragging(null)}
              onClick={(e) => onRowClick(e, l.id)}
            >
              <span className="grip" aria-hidden>
                ≡
              </span>
              {/* The eye is for the pointer: an option holds no controls (roadmap 41), and the
                  listbox's Space shows or hides the selected layers. */}
              <span
                className="eye"
                aria-hidden="true"
                data-visible={l.visible !== false}
                title={`${l.visible === false ? 'Show' : 'Hide'} ${
                  picked && several ? `the ${chosen.length} selected layers` : name(l)
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleVisible(l)
                }}
              >
                {l.visible === false ? '◌' : '●'}
              </span>
              <span className="layer-name">
                {on ? '↲ ' : ''}
                {name(l)}
                {on && <span className="muted"> on {name(on)}</span>}
                {l.visible === false && <span className="muted"> (hidden)</span>}
                {end && <span className="muted layer-end"> · {end}</span>}
              </span>
            </div>
          )
        })}
      </div>
      {several && (
        <p className="muted layers-count" aria-live="polite">
          {chosen.length} layers selected
          {current ? ` (the options below are for “${name(current)}”)` : ''}
        </p>
      )}
      {stacked(graph.layers) && (
        <p className="muted">Stacked bars draw no points, lines or boxes over them.</p>
      )}
      <p className="muted">
        The top layer is drawn in front. Shift- or {isMacPlatform() ? '⌘' : 'Ctrl'}-click selects
        several; Alt+↑ / ↓ moves the selected layers forward or back, Space shows or hides them,
        Delete removes them.
      </p>
      <Select
        label="Drawing order"
        value={graph.drawOrder === 'series' ? 'series' : 'layer'}
        options={[
          { value: 'layer', label: 'Layer by layer (every data set’s, layer by layer)' },
          { value: 'series', label: 'Data set by data set' },
        ]}
        onChange={(v) =>
          ctx.set(['drawOrder'], v === 'series' ? 'series' : undefined, 'Drawing order')
        }
      />
    </Section>
  )
}
