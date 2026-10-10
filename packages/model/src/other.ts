import { z } from 'zod'
import { AssetId, GroupId, LayoutItemId, NodeId } from './ids.ts'
import { FillStyle, LineEnds, Pt, RichText, StrokeStyle, TextSpec, TextStyle } from './style.ts'

/**
 * An info sheet (roadmap 40): label/value fields about the experiment (numbers among them are
 * formulas' constants, `[Info: label]`) and notes.
 */
export const InfoNode = z.object({
  kind: z.literal('info'),
  id: NodeId,
  name: z.string(),
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
  notes: z.string(),
  /** Roadmap 40: the notes formatted (rich text, roadmap 28), spelling `notes`; absent: plain. */
  notesRich: RichText.optional(),
})
export type InfoNode = z.infer<typeof InfoNode>

/** What every page item may carry (roadmap 32). */
const itemCommon = {
  id: LayoutItemId,
  /** Locked: not picked or moved on the page (unlocked from the page panel or Unlock all). */
  locked: z.boolean().optional(),
  /** Items sharing a group id are selected, moved, resized and stacked as one. */
  group: GroupId.optional(),
}

const Point = z.object({ x: z.number(), y: z.number() })

/** A part of an image, as fractions of its width and height from its top-left (0–1). */
export const CropRect = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
})
export type CropRect = z.infer<typeof CropRect>

/** What a table on a page shows: a data table (or result table), or a sheet of results. */
export const PageTableSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table'), node: NodeId }),
  z.object({ kind: z.literal('results'), node: NodeId, sheet: z.string() }),
])
export type PageTableSource = z.infer<typeof PageTableSource>

/** A run of rows or columns, 0-based and inclusive (`to` absent: to the end). */
export const ItemRange = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0).optional(),
})
export type ItemRange = z.infer<typeof ItemRange>

/**
 * Items are placed by their top-left corner, in points from the page's top-left (lines by their
 * two ends). Array order is drawing order.
 */
export const LayoutItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('graph'),
    ...itemCommon,
    graph: NodeId,
    x: z.number(),
    y: z.number(),
    /** The graph is drawn at its own size times this factor. */
    scale: z.number().positive(),
  }),
  z.object({
    type: z.literal('text'),
    ...itemCommon,
    /** The text's top-left corner (a box's border and padding lie outside it). */
    x: z.number(),
    y: z.number(),
    content: TextSpec,
    /** Wraps lines at word boundaries to this width; absent: lines as typed. */
    width: Pt.optional(),
    border: StrokeStyle.optional(),
    background: FillStyle.optional(),
    /** Between the text and its box (default 4 pt when there is a border or background). */
    padding: Pt.optional(),
  }),
  z.object({
    type: z.literal('line'),
    ...itemCommon,
    from: Point,
    to: Point,
    stroke: StrokeStyle,
    heads: LineEnds.optional(),
  }),
  z.object({
    type: z.literal('shape'),
    ...itemCommon,
    shape: z.enum(['rect', 'ellipse']),
    x: z.number(),
    y: z.number(),
    w: Pt,
    h: Pt,
    /** Rectangles: the corners' radius. */
    radius: Pt.optional(),
    /** Absent: no outline. */
    stroke: StrokeStyle.optional(),
    /** Absent: no fill. */
    fill: FillStyle.optional(),
  }),
  z.object({
    type: z.literal('image'),
    ...itemCommon,
    /** The image, in the project's assets (bytes beside the document, not in it). */
    asset: AssetId,
    x: z.number(),
    y: z.number(),
    w: Pt,
    h: Pt,
    /** The part of the image shown (absent: all of it), stretched to the box. */
    crop: CropRect.optional(),
    /** Resizing may change the proportions (default: they are kept). */
    freeAspect: z.boolean().optional(),
    border: StrokeStyle.optional(),
  }),
  z.object({
    type: z.literal('table'),
    ...itemCommon,
    x: z.number(),
    y: z.number(),
    source: PageTableSource,
    /** Body rows (after the header rows) and columns shown; absent: all. */
    rows: ItemRange.optional(),
    columns: ItemRange.optional(),
    /** Font, size, colour… (default: the theme's text at 9 pt). */
    text: TextStyle.partial().optional(),
    /** Grid lines: between all cells, between rows only, or none (default all). */
    grid: z.enum(['all', 'rows', 'none']).optional(),
    gridStroke: StrokeStyle.optional(),
    /** Title and column-title rows in bold (default true). */
    headerBold: z.boolean().optional(),
  }),
])
export type LayoutItem = z.infer<typeof LayoutItem>
export type LayoutItemType = LayoutItem['type']
export type LayoutItemOf<T extends LayoutItemType> = Extract<LayoutItem, { type: T }>

/**
 * An image asset: its bytes (PNG or JPEG) and what its header says. Held by the engine's asset
 * store and written to the project file as `assets/<id>.png|jpg`, never inside the document.
 */
export interface ImageAsset {
  id: AssetId
  mime: 'image/png' | 'image/jpeg'
  /** Pixels. */
  width: number
  height: number
  bytes: Uint8Array
}

/**
 * Where a page places a set of split graphs (roadmap 34d): a grid of `columns` cells, the first's
 * top-left at (x, y), each `dx` wide and `dy` tall (gaps included). The set's graphs fill it in
 * the set's order (levels, data sets, rows), row by row; a graph keeps its place within its cell.
 */
export const SetGrid = z.object({
  set: z.string().min(1),
  columns: z.number().int().min(1).max(12),
  x: z.number(),
  y: z.number(),
  dx: z.number().positive(),
  dy: z.number().positive(),
})
export type SetGrid = z.infer<typeof SetGrid>

export const PanelLabelStyle = z.enum(['A', 'a', '(A)', '(a)'])
export type PanelLabelStyle = z.infer<typeof PanelLabelStyle>

/**
 * A page arranging graphs (live: they redraw when their data change), text, lines, shapes,
 * images and live tables. Graph items are lettered A, B, C… in item order when panel labels are
 * on.
 */
export const LayoutNode = z.object({
  kind: z.literal('layout'),
  id: NodeId,
  name: z.string(),
  page: z.object({ width: Pt, height: Pt }),
  items: z.array(LayoutItem),
  panelLabels: z
    .object({
      show: z.boolean().default(true),
      style: PanelLabelStyle.default('A'),
      size: Pt.default(14),
    })
    .prefault({}),
  /** Free text about the page (roadmap 31), edited above it; never drawn. Absent = none. */
  notes: z.string().optional(),
  /**
   * Roadmap 34d: grids placing sets of split graphs (`GraphNode.split`), one per set on the page.
   * Absent = none.
   */
  grids: z.array(SetGrid).optional(),
})
export type LayoutNode = z.infer<typeof LayoutNode>

/** The images a project's pages place (asset ids, each once). */
export function assetRefs(nodes: Readonly<Record<string, { kind: string }>>): Set<AssetId> {
  const out = new Set<AssetId>()
  for (const n of Object.values(nodes)) {
    if (n.kind !== 'layout') continue
    for (const it of (n as LayoutNode).items) if (it.type === 'image') out.add(it.asset)
  }
  return out
}

/** Page sizes in points (portrait). */
export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const
