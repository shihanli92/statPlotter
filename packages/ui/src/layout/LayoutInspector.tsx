import type { Theme } from '@ps/graph'
import {
  type AnalysisResult,
  type AssetId,
  type GraphNode,
  type ImageAsset,
  type LayoutItem,
  type LayoutNode,
  type NodeId,
  PAGE_SIZES,
  type PanelLabelStyle,
  type Project,
  setMembers,
  sourceTable,
} from '@ps/model'
import { Checkbox, NumberInput, Section, Select } from '../components/fields.tsx'
import { splitWhat } from '../graph/split.ts'
import type { AlignEdge, ZOrder } from './arrange.ts'
import { type Orientation, type PageSize, pageSpec } from './figure.ts'
import { ItemPanels } from './ItemPanels.tsx'
import { itemKindName } from './items.ts'
import { type ItemEdit, SharedItemFields } from './SharedPanels.tsx'
import type { StackDirection } from './stack.ts'

// The layout view's inspector: the item selected alone (its panels and order), several items
// (the fields they share, arranging them; aligning is the view toolbar's), parts of graphs on the
// page (what they are, Format…), or the page (size, what to add, locked items, graph arranging,
// panel labels).

function describePage(page: LayoutNode['page']): { size: PageSize | 'custom'; o: Orientation } {
  const o: Orientation = page.width > page.height ? 'landscape' : 'portrait'
  for (const size of Object.keys(PAGE_SIZES) as PageSize[]) {
    const s = pageSpec(size, o)
    if (Math.abs(s.width - page.width) < 0.5 && Math.abs(s.height - page.height) < 0.5)
      return { size, o }
  }
  return { size: 'custom', o }
}

/** What the inspector's buttons do (the view's own actions). */
interface LayoutActions {
  set: (path: (string | number)[], value: unknown, label?: string) => void
  /** Fields of several items, one undo step. */
  setMany: (edits: ItemEdit[], label: string) => void
  select: (indices: number[]) => void
  zorder: (op: ZOrder) => void
  duplicate: () => void
  remove: () => void
  align: (edge: AlignEdge) => void
  distribute: (axis: 'x' | 'y') => void
  group: () => void
  ungroup: () => void
  lock: () => void
  unlockAll: () => void
  addGraph: (id: NodeId) => void
  addText: () => void
  addImage: () => void
  addTable: () => void
  arrange: () => void
  stack: (d: StackDirection) => void
  equalSizes: () => void
  shareY: () => void
  matchFirst: () => void
  /** A set of split graphs' grid with another column count (roadmap 34d). */
  gridColumns: (set: string, columns: number) => void
}

export function LayoutInspector({
  layout,
  project,
  theme,
  graphs,
  sel,
  parts,
  result,
  asset,
  state,
  act,
}: {
  layout: LayoutNode
  project: Project
  theme: Theme
  graphs: readonly GraphNode[]
  sel: readonly number[]
  /** Parts of graphs selected on the page (roadmap 44), when they are the selection. */
  parts?: {
    /** "Y axis title", "3 elements in 2 graphs". */
    title: string
    /** The graphs they are in, quoted. */
    where: string[]
    /** The Format button's label for the primary part (null: the graph's own). */
    format: string | null
    onFormat: () => void
    /** Back to the graph item. */
    onBack: () => void
  } | null
  result: (id: NodeId) => AnalysisResult | undefined
  asset: (id: AssetId) => ImageAsset | undefined
  state: {
    anyLocked: boolean
    /** Units (items or groups) selected. */
    units: number
    canGroup: boolean
    grouped: boolean
    columns: number
    setColumns: (n: number) => void
    stackShareY: boolean
    setStackShareY: (v: boolean) => void
    stackHideInner: boolean
    setStackHideInner: (v: boolean) => void
  }
  act: LayoutActions
}) {
  const selected = sel.length === 1 ? sel[0]! : null
  const item: LayoutItem | undefined = selected !== null ? layout.items[selected] : undefined
  const { set } = act
  if (parts)
    return (
      <div className="inspector">
        <div className="inspector-header">
          <h2>{parts.title}</h2>
          <button type="button" className="link" onClick={parts.onBack}>
            ← Graph on page
          </button>
        </div>
        <Section title="Selected in the graph">
          <p className="muted">
            {`In ${parts.where.join(' and ')}. Shift-click parts of this or another graph to select several; Escape goes back to the graph.`}
          </p>
          {parts.format && (
            <button type="button" onClick={parts.onFormat}>
              {parts.format}
            </button>
          )}
        </Section>
      </div>
    )
  if (item)
    return (
      <div className="inspector">
        <div className="inspector-header">
          <h2>{item.type === 'graph' ? 'Graph on page' : itemKindName(item)}</h2>
          <button type="button" className="link" onClick={() => act.select([])}>
            ← Page
          </button>
        </div>
        <ItemPanels
          item={item}
          project={project}
          theme={theme}
          graphs={graphs}
          result={result}
          asset={asset}
          set={(path, value, label) => set(['items', selected!, ...path], value, label)}
          replace={(next, label) => set(['items', selected!], next, label)}
        />
        <Section title="Arrange">
          <button type="button" onClick={() => act.zorder('front')}>
            Bring to front
          </button>
          <button type="button" onClick={() => act.zorder('forward')}>
            Bring forward
          </button>
          <button type="button" onClick={() => act.zorder('backward')}>
            Send backward
          </button>
          <button type="button" onClick={() => act.zorder('back')}>
            Send to back
          </button>
          <button type="button" onClick={act.duplicate}>
            Duplicate
          </button>
          <button type="button" className="danger" onClick={act.remove}>
            Remove from page
          </button>
        </Section>
      </div>
    )

  const { anyLocked } = state
  // Roadmap 44 (O4): several items — the fields they share (mixed values blank), then arranging
  // them; the page's own panel is a click on "← Page" away (aligning is in the view toolbar).
  if (sel.length > 1) {
    const picked = sel.flatMap((i) => {
      const it = layout.items[i]
      return it ? [{ item: it, index: i }] : []
    })
    const graphCount = picked.filter((p) => p.item.type === 'graph').length
    return (
      <div className="inspector">
        <div className="inspector-header">
          <h2>{`${sel.length} items`}</h2>
          <button type="button" className="link" onClick={() => act.select([])}>
            ← Page
          </button>
        </div>
        <SharedItemFields picked={picked} theme={theme} setMany={act.setMany} />
        <Section title="Arrange">
          <button type="button" disabled={!state.canGroup} onClick={act.group}>
            Group
          </button>
          <button type="button" disabled={!state.grouped} onClick={act.ungroup}>
            Ungroup
          </button>
          <button type="button" onClick={() => act.zorder('front')}>
            Bring to front
          </button>
          <button type="button" onClick={() => act.zorder('back')}>
            Send to back
          </button>
          <button type="button" onClick={act.duplicate}>
            Duplicate
          </button>
          <button type="button" disabled={anyLocked} onClick={act.lock}>
            Lock
          </button>
          <button type="button" className="danger" onClick={act.remove}>
            Remove from page
          </button>
        </Section>
        {graphCount >= 2 && (
          <Section title={`Selected graphs (${graphCount})`}>
            <p className="muted">
              Align, stack, place side by side and give the same size from the view’s toolbar.
            </p>
            <Checkbox
              label="Share the Y range when stacking (views of the same data)"
              checked={state.stackShareY}
              onChange={state.setStackShareY}
            />
            <Checkbox
              label="Hide repeated inner axis labels"
              checked={state.stackHideInner}
              onChange={state.setStackHideInner}
            />
            <button type="button" onClick={act.shareY}>
              Share the Y axis range
            </button>
            <button type="button" onClick={act.matchFirst}>
              Match format to the first
            </button>
          </Section>
        )}
      </div>
    )
  }
  const page = describePage(layout.page)
  const locked = layout.items.flatMap((it, i) => (it.locked ? [{ it, i }] : []))
  return (
    <div className="inspector">
      <div className="inspector-header">
        <h2>Page</h2>
      </div>
      <Section title="Page">
        <Select
          label="Size"
          value={page.size}
          options={[
            { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
            { value: 'a4', label: 'A4 (210 × 297 mm)' },
            ...(page.size === 'custom'
              ? [
                  {
                    value: 'custom' as const,
                    // Roadmap 37: a page fitted to a column says how big it is.
                    label: `Custom (${Math.round((layout.page.width * 25.4) / 72)} × ${Math.round((layout.page.height * 25.4) / 72)} mm)`,
                  },
                ]
              : []),
          ]}
          onChange={(v) => v !== 'custom' && set(['page'], pageSpec(v, page.o), 'Page size')}
        />
        <Select
          label="Orientation"
          value={page.o}
          options={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ]}
          onChange={(v) =>
            v !== page.o &&
            set(
              ['page'],
              { width: layout.page.height, height: layout.page.width },
              'Page orientation',
            )
          }
        />
      </Section>
      <Section title="Add to page">
        <Select
          label="Add a graph"
          value=""
          options={[
            { value: '', label: 'Choose a graph…' },
            ...graphs.map((g) => ({ value: g.id as string, label: g.name })),
          ]}
          onChange={(v) => v && act.addGraph(v as NodeId)}
        />
        <button type="button" onClick={act.addText}>
          Add text
        </button>
        <button type="button" onClick={act.addImage}>
          Add image…
        </button>
        <button type="button" onClick={act.addTable}>
          Add table…
        </button>
      </Section>
      {locked.length > 0 && (
        <Section title="Locked items">
          <ul className="plain-list">
            {locked.map(({ it, i }) => (
              <li key={it.id}>
                <button type="button" className="link" onClick={() => act.select([i])}>
                  {itemKindName(it)}
                  {it.type === 'graph' ? ` “${project.nodes[it.graph]?.name ?? '?'}”` : ` ${i + 1}`}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={act.unlockAll}>
            Unlock all
          </button>
        </Section>
      )}
      <Section title="Arrange graphs">
        <Select
          label="Columns"
          value={state.columns}
          options={[1, 2, 3, 4].map((c) => ({ value: c, label: String(c) }))}
          onChange={state.setColumns}
        />
        <button type="button" onClick={act.arrange}>
          Arrange in a grid (plot areas aligned)
        </button>
      </Section>
      <Section title="All graphs on the page">
        <p className="muted">
          The buttons act on every graph on the page; select two or more (drag across the page or
          Shift-click) to act on those.
        </p>
        <button type="button" onClick={act.equalSizes}>
          Make plot sizes equal
        </button>
        <button type="button" onClick={act.shareY}>
          Share the Y axis range
        </button>
        <button type="button" onClick={act.matchFirst}>
          Match format to the first
        </button>
      </Section>
      {(layout.grids ?? []).map((grid) => {
        const members = setMembers(project, grid.set)
        const first = members[0]
        if (!first?.split) return null
        const table = sourceTable(project, first.seriesSource.table, result)
        return (
          <Section key={grid.set} title={`One graph per ${splitWhat(first.split, table)}`}>
            <p className="muted">
              {members.length} graphs in a grid, in the set’s order; new ones join it.
            </p>
            <NumberInput
              label="Columns"
              value={grid.columns}
              min={1}
              max={12}
              onChange={(v) => act.gridColumns(grid.set, v)}
            />
          </Section>
        )
      })}
      <Section title="Panel labels">
        <Checkbox
          label="Label graphs A, B, C…"
          checked={layout.panelLabels.show}
          onChange={(v) => set(['panelLabels', 'show'], v, 'Panel labels')}
        />
        <Select<PanelLabelStyle>
          label="Style"
          value={layout.panelLabels.style}
          options={[
            { value: 'A', label: 'A, B, C' },
            { value: 'a', label: 'a, b, c' },
            { value: '(A)', label: '(A), (B), (C)' },
            { value: '(a)', label: '(a), (b), (c)' },
          ]}
          onChange={(v) => set(['panelLabels', 'style'], v, 'Panel labels')}
        />
        <NumberInput
          label="Size (pt)"
          value={layout.panelLabels.size}
          min={6}
          max={48}
          onChange={(v) => set(['panelLabels', 'size'], v, 'Panel labels')}
        />
      </Section>
    </div>
  )
}
