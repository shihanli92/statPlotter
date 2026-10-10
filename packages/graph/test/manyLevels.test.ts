import type { GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  groupVariables,
  LEGEND_MAX_LEVELS,
  layoutLayers,
  levelCount,
  levelsNote,
  MANY_LEVELS,
  MAX_MAPPED_LEVELS,
  presetGraph,
  type SceneNode,
  tooManyLevels,
} from '../src/index.ts'
import { fonts, growthRatio, projectOf } from './helpers.ts'

// Text variables of many levels (roadmap 34e, decision 416): counted, never a default group, no
// colour or shape past a hard limit, and legends listing a few of them and counting the rest.

function all(n: SceneNode, out: SceneNode[] = []): SceneNode[] {
  out.push(n)
  for (const c of n.children ?? []) all(c, out)
  return out
}

describe('levels of text variables', () => {
  const t = syntheticTable({ rows: 1500, genes: 1, pcs: 1 })
  const cell = t.dataSets.find((d) => d.title === 'cell')!
  const cluster = t.dataSets.find((d) => d.title === 'cluster')!

  it('are counted once per text array; many and too many say so', () => {
    expect(levelCount(cell)).toBe(1500)
    expect(levelCount(cluster)).toBeLessThanOrEqual(14)
    expect(levelCount({ text: undefined })).toBe(0)
    expect(levelsNote(cell)).toBe(' (1,500 levels)')
    expect(levelsNote(cluster)).toBe('')
    expect(tooManyLevels(cell)).toBe('1,500 levels: more than 1,000')
    expect(tooManyLevels(cluster)).toBeUndefined()
    expect(MANY_LEVELS).toBeLessThan(MAX_MAPPED_LEVELS)
  })

  it('a variable of many levels is never a default group or colour', () => {
    expect(groupVariables(t).map((d) => d.title)).not.toContain('cell')
    const aes = presetGraph(t, 'bubble').layers.find((l) => l.aes)!.aes!
    expect(aes.color).not.toBe(cell.id)
  })

  it('a legend of a colour of 1,500 levels lists 50 and counts the rest, in linear time', () => {
    const graphOf = (rows: number) => {
      const s = syntheticTable({ rows, genes: 1, pcs: 1 })
      const g = presetGraph(s, 'bubble')
      const key = (title: string) => s.dataSets.find((d) => d.title === title)!.id
      const graph = {
        ...g,
        id: 'g1' as NodeId,
        layers: g.layers.map((l) =>
          l.aes
            ? ({
                ...l,
                aes: { x: key('UMAP_1'), y: key('UMAP_2'), color: key('cell') },
              } as Layer)
            : l,
        ),
        legend: { ...g.legend, show: true },
      } as GraphNode
      return { s, graph }
    }
    const { s, graph } = graphOf(1500)
    const scene = layoutLayers({ project: projectOf(s), graph, fonts })
    const labels = all(scene.root).filter(
      (n) => /^legend\/bubble\/color\/\d+\/label$/.test(n.id) && n.prim?.type === 'text',
    )
    expect(labels).toHaveLength(LEGEND_MAX_LEVELS)
    const more = all(scene.root).find((n) => n.id === 'legend/bubble/color/more/label')
    expect(more?.prim?.type === 'text' && more.prim.layout.runs.map((r) => r.text).join('')).toBe(
      '… and 1,450 more',
    )
    const cases = new Map<number, ReturnType<typeof graphOf>>()
    const ratio = growthRatio(
      (n) => {
        let c = cases.get(n)
        if (!c) {
          c = graphOf(n)
          cases.set(n, c)
        }
        layoutLayers({ project: projectOf(c.s), graph: c.graph, fonts })
      },
      2000,
      4,
      2,
    )
    expect(ratio).toBeLessThan(8)
  })
})
