import type { PageContext } from '@ps/graph'
import { pageTableGrid } from '@ps/io'
import type { AnalysisResult, AssetId, ImageAsset, NodeId, Project } from '@ps/model'

/**
 * What a layout page needs besides its graphs (roadmap 32): its images from the asset store and
 * its tables' cells, from the document and the latest results (so tables follow both).
 */
export function pageSources(
  project: Project,
  result: ((id: NodeId) => AnalysisResult | undefined) | undefined,
  asset: ((id: AssetId) => ImageAsset | undefined) | undefined,
): Pick<PageContext, 'asset' | 'table' | 'result'> {
  const lookup = result ?? (() => undefined)
  return {
    ...(result ? { result } : {}),
    ...(asset ? { asset } : {}),
    table: (source) => pageTableGrid(project, source, lookup),
  }
}
