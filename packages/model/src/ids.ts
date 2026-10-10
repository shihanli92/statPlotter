import { customAlphabet } from 'nanoid'
import { z } from 'zod'

/**
 * Ids are lowercase letters and digits (what the generator below produces). Keeping them to this
 * alphabet means an id can never be `__proto__` or contain path separators, so ids are safe as
 * object keys and file names.
 */
export const ID_PATTERN = /^[0-9a-z]+$/
const id = () => z.string().regex(ID_PATTERN, 'ids are lowercase letters and digits')

export const NodeId = id().brand<'NodeId'>()
export type NodeId = z.infer<typeof NodeId>

export const ColumnId = id().brand<'ColumnId'>()
export type ColumnId = z.infer<typeof ColumnId>

export const SeriesId = id().brand<'SeriesId'>()
export type SeriesId = z.infer<typeof SeriesId>

export const AnnotationId = id().brand<'AnnotationId'>()
export type AnnotationId = z.infer<typeof AnnotationId>

export const LayoutItemId = id().brand<'LayoutItemId'>()
export type LayoutItemId = z.infer<typeof LayoutItemId>

/** A folder of the navigator (roadmap 40): the user's own grouping of sheets. */
export const FolderId = id().brand<'FolderId'>()
export type FolderId = z.infer<typeof FolderId>

/** Items on a layout page that move, resize and stack as one share a group id. */
export const GroupId = id().brand<'GroupId'>()
export type GroupId = z.infer<typeof GroupId>

/**
 * An image (or other binary asset) held beside the document: the first 128 bits of the SHA-256
 * of its bytes, in hex, so the same image placed twice is stored once.
 */
export const ASSET_ID_PATTERN = /^[0-9a-f]{32}$/
export const AssetId = z.string().regex(ASSET_ID_PATTERN).brand<'AssetId'>()
export type AssetId = z.infer<typeof AssetId>

/**
 * Identifies an analyzable/graphable data set within a node: the ColumnId for a table, or a
 * plugin-declared output key (e.g. 'curve:A') for an analysis.
 */
export const DataSetKey = z.string().min(1)
export type DataSetKey = z.infer<typeof DataSetKey>

/** The single linking primitive used by analyses, graphs, and layouts. */
export const DataSetRef = z.object({ node: NodeId, key: DataSetKey })
export type DataSetRef = z.infer<typeof DataSetRef>

const generate = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

export const newNodeId = (): NodeId => generate() as NodeId
export const newColumnId = (): ColumnId => generate() as ColumnId
export const newSeriesId = (): SeriesId => generate() as SeriesId
export const newAnnotationId = (): AnnotationId => generate() as AnnotationId
export const newLayoutItemId = (): LayoutItemId => generate() as LayoutItemId
export const newGroupId = (): GroupId => generate() as GroupId
export const newFolderId = (): FolderId => generate() as FolderId
