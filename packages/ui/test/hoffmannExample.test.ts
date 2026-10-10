import { mkdirSync, writeFileSync } from 'node:fs'
import { layoutPage, sceneToSvg } from '@ps/graph'
import {
  type AnalysisResult,
  type DataTable,
  type GraphNode,
  type LayoutNode,
  resultTableAs,
} from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { buildHoffmann, sheetNumber } from '../src/examples/published/hoffmann.ts'

// The CC BY chemistry paper (Hoffmann et al. 2026, Nature Chemistry; data embedded): every page
// builds, every analysis runs, and the numbers its text and figures print are compared with the
// app's (the paper's printed values, kept here as the licence allows; docs/design/PAPER_PANELS.md
// lists them all). HOFFMANN_SVG_DIR=<dir> writes the figure pages out as SVG.

const built = buildHoffmann(fonts)
const result = (name: string): AnalysisResult => {
  const a = built.analyses[name]
  if (!a) throw new Error(`no analysis ${name}`)
  return built.results.get(a.id)!
}
const value = (name: string, key: string) => {
  const v = result(name).values[key]
  if (!v || !('v' in v) || typeof v.v !== 'number') throw new Error(`no value ${key}`)
  return v.v
}
const keyOf = (t: DataTable, title: string) => t.dataSets.find((d) => d.title === title)!.id
/** A row of a Fraction of total sheet (by X) as percentages. */
const percents = (name: string, x: number) => {
  const block = result(name).sheets[0]!.blocks[0]!
  if (block.type !== 'table') throw new Error('no table')
  const row = block.rows.find((r) => r[0]?.kind === 'text' && r[0].v === `X = ${x}`)
  if (!row) throw new Error(`no row X = ${x}`)
  return Object.fromEntries(
    block.columns.slice(1).map((c, j) => {
      const v = row[j + 1]
      return [c, v?.kind === 'number' ? v.v : Number.NaN]
    }),
  )
}
const round = (v: number, digits = 0) => Number(v.toFixed(digits))

describe('Hoffmann et al. 2026 (embedded, CC BY)', () => {
  it('builds a page per figure (2–5) with every rebuilt panel', () => {
    const nodes = Object.values(built.project.nodes)
    const layouts = nodes.filter((n): n is LayoutNode => n.kind === 'layout')
    expect(layouts.map((l) => l.name)).toEqual([
      'Fig. 2 (reproduced)',
      'Fig. 3 (reproduced)',
      'Fig. 4 (reproduced)',
      'Fig. 5 (reproduced)',
    ])
    // 2a and 2b in halves, 3b two graphs, 3c three, 4a three, 4b and 5d one each.
    const placed = layouts.flatMap((l) => l.items.filter((i) => i.type === 'graph'))
    expect(placed).toHaveLength(14)
    for (const l of layouts) {
      const scene = layoutPage({
        project: built.project,
        layout: l,
        fonts,
        result: (id) => built.results.get(id),
      })
      expect(scene.warnings, l.name).toEqual([])
      const dir = process.env.HOFFMANN_SVG_DIR
      if (dir) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          `${dir}/${l.name.replace(/[^\w.]+/g, '_')}.svg`,
          sceneToSvg(scene, { background: '#ffffff' }),
        )
      }
    }
    expect(nodes.filter((n): n is GraphNode => n.kind === 'graph')).toHaveLength(14)
  })

  it('runs every analysis without errors', () => {
    const analyses = Object.values(built.project.nodes).filter((n) => n.kind === 'analysis')
    expect(analyses.length).toBeGreaterThanOrEqual(20)
    for (const a of analyses) {
      const r = built.results.get(a.id)
      expect(r?.status, a.name).not.toBe('error')
    }
  })

  it('Fig. 2: the isomer distributions the text prints', () => {
    // At equilibrium about 9:1 G3P:G2P ("about 10% G2P", "G3P dominant (90%)") after 12 weeks.
    expect(round(percents('fig2aG3P', 12).G2P!)).toBe(11)
    expect(round(percents('fig2aG3P', 12).G3P!)).toBe(89)
    expect(round(percents('fig2aG2P', 12).G2P!)).toBe(12)
    // 29% G2P after the first cycle (the file's value), 64% G2P of G3P + G2P after ten, from
    // either isomer (Methods: 64:36).
    const cy = built.tables['Fig. 2b – EDC cycles from G3P']!
    expect(cy.dataSets.find((d) => d.title === 'G2P')!.subcolumns[0]!.values[1]).toBe(28.75)
    expect(round(percents('fig2bG3P', 10).G2P!)).toBe(64)
    expect(round(percents('fig2bG2P', 10).G2P!)).toBe(64)
    expect(round(percents('fig2bG2P', 10).G3P!)).toBe(36)
  })

  it('Fig. 3b: the global fit of G3P ⇌ G2P gives the equilibrium of about 9:1', () => {
    const t = built.tables['Fig. 3b – Approach to equilibrium (both starts)']!
    const k = (p: string) => value('fig3bFit', `${p}:${keyOf(t, 'G2P (from G2P)')}`)
    const feq = k('kg') / (k('kg') + k('kgr'))
    expect(round(100 * feq)).toBe(9)
    expect(round((1 - feq) / feq)).toBe(10)
    // Rates per week (the paper's are in Supplementary Table 5, not printed here).
    expect(k('kg').toFixed(3)).toBe('0.032')
    expect(k('kgr').toFixed(3)).toBe('0.316')
  })

  it('Fig. 4a: the pH burst, the GCP plateau, [EDC] and pH under multidose fuelling', () => {
    // "initial burst of pH from 1.1 to 3.4".
    expect(sheetNumber(result('fig4aPH'), 'descriptive', 'Minimum', 'pH').toFixed(1)).toBe('1.1')
    expect(sheetNumber(result('fig4aPH'), 'descriptive', 'Maximum', 'pH').toFixed(1)).toBe('3.4')
    // "a GCP plateau at roughly 90% molar fraction over 50 min".
    const gcp = built.tables['Fig. 4a – 50 equiv. EDC']!
    expect(round(value('fig4aPlateauStats', `mean:${keyOf(gcp, 'GCP')}`))).toBe(90)
    const a = built.analyses.fig4aPlateau!
    const plateau = resultTableAs(result('fig4aPlateau').table!, a.id, a.name)
    const x = plateau.x!.subcolumns[0]!.values.filter((v): v is number => v !== null)
    expect(Math.max(...x) - Math.min(...x)).toBeGreaterThan(50)
    // [EDC] "between 10 and 25 mM" (text) or "between 10 mM and 20 mM" (figure): 8.2 to 21.8.
    const edc = result('fig4aEDC')
    expect(sheetNumber(edc, 'descriptive', 'Minimum', 'EDC').toFixed(1)).toBe('8.2')
    expect(sheetNumber(edc, 'descriptive', 'Maximum', 'EDC').toFixed(1)).toBe('21.8')
    // pH "between 1.2 and 1.4 over 200 min" (text; the figure says 1.1 and 1.3).
    const ph = result('fig4aPHDosed')
    expect(sheetNumber(ph, 'descriptive', 'Minimum', 'pH').toFixed(1)).toBe('1.2')
    expect(sheetNumber(ph, 'descriptive', 'Maximum', 'pH').toFixed(1)).toBe('1.4')
    // GCP hydrolysis once the pH is back: a half-life of about 25 min (Fig. 1a quotes ≈10 min
    // for a five-membered cyclic phosphate at pH 1 from the literature).
    expect(round(sheetNumber(result('fig4aDecay'), 'results', 'HalfLife', 'GCP'))).toBe(25)
  })

  it('Fig. 4b: the steady-state window drifts a little in the pooled runs', () => {
    const t = built.tables['Fig. 4b – Multidose steady state (triplicates)']!
    const slope = (s: string) => value('fig4bSlopes', `slope:${keyOf(t, s)}`)
    expect(slope('GCP').toFixed(3)).toBe('-0.087')
    expect(slope('G2P').toFixed(3)).toBe('0.043')
  })

  it('Fig. 5: start, steady state and relaxed state of the inositol phosphates', () => {
    // I1P:I3P 9:1 at the start.
    const start = percents('fig5dPercent', 0)
    expect(round(start.I1P! / start.I3P!)).toBe(9)
    // Last hour of fuelling, as parts of 30 (the text: 6:5:1:11:7, I1P:I2P:I3P:I1,2CP:I2,3CP).
    const t = built.tables['Fig. 5d – Inositol phosphates (% of the five)']!
    const mean = (name: string, s: string) => value(name, `mean:${keyOf(t, s)}`)
    const order = ['I1P', 'I2P', 'I3P', 'I1,2CP', 'I2,3CP']
    expect(order.map((s) => round((30 * mean('fig5dSteady', s)) / 100))).toEqual([6, 4, 1, 13, 6])
    // Relaxed, I1P:I2P:I3P (the text: 4:3:1).
    const i3 = mean('fig5dRelaxed', 'I3P')
    expect(['I1P', 'I2P'].map((s) => round(mean('fig5dRelaxed', s) / i3))).toEqual([3, 3])
  })
})
