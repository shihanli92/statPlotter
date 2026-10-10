import { hasRightAxis } from '@ps/graph'
import type { GraphNode } from '@ps/model'
import { LiveFields } from '../../components/fields.tsx'
import type { PanelContext } from '../inspector/context.ts'
import { axisPlace, type FormatTarget, graphPlace, tabOf, tabsFor, withTab } from './route.ts'
import { FormatSections } from './sections.tsx'

// Roadmap 46: the Format options, hosted by two shells — the docked panel beside the canvas
// (`FormatPanel`: writes straight to the document) and the modal dialog (`FormatDialog`: a draft,
// OK / Cancel). Both give the body a `PanelContext` whose `set` / `dispatch` write where the shell
// writes; the body never knows which.

/**
 * The place a target names, kept valid: the right Y axis' place goes to the left one when the
 * axis is removed; a layer, bracket or text gone, to the graph's.
 */
export function shownTarget(t: FormatTarget, graph: GraphNode): FormatTarget {
  switch (t.place) {
    case 'axis':
      return t.axis === 'y2' && !hasRightAxis(graph) ? axisPlace('y') : t
    case 'layer':
      return graph.layers.some((l) => l.id === t.layer) ? t : graphPlace()
    case 'series':
      return t.layer && !graph.layers.some((l) => l.id === t.layer) ? { ...t, layer: undefined } : t
    case 'bracket':
      return graph.annotations[t.index]?.type === 'bracket' ? t : graphPlace('annotations')
    case 'object': {
      const a = graph.annotations[t.index]
      return a && a.type !== 'bracket' ? t : graphPlace('annotations')
    }
    default:
      return t
  }
}

/**
 * A place's tabs — the axes' (X axis / Y axis / right Y axis), named by element: a roving
 * tablist; none for other places. `id` prefixes the tabs' ids, `${id}-panel` is their panel.
 */
export function FormatTabs({
  id,
  label,
  target,
  graph,
  setTarget,
}: {
  id: string
  label: string
  target: FormatTarget
  graph: GraphNode
  setTarget: (t: FormatTarget) => void
}) {
  const tabs = tabsFor(target, graph)
  const tab = tabOf(target)
  if (!tabs.length) return null
  const selectTab = (to: string, focus = false) => {
    setTarget(withTab(target, to))
    if (focus) document.getElementById(`${id}-${to}`)?.focus()
  }
  return (
    <div className="format-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`${id}-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === tab}
          aria-controls={`${id}-panel`}
          tabIndex={t.id === tab ? 0 : -1}
          data-autofocus={t.id === tab ? '' : undefined}
          onClick={() => selectTab(t.id)}
          onKeyDown={(e) => {
            const by =
              e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : 0
            const to = e.key === 'End' ? tabs.length - 1 : (i + by + tabs.length) % tabs.length
            if (by || e.key === 'End') {
              e.preventDefault()
              selectTab(tabs[to]!.id, true)
            }
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The options of a target: its place's sections (`sections.tsx`), live fields (every valid
 * keystroke writes), in the tab panel of its tabs or, without tabs, a section named `labelledBy`.
 * `reveal`: a section to open (a search's jump).
 */
export function FormatOptions({
  id,
  labelledBy,
  ctx,
  target,
  setTarget,
  reveal,
}: {
  id: string
  labelledBy: string
  ctx: PanelContext
  target: FormatTarget
  setTarget: (t: FormatTarget) => void
  reveal?: string | undefined
}) {
  const content = (
    <LiveFields.Provider value={true}>
      <FormatSections ctx={ctx} target={target} setTarget={setTarget} reveal={reveal} />
    </LiveFields.Provider>
  )
  return tabsFor(target, ctx.graph).length ? (
    <div
      className="format-options inspector"
      id={`${id}-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-${tabOf(target)}`}
    >
      {content}
    </div>
  ) : (
    <section className="format-options inspector" aria-labelledby={labelledBy}>
      {content}
    </section>
  )
}

/** Tabs and options together: the docked panel's body. */
export function FormatPanelBody(props: {
  id: string
  /** The tablist's name and, without tabs, the options' (the id of their heading). */
  label: string
  labelledBy: string
  ctx: PanelContext
  target: FormatTarget
  setTarget: (t: FormatTarget) => void
  reveal?: string | undefined
}) {
  const { id, label, labelledBy, ctx, target, setTarget, reveal } = props
  return (
    <>
      <FormatTabs id={id} label={label} target={target} graph={ctx.graph} setTarget={setTarget} />
      <FormatOptions
        id={id}
        labelledBy={labelledBy}
        ctx={ctx}
        target={target}
        setTarget={setTarget}
        reveal={reveal}
      />
    </>
  )
}
