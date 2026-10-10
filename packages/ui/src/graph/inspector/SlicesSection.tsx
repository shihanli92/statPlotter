import type { Command } from '@ps/engine'
import { type GraphNode, newNodeId, sourceTable } from '@ps/model'
import { OrderedChecklist, Section, Select } from '../../components/fields.tsx'
import { graphsOf } from '../../util.ts'
import { rowLabel, usedRows } from '../rows.ts'
import type { PanelContext } from './context.ts'

/** Rows of the table shown on the graph (a slice), for tables organized by row. */
export function RowsSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project, set } = ctx
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  if (table?.kind !== 'table') return null
  if (!['grouped', 'contingency', 'xy'].includes(table.tableKind)) return null
  const used = usedRows(table)
  if (used.length < 2) return null
  const write = (rows: number[], what: string) => {
    const all = rows.length === used.length && rows.every((r, i) => r === used[i])
    set(['seriesSource', 'rows'], all ? undefined : rows, what)
  }
  return (
    <Section title="Rows on the graph" collapsed={!graph.seriesSource.rows}>
      <OrderedChecklist
        all={used}
        shown={graph.seriesSource.rows ?? used}
        label={(r) => rowLabel(table, r)}
        noun="row"
        onChange={write}
      />
      {graph.seriesSource.rows && (
        <p className="muted">Rows added to the table later won’t appear until you tick them.</p>
      )}
    </Section>
  )
}

/** Graphs sharing a link group on an axis, by group id. */
function linkMembers(nodes: Record<string, unknown>, axis: 'x' | 'y'): Map<string, GraphNode[]> {
  const out = new Map<string, GraphNode[]>()
  for (const n of Object.values(nodes) as GraphNode[]) {
    const g = n.kind === 'graph' ? n.links?.[axis] : undefined
    if (g) out.set(g, [...(out.get(g) ?? []), n])
  }
  return out
}

/** Join or leave shared-axis groups (automatic ranges computed across the group). */
export function SharedAxesSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project } = ctx
  const axes = (['y', 'x'] as const).filter((w) => graph.axes[w].type === 'continuous')
  const others = graphsOf(project).filter((n) => n.id !== graph.id)
  if (!axes.length || !others.length) return null
  return (
    <Section title="Shared axes" collapsed={!graph.links}>
      {axes.map((w) => {
        const groups = linkMembers(project.nodes, w)
        const mine = graph.links?.[w]
        const partners = mine ? (groups.get(mine) ?? []).filter((g) => g.id !== graph.id) : []
        const candidates = others.filter(
          (g) => g.axes[w].type === 'continuous' && (!mine || g.links?.[w] !== mine),
        )
        const setLink = (
          node: Pick<GraphNode, 'id' | 'links'>,
          group: string | undefined,
        ): Command => ({
          type: 'node.set',
          id: node.id,
          path: ['links'],
          value: (() => {
            const next = { ...node.links, [w]: group }
            if (!group) delete next[w]
            return next.x || next.y ? next : undefined
          })(),
        })
        return (
          <div key={w} className="field">
            <p className="muted">
              {w.toUpperCase()} axis:{' '}
              {partners.length
                ? `automatic range shared with ${partners.map((g) => `“${g.name}”`).join(', ')}.`
                : 'not shared.'}
            </p>
            <Select
              label={`Share the ${w.toUpperCase()} axis with`}
              value=""
              options={[
                { value: '', label: 'Choose a graph…' },
                ...candidates.map((g) => ({ value: g.id as string, label: g.name })),
              ]}
              onChange={(id) => {
                const other = others.find((g) => g.id === id)
                if (!other) return
                const group = other.links?.[w] ?? mine ?? newNodeId()
                const cmds = [setLink(graph, group)]
                if (other.links?.[w] !== group) cmds.push(setLink(other, group))
                // Merging two groups: move the rest of my old group along.
                if (mine && mine !== group) for (const g of partners) cmds.push(setLink(g, group))
                ctx.dispatch(cmds, 'Share axis')
              }}
            />
            {mine && (
              <button
                type="button"
                onClick={() => ctx.dispatch(setLink(graph, undefined), 'Unshare axis')}
              >
                Stop sharing the {w.toUpperCase()} axis
              </button>
            )}
          </div>
        )
      })}
      <p className="muted">
        Shared axes use one automatic range for all graphs in the group; a graph with a manual range
        keeps its own.
      </p>
    </Section>
  )
}
