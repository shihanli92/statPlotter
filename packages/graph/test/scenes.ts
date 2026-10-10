import type { Scene, SceneAxis } from '../src/index.ts'

// Whole scenes compared as data (roadmap 33a's shadow comparison, kept for comparing two layouts
// of a graph exactly: the v1 examples migrated against the examples built now, presets against
// each other). Shared by the graph and ui tests.

/** Axis mappings at 16 points across the plot (and back), so scenes compare as data. */
function sample(a: SceneAxis, from: number, to: number) {
  const px = Array.from({ length: 16 }, (_, i) => from + ((to - from) * i) / 15)
  const values = px.map((p) => a.fromPx(p))
  return { categorical: a.categorical, values, px: values.map((v) => a.toPx(v)) }
}

/** A scene as text: everything but the `layer` of marks, numbers exact (-0, NaN, ±∞ kept). */
export function canon(scene: Scene): string {
  const { plot } = scene
  const axes = scene.axes && {
    x: sample(scene.axes.x, plot.x, plot.x + plot.w),
    y: sample(scene.axes.y, plot.y + plot.h, plot.y),
    ...(scene.axes.y2 ? { y2: sample(scene.axes.y2, plot.y + plot.h, plot.y) } : {}),
  }
  return JSON.stringify({ ...scene, axes }, (key, v) => {
    if (key === 'layer') return undefined
    if (typeof v === 'number' && (Object.is(v, -0) || !Number.isFinite(v)))
      return Object.is(v, -0) ? '#-0' : `#${v}`
    return v
  })
}

/** The first difference between two JSON texts, as a path and both values. */
export function firstDifference(a: string, b: string): string | null {
  if (a === b) return null
  const walk = (x: unknown, y: unknown, path: string): string | null => {
    if (JSON.stringify(x) === JSON.stringify(y)) return null
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null)
      return `${path}: ${JSON.stringify(x)?.slice(0, 300)} ≠ ${JSON.stringify(y)?.slice(0, 300)}`
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])]
    for (const k of keys) {
      const id = (x as { id?: string }).id
      const d = walk(
        (x as Record<string, unknown>)[k],
        (y as Record<string, unknown>)[k],
        `${path}${id ? `[${id}]` : ''}.${k}`,
      )
      if (d) return d
    }
    return `${path}: differ`
  }
  return walk(JSON.parse(a), JSON.parse(b), '')
}
