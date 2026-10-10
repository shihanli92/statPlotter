import { registry as analyses } from '@ps/analyses'
import { createGraphFor } from '@ps/graph'
import {
  type AnalysisNode,
  createProject,
  createTable,
  type DocNode,
  type Layer,
  newNodeId,
  newSeriesId,
  type Project,
} from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { type Command, CommandRegistry, GROUPS } from '../src/commands/index.ts'
import { commandItems } from '../src/components/commandItems.ts'
import { exportCommands, zoomCommands } from '../src/graph/viewCommands.ts'
import { GRAPH_ZOOMS, LAYOUT_ZOOMS, stepZoom } from '../src/graph/zoom.ts'
import { linkedSheets } from '../src/linkedSheets.ts'

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({
  id,
  label: id,
  run: () => {},
  ...extra,
})

describe('commandItems', () => {
  it('turns command ids into menu items that run the latest registration', () => {
    const r = new CommandRegistry()
    const first = vi.fn()
    const latest = vi.fn()
    r.set('view', 'view', [
      cmd('a', { label: 'Alpha', run: first }),
      cmd('b', { label: 'Beta', enabled: false }),
      cmd('t', { label: 'Toggle', checked: true }),
    ])
    const items = commandItems(r, ['a', 'b', 'missing', 't'])
    expect(items.map((i) => i.label)).toEqual(['Alpha', 'Beta', 'Toggle'])
    expect(items.map((i) => !!i.disabled)).toEqual([false, true, false])
    expect(items[2]).toMatchObject({ checked: true })
    // Re-registered (a re-render): choosing the item runs the new closure.
    r.set('view', 'view', [cmd('a', { label: 'Alpha', run: latest })])
    items[0]!.onSelect?.()
    expect(latest).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('places dividers only between items, and takes plain items and overrides', () => {
    const r = new CommandRegistry()
    r.set('v', 'view', [cmd('a'), cmd('b'), cmd('c')])
    const own = { label: 'Format this point…', onSelect: () => {} }
    const items = commandItems(r, [
      '-',
      own,
      '-',
      '-',
      'missing',
      '-',
      { command: 'a', label: 'Delete', danger: true },
      'b',
      '-',
      'gone',
      '-',
    ])
    expect(items.map((i) => [i.label, !!i.separator, !!i.danger])).toEqual([
      ['Format this point…', false, false],
      ['Delete', true, true],
      ['b', false, false],
    ])
    // The caller's item is not changed.
    expect(own).not.toHaveProperty('separator')
  })
})

describe('zoom', () => {
  it('steps through the levels, from between them too, and stops at the ends', () => {
    expect(stepZoom(GRAPH_ZOOMS, 1.5, 1)).toBe(2)
    expect(stepZoom(GRAPH_ZOOMS, 1.5, -1)).toBe(1.25)
    expect(stepZoom(GRAPH_ZOOMS, 1.1, 1)).toBe(1.25)
    expect(stepZoom(GRAPH_ZOOMS, 1.1, -1)).toBe(1)
    expect(stepZoom(GRAPH_ZOOMS, 3, 1)).toBe(3)
    expect(stepZoom(LAYOUT_ZOOMS, 0.5, -1)).toBe(0.5)
  })

  it('offers View › Zoom commands, disabled at the ends', () => {
    const set = vi.fn()
    const r = new CommandRegistry()
    r.set('v', 'view', zoomCommands(LAYOUT_ZOOMS, 1.5, set))
    expect(r.get('view.zoomIn')?.enabled).toBe(false)
    expect(r.run('view.zoomOut')).toBe(true)
    expect(set).toHaveBeenLastCalledWith(1.25)
    r.run('view.actualSize')
    expect(set).toHaveBeenLastCalledWith(1)
    const key = (k: string, shift = false) => ({
      key: k,
      metaKey: true,
      ctrlKey: false,
      shiftKey: shift,
      altKey: false,
    })
    expect(r.match(key('-'), true, false)?.id).toBe('view.zoomOut')
    expect(r.match(key('0'), true, false)?.id).toBe('view.actualSize')
    const view = r.menus().find((m) => m.id === 'view')!
    expect(view.items.map((n) => n.kind === 'command' && n.command.label)).toEqual([
      'Zoom in',
      'Zoom out',
      'Actual size',
    ])
  })
})

describe('exportCommands', () => {
  it('puts Export… / SVG / PDF / PNG / TIFF under File › Export, Print… after it, Export… ▾ on the toolbar', () => {
    const run = vi.fn()
    const print = vi.fn()
    const r = new CommandRegistry()
    r.set('v', 'view', exportCommands({ run, openDialog: () => {}, print }))
    const file = r.menus().find((m) => m.id === 'file')!
    const sub = file.items[0]
    expect(sub).toMatchObject({ kind: 'submenu', title: 'Export' })
    expect(
      sub?.kind === 'submenu' && sub.items.map((n) => n.kind === 'command' && n.command.id),
    ).toEqual([
      'file.export',
      'file.export.svg',
      'file.export.pdf',
      'file.export.png',
      'file.export.tiff',
    ])
    expect(file.items.at(-1)).toMatchObject({ kind: 'command', command: { id: 'file.print' } })
    expect(r.toolbar()[0]!.map((c) => c.id)).toEqual(['file.export'])
    // Roadmap 43: its ▾ offers the four formats straight away.
    const split = r.get('file.export')!.toolbar!.split!
    expect(commandItems(r, split.items).map((i) => i.label)).toEqual([
      'SVG…',
      'PDF…',
      'PNG (300 dpi)…',
      'TIFF (300 dpi)…',
    ])
    r.run('file.export.png')
    expect(run).toHaveBeenCalledWith('png')
    r.run('file.export.tiff')
    expect(run).toHaveBeenCalledWith('tiff')
    // ⌘P prints, also from a text field.
    const cmdP = { key: 'p', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }
    expect(r.match(cmdP, true, true)?.id).toBe('file.print')
    r.run('file.print')
    expect(print).toHaveBeenCalled()
    expect(GROUPS.file.export).toBeLessThan(GROUPS.file.print)
    expect(GROUPS.file.print).toBeLessThan(GROUPS.file.close)
  })
})

describe('linkedSheets', () => {
  function project() {
    const p: Project = createProject('T', new Date('2026-01-01T00:00:00Z'))
    const add = (n: DocNode) => {
      p.nodes[n.id] = n
      p.order.push(n.id)
      return n
    }
    const table = add(createTable({ tableKind: 'xy', rows: 3, columns: 1 }))
    const fit: AnalysisNode = {
      kind: 'analysis',
      id: newNodeId(),
      name: 'Fit',
      analysisId: 'nonlinearFit',
      pluginVersion: 1,
      input: { source: table.id, dataSets: [] },
      params: {},
    }
    const transform: AnalysisNode = { ...fit, id: newNodeId(), name: 'Transform' }
    const ofTransform: AnalysisNode = {
      ...fit,
      id: newNodeId(),
      name: 'Fit of transform',
      input: { source: transform.id, dataSets: [] },
    }
    add(fit)
    add(transform)
    add(ofTransform)
    const base = createGraphFor(table as never, 'Graph')
    const curves: Layer = {
      id: 'curves',
      geom: 'line',
      stat: { kind: 'identity' },
      data: {
        from: 'outputs',
        series: [{ id: newSeriesId(), ref: { node: fit.id, key: 'curve' } }],
      },
    }
    const graph = add({ ...base, layers: [...base.layers, curves] })
    const resultGraph = add({ ...createGraphFor(table as never, 'Of results'), id: newNodeId() })
    if (resultGraph.kind === 'graph') resultGraph.seriesSource.table = transform.id
    const plain = add({ ...createGraphFor(table as never, 'Plain'), id: newNodeId() })
    return { p, table, fit, transform, ofTransform, graph, resultGraph, plain }
  }

  it('goes from a table to its first analysis and graph', () => {
    const { p, table, fit, graph } = project()
    expect(linkedSheets(p, table.id)).toEqual({ results: fit.id, graph: graph.id })
  })

  it('goes from results to the data table up the chain, and to graphs of them', () => {
    const { p, table, fit, transform, ofTransform, graph, resultGraph } = project()
    expect(linkedSheets(p, fit.id)).toEqual({
      table: table.id,
      results: undefined,
      graph: graph.id,
    })
    expect(linkedSheets(p, transform.id).graph).toBe(resultGraph.id)
    expect(linkedSheets(p, ofTransform.id)).toEqual({
      table: table.id,
      results: transform.id,
      graph: resultGraph.id,
    })
  })

  it('goes from a graph to its data and the results it shows', () => {
    const { p, table, fit, transform, graph, resultGraph, plain } = project()
    expect(linkedSheets(p, graph.id)).toEqual({ table: table.id, results: fit.id })
    expect(linkedSheets(p, plain.id)).toEqual({ table: table.id, results: fit.id })
    expect(linkedSheets(p, resultGraph.id)).toEqual({ table: table.id, results: transform.id })
  })
})

describe('analyses that read no data', () => {
  it('say so, so the Analyze dialog offers no data sets', () => {
    const uses = (id: string, params: Record<string, unknown> = {}) => {
      const def = analyses.get(id)!
      return def.usesData?.(def.params.parse(params)) ?? true
    }
    expect(uses('monteCarlo')).toBe(false)
    expect(uses('simulateColumn')).toBe(false)
    expect(uses('simulateContingency')).toBe(false)
    expect(uses('simulateXY')).toBe(false)
    expect(uses('simulateXY', { xMode: 'table' })).toBe(true)
    expect(uses('powerAnalysis')).toBe(false)
    expect(uses('powerAnalysis', { fromData: true })).toBe(true)
    expect(uses('powerAnalysis', { fromData: true, design: 'proportions' })).toBe(false)
    expect(uses('ttest')).toBe(true)
  })
})
