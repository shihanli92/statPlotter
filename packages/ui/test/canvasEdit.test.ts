import { createGraphFor, layoutGraph } from '@ps/graph'
import { createTable, type GraphNode, newAnnotationId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf } from '../../graph/test/helpers.ts'
import { applyDrag, dragTargetOf, legendLabelAt, textEditAt } from '../src/graph/canvasEdit.ts'

function setup(tableKind: 'xy' | 'column' = 'xy') {
  const table = createTable({ tableKind, columns: 2, rows: 3 })
  if (tableKind === 'xy') table.x!.subcolumns[0]!.values = [1, 2, 3]
  table.dataSets[0]!.subcolumns[0]!.values = [1, 4, 9]
  table.dataSets[1]!.subcolumns[0]!.values = [2, 3, 5]
  const base = createGraphFor(table)
  const graph: GraphNode = {
    ...base,
    axes: { ...base.axes, y: { ...base.axes.y, title: { content: [{ text: 'Response' }] } } },
    annotations: [
      {
        type: 'text',
        id: newAnnotationId(),
        anchor: { space: 'data', x: 2, y: 5 },
        content: { content: [{ text: 'Note' }] },
      },
      {
        type: 'line',
        id: newAnnotationId(),
        space: 'plot',
        from: { x: 0.1, y: 0.1 },
        to: { x: 0.5, y: 0.5 },
        stroke: { color: { rgb: '#000000' }, width: 1, dash: 'solid' },
        arrow: 'end',
      },
    ],
  }
  const project = projectOf(table, graph)
  return { project, table, graph, scene: layoutGraph({ project, graph, fonts }) }
}

describe('on-canvas editing', () => {
  it('drags the legend inside the plot, starting where it was drawn', () => {
    const { graph, scene } = setup()
    const t = dragTargetOf(['legend'], graph)!
    const moved = applyDrag(graph, scene, t, 0, 0)
    expect(moved.legend.position).toBe('inside')
    // The right-hand legend starts beyond the plot's right edge.
    expect(moved.legend.inside!.x).toBeGreaterThan(1)
    const dragged = applyDrag(graph, scene, t, -scene.plot.w / 2, 0)
    expect(dragged.legend.inside!.x).toBeCloseTo(moved.legend.inside!.x - 0.5, 9)
  })

  it('moves data-anchored text in data units and plot-anchored lines in fractions', () => {
    const { graph, scene } = setup()
    const text = applyDrag(graph, scene, { kind: 'annotation', index: 0 }, 0, 0)
    expect(text.annotations[0]).toEqual(graph.annotations[0])
    const ax = scene.axes!.x
    const dx = ax.toPx(3) - ax.toPx(2)
    const moved = applyDrag(graph, scene, { kind: 'annotation', index: 0 }, dx, 0)
    const a = moved.annotations[0]!
    expect(a.type === 'text' && a.anchor.x).toBeCloseTo(3, 9)
    const line = applyDrag(graph, scene, { kind: 'annotation', index: 1 }, scene.plot.w * 0.1, 0)
    const l = line.annotations[1]!
    expect(l.type === 'line' && [l.from.x, l.to.x]).toEqual([
      expect.closeTo(0.2, 9),
      expect.closeTo(0.6, 9),
    ])
    expect(dragTargetOf(['axes', 'x'], graph)).toBeNull()
  })

  it('finds editable text: titles, text annotations and legend labels', () => {
    const { graph, scene, table } = setup()
    const y = textEditAt(graph, scene, ['axes', 'y', 'title'])
    expect(y?.kind === 'graph' && y.path).toEqual(['axes', 'y', 'title', 'content'])
    // The Y title is vertical: its box is taller than wide.
    expect(y!.box.h).toBeGreaterThan(y!.box.w)
    expect(textEditAt(graph, scene, ['annotations', 0])?.kind).toBe('graph')
    expect(textEditAt(graph, scene, ['annotations', 1])).toBeNull()
    const key = table.dataSets[0]!.id
    // Roadmap 47b: a legend entry's label edits its legend-only label, its own name to start.
    const at = legendLabelAt(scene, graph, `legend/${key}/label`)
    expect(at?.key).toBe(key)
    expect(at?.value).toEqual([{ text: table.dataSets[0]!.title }])
    const labelled = {
      ...graph,
      legend: { ...graph.legend, labels: { [key]: [{ text: 'Mine' }] } },
    }
    expect(legendLabelAt(scene, labelled, `legend/${key}/label`)?.value).toEqual([{ text: 'Mine' }])
    expect(legendLabelAt(scene, graph, `legend/${key}/swatch`)).toBeNull()
  })
})
