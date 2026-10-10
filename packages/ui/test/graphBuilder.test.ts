import {
  BUILDER_PRESETS,
  builderPresetsFor,
  frontFirst,
  layoutGraph,
  matrixKindOf,
  presetGraph,
  presetsFor,
  rowToIndex,
  styleOfLayer,
  stylesFor,
  withLayers,
} from '@ps/graph'
import { type DataTable, GraphNode, TableKind } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, projectOf, sampleTable, sampleVariables } from '../../graph/test/helpers.ts'
import {
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
import { previewLabel, tableContext } from '../src/graph/builder/GraphBuilder.tsx'

// The graph builder's state (roadmap 33c): a pure reducer over a table, every step valid by the
// compatibility matrix.

const run = (table: DataTable, actions: BuilderAction[], from = initialBuilder(table)) =>
  actions.reduce((s, a) => builderReducer(table, s, a), from)

const ids = (s: BuilderState) => s.layers.map((l) => l.id)

describe('graph builder', () => {
  it('starts from the table’s usual preset; every preset is valid for every table kind', () => {
    // The kind's default where it is a chip, else the first chip; a node's natural one.
    expect(initialBuilder(sampleTable('grouped')).preset).toBe('barsPoints')
    expect(initialBuilder(sampleTable('column')).preset).toBe('points')
    expect(initialBuilder(sampleTable('xy')).preset).toBe('meanSdJoined')
    expect(initialBuilder(sampleTable('contingency')).preset).toBe('bars')
    expect(initialBuilder(sampleTable('xy'), 'histogram').preset).toBe('histogram')
    for (const kind of TableKind.options) {
      for (const p of presetsFor(kind)) {
        // A dot plot (roadmap 34g) groups by a text variable: a table with some.
        const table = p.id === 'dotPlot' ? sampleVariables() : sampleTable(kind)
        const s = run(table, [{ type: 'preset', id: p.id }])
        expect(s.preset, `${p.id} on ${kind}`).toBe(p.id)
        expect(s.custom).toBe(false)
        expect(builderIssues(table, s), `${p.id} on ${kind}`).toEqual([])
        const g = presetGraph(table, p.id)
        const scene = layoutGraph({ project: projectOf(table, g), graph: g, fonts })
        expect(scene.width).toBeGreaterThan(0)
      }
    }
  })

  it('builds bars (mean) + points + error bars (SEM) on a grouped table (the user’s example)', () => {
    const table = sampleTable('grouped')
    const s = run(table, [
      { type: 'preset', id: 'pointsOnly' },
      { type: 'toggle', style: 'bars' },
      { type: 'toggle', style: 'error' },
      { type: 'stat', id: 'error', stat: { kind: 'summary', center: 'mean', error: 'SEM' } },
    ])
    // Bars (a fill) go behind the points already there; the error bars on the bars, just in
    // front of them.
    expect(ids(s)).toEqual(['bars', 'error', 'points'])
    expect(s.layers[1]).toMatchObject({
      geom: 'errorbar',
      on: 'bars',
      stat: { center: 'mean', error: 'SEM' },
      position: { kind: 'dodge' },
    })
    expect(s.look).toBe('grouped.bar')
    expect(s.custom).toBe(true)
    expect(s.preset).toBe('pointsOnly')
    expect(builderIssues(table, s)).toEqual([])
    // The bars moved up (to the front): past the points, their error bars along.
    const up = run(table, [{ type: 'move', id: 'bars', by: 1 }], s)
    expect(ids(up)).toEqual(['points', 'bars', 'error'])
    const g = presetGraph(table, 'bars')
    const made = GraphNode.parse(withLayers(g, builderChange(s), table))
    expect(made.layers.map((l) => l.geom)).toEqual(['bar', 'errorbar', 'points'])
    const choices = styleChoices(table, s)
    for (const id of ['bars', 'points', 'error'])
      expect(choices.find((c) => c.style.id === id)?.selected, id).toBe(true)
  })

  it('lists layers front first: new marks on top, new fills behind the marks, up towards the front (roadmap 33e)', () => {
    const table = sampleTable('column')
    const s = run(table, [{ type: 'preset', id: 'barsPoints' }])
    expect(ids(s)).toEqual(['bars', 'points', 'error'])
    // The table's rows, top to bottom.
    expect(frontFirst(s.layers).map((l) => l.id)).toEqual(['error', 'points', 'bars'])
    // A new mark (a line) on top; new bars (a fill) behind every mark, a band in front of them.
    const added = run(table, [
      { type: 'preset', id: 'points' },
      { type: 'toggle', style: 'joinMeans' },
      { type: 'toggle', style: 'bars' },
    ])
    expect(ids(added)[0]).toBe('bars')
    expect(ids(added).at(-1)).toBe('line')
    const xy = sampleTable('xy')
    const band = run(xy, [
      { type: 'preset', id: 'each' },
      { type: 'toggle', style: 'area' },
      { type: 'toggle', style: 'line' },
      { type: 'toggle', style: 'band' },
    ])
    expect(band.layers.map((l) => l.geom)).toEqual(['area', 'band', 'points', 'line'])
    const bars = run(table, [
      { type: 'preset', id: 'bars' },
      { type: 'toggle', style: 'error' },
      { type: 'toggle', style: 'points' },
      { type: 'toggle', style: 'error' },
    ])
    expect(ids(bars)).toEqual(['bars', 'error', 'points'])
    // Up: the bars and their error bars past the points; down: back again.
    const up = run(table, [{ type: 'move', id: 'bars', by: 1 }], bars)
    expect(ids(up)).toEqual(['points', 'bars', 'error'])
    expect(ids(run(table, [{ type: 'move', id: 'bars', by: -1 }], up))).toEqual(ids(bars))
    // At the top nothing moves (the same state); a row dropped on the top row goes to the front.
    expect(run(table, [{ type: 'move', id: 'points', by: 1 }], bars)).toBe(bars)
    expect(ids(run(table, [{ type: 'moveTo', id: 'bars', to: rowToIndex(3, 0) }], bars))).toEqual([
      'points',
      'bars',
      'error',
    ])
  })

  it('a second click removes a style’s layer and what is attached to it', () => {
    const table = sampleTable('grouped')
    const bars = run(table, [{ type: 'preset', id: 'bars' }])
    const s = run(table, [{ type: 'toggle', style: 'bars' }], bars)
    expect(ids(s)).toEqual([])
    const t = run(table, [{ type: 'remove', id: 'bars' }], bars)
    expect(ids(t)).toEqual([])
  })

  it('leaves unavailable styles out, with their reasons', () => {
    const means = { ...sampleTable('column'), yFormat: { type: 'sd' } } as unknown as DataTable
    const s = initialBuilder(means)
    const violin = styleChoices(means, s).find((c) => c.style.id === 'violin')!
    expect(violin.allowed).toEqual({ allowed: false, reason: 'needs raw values' })
    expect(run(means, [{ type: 'toggle', style: 'violin' }], s)).toBe(s)
    const one = { ...sampleTable('column') }
    one.dataSets = one.dataSets.slice(0, 1)
    const pairs = styleChoices(one, initialBuilder(one)).find((c) => c.style.id === 'pairs')!
    expect(pairs.allowed.reason).toBe('needs two or more data sets')
  })

  it('stacking leaves points out (with a note); attached layers keep in front of their host', () => {
    const table = sampleTable('grouped')
    const s = run(table, [
      { type: 'preset', id: 'barsPoints' },
      { type: 'groups', value: 'stack' },
    ])
    expect(ids(s)).toEqual(['bars', 'error'])
    expect(groupsOf(s.layers)).toBe('stack')
    expect(s.note).toMatch(/Points/)
    expect(styleChoices(table, s).find((c) => c.style.id === 'points')?.allowed.reason).toBe(
      'not with stacked bars',
    )
    const back = run(table, [{ type: 'groups', value: 'aligned' }], s)
    expect(back.layers.every((l) => l.position?.kind === 'aligned')).toBe(true)
    // Moving the bars in front: their error bars come along.
    const m = run(table, [
      { type: 'preset', id: 'barsPoints' },
      { type: 'move', id: 'bars', by: 1 },
    ])
    expect(ids(m)).toEqual(['points', 'bars', 'error'])
    const n = run(table, [
      { type: 'preset', id: 'barsPoints' },
      { type: 'moveTo', id: 'error', to: 0 },
    ])
    expect(ids(n)).toEqual(['bars', 'error', 'points'])
  })

  it('frame choices replace the layers (a heat map of a grouped table)', () => {
    const table = sampleTable('grouped')
    const s = run(table, [{ type: 'toggle', style: 'heatmap' }])
    expect(s.frame).toBe('matrix')
    expect(ids(s)).toEqual(['cells'])
    expect(s.note).toMatch(/replaced/)
    const mv = sampleTable('multipleVariables')
    const b = run(mv, [
      { type: 'toggle', style: 'bubbles' },
      { type: 'aes', field: 'size', key: undefined },
    ])
    expect(b.frame).toBe('xy')
    expect(b.layers[0]!.aes?.size).toBeUndefined()
    expect(b.layers[0]!.aes?.x).toBeDefined()
  })

  it('nested subjects follow the options below', () => {
    const table = sampleTable('nested')
    const s = run(table, [{ type: 'nested', value: { layout: 'pooled', subjectMeans: true } }])
    expect(s.layers.find((l) => l.id === 'points')?.position).toBeUndefined()
    expect(ids(s)).toContain('subjectMeans')
  })

  it('over an existing graph: its layers, then OK keeps the formats of layers that stay', () => {
    const table = sampleTable('column')
    const g = presetGraph(table, 'bars')
    const styled: GraphNode = {
      ...g,
      layers: g.layers.map((l) =>
        l.id === 'bars' ? { ...l, style: { width: 0.3 } } : l,
      ) as GraphNode['layers'],
    }
    const s = run(table, [{ type: 'toggle', style: 'points' }], builderOf(styled, table))
    const out = withLayers(styled, builderChange(s), table)
    expect(out.layers.find((l) => l.id === 'bars')?.style).toEqual({ width: 0.3 })
    // The points added in front.
    expect(out.layers.map((l) => l.id)).toEqual(['bars', 'error', 'points'])
  })

  it('describes the table and the preview', () => {
    const table = sampleTable('grouped')
    expect(tableContext(table)).toBe('Grouped table · 3 rows × 2 data sets')
    const s = initialBuilder(table)
    expect(previewLabel(s.layers, s.frame, 2)).toBe(
      'Preview: Bars (mean), Points (every value) and error bars (SD), 2 data sets',
    )
  })

  it('shows a few presets as chips per table kind, each valid and making what it says', () => {
    for (const kind of TableKind.options) {
      // Multiple variables: a table with text variables (a box by group needs one); its cells
      // table's violins by group (roadmap 34f), density and dot plot (34g) are chips of cells
      // tables only.
      const table = kind === 'multipleVariables' ? sampleVariables() : sampleTable(kind)
      const chips = builderPresetsFor(kind, table)
      expect(chips.length, kind).toBeGreaterThan(0)
      expect(chips.length, kind).toBeLessThanOrEqual(5)
      expect(chips.map((p) => p.id)).toEqual(
        builderPresetsFor(kind)
          .map((p) => p.id)
          .filter((id) => !['groupViolin', 'density', 'dotPlot'].includes(id)),
      )
      for (const p of chips) {
        const s = run(table, [{ type: 'preset', id: p.id }])
        // A chip of a graph of variables lists the kind of its variables' types (roadmap 34a).
        expect(p.tableKinds, `${p.id} on ${kind}`).toContain(matrixKindOf(table, s))
        // The builder's layers, before a graph made of them takes the new looks (audit 3).
        expect(s.layers, `${p.id} on ${kind}`).toEqual(
          presetGraph(table, p.id, undefined, { looks: 'theme' }).layers,
        )
        expect(builderIssues(table, s), `${p.id} on ${kind}`).toEqual([])
      }
    }
    expect(BUILDER_PRESETS.column).toEqual(['barsPoints', 'points', 'boxPoints', 'violinBox'])
    expect(BUILDER_PRESETS.grouped).toContain('stacked')
  })

  it('every preset left out of the chips is still made of plot styles the builder offers', () => {
    for (const kind of TableKind.options) {
      const table = sampleTable(kind)
      for (const p of presetsFor(kind)) {
        const g = presetGraph(table, p.id)
        const offered = stylesFor({ kind, frame: g.frame }).map((st) => st.id)
        for (const l of g.layers) {
          const style = styleOfLayer(l, g.frame)
          expect(style, `${l.id} of ${p.id} on ${kind}`).toBeDefined()
          // A frame choice's layers come with the frame (heat map, bubbles, wedges, 100% bars).
          if (style && !style.frameChoice)
            expect(offered, `${style.id} of ${p.id} on ${kind}`).toContain(style.id)
        }
      }
    }
  })
})

describe('graph builder: the combinations of roadmap 33d', () => {
  /** A table's builder with no layers (the preset's removed one by one). */
  const empty = (table: DataTable, preset: string) => {
    const s = run(table, [{ type: 'preset', id: preset }])
    return run(
      table,
      s.layers.map((l): BuilderAction => ({ type: 'remove', id: l.id })),
      s,
    )
  }
  const toggle = (...styles: string[]): BuilderAction[] =>
    styles.map((style) => ({ type: 'toggle', style }))
  /** Valid by the matrix, and a graph of it drawn without warnings. */
  const valid = (table: DataTable, s: BuilderState) => {
    expect(builderIssues(table, s)).toEqual([])
    const g = withLayers(
      presetGraph(table, presetsFor(table.tableKind)[0]!.id),
      builderChange(s),
      table,
    )
    expect(layoutGraph({ project: projectOf(table, g), graph: g, fonts }).warnings).toEqual([])
  }

  it('violin + box + points: the box narrow inside the violin, in either order', () => {
    const table = sampleTable('column')
    for (const order of [
      ['violin', 'box', 'points'],
      ['box', 'violin', 'points'],
    ]) {
      const s = run(table, toggle(...order), empty(table, 'points'))
      expect(s.layers.map((l) => l.geom)).toEqual(['violin', 'box', 'points'])
      const box = s.layers.find((l) => l.geom === 'box')!
      expect((box.style as { width?: number }).width).toBe(0.12)
      expect(s.layers.find((l) => l.geom === 'violin')!.stat).toMatchObject({ center: 'none' })
      valid(table, s)
    }
  })

  it('a line through the means, mean symbols and a band, from the icons', () => {
    const column = sampleTable('column')
    const s = run(column, toggle('joinMeans', 'means'), empty(column, 'points'))
    expect(s.layers.map((l) => [l.geom, l.stat.kind])).toEqual([
      ['line', 'summary'],
      ['points', 'summary'],
    ])
    valid(column, s)
    const grouped = sampleTable('grouped')
    const course = run(
      grouped,
      [...toggle('band', 'joinMeans', 'means'), { type: 'groups', value: 'aligned' }],
      empty(grouped, 'points'),
    )
    expect(course.layers.map((l) => [l.geom, l.position?.kind])).toEqual([
      ['band', 'aligned'],
      ['line', 'aligned'],
      ['points', 'aligned'],
    ])
    valid(grouped, course)
    valid(grouped, run(grouped, toggle('box', 'joinMeans'), empty(grouped, 'points')))
  })

  it('contingency tables: 100% stacked bars with percent labels, and a heat map', () => {
    const table = sampleTable('contingency')
    const s = run(table, [{ type: 'groups', value: 'percent' }, ...toggle('labels')])
    const labels = s.layers.find((l) => l.geom === 'label')!
    expect(labels.on).toBe('bars')
    expect(labels.style).toEqual({ value: 'percent' })
    valid(table, s)
    const map = run(table, toggle('heatmap'))
    expect(map.frame).toBe('matrix')
    valid(table, map)
  })

  it('XY: stacked areas leave out points and lines (with a note); a step line', () => {
    const table = sampleTable('xy')
    const s = run(table, [...toggle('area'), { type: 'areas', stacked: true }])
    expect(s.layers.map((l) => l.geom)).toEqual(['area'])
    expect(s.layers[0]!.position).toEqual({ kind: 'stack' })
    expect(s.note).toMatch(/^Stacked areas draw no points/)
    expect(styleChoices(table, s).find((c) => c.style.id === 'points')?.allowed.reason).toBe(
      'not with stacked areas',
    )
    valid(table, s)
    const back = run(table, [{ type: 'areas', stacked: false }], s)
    expect(back.layers[0]!.position).toBeUndefined()
    const step = run(table, toggle('step'), empty(table, 'meanSdJoined'))
    expect(step.layers[0]).toMatchObject({ geom: 'step', stat: { kind: 'summary' } })
    valid(table, step)
  })

  it('a histogram of a column table: a frame choice, its bars binned, its measure', () => {
    const table = sampleTable('column')
    const s = run(table, toggle('histogram'))
    expect(s.frame).toBe('xy')
    expect(s.layers).toEqual([
      expect.objectContaining({ geom: 'bar', stat: { kind: 'bin', measure: 'count' } }),
    ])
    // Only binned bars on a column table's XY graph.
    expect(styleChoices(table, s).map((c) => c.style.id)).toEqual(['bars', 'columns', 'histogram'])
    const pct = run(
      table,
      [{ type: 'stat', id: 'bars', stat: { kind: 'bin', measure: 'percent', width: 2 } }],
      s,
    )
    valid(table, pct)
    expect(run(table, toggle('columns'), s).frame).toBe('category')
  })

  it('multiple variables: points coloured by a variable, lines by group', () => {
    const table = sampleTable('multipleVariables')
    const s = run(table, [
      { type: 'preset', id: 'bubble' },
      { type: 'aes', field: 'size' },
      ...toggle('groupLines'),
      { type: 'aes', field: 'group', key: 'd' },
    ])
    expect(s.layers.find((l) => l.geom === 'line')!.aes).toEqual({ group: 'd' })
    expect(s.layers.find((l) => l.geom === 'points')!.aes?.size).toBeUndefined()
    expect(builderIssues(table, s)).toEqual([])
  })
})
