import { type ColumnId, type DataTable, type GraphNode, type Layer, presetRecipe } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  builderPresetsFor,
  checkLayers,
  GEOM_LAYER_KIND,
  layoutGraph,
  newLayerIndex,
  newStyleLayer,
  plotStyle,
  presetFits,
  presetGraph,
  recipeLayers,
  type Scene,
  type SceneNode,
  styleAllowed,
  styleContext,
  styleOfLayer,
  stylesFor,
} from '../src/index.ts'
import { builtGraph, mvWithGroups, vectorTable } from './goldenCases.ts'
import { appearanceTable, fonts, projectOf, sampleTable } from './helpers.ts'

// Roadmap 34c's layers: ellipses and hulls per group, paths in row order, vectors and pair lines
// on grouped graphs — what the matrix and the builder allow, what they draw, and what they say
// when a group can't have one.

const lay = (table: DataTable, graph: GraphNode): Scene =>
  layoutGraph({ project: projectOf(table, graph), graph, fonts })

const marks = (scene: Scene, layer: string): SceneNode[] => {
  const out: SceneNode[] = []
  const walk = (n: SceneNode, own: string | undefined) => {
    const l = n.layer ?? own
    if (n.prim && l === layer) out.push(n)
    for (const c of n.children ?? []) walk(c, l)
  }
  walk(scene.root, undefined)
  return out
}

/** A graph of variables (Score by Age) coloured by Group, with these layers around the points. */
function grouped(back: Layer[], front: Layer[] = [], table = appearanceTable()): GraphNode {
  const g = presetGraph(table, 'bubble')
  const layers = g.layers.map((l) =>
    l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'a' } } as Layer) : l,
  )
  return { ...g, layers: [...back, ...layers, ...front] }
}

const ellipse = (type: 'norm' | 'mean' | 't' = 'norm', level = 0.95): Layer => ({
  id: 'ellipse',
  geom: 'polygon',
  stat: { kind: 'ellipse', type, level },
})

describe('the matrix and the builder', () => {
  it('overlays, paths and vectors on XY graphs only; vectors need their ends', () => {
    const mv = (layers: Layer[]) =>
      checkLayers({ frame: 'xy', layers }, 'multipleVariables', { raw: true })
    const points: Layer = { id: 'p', geom: 'points', stat: { kind: 'identity' }, aes: {} }
    const seg: Layer = { id: 's', geom: 'segment', stat: { kind: 'identity' }, aes: {} }
    expect(mv([points, seg]).get('s')).toEqual({
      allowed: false,
      reason: 'needs X end and Y end variables',
    })
    expect(mv([{ ...seg, aes: { xend: 'c', yend: 'd' } } as Layer]).get('s')?.reason).toBe(
      'needs mapped points',
    )
    expect(mv([points, ellipse()]).get('ellipse')?.allowed).toBe(true)
    const cat = checkLayers({ frame: 'category', layers: [ellipse()] }, 'multipleVariables')
    expect(cat.get('ellipse')?.allowed).toBe(false)
    const xy = checkLayers({ frame: 'xy', layers: [ellipse()] }, 'xy', { raw: true })
    expect(xy.get('ellipse')?.allowed).toBe(true)
    const pairs = checkLayers(
      { frame: 'grouped', layers: [{ id: 'c', geom: 'connector', stat: { kind: 'identity' } }] },
      'grouped',
      { raw: true },
    )
    expect(pairs.get('c')?.allowed).toBe(true)
  })

  it('ellipses and hulls are fills (behind the marks), paths and vectors marks', () => {
    expect([GEOM_LAYER_KIND.polygon, GEOM_LAYER_KIND.path, GEOM_LAYER_KIND.segment]).toEqual([
      'fill',
      'mark',
      'mark',
    ])
    const layers = grouped([]).layers
    expect(newLayerIndex(layers, ellipse())).toBe(0)
  })

  it('offers the new plot styles where they draw, vectors with the next number variables', () => {
    const t = appearanceTable()
    const g = grouped([], [], t)
    const c = styleContext(t, 'xy', g.layers)
    const ids = stylesFor(c).map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['ellipses', 'hull', 'path', 'vectors']))
    const vectors = newStyleLayer(plotStyle('vectors')!, c)
    // Score and Age on the axes: BMI is the next number variable; the table has no fourth.
    expect(c.ends).toBeUndefined()
    expect(styleAllowed(plotStyle('vectors')!, c).reason).toMatch(/two more number variables/)
    const v = vectorTable()
    const vg = presetGraph(v, 'bubble')
    const vc = styleContext(v, 'xy', vg.layers)
    const layer = newStyleLayer(plotStyle('vectors')!, vc)
    expect(layer.aes).toEqual({ xend: 'c', yend: 'd' })
    expect(vectors.geom).toBe('segment')
    expect(styleOfLayer(ellipse(), 'xy')?.id).toBe('ellipses')
    expect(styleOfLayer({ id: 'h', geom: 'polygon', stat: { kind: 'hull' } }, 'xy')?.id).toBe(
      'hull',
    )
    // Before-after lines on grouped graphs.
    const gt = sampleTable('grouped')
    const gc = styleContext(gt, 'grouped', builtGraph(gt, 'grouped', ['points']).layers)
    expect(styleAllowed(plotStyle('pairs')!, gc).allowed).toBe(true)
    // XY tables: an ellipse per data set.
    const xt = sampleTable('xy')
    expect(styleAllowed(plotStyle('ellipses')!, styleContext(xt, 'xy', [])).allowed).toBe(true)
  })

  it('shows the two new chips only for tables with a text variable to group by', () => {
    const chips = (t: DataTable) => builderPresetsFor('multipleVariables', t).map((p) => p.id)
    expect(chips(mvWithGroups())).toEqual(
      expect.arrayContaining(['scatterEllipses', 'trajectories']),
    )
    expect(chips(sampleTable('multipleVariables'))).not.toContain('scatterEllipses')
    const g = presetGraph(mvWithGroups(), 'scatterEllipses')
    expect(g.layers.map((l) => l.geom)).toEqual(['polygon', 'points'])
    expect(g.layers[1]!.aes).toEqual({ x: 'a', y: 'b', color: 'e' })
  })

  it('user presets keep the types: vectors end at the table’s next number variables', () => {
    const v = vectorTable()
    const g = presetGraph(v, 'bubble')
    const graph: GraphNode = {
      ...g,
      layers: [
        ...g.layers.map((l) => (l.aes ? ({ ...l, aes: { x: 'a', y: 'b' } } as Layer) : l)),
        {
          id: 'vectors',
          geom: 'segment',
          stat: { kind: 'identity' },
          aes: { xend: 'c', yend: 'd' },
        },
      ],
    }
    const recipe = presetRecipe(graph, 'multipleVariables', v)
    expect(JSON.stringify(recipe)).not.toContain('"xend":"c"')
    expect(presetFits(recipe, 'multipleVariables', v)).toBe(true)
    // Three number variables: no ends for the vectors.
    expect(presetFits(recipe, 'multipleVariables', sampleTable('multipleVariables'))).toBe(true)
    const three: DataTable = { ...v, dataSets: v.dataSets.slice(0, 3) }
    expect(presetFits(recipe, 'multipleVariables', three)).toBe(false)
    const applied = recipeLayers(recipe, v, 'Vectors')
    expect(applied.layers.find((l) => l.geom === 'segment')?.aes).toEqual({
      xend: 'c',
      yend: 'd',
    })
  })
})

describe('drawing', () => {
  it('an ellipse of each kind per colour group, wider for a lower confidence of the mean', () => {
    for (const type of ['norm', 'mean', 't'] as const) {
      const scene = lay(appearanceTable(), grouped([ellipse(type)]))
      // Three groups, each a fill and an outline.
      expect(marks(scene, 'ellipse').length, type).toBeGreaterThanOrEqual(6)
      expect(scene.warnings, type).toEqual([])
    }
    const area = (level: number) => {
      const [fill] = marks(lay(appearanceTable(), grouped([ellipse('norm', level)])), 'ellipse')
      const pts = fill!.prim!.type === 'polygon' ? fill!.prim!.points : []
      let a = 0
      pts.forEach(([x, y], i) => {
        const [x2, y2] = pts[(i + 1) % pts.length]!
        a += x * y2 - x2 * y
      })
      return Math.abs(a / 2)
    }
    expect(area(0.5)).toBeLessThan(area(0.95))
  })

  it('says why a group has no ellipse or hull (too few points, on a line)', () => {
    const t = appearanceTable()
    // Group: Low, High, Mid (4 each); one Low row made a group of its own.
    const one = structuredClone(t)
    one.dataSets[0]!.text![0] = 'Solo'
    const scene = lay(one, grouped([ellipse()]))
    expect(scene.warnings).toContain('Ellipse of “Solo” not drawn: one point: needs 3 or more.')
    const line = structuredClone(t)
    // Every Mid row at the same Score.
    const d = line.dataSets.find((x) => x.id === 'c')!
    line.dataSets[0]!.text!.forEach((g, r) => {
      if (g === 'Mid') d.subcolumns[0]!.values[r] = 15
    })
    const hull: Layer = { id: 'hull', geom: 'polygon', stat: { kind: 'hull' } }
    const s2 = lay(line, grouped([hull], [], line))
    expect(s2.warnings).toContain('Hull of “Mid” not drawn: the points lie on a line.')
    expect(lay(line, grouped([ellipse()], [], line)).warnings).toContain(
      'Ellipse of “Mid” not drawn: every point has the same X or the same Y value.',
    )
  })

  it('widens the axes to the ellipses', () => {
    const t = appearanceTable()
    const ticks = (s: Scene) => {
      const out: string[] = []
      const walk = (n: SceneNode) => {
        if (n.id.startsWith('axis/y') && n.prim?.type === 'text') out.push(JSON.stringify(n.prim))
        for (const c of n.children ?? []) walk(c)
      }
      walk(s.root)
      return out
    }
    expect(ticks(lay(t, grouped([ellipse()])))).not.toEqual(ticks(lay(t, grouped([]))))
  })

  it('a path per group in row order, an arrowhead at each end', () => {
    const t = appearanceTable()
    const path: Layer = {
      id: 'path',
      geom: 'path',
      stat: { kind: 'identity' },
      aes: {},
      style: { arrow: 'end' },
    }
    const scene = lay(t, grouped([], [path]))
    const m = marks(scene, 'path')
    expect(m.filter((n) => n.prim?.type === 'polyline')).toHaveLength(3)
    expect(m.filter((n) => n.prim?.type === 'polygon')).toHaveLength(3)
    // Row order, not X order: the Low group's first point is its first row's.
    const low = m.find((n) => n.prim?.type === 'polyline' && n.id.endsWith('/0'))!
    expect(low.prim!.type === 'polyline' && low.prim!.points.length).toBe(4)
  })

  it('a vector per row, coloured by a number variable', () => {
    const v = vectorTable()
    const g = presetGraph(v, 'bubble')
    const graph: GraphNode = {
      ...g,
      layers: [
        ...g.layers.map((l) =>
          l.aes ? ({ ...l, aes: { x: 'a', y: 'b', color: 'e' } } as Layer) : l,
        ),
        {
          id: 'vectors',
          geom: 'segment',
          stat: { kind: 'identity' },
          aes: { xend: 'c', yend: 'd' },
        },
      ],
    }
    const m = marks(lay(v, graph), 'vectors')
    // The centre row has no length: no line, no head.
    expect(m.filter((n) => n.prim?.type === 'polyline')).toHaveLength(8)
    expect(m.filter((n) => n.prim?.type === 'polygon')).toHaveLength(8)
  })

  it('pair lines join each subject of a grouped row across the data sets', () => {
    const t = sampleTable('grouped')
    const base = builtGraph(t, 'grouped', ['points'], { kind: 'dodge' })
    const graph = {
      ...base,
      layers: [...base.layers, { id: 'pairs', geom: 'connector', stat: { kind: 'identity' } }],
    } as GraphNode
    // 3 rows × 3 replicates.
    expect(marks(lay(t, graph), 'pairs')).toHaveLength(9)
    // A missing value leaves its subject unjoined.
    const gap = structuredClone(t)
    gap.dataSets[1]!.subcolumns[0]!.values[0] = null
    expect(marks(lay(gap, graph), 'pairs')).toHaveLength(8)
  })

  it('an ellipse on a log axis that would reach zero is left out with a note', () => {
    const t = appearanceTable()
    const g = grouped([ellipse('norm', 0.999)])
    const graph: GraphNode = {
      ...g,
      axes: {
        ...g.axes,
        y: g.axes.y.type === 'continuous' ? { ...g.axes.y, scale: 'log10' } : g.axes.y,
      },
    }
    const scene = lay(t, graph)
    expect(scene.warnings.some((w) => /log axis/.test(w))).toBe(true)
  })

  it('each XY data set gets its own ellipse; an XY path joins its rows in table order', () => {
    const t = sampleTable('xy')
    const base = builtGraph(t, 'xy', ['each'])
    const graph = {
      ...base,
      layers: [ellipse(), { id: 'path', geom: 'path', stat: { kind: 'identity' } }, ...base.layers],
    } as GraphNode
    const scene = lay(t, graph)
    expect(marks(scene, 'ellipse').filter((n) => n.prim?.type === 'polygon')).toHaveLength(2)
    expect(marks(scene, 'path').length).toBeGreaterThanOrEqual(2)
    void (0 as unknown as ColumnId)
  })
})
