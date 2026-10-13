import { EQUATIONS, MODEL_GOALS, modelThumbnail, THUMBNAIL_PLOT } from '@ps/analyses'
import { layoutGraph, sceneToSvg, sketchGraph } from '@ps/graph'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'

// Roadmap 51e (design §9.1): every model's thumbnail in the curve-fit picker is laid out by
// @ps/graph from typical values (`explain/equations.ts`) — a line, its plateaus and midpoint
// dashed and named, no axis numbers — and the first model of each goal is pinned as an SVG
// (`__snapshots__/thumbnails/`), so a change to a thumbnail shows as a reviewable diff.

const svgOf = (id: string): string => {
  const panel = modelThumbnail(id)!
  const { project, graph } = sketchGraph(panel, THUMBNAIL_PLOT)
  const svg = sceneToSvg(layoutGraph({ project, graph, fonts }), { ids: true })
  expect(svg, id).not.toContain('NaN')
  return svg
}

describe('model thumbnails (design §9.1)', () => {
  it.each(EQUATIONS.map((e) => [e.id] as const))('%s lays out: a line, no axis numbers', (id) => {
    const svg = svgOf(id)
    // The shape is drawn as a line (a path or polyline of many points).
    expect(svg).toMatch(/<(path|polyline)[^>]*(d|points)="[^"]{60,}/)
    // Bare axes: no tick labels (the only text is the parameters' names).
    const texts = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1])
    const panel = modelThumbnail(id)!
    expect(texts.sort()).toEqual((panel.labels ?? []).map((l) => l.text).sort())
  })

  it.each(MODEL_GOALS.map((g) => [g.id, g.models[0]!] as const))(
    'the first model of %s, pinned',
    async (goal, id) => {
      await expect(svgOf(id)).toMatchFileSnapshot(`./__snapshots__/thumbnails/${goal}.svg`)
    },
  )
})
