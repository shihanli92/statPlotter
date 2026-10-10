import {
  createInfoSheet,
  createProject,
  createTable,
  type DocNode,
  newLayoutItemId,
  newNodeId,
  type Project,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { growthRatio } from '../../stats/test/timing.ts'
import { searchProject } from '../src/index.ts'
import { analysis, graph, layout } from './familyFixture.ts'

// Roadmap 40: project search over names, notes, info fields, titles and page text.

function projectOf(nodes: DocNode[]): Project {
  const p = createProject('Search')
  for (const n of nodes) {
    p.nodes[n.id] = n
    p.order.push(n.id)
  }
  return p
}

function sample() {
  const t = createTable({ name: 'Dose response', columns: 2, rows: 3 })
  t.dataSets[0]!.title = 'Viability (%)'
  t.dataSets[1]!.title = 'Control'
  t.notes = 'Cells treated for 24 h with drug X'
  const a = analysis('Fit of Dose response', 'nonlinearFit', t.id, [])
  const g = graph('Dose response', t.id, {
    title: { content: [{ text: 'Viability after ' }, { text: 'treatment' }] },
  })
  g.axes.y = { ...g.axes.y, title: { content: [{ text: 'Viability' }] } }
  const page = layout('Figure 1', [g.id])
  const info = {
    ...createInfoSheet(newNodeId(), 'Experiment', 'experiment'),
    fields: [
      { label: 'Cell line / strain', value: 'HeLa' },
      { label: 'Viable cells', value: '1e6' },
    ],
  }
  return { t, a, g, page, info, p: projectOf([t, a, g, page, info]) }
}

describe('searchProject', () => {
  it('finds names, notes, columns, titles, page text, analysis names and info fields', () => {
    const { p, t, g, info, a } = sample()
    const res = searchProject(p, 'viab')
    // The graph matches twice (its title and Y axis); the table before the info sheet (order).
    expect(res.map((r) => r.node)).toEqual([g.id, t.id, info.id])
    const table = res[1]!
    expect(table.hits[0]).toMatchObject({
      label: 'Column title',
      before: '',
      match: 'Viab',
      after: 'ility (%)',
      target: { kind: 'column', column: t.dataSets[0]!.id },
    })
    expect(res[0]!.hits.map((h) => h.label)).toEqual(['Graph title', 'Y axis title'])
    expect(searchProject(p, 'hela')[0]!.hits[0]!.target).toEqual({
      kind: 'field',
      index: 0,
      part: 'value',
    })
    expect(searchProject(p, 'figure')[0]!.hits.map((h) => h.label)).toEqual([
      'Sheet name',
      'Text on the page',
    ])
    expect(searchProject(p, 'drug')[0]!.hits[0]).toMatchObject({ label: 'Notes', match: 'drug' })
    const byTitle = searchProject(p, 'nonlinear regression', {
      analysisTitle: (id) => (id === 'nonlinearFit' ? 'Nonlinear regression' : undefined),
    })
    expect(byTitle.map((r) => r.node)).toEqual([a.id])
    expect(searchProject(p, '   ')).toEqual([])
  })

  it('ranks exact names over prefixes over words over substrings, ignoring case and accents', () => {
    const names = ['Résumé of data', 'Data', 'Big data', 'Metadata', 'Data set 2']
    const p = projectOf(names.map((name) => createTable({ name })))
    expect(searchProject(p, 'data').map((r) => r.name)).toEqual([
      'Data',
      'Data set 2',
      'Résumé of data',
      'Big data',
      'Metadata',
    ])
    expect(searchProject(p, 'resume').map((r) => r.name)).toEqual(['Résumé of data'])
    // Several words match texts holding them all.
    expect(searchProject(p, 'data résumé').map((r) => r.name)).toEqual(['Résumé of data'])
  })

  it('cuts long texts round the match', () => {
    const t = createTable({ name: 'T' })
    t.notes = `${'x'.repeat(100)} needle ${'y'.repeat(100)}`
    const hit = searchProject(projectOf([t]), 'needle')[0]!.hits[0]!
    expect(hit.before.startsWith('…')).toBe(true)
    expect(hit.after.endsWith('…')).toBe(true)
    expect(hit.before.length + hit.after.length).toBeLessThan(70)
  })

  it('costs the same whatever the tables’ sizes (cell values aren’t searched)', () => {
    const projects = new Map<number, Project>()
    const at = (rows: number) => {
      let p = projects.get(rows)
      if (!p) {
        const t = createTable({ name: 'Big', tableKind: 'multipleVariables', columns: 3, rows })
        for (const ds of t.dataSets)
          ds.subcolumns[0]!.values = Array.from({ length: rows }, (_, i) => i)
        const page = layout('Page', [])
        page.items.push({
          type: 'text',
          id: newLayoutItemId(),
          x: 0,
          y: 0,
          content: { content: [{ text: 'big text' }] },
        })
        p = projectOf([t, page, graph('Big', t.id)])
        projects.set(rows, p)
      }
      return p
    }
    at(100_000)
    at(1_000_000)
    const ratio = growthRatio(
      (n) => {
        for (let i = 0; i < 200; i++) searchProject(at(n), 'big')
      },
      100_000,
      10,
      2,
    )
    // Independent of the rows: about 1 (linear in the rows would be 10).
    expect(ratio).toBeLessThan(3)
  }, 120_000)
})
