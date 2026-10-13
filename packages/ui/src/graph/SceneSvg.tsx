import {
  type Box,
  cloudHit,
  cloudPointIndex,
  cloudPointNode,
  dashArray,
  FONT_STACKS,
  hitTest,
  type PointsPrim,
  type Prim,
  pathData,
  pointsImagePrim,
  pointsPrimBounds,
  pointsShift,
  primBounds,
  type Scene,
  type SceneNode,
  type Stroke,
  type StylePath,
  symbolPath,
  transformAttr,
  treeLegAt,
  unionBoxes,
} from '@ps/graph'
import {
  createContext,
  Fragment,
  type MouseEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import {
  entryKeyOf,
  hitKey,
  hoverMarks,
  keysMatcher,
  type NodeMatch,
  pointSeries,
  sceneIndex,
} from '../selection/sceneKeys.ts'
import { rasterInWorker, rasterWorkerAvailable, SUPERSEDED } from '../worker/pointRaster.ts'
import { assetUrl, cloudUrls } from './assetUrls.ts'
import { textBox } from './canvasEdit.ts'

// Moved to the selection model (roadmap 44); kept here for their callers.
export {
  hitKey,
  hoverIndex,
  hoverMarks,
  selectionKey,
  selectionMatcher,
} from '../selection/sceneKeys.ts'

/** Points → CSS pixels at 100% zoom. */
export const PX_PER_PT = 4 / 3

function strokeProps(s: Stroke | null) {
  if (!s || s.width <= 0) return { stroke: 'none' }
  return { stroke: s.color, strokeWidth: s.width, strokeDasharray: dashArray(s) ?? undefined }
}

/**
 * Screen pixels per point of the scene being drawn (zoom × CSS pixels per point × the display's
 * pixel ratio): the resolution point clouds are drawn into images at (roadmap 34e).
 */
export const RasterScale = createContext(PX_PER_PT * pixelRatio())

/** The display's device pixels per CSS pixel. */
export function pixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/** A cloud's image at a resolution (`img`), made from the cloud `p`. */
export interface CloudRaster {
  p: PointsPrim
  scale: number
  img: ReturnType<typeof pointsImagePrim>
}

/** A cloud's image at a resolution: one kept per cloud (the latest zoom's). */
const cloudImages = new WeakMap<PointsPrim, CloudRaster>()

/** Zoom steps reuse an image within a quarter of its resolution's scale. */
const fits = (made: number, scale: number) => made >= scale && made < scale * 1.25

/**
 * A point cloud's image at `scale` pixels per point (made once per cloud and zoom): `before`'s
 * (the image the element showed last), moved with the points, when the cloud draws its points
 * moved alike (`pointsShift`; audit 3, P4: a re-layout after a title or the legend moved, each
 * step of a drag, leaves the points as they were or moves the whole plot).
 */
export function cloudRaster(
  p: PointsPrim,
  scale: number,
  before?: CloudRaster | null,
): CloudRaster {
  const hit = cloudImages.get(p)
  if (hit && fits(hit.scale, scale)) return hit
  const shift = before?.img && fits(before.scale, scale) ? pointsShift(before.p, p) : null
  const r: CloudRaster =
    before?.img && shift
      ? {
          p,
          scale: before.scale,
          img: { ...before.img, x: before.img.x + shift[0], y: before.img.y + shift[1] },
        }
      : { p, scale, img: pointsImagePrim(p, scale, { level: 1 }) }
  cloudImages.set(p, r)
  return r
}

/** A point cloud's image at `scale` pixels per point (made once per cloud and zoom). */
export const cloudImage = (p: PointsPrim, scale: number) => cloudRaster(p, scale).img

/**
 * Audit 4 (P5): where the scene is seen (the canvas: its element, whose box on the screen is the
 * part in view) and a key that changes once a scroll, a zoom or a resize has rested. A cloud whose
 * image at the zoom would be larger than LARGE_CLOUD_PIXELS draws a whole image of a fixed size
 * and, over it, the part in view (and around it) at the zoom's resolution.
 */
export interface RasterViewport {
  el: () => Element | null
  key: number
}
export const RasterView = createContext<RasterViewport | null>(null)

/** Pixels of a cloud's whole image above which only the part in view is drawn sharp. */
export const LARGE_CLOUD_PIXELS = 4_000_000

/** A cloud's bounds (once per cloud: a pass over its points). */
const cloudBounds = new WeakMap<PointsPrim, ReturnType<typeof pointsPrimBounds>>()
function boundsOf(p: PointsPrim) {
  if (!cloudBounds.has(p)) cloudBounds.set(p, pointsPrimBounds(p))
  return cloudBounds.get(p) ?? null
}

/** Pixels of a cloud's whole image at `scale`. */
export function cloudPixels(p: PointsPrim, scale: number): number {
  const b = boundsOf(p)
  return b ? b.w * scale * b.h * scale : 0
}

/** The part of the element's user space seen through `viewport`, or null when unknown. */
function seenBox(el: Element | null, viewport: Element | null): Box | null {
  const g = el as SVGGraphicsElement | null
  if (!g || !viewport || typeof g.getScreenCTM !== 'function') return null
  const ctm = g.getScreenCTM()
  if (!ctm || typeof DOMPoint === 'undefined') return null
  const inv = ctm.inverse()
  const r = viewport.getBoundingClientRect()
  const pts = [
    [r.left, r.top],
    [r.right, r.top],
    [r.left, r.bottom],
    [r.right, r.bottom],
  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(inv))
  const xs = pts.map((q) => q.x)
  const ys = pts.map((q) => q.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const box = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  return box.w > 0 && box.h > 0 && [x, y, box.w, box.h].every(Number.isFinite) ? box : null
}

const contains = (a: Box, b: Box) =>
  b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h

/** The part drawn for a view: the view and a quarter of it around (a short pan draws nothing). */
const around = (v: Box): Box => ({
  x: v.x - v.w / 4,
  y: v.y - v.h / 4,
  w: v.w * 1.5,
  h: v.h * 1.5,
})

/** A large cloud's whole image, at a fixed size (the same at every zoom: made once). */
const wholeImages = new WeakMap<PointsPrim, CloudRaster>()
/** A large cloud's image of the part in view: one kept per cloud (the latest view's). */
const partImages = new WeakMap<PointsPrim, CloudRaster & { clip: Box }>()

/** The whole image made at about `scale` (a quarter either way), if any. */
function wholeMade(p: PointsPrim, scale: number): CloudRaster | null {
  const hit = wholeImages.get(p)
  return hit && hit.scale >= scale / 1.25 && hit.scale <= scale * 1.25 ? hit : null
}

/**
 * Audit 4 (P5): an image the worker draws (`rasterInWorker`) while `ask` holds — the image shown
 * till then stays — given to `keep` when it comes (drawn on this thread when the worker can't).
 * A zoom that rested drew a million points' image on the main thread: a two-second task.
 */
function useWorkerImage(
  ask: boolean,
  p: PointsPrim,
  scale: number,
  clip: Box | undefined,
  keep: (r: CloudRaster) => void,
) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const keepRef = useRef(keep)
  keepRef.current = keep
  const clipKey = clip ? `${clip.x},${clip.y},${clip.w},${clip.h}` : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: the clip by its numbers (clipKey)
  useEffect(() => {
    if (!ask) return
    let live = true
    const done = (img: CloudRaster['img']) => {
      keepRef.current({ p, scale, img })
      if (live) redraw()
    }
    const opts = { ...(clip ? { clip } : {}), level: 1 }
    rasterInWorker(p, scale, clip).then(
      // Superseded: a later request (another zoom) shows its image.
      (img) => img !== SUPERSEDED && done(img),
      () => done(pointsImagePrim(p, scale, opts)),
    )
    return () => {
      live = false
    }
  }, [ask, p, scale, clipKey])
}

/** A large cloud: its whole image at a fixed size, the part in view at the zoom's over it. */
function LargeCloudEl(props: {
  p: PointsPrim
  id: string
  scale: number
  view: RasterViewport
  pixels: number
}) {
  const { p, id, scale, view, pixels } = props
  const ref = useRef<SVGImageElement>(null)
  // The part in view (in the cloud's coordinates) at the zoom it was seen at.
  const [seen, setSeen] = useState<{ box: Box; scale: number } | null>(null)
  // Looked at once the view has rested (its key) and at each zoom, after the zoom is drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view's key and the zoom say when
  useLayoutEffect(() => {
    const b = seenBox(ref.current, view.el())
    setSeen((s) =>
      s && b && s.scale === scale && contains(s.box, b) && contains(b, s.box)
        ? s
        : b && { box: b, scale },
    )
  }, [view, scale, p])

  // The whole image (the same at every zoom); until the worker has made it, the image the cloud
  // had at a lower zoom.
  const wholeScale = scale * Math.sqrt(LARGE_CLOUD_PIXELS / pixels)
  const made = wholeMade(p, wholeScale)
  const before = cloudImages.get(p) ?? null
  const askWhole = !made && !!before?.img && rasterWorkerAvailable()
  const whole =
    made ??
    (askWhole
      ? before!
      : (() => {
          const r = { p, scale: wholeScale, img: pointsImagePrim(p, wholeScale, { level: 1 }) }
          wholeImages.set(p, r)
          return r
        })())
  useWorkerImage(askWhole, p, wholeScale, undefined, (r) => wholeImages.set(p, r))

  // The part in view at this zoom; until it is made, the part drawn last (held, as zooms hold).
  const want = seen && seen.scale === scale ? seen.box : null
  const last = partImages.get(p) ?? null
  const ready = !!want && !!last && fits(last.scale, scale) && contains(last.clip, want)
  const clip = want && !ready ? around(want) : undefined
  const askPart = !!clip && !!last?.img && rasterWorkerAvailable()
  let part: CloudRaster | null = last
  if (clip && !askPart) {
    const r = { p, scale, clip, img: pointsImagePrim(p, scale, { clip, level: 1 }) }
    partImages.set(p, r)
    part = r
  }
  useWorkerImage(askPart, p, scale, clip, (r) => partImages.set(p, { ...r, clip: clip! }))

  const wa = whole.img?.asset
  const pa = part?.img?.asset
  useEffect(() => (wa ? cloudUrls.hold(wa) : undefined), [wa])
  useEffect(() => (pa ? cloudUrls.hold(pa) : undefined), [pa])
  const w = whole.img
  const q = part?.img
  return (
    <>
      {w ? (
        <image
          ref={ref}
          data-id={id}
          x={w.x}
          y={w.y}
          width={w.w}
          height={w.h}
          preserveAspectRatio="none"
          href={cloudUrls.url(w.asset)}
        />
      ) : null}
      {q ? (
        <image
          data-part="in view"
          x={q.x}
          y={q.y}
          width={q.w}
          height={q.h}
          preserveAspectRatio="none"
          href={cloudUrls.url(q.asset)}
        />
      ) : null}
    </>
  )
}

/** A point cloud drawn as our rasteriser's image (on screen; exports draw its symbols). */
function PointsEl({ p, id, scale }: { p: PointsPrim; id: string; scale: number }) {
  const view = useContext(RasterView)
  const pixels = view ? cloudPixels(p, scale) : 0
  if (view && pixels > LARGE_CLOUD_PIXELS)
    return <LargeCloudEl p={p} id={id} scale={scale} view={view} pixels={pixels} />
  return <CloudEl p={p} id={id} scale={scale} />
}

function CloudEl({ p, id, scale }: { p: PointsPrim; id: string; scale: number }) {
  // The image this element showed last, kept as long as the element (its scene keeps its cloud).
  const last = useRef<CloudRaster | null>(null)
  const held = last.current
  const hit = cloudImages.get(p)
  // Audit 4 (P5): the same cloud at another zoom: the image shown stays until the worker has
  // drawn the new one.
  const ask =
    !(hit && fits(hit.scale, scale)) && !!held?.img && held.p === p && rasterWorkerAvailable()
  const r = ask ? held! : cloudRaster(p, scale, held)
  last.current = r
  useWorkerImage(ask, p, scale, undefined, (c) => cloudImages.set(p, c))
  const asset = r.img?.asset
  // Its URL is held while shown (audit 3, P3).
  useEffect(() => (asset ? cloudUrls.hold(asset) : undefined), [asset])
  if (!r.img) return null
  const img = r.img
  return (
    <image
      data-id={id}
      x={img.x}
      y={img.y}
      width={img.w}
      height={img.h}
      preserveAspectRatio="none"
      href={cloudUrls.url(img.asset)}
    />
  )
}

function PrimEl({ p, id, scale = 1 }: { p: Prim; id: string; scale?: number }) {
  const raster = useContext(RasterScale)
  switch (p.type) {
    case 'points':
      return <PointsEl p={p} id={id} scale={raster * scale} />
    case 'ellipse':
      return (
        <ellipse
          data-id={id}
          cx={p.cx}
          cy={p.cy}
          rx={p.rx}
          ry={p.ry}
          fill={p.fill?.color ?? 'none'}
          fillOpacity={p.fill?.opacity}
          {...strokeProps(p.stroke)}
        />
      )
    case 'path':
      return (
        <path
          data-id={id}
          d={pathData(p.d)}
          fill={p.fill?.color ?? 'none'}
          fillOpacity={p.fill?.opacity}
          {...strokeProps(p.stroke)}
        />
      )
    case 'image': {
      // As in the exported SVG: a nested viewport showing the crop, stretched to the box.
      const { width: W, height: H } = p.asset
      const c = p.crop ?? { x: 0, y: 0, w: 1, h: 1 }
      return (
        <svg
          data-id={id}
          aria-hidden="true"
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          viewBox={`${c.x * W} ${c.y * H} ${c.w * W} ${c.h * H}`}
          preserveAspectRatio="none"
          overflow="hidden"
        >
          <image width={W} height={H} preserveAspectRatio="none" href={assetUrl(p.asset)} />
        </svg>
      )
    }
    case 'line':
      return (
        <line
          data-id={id}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          strokeLinecap="square"
          {...strokeProps(p.stroke)}
        />
      )
    case 'polyline':
      return (
        <polyline
          data-id={id}
          points={p.points.map((q) => q.join(',')).join(' ')}
          fill="none"
          {...strokeProps(p.stroke)}
        />
      )
    case 'polygon':
      return (
        <polygon
          data-id={id}
          points={p.points.map((q) => q.join(',')).join(' ')}
          fill={p.fill.color}
          fillOpacity={p.fill.opacity}
          {...strokeProps(p.stroke)}
        />
      )
    case 'rect':
      return (
        <rect
          data-id={id}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx={p.rx}
          fill={p.fill?.color ?? 'none'}
          fillOpacity={p.fill?.opacity}
          {...strokeProps(p.stroke)}
        />
      )
    case 'symbol':
      return (
        <path
          data-id={id}
          d={symbolPath(p.shape, p.cx, p.cy, p.size)}
          fill={p.fill?.color ?? 'none'}
          fillOpacity={p.fill?.opacity}
          {...strokeProps(p.stroke)}
        />
      )
    case 'text': {
      const transform = p.rotate
        ? `rotate(${p.rotate.angle} ${p.rotate.cx} ${p.rotate.cy})`
        : undefined
      const halo = p.halo
        ? {
            stroke: p.halo.color,
            strokeWidth: p.halo.width,
            strokeLinejoin: 'round' as const,
            paintOrder: 'stroke',
          }
        : {}
      const text = (
        <text data-id={id} fill={p.color} transform={transform} xmlSpace="preserve" {...halo}>
          {p.layout.runs.map((r, i) => (
            <tspan
              // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
              key={i}
              x={p.x + r.x}
              y={p.y + r.dy}
              fontFamily={FONT_STACKS[r.font]}
              fontSize={r.size}
              fontWeight={r.bold ? 700 : 400}
              fontStyle={r.italic ? 'italic' : 'normal'}
              fill={r.fill}
            >
              {r.text}
            </tspan>
          ))}
        </text>
      )
      if (!p.layout.underlines) return text
      // Underlines as filled rects, turned with the text (as in the exported SVG).
      return (
        <>
          {text}
          {p.layout.underlines.map((u, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: underlines are positional
              key={i}
              x={p.x + u.x}
              y={p.y + u.y}
              width={u.w}
              height={u.h}
              fill={u.fill ?? p.color}
              transform={transform}
            />
          ))}
        </>
      )
    }
  }
}

/**
 * A scene subtree; `scale`: its points per scene point so far (pages' graphs are scaled). Scenes
 * are never changed once made, so a subtree drawn again as the same object is skipped: a page
 * redrawn during a drag redraws only what moved, its graphs coming from the scene cache
 * (audit 2, P3).
 */
export const NodeEl = memo(function NodeEl({
  node,
  scale = 1,
}: {
  node: SceneNode
  scale?: number
}) {
  const k = node.transform ? scale * (node.transform.scale || 1) : scale
  const body = (
    <>
      {node.prim && <PrimEl p={node.prim} id={node.id} scale={k} />}
      {node.children?.map((c) => (
        <NodeEl key={c.id} node={c} scale={k} />
      ))}
    </>
  )
  return node.transform ? <g transform={transformAttr(node.transform)}>{body}</g> : body
})

/** The selection colour: halos and outlines here, selected items and the marquee on a page. */
export const HALO = '#2f7cf6'

/**
 * Hovering highlights at most this many marks: the halo of a data set with more (e.g. thousands
 * of points) would cost more than a hover should, so only the mark under the pointer is shown.
 */
export const HOVER_LIMIT = 1500

const keyOf = (path: StylePath) => JSON.stringify(path)

/**
 * A selection halo drawn along a primitive: a wide, translucent accent stroke on its outline.
 * `light`: the fainter hover version.
 */
function Halo({ p, k, light = false }: { p: Prim; k: number; light?: boolean }) {
  const extra = (light ? 4 : 5) / k
  const common = {
    fill: 'none',
    stroke: HALO,
    strokeOpacity: light ? 0.22 : 0.45,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }
  const w = (s: Stroke | null) => (s && s.width > 0 ? s.width : 0) + extra
  switch (p.type) {
    case 'line':
      return <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...common} strokeWidth={w(p.stroke)} />
    case 'polyline':
      return (
        <polyline
          points={p.points.map((q) => q.join(',')).join(' ')}
          {...common}
          strokeWidth={w(p.stroke)}
        />
      )
    case 'polygon':
      return (
        <polygon
          points={p.points.map((q) => q.join(',')).join(' ')}
          {...common}
          strokeWidth={extra}
        />
      )
    case 'rect':
    case 'image':
      return (
        <rect
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx={p.type === 'rect' ? p.rx : undefined}
          {...common}
          strokeWidth={extra}
        />
      )
    case 'ellipse':
      return (
        <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...common} strokeWidth={w(p.stroke)} />
      )
    case 'path':
      return <path d={pathData(p.d)} {...common} strokeWidth={w(p.stroke)} />
    case 'points': {
      // A whole cloud (roadmap 34e): the box round its points.
      const b = pointsPrimBounds(p)
      return b ? (
        <rect x={b.x} y={b.y} width={b.w} height={b.h} {...common} strokeWidth={extra / 2} />
      ) : null
    }
    case 'symbol':
      return (
        // Symbols are small: a slightly bolder ring so a single selected point stands out.
        <path
          d={symbolPath(p.shape, p.cx, p.cy, p.size)}
          {...common}
          strokeOpacity={light ? 0.3 : 0.6}
          strokeWidth={w(p.stroke) + 2 / k}
        />
      )
    case 'text': {
      // Text: a tight outline of the words themselves.
      const b = textBox(p)
      const pad = 1.5 / k
      return (
        <rect
          x={b.x - pad}
          y={b.y - pad}
          width={b.w + 2 * pad}
          height={b.h + 2 * pad}
          {...common}
          strokeOpacity={light ? 0.4 : 0.8}
          strokeWidth={1.25 / k}
        />
      )
    }
  }
}

/** A cloud's point one of the selected single points (`pointOverrides`) names, as a node; else null. */
export function cloudPoint(
  node: SceneNode,
  target: StylePath | undefined,
  selected: readonly StylePath[],
): SceneNode | null {
  if (node.prim?.type !== 'points') return null
  const series = pointSeries(target)
  for (const k of selected) {
    if (k[0] !== 'pointOverrides' || series !== String(k[1])) continue
    const i = cloudPointIndex(node.prim, String(k[2]))
    if (i >= 0) return cloudPointNode({ ...node, ...(target ? { target } : {}) }, i)
  }
  return null
}

/** Halos for every node the selection covers, following the scene's transforms. */
function haloLayer(
  node: SceneNode,
  match: NodeMatch,
  k: number,
  selected: readonly StylePath[],
  inherited?: StylePath,
): ReactNode {
  const target = node.target ?? inherited
  const point = cloudPoint(node, target, selected)
  const own = point ? (
    <Halo p={point.prim!} k={k} />
  ) : node.prim && match(target, node) ? (
    <Halo p={node.prim} k={k} />
  ) : null
  const kids = node.children?.map((c) => haloLayer(c, match, k, selected, target))
  const body = (
    <>
      {own}
      {kids}
    </>
  )
  return node.transform ? (
    <g key={node.id} transform={transformAttr(node.transform)}>
      {body}
    </g>
  ) : (
    <Fragment key={node.id}>{body}</Fragment>
  )
}

/**
 * The selection halos of `selected` over a scene drawn elsewhere (roadmap 44: the parts of a
 * graph selected on a page, inside the item's transform): the shapes as on the canvas, the
 * legend outlined. `k`: screen pixels per scene point.
 */
export function SceneHalos({
  scene,
  selected,
  k,
}: {
  scene: Scene
  selected: readonly StylePath[]
  k: number
}) {
  const others = selected.filter((p) => p[0] !== 'legend')
  const match = keysMatcher(others)
  const { legend, entries } = legendHalos(scene, selected)
  return (
    <g className="selection page-element-halo" pointerEvents="none">
      {match && haloLayer(scene.root, match, k, others)}
      {legend && <LegendOutline box={legend} k={k} />}
      {entries.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: boxes of the entries selected, in order
        <EntryOutline key={i} box={b} k={k} />
      ))}
    </g>
  )
}

/**
 * Roadmap 47b: the legend's box when the legend itself is selected, and the boxes of the legend
 * entries selected (outlined, as the legend is).
 */
export function legendHalos(
  scene: Scene,
  selected: readonly StylePath[],
): { legend: Box | null; entries: Box[] } {
  const { nodes } = sceneIndex(scene.root)
  const legend = selected.some((p) => p[0] === 'legend' && p.length === 1)
    ? unionBoxes(
        nodes.all
          .filter((n) => n.target?.[0] === 'legend')
          .map((n) => n.bbox ?? (n.prim ? primBounds(n.prim) : null)),
      )
    : null
  const keys = new Set(selected.flatMap((p) => entryKeyOf(p) ?? []))
  const entries = keys.size
    ? nodes.entries.flatMap((n) => (n.bbox && keys.has(n.legendEntry!.key) ? [n.bbox] : []))
    : []
  return { legend, entries }
}

/** The legend selected: a dashed outline round it. */
function LegendOutline({ box, k, light }: { box: Box; k: number; light?: boolean }) {
  return (
    <rect
      className={light ? 'hover' : 'selection'}
      x={box.x - 3}
      y={box.y - 3}
      width={box.w + 6}
      height={box.h + 6}
      fill="none"
      stroke={HALO}
      strokeOpacity={light ? 0.5 : 1}
      strokeWidth={1 / k}
      strokeDasharray={`${4 / k} ${3 / k}`}
      pointerEvents="none"
    />
  )
}

/** Roadmap 47b: a legend entry selected: an outline round its row. */
function EntryOutline({ box, k }: { box: Box; k: number }) {
  return (
    <rect
      className="selection legend-entry-halo"
      x={box.x - 1.5}
      y={box.y}
      width={box.w + 3}
      height={box.h}
      rx={2 / k}
      fill={HALO}
      fillOpacity={0.08}
      stroke={HALO}
      strokeWidth={1.5 / k}
      pointerEvents="none"
    />
  )
}

export interface SceneHit {
  node: SceneNode
  target: StylePath | undefined
}

/** The modifiers of a pointer event: Alt (Option), and Shift / ⌘ / Ctrl (adding to a selection). */
export interface PointerMods {
  alt: boolean
  additive: boolean
}

export const modsOf = (e: {
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): PointerMods => ({ alt: e.altKey, additive: e.shiftKey || e.metaKey || e.ctrlKey })

/**
 * Hits of thin lines are widened (roadmap 44, O10): a pointer on nothing, or on the plot's or
 * graph's background, takes the topmost element within this many screen pixels (`hitTest`, in
 * drawing order, as on pages).
 */
export const HIT_TOLERANCE_PX = 4

/** Backgrounds a widened hit looks through. */
const isBackground = (t: StylePath | undefined) =>
  t?.[0] === 'style' && (t[1] === 'plotBackground' || t[1] === 'background')

export function SceneSvg({
  scene,
  zoom,
  rasterZoom = zoom,
  rasterView = null,
  selected,
  onSelect,
  onPointerDownNode,
  onPointerDownEmpty,
  onDoubleClickNode,
  onContextMenuNode,
  hoverTarget,
  preview,
  canDrag,
  overlay,
  onHoverNode,
  label = 'Graph',
}: {
  scene: Scene
  zoom: number
  /**
   * The zoom point clouds are drawn into images at: the zoom, or (roadmap 50) the zoom before the
   * wheel's, until it rests.
   */
  rasterZoom?: number
  /** Audit 4 (P5): where the canvas shows the scene (large clouds draw the part in view sharp). */
  rasterView?: RasterViewport | null
  /** The selection keys to halo (several when several things are selected). */
  selected: readonly StylePath[]
  /**
   * A click: the selection key of what was hit (null: nothing), the hit itself, the click count
   * (2 for the second click of a double-click) and the modifiers held.
   */
  onSelect: (
    target: StylePath | null,
    hit: SceneHit | null,
    clickCount: number,
    mods: PointerMods,
  ) => void
  /** Pointer pressed on a scene element (drag start). */
  onPointerDownNode?: (hit: SceneHit, e: PointerEvent<SVGSVGElement>) => void
  /**
   * Pointer pressed on nothing, or on the plot's or graph's background with no element within
   * reach (roadmap 44: a marquee starts there).
   */
  onPointerDownEmpty?: (e: PointerEvent<SVGSVGElement>) => void
  onDoubleClickNode?: (hit: SceneHit, mods: PointerMods) => void
  /** Right-click (or the context-menu key) on the graph; `hit` is null off any element. */
  onContextMenuNode?: (hit: SceneHit | null, e: MouseEvent<SVGSVGElement>) => void
  /**
   * What a click on a hovered element would select (e.g. a point of the selected data set), for
   * the hover highlight; default: the element's selection key. Returning null shows none.
   */
  hoverTarget?: (key: StylePath, hit: SceneHit, mods: PointerMods) => StylePath | null
  /**
   * Marks to show the hover halo on instead of what is under the pointer (a marquee's live
   * preview: what it would pick); null or absent: the hover as usual.
   */
  preview?: readonly SceneNode[] | null
  /** Elements a press can drag get a move cursor. */
  canDrag?: (hit: SceneHit) => boolean
  /** Drawn over everything, in scene points (e.g. resize handles, snap guides). */
  overlay?: ReactNode
  /** The element under the pointer as it moves (null: off every element), for hover cards. */
  onHoverNode?: (node: SceneNode | null) => void
  label?: string
}) {
  const { nodes: index, marks: hovers } = useMemo(() => sceneIndex(scene.root), [scene])

  // The legend is outlined as a whole, its entries (roadmap 47b) each; everything else is
  // highlighted along its own shapes.
  const legendHalo = useMemo(() => legendHalos(scene, selected), [scene, selected])
  const selectedIds = useMemo(() => new Set(selected.map(keyOf)), [selected])
  const others = useMemo(() => selected.filter((p) => p[0] !== 'legend'), [selected])
  const match = useMemo(() => keysMatcher(others), [others])

  const k = zoom * PX_PER_PT
  /** The pointer's place in scene points. */
  const scenePoint = (e: { target: EventTarget; clientX?: number; clientY?: number }) => {
    const svg = (e.target as Element).closest('svg.scene')
    if (!svg || e.clientX === undefined || e.clientY === undefined) return null
    const r = svg.getBoundingClientRect()
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }
  }
  const hitOf = (e: {
    target: EventTarget
    clientX?: number
    clientY?: number
  }): SceneHit | null => {
    const el = (e.target as Element).closest('[data-id]')
    const node = el ? index.map.get(el.getAttribute('data-id')!) : undefined
    if (node?.prim?.type === 'points') {
      // A cloud's image (roadmap 34e): the point under the pointer, from the cloud's grid.
      const at = scenePoint(e)
      if (!at) return null
      const i = cloudHit(node.prim, at.x, at.y, 3 / k)
      if (i >= 0) {
        const point = cloudPointNode(node, i)
        return { node: point, target: point.target }
      }
    } else if (node?.tree?.legs?.length) {
      // A dendrogram's branch (roadmap 49c): its leg down to a leaf is the leaf's (hover cards;
      // a graph's marks are in the scene's coordinates, as a cloud's).
      const at = scenePoint(e)
      return { node: (at && treeLegAt(node, at.x, at.y)) || node, target: node.target }
    } else if (node && !isBackground(node.target)) return { node, target: node.target }
    // On nothing, a background or between a cloud's points: what is within reach (O10).
    const at = scenePoint(e)
    const near = at ? hitTest(scene.root, at.x, at.y, HIT_TOLERANCE_PX / k) : null
    if (near && !isBackground(near.target)) {
      const own = near.node.cloud ? near.node : (index.map.get(near.node.id) ?? near.node)
      return { node: own, target: near.target }
    }
    return node && node.prim?.type !== 'points' ? { node, target: node.target } : null
  }

  // Hover: a lighter halo on what a click would select. The key is kept as a string so moving
  // within one element (or between marks of one data set) doesn't re-render.
  const [hover, setHover] = useState<{ key: string; node: string; cloud?: SceneNode } | null>(null)
  const [movable, setMovable] = useState(false)
  const onHover = (e: PointerEvent<SVGSVGElement>) => {
    const hit = hitOf(e)
    const key = hit ? hitKey(hit.node, hit.target, index.entryOf) : null
    const mods = modsOf(e)
    const target = key && hit ? (hoverTarget ? hoverTarget(key, hit, mods) : key) : null
    const next = target
      ? { key: keyOf(target), node: hit!.node.id, ...(hit!.node.cloud ? { cloud: hit!.node } : {}) }
      : null
    setHover((h) => (h?.key === next?.key && h?.node === next?.node ? h : next))
    setMovable(!!hit && !!canDrag?.(hit))
    onHoverNode?.(hit?.node ?? null)
  }
  // Over a background, what is within reach changes as the pointer moves: looked for once a frame
  // at most.
  const frame = useRef<{ id: number; e: PointerEvent<SVGSVGElement> } | null>(null)
  useEffect(() => () => cancelAnimationFrame(frame.current?.id ?? 0), [])
  const onMoveOverBackground = (e: PointerEvent<SVGSVGElement>) => {
    if (frame.current) {
      frame.current.e = e
      return
    }
    frame.current = {
      e,
      id: requestAnimationFrame(() => {
        const last = frame.current?.e
        frame.current = null
        if (last) onHover(last)
      }),
    }
  }
  // The legend hovered (roadmap 47b: what a first click on it selects): its outline, light.
  const hoverLegend = useMemo(
    () =>
      hover?.key === '["legend"]' && !selectedIds.has(hover.key)
        ? legendHalos(scene, [['legend']]).legend
        : null,
    [hover, scene, selectedIds],
  )
  const hoverHalos = useMemo(() => {
    if (!hover || selectedIds.has(hover.key) || hover.key === '["legend"]') return null
    // A point of a cloud: its own halo alone.
    if (hover.cloud) return [hover.cloud]
    const marks = hoverMarks(hovers, JSON.parse(hover.key) as StylePath)
    const shown = marks.length > HOVER_LIMIT ? marks.filter((n) => n.id === hover.node) : marks
    return shown
  }, [hover, hovers, selectedIds])

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const hit = hitOf(e)
    onSelect(hit ? hitKey(hit.node, hit.target, index.entryOf) : null, hit, e.detail, modsOf(e))
  }

  // The scene and the selection halos don't change while hovering: keep their elements so a
  // hover re-renders only its own halos, however large the graph.
  const body = useMemo(() => <NodeEl node={scene.root} />, [scene])
  const selectionHalos = useMemo(
    () => (match ? haloLayer(scene.root, match, k, others) : null),
    [scene, match, k, others],
  )
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: from the keyboard, Enter / the toolbar open the Format dialogs
    <svg
      className="scene"
      width={scene.width * k}
      height={scene.height * k}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      onClick={onClick}
      onPointerOver={onHover}
      onPointerMove={(e) => {
        // Over a cloud's image the point under the pointer changes as it moves, as along a
        // tree's branch (its legs down to leaves, roadmap 49c); over a background, what is
        // within reach.
        const el = e.target as Element
        const id = el.tagName === 'image' ? null : el.closest('[data-id]')?.getAttribute('data-id')
        const n = id ? index.map.get(id) : undefined
        if (el.tagName === 'image' || n?.tree?.legs?.length) onHover(e)
        else if (!n || isBackground(n.target)) onMoveOverBackground(e)
      }}
      onPointerLeave={() => {
        cancelAnimationFrame(frame.current?.id ?? 0)
        frame.current = null
        setHover(null)
        setMovable(false)
        onHoverNode?.(null)
      }}
      style={movable ? { cursor: 'move' } : undefined}
      onPointerDown={(e) => {
        const hit = hitOf(e)
        if (hit && !isBackground(hit.target)) onPointerDownNode?.(hit, e)
        else if (onPointerDownEmpty) onPointerDownEmpty(e)
        else if (hit) onPointerDownNode?.(hit, e)
      }}
      onDoubleClick={(e) => {
        const hit = hitOf(e)
        if (hit) onDoubleClickNode?.(hit, modsOf(e))
      }}
      onContextMenu={
        onContextMenuNode
          ? (e) => {
              e.preventDefault()
              onContextMenuNode(hitOf(e), e)
            }
          : undefined
      }
      role="img"
      aria-label={label}
    >
      <rect x={0} y={0} width={scene.width} height={scene.height} fill="#ffffff" />
      <RasterScale.Provider value={rasterZoom * PX_PER_PT * pixelRatio()}>
        <RasterView.Provider value={rasterView}>{body}</RasterView.Provider>
      </RasterScale.Provider>
      {preview
        ? preview.length > 0 && (
            <g className="hover preview" pointerEvents="none">
              {preview.map((n) => (
                <Halo key={n.id} p={n.prim!} k={k} light />
              ))}
            </g>
          )
        : hoverHalos &&
          hoverHalos.length > 0 && (
            <g className="hover" pointerEvents="none">
              {hoverHalos.map((n) => (
                <Halo key={n.id} p={n.prim!} k={k} light />
              ))}
            </g>
          )}
      {match && (
        <g className="selection" pointerEvents="none">
          {selectionHalos}
        </g>
      )}
      {hoverLegend && !preview && <LegendOutline box={hoverLegend} k={k} light />}
      {legendHalo.legend && <LegendOutline box={legendHalo.legend} k={k} />}
      {legendHalo.entries.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: boxes of the entries selected, in order
        <EntryOutline key={i} box={b} k={k} />
      ))}
      {overlay}
    </svg>
  )
}
