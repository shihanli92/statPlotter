import { folderOf, followSplitSets, type Project } from '@ps/model'
import type { Command } from './commands.ts'

/**
 * The commands that follow a change for sets of split graphs (roadmap 34d, decision 382): a graph
 * for each new level, data set or row of a set's table, after its set's graphs, and the pages
 * placing the set with it in its place. The store applies them in the same undo step as the
 * change.
 */
export function splitFollowUps(before: Project, after: Project): Command[] {
  const follow = followSplitSets(before, after)
  if (!follow) return []
  const order = [...after.order]
  const cmds: Command[] = []
  for (const { node, after: prev, template } of follow.graphs) {
    const at = order.indexOf(prev) + 1
    order.splice(at, 0, node.id)
    // In the folder of the graph it copies (audit 2, M9), not its table's.
    const folder = folderOf(after.folders, template)?.id ?? null
    cmds.push({ type: 'node.add', node, at, folder })
  }
  for (const layout of follow.layouts) cmds.push({ type: 'node.replace', node: layout })
  return cmds
}
