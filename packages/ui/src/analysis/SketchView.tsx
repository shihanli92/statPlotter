import { type FontRegistry, layoutGraph, sceneToSvg, sketchGraph } from '@ps/graph'
import type { SketchSpec } from '@ps/model'
import { useId, useMemo } from 'react'

// Roadmap 51b (design §5): the live sketch in the Analyze dialog's side panel — each panel an
// ordinary graph of a transient table laid out by @ps/graph (fonts measured by fontkit) and shown
// as an image; the group is an image with the spec's text alternative, the counts line said
// when the design changes. Never a result: the spec holds data and structure only.

/** One panel's picture (an SVG data URL), or null when it can't be laid out. */
export function panelImage(
  panel: SketchSpec['panels'][number],
  fonts: FontRegistry,
  /** The plot size in points (roadmap 51e: a model's thumbnail is smaller). */
  size?: { width: number; height: number },
): { src: string; width: number; height: number } | null {
  try {
    const { project, graph } = sketchGraph(panel, size)
    const scene = layoutGraph({ project, graph, fonts })
    const svg = sceneToSvg(scene, { background: '#ffffff', portableFonts: true })
    return {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      width: scene.width,
      height: scene.height,
    }
  } catch {
    return null
  }
}

export function SketchView({
  spec,
  fonts,
  stale,
  heading = 'Your data, as it will be analyzed',
}: {
  spec: SketchSpec | null
  fonts: FontRegistry
  /** The options changed and the sketch is catching up (debounced). */
  stale?: boolean
  /** Roadmap 51d: the effect plot of results shows its own heading. */
  heading?: string
}) {
  const id = useId()
  const images = useMemo(
    () => (spec ? spec.panels.map((p) => ({ panel: p, image: panelImage(p, fonts) })) : []),
    [spec, fonts],
  )
  if (!spec) return null
  return (
    <section className={`sketch${stale ? ' stale' : ''}`} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="side-heading">
        {heading}
      </h3>
      {images.length > 0 && (
        <div className="sketch-panels" role="img" aria-describedby={`${id}-desc`}>
          {images.map(({ panel, image }) => (
            <figure key={panel.id} className="sketch-panel" data-panel={panel.id}>
              {panel.title && <figcaption>{panel.title}</figcaption>}
              {image ? (
                <img src={image.src} alt="" width={image.width} height={image.height} />
              ) : (
                <div className="muted">Can’t draw this yet.</div>
              )}
            </figure>
          ))}
        </div>
      )}
      <p id={`${id}-desc`} className="sketch-description visually-hidden">
        {spec.description}
      </p>
      <p className="sketch-caption">{spec.caption}</p>
      <p className="sketch-counts" aria-live="polite">
        {spec.counts}
        {spec.sampled &&
          ` · Showing ${spec.sampled.shown.toLocaleString('en-US')} of ${spec.sampled.total.toLocaleString('en-US')} rows`}
      </p>
      {spec.notes && spec.notes.length > 0 && (
        <ul className="sketch-notes">
          {spec.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
