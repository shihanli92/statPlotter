// @vitest-environment happy-dom
import { graphTheme, newGraphNode } from '@ps/graph'
import { createProject, type DataTable, GraphNode, type NodeId, type Project } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  type BuilderAction,
  builderChange,
  builderReducer,
  initialBuilder,
} from '../src/graph/builder/builderState.ts'
import type { PanelContext } from '../src/graph/inspector/context.ts'
import { LayerFields } from '../src/graph/inspector/LayerFields.tsx'
import { seriesOfLayer } from '../src/graph/inspector/layers.ts'

// Audit 2 (step 1's follow-up to G9, decision 664): the inspector shows what an ellipse, a hull,
// a path or a density draws by default under the graph's style (its theme), not the app's
// defaults: the style's data line width for outlines and contour lines, its colour map.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

// Not the graph test helpers: they load fonts from files, which happy-dom's URLs can't.
const small = () => syntheticTable({ rows: 300, genes: 2, pcs: 0, cellIds: false })
const projectOf = (table: DataTable, graph: GraphNode): Project => {
  const p = createProject()
  p.nodes[table.id] = table
  p.nodes[graph.id] = graph
  p.order.push(table.id, graph.id)
  return p
}

const run = (table: DataTable, actions: BuilderAction[]) =>
  actions.reduce((s, a) => builderReducer(table, s, a), initialBuilder(table))

/** The project with the graph made by these builder actions, under a style of thick lines. */
function setup(table: DataTable, actions: BuilderAction[]) {
  const graph = GraphNode.parse({
    ...newGraphNode(table, builderChange(run(table, actions))),
    id: 'g1' as NodeId,
  })
  const plain = projectOf(table, graph)
  const styled: Project = {
    ...plain,
    settings: { ...plain.settings, style: { lines: { dataLine: 2.5 }, colorMap: 'magma' } },
  }
  return { graph, plain, styled }
}

/** The layer of this geom's fields, rendered as the Format dialog does: its sections by title. */
function fields(project: Project, graph: GraphNode, geom: string) {
  const layer = graph.layers.find((l) => l.geom === geom)!
  const theme = graphTheme(project, graph)
  const ctx: PanelContext = {
    graph,
    project,
    lookup: () => undefined,
    theme,
    palette: theme.palette,
    set: () => {},
    dispatch: () => {},
    onSelect: () => {},
    onError: () => {},
  }
  const host = document.createElement('div')
  document.body.append(host)
  act(() => {
    root?.unmount()
    root = createRoot(host)
    root.render(
      <LayerFields
        ctx={ctx}
        layer={layer}
        items={seriesOfLayer(project, graph, layer)}
        seriesKey={null}
      />,
    )
  })
  return (title: string) => {
    const section = [...host.querySelectorAll('section')].find((s) =>
      s.querySelector('h3')?.textContent?.includes(title),
    )
    if (!section) throw new Error(`no section ${title}`)
    const input = (label: string) => {
      const l = [...section.querySelectorAll('label')].find((x) => x.textContent === label)
      return (l &&
        section.querySelector<HTMLInputElement | HTMLSelectElement>(`#${CSS.escape(l.htmlFor)}`))!
    }
    return { input }
  }
}

describe('the inspector under a graph’s style', () => {
  it('shows an ellipse’s outline at the style’s data line width', () => {
    const { graph, plain, styled } = setup(small(), [{ type: 'preset', id: 'scatterEllipses' }])
    expect(fields(plain, graph, 'polygon')('Ellipses').input('Width (pt)').value).toBe('1')
    expect(fields(styled, graph, 'polygon')('Ellipses').input('Width (pt)').value).toBe('2.5')
  })

  it('shows a path’s line at the style’s width', () => {
    const { graph, styled } = setup(small(), [{ type: 'preset', id: 'trajectories' }])
    expect(fields(styled, graph, 'path')('Paths').input('Line width (pt)').value).toBe('2.5')
  })

  it('shows contour lines at the style’s width and density colours on its colour map', () => {
    const cells = syntheticTable({ rows: 25_000, genes: 3, pcs: 0, cellIds: false })
    const { graph, plain, styled } = setup(cells, [
      { type: 'preset', id: 'bubble' },
      { type: 'toggle', style: 'contours' },
      { type: 'toggle', style: 'hexbin' },
    ])
    expect(fields(plain, graph, 'contour')('Density contours').input('Width (pt)').value).toBe(
      '0.75',
    )
    expect(fields(styled, graph, 'contour')('Density contours').input('Width (pt)').value).toBe(
      '2.5',
    )
    expect(fields(plain, graph, 'hex')('Hexagons').input('Colour map').value).toBe('viridis')
    expect(fields(styled, graph, 'hex')('Hexagons').input('Colour map').value).toBe('magma')
  })
})
