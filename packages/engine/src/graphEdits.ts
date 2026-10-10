import type { GraphEdit, GraphNode } from '@ps/model'
import type { Command } from './commands.ts'

/**
 * The commands making the edits between two versions of a graph (`graphEdits` in `@ps/model`):
 * a layer list replaced whole, every other change a `node.set` of its path.
 */
export function editCommands(id: GraphNode['id'], edits: readonly GraphEdit[]): Command[] {
  return edits.map((e) =>
    e.kind === 'layers'
      ? { type: 'graph.setLayers', id, layers: e.layers }
      : { type: 'node.set', id, path: e.path, value: e.value },
  )
}
