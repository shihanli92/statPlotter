import type {
  AnalysisResult,
  AssetId,
  GraphNode,
  ImageAsset,
  LayoutItem,
  LayoutItemId,
  LayoutItemType,
  LayoutNode,
  NodeId,
  PageTableSource,
  PanelLabelStyle,
  Project,
} from '@ps/model'
import { columnLetters } from '@ps/model'
import type { FontRegistry } from './fonts/registry.ts'
import type { GraphContext } from './layout/common.ts'
import { layoutGraph } from './layout/dispatch.ts'
import { largerSample, type SampledPoints, type ScreenSample } from './layout/screen.ts'
import { placeText } from './layout/text.ts'
import {
  type ItemScene,
  imageItem,
  lineItem,
  type PageTableGrid,
  shapeItem,
  tableItem,
  textItem,
} from './pageItems.ts'
import type { Box, Scene, SceneNode } from './scene.ts'
import { layoutText } from './text/layout.ts'
import { graphTheme, resolveText, type Theme } from './theme.ts'

export interface PageContext {
  project: Project
  layout: LayoutNode
  fonts: FontRegistry
  theme?: Theme
  result?: (analysisId: NodeId) => AnalysisResult | undefined
  /** Image items' pictures (the project's assets). */
  asset?: (id: AssetId) => ImageAsset | undefined
  /** Table items' cells, from their source (a data table or a sheet of results). */
  table?: (source: PageTableSource) => PageTableGrid | null
  /** Laid out for the screen: each graph's per-row points capped (decision 450). */
  screen?: ScreenSample
  /**
   * Lays out a graph item's graph (`layoutGraph` unless given): the editor passes its scene cache,
   * so a drag or an edit lays out only the graphs it changes (audit 2, P3).
   */
  graphScene?: (ctx: GraphContext) => Scene
}

/** Where an item landed on the page, for the layout editor's hit-testing and handles. */
export interface PageItemBox extends Box {
  id: LayoutItemId
  index: number
  type: LayoutItemType
  /** Graph items: the plot area on the page (for alignment and snapping). */
  plot?: Box
}

export interface PageScene extends Scene {
  items: PageItemBox[]
}

/** 0 → 'A' / 'a' / '(A)' / '(a)'; past Z continues AA, AB… */
export function panelLabel(index: number, style: PanelLabelStyle): string {
  const s = columnLetters(index)
  const lower = style === 'a' || style === '(a)'
  const text = lower ? s.toLowerCase() : s
  return style.startsWith('(') ? `(${text})` : text
}

const PLACEHOLDER = { w: 144, h: 108 }
/** Space between a panel letter and the graph it labels. */
const LABEL_GAP = 3

/**
 * Lays out a page: every graph item drawn by the graph engine and placed with a transform, free
 * text, and panel labels (A, B, C… over each graph's top-left corner). Graphs stay live.
 */
export function layoutPage(ctx: PageContext): PageScene {
  const { project, layout, fonts } = ctx
  const theme = ctx.theme ?? graphTheme(project)
  const palette = theme.palette
  const warnings: string[] = []
  const children: SceneNode[] = []
  const items: PageItemBox[] = []
  const labelStyle = { ...resolveText(theme.graphTitle), size: layout.panelLabels.size, bold: true }
  let graphIndex = 0
  let sampled: SampledPoints | undefined

  layout.items.forEach((item: LayoutItem, index) => {
    const target = ['items', index]
    if (item.type !== 'graph') {
      const t: ItemScene =
        item.type === 'text'
          ? textItem(fonts, theme, item, target)
          : item.type === 'line'
            ? lineItem(theme, item, target)
            : item.type === 'shape'
              ? shapeItem(theme, item, target)
              : item.type === 'image'
                ? imageItem(fonts, theme, item, target, ctx.asset?.(item.asset))
                : tableItem(fonts, theme, item, target, ctx.table?.(item.source) ?? null)
      children.push(t.node)
      if (t.warning) warnings.push(t.warning)
      items.push({ id: item.id, index, type: item.type, ...t.box })
      return
    }

    const graph = project.nodes[item.graph]
    let w: number
    let h: number
    let plot: Box | undefined
    if (graph?.kind === 'graph') {
      const scene = (ctx.graphScene ?? layoutGraph)({
        project,
        graph,
        fonts,
        theme: ctx.theme,
        result: ctx.result,
        ...(ctx.screen ? { screen: ctx.screen } : {}),
      })
      for (const warning of scene.warnings) warnings.push(`${graph.name}: ${warning}`)
      sampled = largerSample(sampled, scene.sampled)
      w = scene.width * item.scale
      h = scene.height * item.scale
      plot = {
        x: item.x + scene.plot.x * item.scale,
        y: item.y + scene.plot.y * item.scale,
        w: scene.plot.w * item.scale,
        h: scene.plot.h * item.scale,
      }
      children.push({
        id: `item/${item.id}`,
        target,
        transform: { x: item.x, y: item.y, scale: item.scale },
        children: [scene.root],
      })
    } else {
      warnings.push('A graph on this page no longer exists.')
      w = PLACEHOLDER.w * item.scale
      h = PLACEHOLDER.h * item.scale
      children.push({
        id: `item/${item.id}`,
        target,
        prim: {
          type: 'rect',
          x: item.x,
          y: item.y,
          w,
          h,
          stroke: { color: '#999999', width: 0.5, dash: 'dash' },
          fill: null,
        },
      })
    }
    items.push({
      id: item.id,
      index,
      type: 'graph',
      x: item.x,
      y: item.y,
      w,
      h,
      ...(plot ? { plot } : {}),
    })

    if (layout.panelLabels.show) {
      const text = [{ text: panelLabel(graphIndex, layout.panelLabels.style) }]
      // Just outside the graph's top-left corner when the page has room, so the letter never
      // covers the graph's own title or top tick label; otherwise at the corner.
      const outside = item.x - LABEL_GAP >= layoutText(fonts, text, labelStyle).width
      children.push(
        placeText(
          fonts,
          `item/${item.id}/label`,
          text,
          labelStyle,
          palette,
          outside ? item.x - LABEL_GAP : item.x,
          item.y,
          outside ? 'end' : 'start',
          'top',
          { target: ['panelLabels'] },
        ).node,
      )
    }
    graphIndex++
  })

  const { width, height } = layout.page
  return {
    width,
    height,
    plot: { x: 0, y: 0, w: width, h: height },
    root: { id: 'page', target: [], children },
    warnings: [...new Set(warnings)],
    items,
    ...(sampled ? { sampled } : {}),
  }
}

/**
 * Places graphs in a grid filling the page inside `margin`, row by row in the given order, each
 * scaled down (never up) to fit its cell.
 */
export function arrangeGrid(
  sizes: readonly { w: number; h: number }[],
  page: { width: number; height: number },
  columns: number,
  margin = 36,
): { x: number; y: number; scale: number }[] {
  const cols = Math.max(1, Math.min(columns, sizes.length))
  const rows = Math.max(1, Math.ceil(sizes.length / cols))
  const cellW = (page.width - 2 * margin) / cols
  const cellH = (page.height - 2 * margin) / rows
  return sizes.map((s, i) => {
    const scale = Math.min(1, cellW / s.w, cellH / s.h)
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      x: margin + col * cellW + (cellW - s.w * scale) / 2,
      y: margin + row * cellH,
      scale,
    }
  })
}

export interface AlignOptions {
  /** Graphs per grid row. */
  columns: number
  /** Page margin (default 36 pt). */
  margin?: number
  /** Space between grid cells, in page points (default 12 pt). */
  gap?: number
  /**
   * The plot areas are all the same size (see `equalizePlotSizes`): cells are then made uniform
   * too (every column as wide and every row as tall as the largest), so plot areas are evenly
   * spaced and their right and bottom edges line up as well. Otherwise each grid column and row
   * is only as large as its own graphs need.
   */
  equalPlotSize?: boolean
}

/**
 * Places graphs in a grid, row by row in the given order, so that their plot areas line up:
 * within each grid column every plot area starts at the same x (the column's left offset is the
 * largest plot.x of its graphs), within each grid row at the same y (the largest plot.y). Cells
 * are sized to fit their graphs, and one common scale (never above 1) makes the grid fit inside
 * the page margins. The grid is centred horizontally and starts at the top margin.
 */
export function arrangeAligned(
  graphs: readonly { scene: Pick<Scene, 'width' | 'height' | 'plot'> }[],
  page: { width: number; height: number },
  opts: AlignOptions,
): { x: number; y: number; scale: number }[] {
  return alignedGrid(graphs, page, opts).placements
}

/**
 * `arrangeAligned`'s placements with the grid they fill (roadmap 34d, a set's `SetGrid`): the
 * first cell's top-left and the distance from one cell to the next across (`dx`, the first
 * column's width plus the gap) and down (`dy`). Uniform with `equalPlotSize`.
 */
export function alignedGrid(
  graphs: readonly { scene: Pick<Scene, 'width' | 'height' | 'plot'> }[],
  page: { width: number; height: number },
  opts: AlignOptions,
): {
  placements: { x: number; y: number; scale: number }[]
  columns: number
  x: number
  y: number
  dx: number
  dy: number
} {
  const n = graphs.length
  const margin0 = opts.margin ?? 36
  if (!n) return { placements: [], columns: 1, x: margin0, y: margin0, dx: 1, dy: 1 }
  const margin = opts.margin ?? 36
  const gap = opts.gap ?? 12
  const cols = Math.max(1, Math.min(Math.floor(opts.columns) || 1, n))
  const rows = Math.ceil(n / cols)
  const colOf = (i: number) => i % cols
  const rowOf = (i: number) => Math.floor(i / cols)

  // Unscaled extents left/right of the plot's left edge per column, above/below its top per row.
  const left = new Array<number>(cols).fill(0)
  const right = new Array<number>(cols).fill(0)
  const above = new Array<number>(rows).fill(0)
  const below = new Array<number>(rows).fill(0)
  graphs.forEach(({ scene: s }, i) => {
    const [c, r] = [colOf(i), rowOf(i)]
    left[c] = Math.max(left[c]!, s.plot.x)
    right[c] = Math.max(right[c]!, s.width - s.plot.x)
    above[r] = Math.max(above[r]!, s.plot.y)
    below[r] = Math.max(below[r]!, s.height - s.plot.y)
  })
  if (opts.equalPlotSize) {
    for (const a of [left, right, above, below]) a.fill(Math.max(...a))
  }
  const colW = left.map((l, c) => l + right[c]!)
  const rowH = above.map((a, r) => a + below[r]!)
  const sum = (a: number[]) => a.reduce((p, q) => p + q, 0)
  const availW = page.width - 2 * margin - gap * (cols - 1)
  const availH = page.height - 2 * margin - gap * (rows - 1)
  const scale = Math.max(0, Math.min(1, availW / (sum(colW) || 1), availH / (sum(rowH) || 1)))

  const gridW = sum(colW) * scale + gap * (cols - 1)
  const x0 = margin + Math.max(0, (page.width - 2 * margin - gridW) / 2)
  /** Start of each cell along one direction. */
  const starts = (sizes: number[], from: number) => {
    const out: number[] = []
    let at = from
    for (const size of sizes) {
      out.push(at)
      at += size * scale + gap
    }
    return out
  }
  const colX = starts(colW, x0)
  const rowY = starts(rowH, margin)

  const placements = graphs.map(({ scene: s }, i) => {
    const [c, r] = [colOf(i), rowOf(i)]
    return {
      x: colX[c]! + (left[c]! - s.plot.x) * scale,
      y: rowY[r]! + (above[r]! - s.plot.y) * scale,
      scale,
    }
  })
  return {
    placements,
    columns: cols,
    x: colX[0]!,
    y: rowY[0]!,
    dx: Math.max(1, colW[0]! * scale + gap),
    dy: Math.max(1, rowH[0]! * scale + gap),
  }
}

/**
 * Gives every graph the same plot-area size: the largest plot width and the largest plot height
 * among them (so nothing gets cramped). Graphs already that size are returned as they are.
 */
export function equalizePlotSizes<G extends Pick<GraphNode, 'size'>>(graphs: readonly G[]): G[] {
  if (!graphs.length) return []
  const plotWidth = Math.max(...graphs.map((g) => g.size.plotWidth))
  const plotHeight = Math.max(...graphs.map((g) => g.size.plotHeight))
  return graphs.map((g) =>
    g.size.plotWidth === plotWidth && g.size.plotHeight === plotHeight
      ? g
      : { ...g, size: { ...g.size, plotWidth, plotHeight } },
  )
}
