import { describe, expect, it } from 'vitest'
import {
  iconViewBox,
  newStyleLayer,
  PLOT_STYLES,
  plotIcon,
  type SceneNode,
  sceneToSvg,
  styleAllowed,
  styleContext,
  styleLayer,
  styleOfLayer,
  stylesFor,
} from '../src/index.ts'
import { FRAMES } from '../src/layers/matrix.ts'
import { fonts, sampleTable, TABLE_KINDS } from './helpers.ts'

// Plot-style icons (roadmap 33c): drawn by the engine from fixed tiny tables, deterministic.

const marks = (n: SceneNode): number =>
  (n.prim ? 1 : 0) + (n.children ?? []).reduce((a, c) => a + marks(c), 0)

describe('plot-style icons', () => {
  it('draw every style a table kind shows, the same each time, without text', () => {
    let drawn = 0
    for (const kind of TABLE_KINDS)
      for (const frame of FRAMES[kind])
        for (const s of stylesFor({ kind, frame })) {
          const scene = plotIcon(fonts, s.id, kind, { frame })
          expect(scene, `${s.id} on ${kind}`).not.toBeNull()
          expect(marks(scene!.root), `${s.id} on ${kind}`).toBeGreaterThan(0)
          // Cached; and a fresh layout (another palette) is identical but for its colours.
          expect(plotIcon(fonts, s.id, kind, { frame })).toBe(scene)
          const again = plotIcon(fonts, s.id, kind, { frame, palette: ['#123456'] })
          expect(again).not.toBe(scene)
          expect(sceneToSvg(again!).replaceAll('#123456', '')).not.toContain('NaN')
          expect(iconViewBox(scene!)[2]).toBeGreaterThan(0)
          drawn++
        }
    expect(drawn).toBeGreaterThan(60)
  })

  it('are deterministic across layouts (fixed data and ids)', () => {
    const a = plotIcon(fonts, 'violin', 'column', { palette: ['#000000'] })
    const b = plotIcon(fonts, 'violin', 'column', { palette: ['#000000', '#111111'] })
    expect(sceneToSvg(a!)).toBe(sceneToSvg(b!).replaceAll('#111111', '#000000'))
  })
})

describe('plot styles', () => {
  it('make layers their style recognises, allowed by the matrix with reasons', () => {
    for (const s of PLOT_STYLES.filter((x) => !x.frameChoice))
      for (const frame of s.frames) {
        const layer = styleLayer(s, frame, frame === 'grouped' ? 'grouped' : 'column')
        expect(styleOfLayer(layer, frame)?.id, s.id).toBe(
          s.id === 'line' && frame === 'grouped' ? 'joinMeans' : s.id,
        )
      }
    const means = { ...sampleTable('column'), yFormat: { type: 'sd' as const } } as never
    const c = styleContext(means, 'category', [])
    expect(styleAllowed(PLOT_STYLES.find((s) => s.id === 'violin')!, c)).toEqual({
      allowed: false,
      reason: 'needs raw values',
    })
    const grouped = sampleTable('grouped')
    const stack = styleContext(grouped, 'grouped', [
      {
        id: 'bars',
        geom: 'bar',
        stat: { kind: 'summary', center: 'mean' },
        position: { kind: 'stack' },
      },
    ])
    expect(styleAllowed(PLOT_STYLES.find((s) => s.id === 'points')!, stack).reason).toBe(
      'not with stacked bars',
    )
    // Error bars attach to the bars; a second points layer gets its own id.
    const err = newStyleLayer(PLOT_STYLES.find((s) => s.id === 'error')!, stack)
    expect(err.on).toBe('bars')
    const two = styleContext(grouped, 'grouped', [
      { id: 'points', geom: 'points', stat: { kind: 'identity' } },
    ])
    expect(newStyleLayer(PLOT_STYLES.find((s) => s.id === 'points')!, two).id).toBe('points2')
  })
})
