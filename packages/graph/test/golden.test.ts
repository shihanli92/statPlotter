import { GraphNode, parseProject } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { layoutGraph, layoutLayers, pointsAsImages, type Scene, sceneToSvg } from '../src/index.ts'
import { axisExtrasCases } from './axisExtrasCases.ts'
import { byGroupCases } from './byGroupCases.ts'
import { cutoffCases } from './cutoffCases.ts'
import { dendrogramCases } from './dendrogramCases.ts'
import {
  appearanceCases,
  cellsCases,
  comboCases,
  densityCases,
  fixCases,
  GOLDEN_GROUPS,
  goldenProject,
  largeCases,
  layeredCases,
  orderCases,
  overlayCases,
  splitCases,
  variableCases,
} from './goldenCases.ts'
import { fonts, projectOf } from './helpers.ts'
import { identityLineCases } from './identityLineCases.ts'
import { legendCases } from './legendCases.ts'
import { resultCases } from './resultCases.ts'
import { styleCases } from './styleCases.ts'

/**
 * Golden SVGs: a representative set of graphs (`goldenCases.ts`) rendered and compared with the
 * committed files in `__snapshots__/golden/`, so a change to the layout shows up as a reviewable
 * diff. After an intended change, run `pnpm vitest run packages/graph/test/golden.test.ts -u` and
 * check the diff. The graphs of the v1 fixtures are rendered as opening their files does: the
 * project migrated (roadmap 33b) and validated.
 */

const golden = (name: string) => `./__snapshots__/golden/${name}.svg`

function svgOf(scene: Scene): string {
  const svg = sceneToSvg(scene, { ids: true })
  // (Embedded images' base64 may spell anything.)
  expect(svg.replace(/data:[^"]+/g, '')).not.toContain('NaN')
  return svg
}

/** A golden v1 project opened (migrated and validated), its graph laid out. */
function render(name: string, id: string): string {
  const project = parseProject(goldenProject(name))
  const graph = GraphNode.parse(project.nodes[id as never])
  expect(graph.drawOrder).toBe('series')
  return svgOf(layoutGraph({ project, graph, fonts }))
}

for (const { title, cases } of GOLDEN_GROUPS)
  describe(title, () => {
    it.each(cases)('%s', async (name, _, graph) => {
      await expect(render(name, graph.id)).toMatchFileSnapshot(golden(name))
    })
  })

describe('golden SVGs: layered graphs drawn layer by layer (roadmap 33)', () => {
  it.each([
    ...layeredCases(),
    ...comboCases(),
    ...orderCases(),
    ...variableCases(),
    ...appearanceCases(),
    ...fixCases(),
    ...overlayCases(),
    ...splitCases(),
    ...cellsCases(),
    ...densityCases(),
  ])('%s', async (name, table, graph) => {
    const scene = layoutLayers({ project: projectOf(table), graph, fonts })
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: large tables (roadmap 34e)', () => {
  it.each(largeCases())('%s', async (name, table, graph, raster) => {
    const scene = layoutLayers({ project: projectOf(table), graph, fonts })
    // A layer drawn as an image: embedded as the export with points as an image would.
    const drawn = raster ? pointsAsImages(scene, raster) : scene
    await expect(svgOf(drawn)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: results on graphs (roadmap 35)', () => {
  it.each(resultCases())('%s', async (name, nodes, graph, results) => {
    const scene = layoutLayers({
      project: projectOf(...nodes, graph),
      graph,
      fonts,
      result: (id) => results[id],
    })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: axis extras (roadmap 36)', () => {
  it.each(axisExtrasCases())('%s', async (name, table, graph) => {
    const scene = layoutLayers({ project: projectOf(table), graph, fonts })
    // (The sample variables leave out a row without a level and one without a value.)
    expect(scene.warnings.filter((w) => !w.endsWith('left out.'))).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: identity and reference lines (roadmap 46b)', () => {
  it.each(identityLineCases())('%s', async (name, table, graph) => {
    const scene = layoutLayers({ project: projectOf(table), graph, fonts })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: styles (roadmap 37)', () => {
  it.each(styleCases())('%s', async (name, project, graph, results) => {
    const scene = layoutGraph({ project, graph, fonts, result: (id) => results[id] })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: legends edited (roadmap 47b)', () => {
  it.each(legendCases())('%s', async (name, table, graph) => {
    const scene = layoutGraph({ project: projectOf(table), graph, fonts })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: lines at ± a value and volcano thresholds (roadmap 46b)', () => {
  it.each(cutoffCases())('%s', async (name, table, graph) => {
    const scene = layoutLayers({ project: projectOf(table), graph, fonts })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: dendrograms as layers (roadmap 49c)', () => {
  it.each(dendrogramCases())('%s', async (name, table, graph) => {
    const scene = layoutGraph({ project: projectOf(table), graph, fonts })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})

describe('golden SVGs: aesthetics by data set or fixed (roadmap 49a)', () => {
  it.each(byGroupCases())('%s', async (name, table, graph) => {
    const scene = layoutGraph({ project: projectOf(table), graph, fonts })
    expect(scene.warnings).toEqual([])
    await expect(svgOf(scene)).toMatchFileSnapshot(golden(name))
  })
})
