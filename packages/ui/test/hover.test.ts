import { createGraphFor, layoutGraph, type SceneNode, type StylePath } from '@ps/graph'
import { createTable } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts, growthRatio, projectOf } from '../../graph/test/helpers.ts'
import { hoverIndex, hoverMarks, selectionMatcher } from '../src/graph/SceneSvg.tsx'

/** Every node with the target it (or its nearest ancestor) carries, as SceneSvg indexes them. */
function nodes(root: SceneNode): SceneNode[] {
  const out: SceneNode[] = []
  const walk = (n: SceneNode, inherited?: StylePath) => {
    const withTarget = n.target ? n : { ...n, target: inherited }
    out.push(withTarget)
    for (const c of n.children ?? []) walk(c, withTarget.target)
  }
  walk(root)
  return out
}

function setup(rows = 6) {
  const table = createTable({ columns: 2, rows })
  table.dataSets.forEach((d, i) => {
    d.subcolumns[0]!.values = Array.from({ length: rows }, (_, r) => r + i * 3)
  })
  const graph = createGraphFor(table)
  const project = projectOf(table, graph)
  const scene = layoutGraph({ project, graph, fonts })
  return { scene, all: nodes(scene.root), ds: table.dataSets[0]!.id as string }
}

describe('hover highlight', () => {
  it('covers the same marks as selecting them would', () => {
    const { all, ds } = setup()
    const index = hoverIndex(all)
    for (const key of [
      ['seriesOverrides', ds],
      ['axes', 'y'],
      ['axes', 'x'],
      ['pointOverrides', ds, 'r2s0'],
    ] as StylePath[]) {
      const match = selectionMatcher(key)
      const selected = all.filter((n) => n.prim && match(n.target, n)).map((n) => n.id)
      expect(
        hoverMarks(index, key)
          .map((n) => n.id)
          .sort(),
      ).toEqual(selected.sort())
      expect(selected.length).toBeGreaterThan(0)
    }
    expect(hoverMarks(index, ['annotations', 3])).toEqual([])
  })

  it('indexes a large graph once, in linear time', () => {
    const { all, ds } = setup(3000)
    const index = hoverIndex(all)
    expect(hoverMarks(index, ['seriesOverrides', ds]).length).toBeGreaterThan(3000)
    // Four times the nodes take about four times as long (sixteen if it were quadratic). A ratio
    // of CPU times, so it holds on a slow or busy machine.
    const four = [...all, ...all, ...all, ...all]
    expect(growthRatio((n) => hoverIndex(four.slice(0, n)), all.length)).toBeLessThan(10)
  })
})
