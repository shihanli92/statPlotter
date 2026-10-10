import type { DataTable, LimitFlag } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  layoutLayers,
  limitPointOverrides,
  sceneToSvg,
  showsLimitPoints,
  withLimitPoints,
} from '../src/index.ts'
import { graphOf } from './graphs.ts'
import { fonts, projectOf, sampleTable } from './helpers.ts'

// Roadmap 39: values imported at a detection limit drawn as open symbols through single-point
// formats (pointOverrides), so no drawing code knows about limits.

const below = (text: string): LimitFlag => ({ side: 'below', text })

/** The sample column table with its two lowest values flagged as below a limit. */
function flagged(): DataTable {
  const t = structuredClone(sampleTable('column'))
  const sub = t.dataSets[0]!.subcolumns[0]!
  sub.limit = sub.values.map(() => null)
  sub.limit[0] = below('<35')
  sub.limit[2] = below('BLQ')
  return t
}

describe('values at detection limits on graphs (roadmap 39)', () => {
  it('formats each flagged value open, and removes only those fills again', () => {
    const t = flagged()
    const key = t.dataSets[0]!.id
    const g = graphOf(t, 'points')
    const open = limitPointOverrides(g, t, true)
    expect(open).toEqual({
      [key]: { r0s0: { fill: { type: 'none' } }, r2s0: { fill: { type: 'none' } } },
    })
    const shown = { ...g, pointOverrides: open }
    expect(showsLimitPoints(shown, t)).toBe(true)
    expect(showsLimitPoints(g, t)).toBe(false)
    // A point's other formats stay when the open fill goes.
    const labelled = {
      ...shown,
      pointOverrides: {
        [key]: { ...open![key], r0s0: { fill: { type: 'none' as const }, label: 'low' } },
      },
    }
    expect(limitPointOverrides(labelled, t, false)).toEqual({ [key]: { r0s0: { label: 'low' } } })
    expect(limitPointOverrides(shown, t, false)).toBeUndefined()
  })

  it('leaves graphs of tables without flags as they are', () => {
    const t = sampleTable('column')
    const g = graphOf(t, 'points')
    expect(withLimitPoints(g, t)).toBe(g)
  })

  it('golden: flagged values as open symbols in a scatter of a column table', async () => {
    const t = flagged()
    const g = withLimitPoints(graphOf(t, 'points'), t)
    const svg = sceneToSvg(layoutLayers({ project: projectOf(t), graph: g, fonts }), { ids: true })
    expect(svg).not.toContain('NaN')
    await expect(svg).toMatchFileSnapshot('./__snapshots__/golden/limit-open-symbols.svg')
  })
})
