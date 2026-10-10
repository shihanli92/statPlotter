import {
  builderPresetsFor,
  layoutGraph,
  newGraphNode,
  presetFits,
  recipeLayers,
  resolveSeries,
  userPresetsFor,
  withLayers,
} from '@ps/graph'
import {
  type DataTable,
  GraphNode,
  type NodeId,
  newUserPreset,
  presetRecipe,
  readPreset,
  writePreset,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf, sampleTable, sampleVariables } from '../../graph/test/helpers.ts'
import {
  axisVariables,
  type BuilderAction,
  type BuilderState,
  builderChange,
  builderIssues,
  builderOf,
  builderReducer,
  groupsOf,
  initialBuilder,
  styleChoices,
} from '../src/graph/builder/builderState.ts'

// The graph builder's Map variables (roadmap 34a): X and Y of any type, the frame following the
// types — number × number an XY graph, a text variable's levels as categories (grouped by a text
// colour variable, turned when it is Y), two text variables counted — every step valid by the
// matrix; what the plot-style icons offer for the axes' types; presets of graphs of variables.

const table = sampleVariables()
const run = (actions: BuilderAction[], from: BuilderState = initialBuilder(table)) =>
  actions.reduce((s, a) => builderReducer(table, s, a), from)
const ids = (s: BuilderState) => s.layers.map((l) => l.id)
const offered = (s: BuilderState) =>
  styleChoices(table, s)
    .filter((c) => c.allowed.allowed)
    .map((c) => c.style.id)

/** The graph the builder makes, laid out: its series' titles and warnings. */
function made(s: BuilderState) {
  const g = { ...newGraphNode(table, builderChange(s)), id: 'g1' as NodeId }
  const graph = GraphNode.parse(s.levels ? { ...g, levels: s.levels } : g)
  const scene = layoutGraph({ project: projectOf(table, graph), graph, fonts })
  return {
    graph,
    titles: resolveSeries(projectOf(table, graph), graph).map((x) => x.title),
    scene,
  }
}

describe('graph builder: Map variables of any type', () => {
  it('starts with the variables as columns; a text variable on X gives its levels as categories', () => {
    const s0 = initialBuilder(table)
    expect(s0.mapping).toBeUndefined()
    expect(axisVariables(s0)).toEqual({})
    const s = run([{ type: 'map', field: 'x', key: 'a' }])
    // The first number variable comes on Y; the layers there stay.
    expect(s.mapping).toEqual({ x: 'a', y: 'c' })
    expect(s.frame).toBe('category')
    expect(s.horizontal).toBe(false)
    expect(ids(s)).toEqual(ids(s0))
    expect(builderIssues(table, s)).toEqual([])
    const m = made(s)
    expect(m.titles).toEqual(['Low', 'High', 'Mid'])
    expect(m.graph.axes.x.title).toEqual({ content: [{ text: 'Group' }] })
    expect(m.graph.axes.y.title).toEqual({ content: [{ text: 'Score' }] })
    expect(m.scene.warnings).toContain('1 row without a level of Group left out.')
  })

  it('a text colour variable groups the categories, side by side or stacked', () => {
    const s = run([
      { type: 'map', field: 'x', key: 'a' },
      { type: 'map', field: 'color', key: 'b' },
    ])
    expect(s.mapping).toEqual({ x: 'a', y: 'c', color: 'b' })
    expect(s.frame).toBe('grouped')
    expect(groupsOf(s.layers)).toBe('dodge')
    expect(builderIssues(table, s)).toEqual([])
    expect(made(s).titles).toEqual(['F', 'M'])
    const stacked = run([{ type: 'groups', value: 'stack' }], s)
    expect(groupsOf(stacked.layers)).toBe('stack')
    expect(builderIssues(table, stacked)).toEqual([])
    // No colour: categories again.
    const back = run([{ type: 'map', field: 'color' }], s)
    expect(back.frame).toBe('category')
    expect(back.mapping).toEqual({ x: 'a', y: 'c' })
    expect(back.layers.every((l) => l.position === undefined)).toBe(true)
  })

  it('a number on X and text on Y turns the graph; Horizontal swaps the variables', () => {
    const s = run([
      { type: 'map', field: 'x', key: 'c' },
      { type: 'map', field: 'y', key: 'a' },
    ])
    expect(s.mapping).toEqual({ x: 'c', y: 'a' })
    expect(s.horizontal).toBe(true)
    expect(s.frame).toBe('category')
    const g = made(s).graph
    expect(g.style.orientation).toBe('horizontal')
    // The category axis (axes.x) stays the text variable's, down the left.
    expect(g.axes.x.title).toEqual({ content: [{ text: 'Group' }] })
    const v = run([{ type: 'horizontal', on: false }], s)
    expect(v.mapping).toEqual({ x: 'a', y: 'c' })
    expect(v.horizontal).toBe(false)
  })

  it('two text variables count their combinations: bars or a heat map, counts or percents', () => {
    const s = run([
      { type: 'map', field: 'x', key: 'a' },
      { type: 'map', field: 'y', key: 'b' },
    ])
    expect(s.mapping).toEqual({ x: 'a', y: 'b' })
    expect(s.frame).toBe('grouped')
    // Points and error bars don't count: the usual count bars instead.
    expect(ids(s)).toEqual(['bars'])
    expect(builderIssues(table, s)).toEqual([])
    expect(offered(s)).toEqual(['bars', 'labels', 'groupedBars', 'heatmap'])
    const pct = run(
      [
        { type: 'measure', value: 'percentOfX' },
        { type: 'groups', value: 'percent' },
      ],
      s,
    )
    expect(pct.mapping?.measure).toBe('percentOfX')
    expect(made(pct).graph.axes.y.title).toEqual({ content: [{ text: 'Percent within Group' }] })
    expect(run([{ type: 'measure', value: 'count' }], pct).mapping).toEqual({ x: 'a', y: 'b' })
    const heat = run([{ type: 'toggle', style: 'heatmap' }], s)
    expect(heat.frame).toBe('matrix')
    expect(heat.mapping).toEqual({ x: 'a', y: 'b' })
    expect(made(heat).titles).toEqual(['Low', 'High', 'Mid'])
    expect(run([{ type: 'toggle', style: 'groupedBars' }], heat).frame).toBe('grouped')
    // A colour variable has no place: the Y variable gives the groups.
    expect(run([{ type: 'map', field: 'color', key: 'b' }], s).mapping).toEqual(s.mapping)
  })

  it('two number variables are an XY graph of the rows; no X variable the columns again', () => {
    const tn = run([{ type: 'map', field: 'x', key: 'a' }])
    const xy = run([{ type: 'map', field: 'x', key: 'd' }], tn)
    expect(xy.frame).toBe('xy')
    expect(xy.mapping).toBeUndefined()
    expect(xy.layers.find((l) => l.aes)?.aes).toEqual({ x: 'd', y: 'c' })
    expect(axisVariables(xy)).toEqual({ x: 'd', y: 'c', color: undefined })
    // On the XY graph, colour can be any variable.
    expect(run([{ type: 'map', field: 'color', key: 'b' }], xy).layers[0]!.aes).toMatchObject({
      color: 'b',
    })
    const cols = run([{ type: 'map', field: 'x' }], tn)
    expect(cols.mapping).toBeUndefined()
    expect(cols.frame).toBe('category')
    expect(made(cols).titles).toEqual(['Score', 'Age'])
  })

  it('offers only what draws for the axes’ types', () => {
    const tn = run([{ type: 'map', field: 'x', key: 'a' }])
    const styles = offered(tn)
    for (const id of ['points', 'box', 'violin', 'bars', 'center', 'error', 'labels', 'joinMeans'])
      expect(styles, id).toContain(id)
    // Before-after lines join a row across variables; frame choices leave the mapping elsewhere.
    for (const id of ['pairs', 'heatmap', 'bubbles', 'columns', 'band'])
      expect(styles, id).not.toContain(id)
    const grouped = run([{ type: 'map', field: 'color', key: 'b' }], tn)
    expect(offered(grouped)).toContain('band')
    expect(offered(grouped)).not.toContain('grandMean')
  })

  it('presets keep the variables mapped; a bubble plot leaves them', () => {
    const tn = run([{ type: 'map', field: 'x', key: 'a' }])
    const box = run([{ type: 'preset', id: 'groupBoxPoints' }], tn)
    expect(box.mapping).toEqual({ x: 'a', y: 'c' })
    expect(ids(box)).toEqual(['box', 'points'])
    const bars = run([{ type: 'preset', id: 'barsPoints' }], tn)
    expect(bars.mapping).toEqual({ x: 'a', y: 'c' })
    const bubble = run([{ type: 'preset', id: 'bubble' }], tn)
    expect(bubble.mapping).toBeUndefined()
    expect(bubble.frame).toBe('xy')
    // The box by group needs a text variable.
    expect(builderPresetsFor('multipleVariables', sampleTable('multipleVariables'))).toHaveLength(2)
    expect(run([{ type: 'preset', id: 'groupBoxPoints' }], initialBuilder(table)).mapping).toEqual({
      x: 'a',
      y: 'c',
    })
  })

  it('keeps an order of levels, reset to the table’s', () => {
    const s = run([
      { type: 'map', field: 'x', key: 'a' },
      { type: 'levels', variable: 'a', order: ['Mid', 'Low', 'High'] },
    ])
    expect(s.levels).toEqual({ a: ['Mid', 'Low', 'High'] })
    expect(made(s).titles).toEqual(['Mid', 'Low', 'High'])
    const reset = run([{ type: 'levels', variable: 'a', order: null }], s)
    expect(reset.levels).toBeUndefined()
  })

  it('over an existing graph of variables: its mapping, changed in one step', () => {
    const s = run([{ type: 'map', field: 'x', key: 'a' }])
    const g = newGraphNode(table, builderChange(s))
    const again = builderOf({ ...g, levels: { a: ['High'] } }, table)
    expect(again.mapping).toEqual(s.mapping)
    expect(again.levels).toEqual({ a: ['High'] })
    const tt = run([{ type: 'map', field: 'y', key: 'b' }], again)
    const out = withLayers(g, builderChange(tt), table)
    expect(out.mapping).toEqual({ x: 'a', y: 'b' })
    expect(out.frame).toBe('grouped')
    expect(out.axes.y.title).toEqual({ content: [{ text: 'Count' }] })
    // Back to the variables as columns: no mapping.
    expect(
      withLayers(out, builderChange(run([{ type: 'map', field: 'x' }], tt)), table).mapping,
    ).toBeUndefined()
  })
})

describe('user presets of graphs of variables', () => {
  const tn = run([
    { type: 'map', field: 'x', key: 'a' },
    { type: 'map', field: 'color', key: 'b' },
  ])
  const graph = newGraphNode(table, builderChange(tn))
  const recipe = presetRecipe(graph, 'multipleVariables', table)

  it('keep the types of the variables, never the variables', () => {
    expect(recipe.variables).toEqual({ x: 'text', y: 'number', color: 'text' })
    expect(JSON.stringify(recipe)).not.toMatch(/"(a|b|c)"/)
    const back = readPreset(writePreset(newUserPreset('Groups', recipe)))
    expect(back.recipe.variables).toEqual(recipe.variables)
  })

  it('map the first variables of those types on another table, where it has them', () => {
    const other: DataTable = {
      ...table,
      id: 't2' as NodeId,
      dataSets: [table.dataSets[3]!, table.dataSets[1]!, table.dataSets[2]!, table.dataSets[0]!],
    }
    const spec = recipeLayers(recipe, other, 'Groups')
    // X: the first text variable (Sex), Y: the first number (Age), colour: the next text (Group).
    expect(spec.mapping).toEqual({ x: 'b', y: 'd', color: 'a' })
    const s = run([{ type: 'recipe', spec }], initialBuilder(other))
    expect(s.mapping).toEqual(spec.mapping)
    expect(s.frame).toBe('grouped')
    const p = newUserPreset('Groups', recipe)
    expect(presetFits(recipe, 'multipleVariables', other)).toBe(true)
    expect(userPresetsFor([p], 'multipleVariables', sampleTable('multipleVariables'))).toEqual([])
    expect(presetFits(recipe, 'column')).toBe(false)
  })
})
