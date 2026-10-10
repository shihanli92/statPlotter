import { sourceTable } from '@ps/model'
import { layoutLayers } from '../layers/engine.ts'
import { layerTargets, matrixWarnings } from '../layers/targets.ts'
import { layerTitle } from '../plotStyles.ts'
import type { Scene } from '../scene.ts'
import type { GraphContext } from './common.ts'
import { graphScale, scaleScene, unscaledGraph } from './scaled.ts'

/**
 * Lays out any graph node with the layer engine. A graph with a scale (`size.scale`, roadmap 23)
 * is laid out at its plot size ÷ scale and the scene scaled, so everything it draws grows with
 * it; every consumer (canvas, pages, export) gets the scaled scene. (v1 graphs reach it only
 * migrated: `parseProject` compiles them, roadmap 33b.)
 *
 * The scene's marks target their layers (`layerTargets`, roadmap 33c), and layers the table
 * can't support that drew something are named in its warnings (decision 229).
 */
export function layoutGraph(ctx: GraphContext): Scene {
  const { graph } = ctx
  const s = graphScale(graph)
  const scene =
    s === 1
      ? layoutLayers({ ...ctx, graph })
      : scaleScene(layoutLayers({ ...ctx, graph: unscaledGraph(graph) }), s)
  layerTargets(scene, graph)
  const table = sourceTable(ctx.project, graph.seriesSource.table, ctx.result)
  const unsupported = matrixWarnings(scene, graph, table, (l) => layerTitle(l, graph.frame))
  return unsupported.length ? { ...scene, warnings: [...scene.warnings, ...unsupported] } : scene
}
