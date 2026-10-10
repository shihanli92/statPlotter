import { newFunctionCurve, presetGraph } from '@ps/graph'
import { createTable, type DataTable, type GraphNode, type Project } from '@ps/model'

/**
 * "Plot a function" from scratch: a graph of a function (a dose-response curve to start from,
 * over log concentrations −9 to −3) and the small XY table it belongs to, where data to compare
 * with the function can be entered. The function itself lives on the graph (its functions
 * layer) and is edited in Format graph › Appearance, the graph following every change.
 */
export function plotFunctionNodes(project: Pick<Project, 'nodes'>): {
  table: DataTable
  graph: GraphNode
  /** The function's series id. */
  fn: string
} {
  const n = Object.values(project.nodes).filter(
    (d) => d.kind === 'graph' && d.layers.some((l) => l.data?.from === 'functions'),
  ).length
  const name = `Function ${n + 1}`
  const table = createTable({ name, tableKind: 'xy', columns: 1, rows: 5 })
  table.dataSets[0]!.title = 'Data'
  table.notes =
    'Values to plot with the function (optional). The function is on the graph: double-click the curve (or Format graph › Appearance) to choose the equation, its parameter values and the X range.'
  const base = presetGraph(table, 'meanSd', name)
  const { style: _, ...fc } = newFunctionCurve('agonist-response-variable-slope', [-9, -3])
  const graph: GraphNode = {
    ...base,
    // The function behind the table's data, as a migrated graph's functions are.
    layers: [
      {
        id: 'functions',
        geom: 'line',
        stat: { kind: 'identity' },
        data: { from: 'functions', functions: [fc] },
      },
      ...base.layers,
    ],
    legend: { ...base.legend, show: false },
    title: { content: [{ text: name }] },
  }
  return { table, graph, fn: fc.id }
}
