import type { DataSetColumn, GraphNode, Layer, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATCH_OPTIONS,
  matchGraphFormat,
  matchSetFormat,
  presetGraph,
  withOutputSeries,
} from '../src/index.ts'
import { pmLine, sigLine, significance, volcanoGraph, volcanoTable } from './cutoffCases.ts'
import { projectOf, sampleTable, sampleVariables } from './helpers.ts'

// Magic by layers (decision 30, amended in roadmap 33c): layers matched by id, then by geom and
// position; per-data-set formats by position; the target's curves and variables its own.

const red = { rgb: '#ff0000' }

describe('Magic', () => {
  it('copies the source’s layers with their formats, data sets matched by position', () => {
    const table = sampleTable('column')
    const source = presetGraph(table, 'barsPoints')
    source.layers[0] = {
      ...source.layers[0]!,
      style: { width: 0.9 },
      series: { a: { style: { width: 0.2 } } },
    } as never
    source.seriesOverrides = { a: { color: red } }
    // The target shows the data sets in another order: its first is the source's first.
    const target = {
      ...presetGraph(table, 'points'),
      id: 't' as NodeId,
      seriesSource: { table: table.id, include: ['b', 'a'] },
    }
    const out = matchGraphFormat(projectOf(table), target, source)
    expect(out.id).toBe('t')
    expect(out.layers.map((l) => l.id)).toEqual(['bars', 'points', 'error'])
    expect(out.layers[0]).toMatchObject({
      style: { width: 0.9 },
      series: { b: { style: { width: 0.2 } } },
    })
    expect(out.seriesOverrides).toEqual({ b: { color: red } })
    expect(out.look).toBe('column.bar')
    expect(out.preset).toBe('barsPoints')
    // Without layers: the target keeps its own, styled as their counterparts in the source.
    const kept = matchGraphFormat(projectOf(table), target, source, {
      ...DEFAULT_MATCH_OPTIONS,
      layers: false,
      dataSets: false,
    })
    expect(kept.layers.map((l) => l.id)).toEqual(['points', 'error', 'center'])
    expect(kept.look).toBe(target.look)
    expect(kept.seriesOverrides).toBe(target.seriesOverrides)
  })

  it('keeps the target’s curves and a bubble plot’s variables; frames the table offers only', () => {
    const xy = sampleTable('xy')
    const source = presetGraph(xy, 'envelope')
    const target = withOutputSeries(presetGraph(xy, 'meanSd'), 'fit' as NodeId, [
      { key: 'curve' as never },
    ]).graph
    const out = matchGraphFormat(projectOf(xy), target, source)
    expect(out.layers.map((l) => l.id)).toEqual([
      'curves',
      'curveBands',
      'envelope',
      'line',
      'points',
    ])

    const mv = sampleTable('multipleVariables')
    const bubbles: GraphNode = presetGraph(mv, 'bubble')
    const mine = {
      ...bubbles,
      layers: [{ ...bubbles.layers[0]!, aes: { x: 'c', y: 'd' } }],
    } as GraphNode
    const matched = matchGraphFormat(projectOf(mv), mine, bubbles)
    expect(matched.layers[0]!.aes).toEqual({ x: 'c', y: 'd' })

    // A heat map's layers on a column table: not offered, the target keeps its own.
    const grouped = sampleTable('grouped')
    const column = sampleTable('column')
    const map = presetGraph(grouped, 'heatmap')
    const col = presetGraph(column, 'points')
    const tried = matchGraphFormat(projectOf(column), col, map)
    expect(tried.frame).toBe('category')
    expect(tried.layers.map((l) => l.id)).toEqual(['points', 'error', 'center'])
  })

  it('maps the source’s variables onto the target’s table: by title, else place (audit 2, G5)', () => {
    // Table A: Group, Sex, Score, Age (a–d). Table B: its own ids, Age and Score swapped, then
    // a variable A lacks.
    const a = sampleVariables()
    const b = structuredClone(sampleVariables())
    b.id = 't2' as NodeId
    const [p, q, r, s] = b.dataSets as [DataSetColumn, DataSetColumn, DataSetColumn, DataSetColumn]
    Object.assign(p, { id: 'p', title: 'Site' })
    Object.assign(q, { id: 'q', title: 'Sex' })
    Object.assign(r, { id: 'r', title: 'Age' })
    Object.assign(s, { id: 's', title: 'Score' })
    const bubble = presetGraph(a, 'bubble')
    const source = {
      ...bubble,
      layers: bubble.layers.map((l) =>
        l.aes ? ({ ...l, aes: { x: 'c', y: 'd', color: 'a', shape: 'b' } } as Layer) : l,
      ),
    } as GraphNode
    // A graph of table B's variables as columns (its points map nothing).
    const target = { ...presetGraph(b, 'points'), id: 'g2' as NodeId }
    const project = projectOf(a, b)
    const out = matchGraphFormat(project, target, source)
    expect(out.frame).toBe('xy')
    // Score and Age by title, Sex by title, Group (no title in B) by its place: Site.
    expect(out.layers.find((l) => l.aes)!.aes).toEqual({ x: 's', y: 'r', color: 'p', shape: 'q' })
    const ids = new Set(b.dataSets.map((d) => d.id as string))
    for (const l of out.layers) for (const v of Object.values(l.aes ?? {})) expect(ids).toContain(v)

    // A graph of B's variables by category (mapped): an XY graph's layers aren't offered to it.
    const byGroup = {
      ...presetGraph(b, 'groupBoxPoints', undefined, { mapping: { x: 'p', y: 's' } }),
      id: 'g3' as NodeId,
    }
    const kept = matchGraphFormat(project, byGroup, source)
    expect(kept.frame).toBe(byGroup.frame)
    expect(kept.layers.map((l) => l.id)).toEqual(byGroup.layers.map((l) => l.id))
  })
})

describe('Magic and the cut-offs (audit 3, G3)', () => {
  it('carries the cut-offs a copied Significance layer reads; keeps the target’s otherwise', () => {
    const table = volcanoTable()
    const cutoffs = { fold: 2, sig: { p: 0.001 } }
    const source = {
      ...volcanoGraph([pmLine('fc', 'cutoff'), sigLine('pl'), significance()], cutoffs),
      id: 's' as NodeId,
    }
    const target = { ...volcanoGraph([]), id: 't' as NodeId }
    const project = projectOf(table, source, target)
    const layered = matchGraphFormat(project, target, source, {
      ...DEFAULT_MATCH_OPTIONS,
      layers: true,
    })
    expect(layered.layers.some((l) => l.stat.kind === 'threshold')).toBe(true)
    expect(layered.cutoffs).toEqual(cutoffs)
    expect(matchSetFormat(project, target, source).cutoffs).toEqual(cutoffs)
    // Styles only: the target's layers, and its own cut-offs.
    const styled = matchGraphFormat(
      project,
      { ...target, cutoffs: { fold: 3, sig: { p: 0.01 } } },
      source,
      {
        ...DEFAULT_MATCH_OPTIONS,
        layers: false,
      },
    )
    expect(styled.cutoffs).toEqual({ fold: 3, sig: { p: 0.01 } })
  })
})

describe('Magic and the legend’s entries (audit 3, G5)', () => {
  it('keeps the target’s hidden entries, as its order and labels: they name its entries', () => {
    const t1 = sampleTable('column')
    const t2 = {
      ...sampleTable('column'),
      id: 't2' as NodeId,
      dataSets: t1.dataSets.map((d, i) => ({ ...d, id: `z${i}` }) as DataSetColumn),
    }
    const source = { ...presetGraph(t1, 'bars'), id: 's' as NodeId }
    source.legend = { ...source.legend, hidden: [t1.dataSets[0]!.id], position: 'top' }
    const plain = presetGraph(t2, 'bars')
    const target = {
      ...plain,
      id: 't' as NodeId,
      legend: { ...plain.legend, hidden: ['z1'], labels: { z0: [{ text: 'mine' }] } },
    }
    const project = projectOf(t1, t2, source, target)
    for (const out of [
      matchGraphFormat(project, target, source),
      matchSetFormat(project, target, source),
    ]) {
      expect(out.legend.hidden).toEqual(['z1'])
      expect(out.legend.labels).toEqual({ z0: [{ text: 'mine' }] })
      // The legend's format is the source's.
      expect(out.legend.position).toBe('top')
    }
    // A target hiding nothing hides nothing.
    const none = matchGraphFormat(project, { ...target, legend: plain.legend }, source)
    expect(none.legend.hidden).toBeUndefined()
  })
})
