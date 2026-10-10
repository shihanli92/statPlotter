import type { Command } from '@ps/engine'
import { matchSetFormat } from '@ps/graph'
import { type GraphNode, newNodeId, setMembers, sourceTable } from '@ps/model'
import { Checkbox, Section } from '../../components/fields.tsx'
import { graphChangeCommands } from '../graphActions.ts'
import { splitWhat } from '../split.ts'
import type { PanelContext } from './context.ts'

/** A graph's links with one axis' group set (or removed). */
function withLink(g: GraphNode, axis: 'x' | 'y', group: string | undefined): Command {
  const next = { ...g.links, [axis]: group }
  if (!group) delete next[axis]
  return {
    type: 'node.set',
    id: g.id,
    path: ['links'],
    value: next.x || next.y ? next : undefined,
  }
}

/**
 * Format graph › Graph settings › One graph per… (roadmap 34d): for a graph of a set of split
 * graphs, what the set is, its axes shared or free, and this graph's format applied to the others;
 * for any other graph, "Split into one graph per…".
 */
export function SplitSection({ ctx }: { ctx: PanelContext }) {
  const { graph, project } = ctx
  if (!graph.split)
    return ctx.onSplit ? (
      <Section title="One graph per…" collapsed>
        <p className="muted">
          Small multiples: graphs like this one, one per level of a text variable, data set or row,
          on a new page with shared axes.
        </p>
        <button type="button" onClick={ctx.onSplit}>
          Split into one graph per…
        </button>
      </Section>
    ) : null
  const set = graph.split.set
  const members = setMembers(project, set)
  const others = members.filter((g) => g.id !== graph.id)
  const table = sourceTable(project, graph.seriesSource.table, ctx.lookup)
  const axes = (['x', 'y'] as const).filter((w) => graph.axes[w].type === 'continuous')
  const shared = (w: 'x' | 'y') =>
    !!graph.links?.[w] && members.every((g) => g.links?.[w] === graph.links?.[w])
  const share = (w: 'x' | 'y', on: boolean) => {
    const group = on ? (graph.links?.[w] ?? newNodeId()) : undefined
    ctx.dispatch(
      members.map((g) => withLink(g, w, group)),
      on ? `Share the ${w.toUpperCase()} axis` : `Free ${w.toUpperCase()} axes`,
    )
  }
  return (
    <Section title="One graph per…">
      <p className="muted">
        One of {members.length} graphs, one per {table ? splitWhat(graph.split, table) : 'slice'}; a
        new one in the table gets its graph.
      </p>
      {axes.map((w) => (
        <Checkbox
          key={w}
          label={`Share the ${w.toUpperCase()} axis range across the set (off: free scales)`}
          checked={shared(w)}
          onChange={(v) => share(w, v)}
        />
      ))}
      <button
        type="button"
        disabled={!others.length}
        onClick={() =>
          ctx.dispatch(
            others.flatMap((g) =>
              graphChangeCommands(g, matchSetFormat(project, g, graph, ctx.lookup)),
            ),
            'Apply format to the set',
          )
        }
      >
        Apply this graph’s format to all graphs of the set
      </button>
    </Section>
  )
}
