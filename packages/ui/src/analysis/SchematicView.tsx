import { type FontRegistry, SCHEMATIC_WIDTH, sceneToSvg, schematicScene } from '@ps/graph'
import type { SchematicSpec } from '@ps/model'
import { useEffect, useId, useMemo, useState } from 'react'

// Roadmap 51f: "What will be tested" — the question in the user's names, a schematic of it drawn
// by @ps/graph (groups as boxes, what is compared, comparisons as arrows, the same subjects as
// links, a grid's factors), what "no effect" means, and the notes (the family and its
// correction, the independent units). Never a value of the data, never a result. The picture is
// an image in the dialog's colours; its text alternative is the spec's description.

/** The app's colours as set on the document (`data-theme`). */
const documentTheme = (): 'light' | 'dark' =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light'

/** The app's colours as set on the document, followed as they change. */
export function useDocumentTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(documentTheme)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const o = new MutationObserver(() => setTheme(documentTheme()))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => o.disconnect()
  }, [])
  return theme
}

/** The schematic's picture (an SVG data URL) and its size in CSS pixels; null if it can't be drawn. */
export function schematicImage(
  spec: SchematicSpec,
  fonts: FontRegistry,
  theme: 'light' | 'dark',
  width = SCHEMATIC_WIDTH,
): { src: string; width: number; height: number; svg: string } | null {
  if (!spec.boxes.length) return null
  try {
    const scene = schematicScene(spec, fonts, { theme, width })
    const svg = sceneToSvg(scene, { portableFonts: true })
    return {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      width: scene.width,
      height: scene.height,
      svg,
    }
  } catch {
    return null
  }
}

export function SchematicView({
  spec,
  fonts,
  heading = 'What will be tested',
  compact,
}: {
  spec: SchematicSpec
  fonts: FontRegistry
  /** The heading (null: none, when a disclosure's summary names it). */
  heading?: string | null
  /** A strip above the questions (the dialog's narrow layout): the picture smaller. */
  compact?: boolean
}) {
  const id = useId()
  const theme = useDocumentTheme()
  const image = useMemo(() => schematicImage(spec, fonts, theme), [spec, fonts, theme])
  return (
    <section
      className={`schematic${compact ? ' compact' : ''}`}
      {...(heading ? { 'aria-labelledby': `${id}-h` } : { 'aria-label': 'What will be tested' })}
    >
      {heading && (
        <h3 id={`${id}-h`} className="side-heading">
          {heading}
        </h3>
      )}
      <p className="schematic-question" aria-live="polite">
        {spec.question}
      </p>
      {image && (
        <figure className="schematic-figure" role="img" aria-describedby={`${id}-desc`}>
          <img
            src={image.src}
            alt=""
            width={image.width}
            height={image.height}
            style={{ maxWidth: Math.round(image.width * 1.25) }}
            data-theme={theme}
          />
        </figure>
      )}
      <p id={`${id}-desc`} className="visually-hidden">
        {spec.description}
      </p>
      {spec.noEffect && (
        <p className="schematic-null">
          <span className="schematic-null-label">No effect: </span>
          {spec.noEffect}
        </p>
      )}
      {spec.notes.length > 0 && (
        <ul className="schematic-notes">
          {spec.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {spec.pending && <p className="schematic-pending">{spec.pending}</p>}
    </section>
  )
}
