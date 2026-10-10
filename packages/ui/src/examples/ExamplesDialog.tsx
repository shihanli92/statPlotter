import type { Project } from '@ps/model'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { errorMessage } from '../util.ts'
import { EXAMPLES, type ExampleContext, type ExampleDef, preloadExamples } from './registry.ts'
import { loadThumbnails, type Thumbnails } from './thumbnails.ts'

const SECTIONS: {
  id: ExampleDef['section']
  title: string
  note?: string
  /** The note where there is no local source_data folder (deployed builds). */
  deployedNote?: string
  /** A card's badge when its example names none. */
  badge: string
}[] = [
  { id: 'examples', title: 'Examples', badge: 'Example' },
  {
    id: 'published',
    title: 'Published data',
    note: 'Figures rebuilt from papers’ source data. Apart from the CC BY paper, they read the files in your local source_data folder when the app runs in development, so no paper data is part of the app.',
    deployedNote: 'Figures rebuilt from a paper’s published source data (CC BY 4.0).',
    badge: 'Paper',
  },
  {
    id: 'local',
    title: 'Your data',
    note: 'Built from your own files in the local source_data folder when the app runs in development; none of their data is part of the app.',
    badge: 'Your data',
  },
]

/** The example a new user should open first (roadmap 47): listed first, marked "Start here". */
export const START_HERE = 'getting-started'

/**
 * The card to move to from `from` by an arrow key, among `cards` laid out in rows: ← / → the
 * previous or next in reading order, ↑ / ↓ the nearest in the row above or below (by their
 * centres), Home / End the first or last. Null: no move.
 */
export function nextCard(
  cards: readonly { x: number; y: number }[],
  from: number,
  key: string,
): number | null {
  if (key === 'Home') return cards.length ? 0 : null
  if (key === 'End') return cards.length ? cards.length - 1 : null
  if (key === 'ArrowLeft') return from > 0 ? from - 1 : null
  if (key === 'ArrowRight') return from < cards.length - 1 ? from + 1 : null
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  const at = cards[from]
  if (!at) return null
  const down = key === 'ArrowDown'
  const rows = cards.filter((c) => (down ? c.y > at.y + 1 : c.y < at.y - 1)).map((c) => c.y)
  if (!rows.length) return null
  const row = down ? Math.min(...rows) : Math.max(...rows)
  let best: number | null = null
  cards.forEach((c, i) => {
    if (Math.abs(c.y - row) > 1) return
    if (best === null || Math.abs(c.x - at.x) < Math.abs(cards[best]!.x - at.x)) best = i
  })
  return best
}

/**
 * The example projects as cards (roadmap 47): a thumbnail of one of its graphs (drawn ahead of
 * time, loaded with the dialog), its title, a line saying what it shows and a badge; "Getting
 * started" first, marked "Start here". Arrow keys move across the grid, Enter opens. Opening one
 * replaces the current project.
 */
export function ExamplesDialog({
  context,
  onOpen,
  onClose,
  thumbnails: loadThumbs = loadThumbnails,
}: {
  context: ExampleContext
  onOpen: (project: Project) => void
  onClose: () => void
  /** Where the thumbnails come from (tests). */
  thumbnails?: () => Promise<Thumbnails>
}) {
  const id = useId()
  // Examples that need local files: null while checking, then whether they can be built.
  const [available, setAvailable] = useState<Record<string, boolean | null>>(() =>
    Object.fromEntries(EXAMPLES.map((e) => [e.id, e.available ? null : true])),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Thumbnails>({})
  // The builders load as the dialog shows (audit 2 P6); a failure shows when one is opened.
  useEffect(() => void preloadExamples().catch(() => {}), [])
  useEffect(() => {
    let live = true
    loadThumbs().then(
      (t) => live && setThumbs(t),
      // Placeholders stay.
      () => {},
    )
    return () => {
      live = false
    }
  }, [loadThumbs])
  useEffect(() => {
    let live = true
    for (const e of EXAMPLES) {
      if (!e.available) continue
      e.available(context)
        .catch(() => false)
        .then((ok) => live && setAvailable((a) => ({ ...a, [e.id]: ok })))
    }
    return () => {
      live = false
    }
  }, [context])

  // A build that finishes after the dialog closed opens nothing (audit 2, U13): the user has
  // moved on (another project opened, or the dialog cancelled).
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])
  const open = async (e: ExampleDef) => {
    if (available[e.id] !== true || busy !== null) return
    setBusy(e.id)
    setError(null)
    try {
      const project = await e.build(context)
      if (shown.current) onOpen(project)
    } catch (err) {
      if (shown.current) setError(`Couldn’t build “${e.title}”: ${errorMessage(err)}`)
    } finally {
      if (shown.current) setBusy(null)
    }
  }

  // Audit 3 (A9): every card is in the tab order (there are few; arrow keys alone, with nothing
  // saying so, hid the rest); the arrows still move across the grid.
  const grid = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cards = [...(grid.current?.querySelectorAll<HTMLElement>('.example-card') ?? [])]
    const from = cards.indexOf(e.target as HTMLElement)
    if (from < 0) return
    const to = nextCard(
      cards.map((c) => {
        const r = c.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top }
      }),
      from,
      e.key,
    )
    if (to === null) return
    e.preventDefault()
    cards[to]!.focus()
  }

  const sections = SECTIONS.map((s) => {
    // Examples that need local files are left out where there can be none.
    const items = EXAMPLES.filter(
      (e) => e.section === s.id && (context.localSourceData || !e.available),
    ).sort((a, b) => Number(b.id === START_HERE) - Number(a.id === START_HERE))
    return { ...s, items }
  }).filter((s) => s.items.length)

  return (
    <Dialog
      title="Examples"
      onClose={onClose}
      wide
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys between the cards */}
      <div ref={grid} className="examples-grid-host" onKeyDown={onKey}>
        {sections.map((s) => {
          const note = context.localSourceData ? s.note : (s.deployedNote ?? s.note)
          return (
            <section key={s.id} className="examples-section" aria-labelledby={`${id}-${s.id}`}>
              <h3 id={`${id}-${s.id}`}>{s.title}</h3>
              {note && <p className="muted">{note}</p>}
              <ul className="examples-grid">
                {s.items.map((e) => {
                  const ok = available[e.id]
                  const thumb = thumbs[e.id]
                  const start = e.id === START_HERE
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        className={`example-card${start ? ' start' : ''}`}
                        aria-disabled={ok !== true || busy !== null || undefined}
                        aria-labelledby={`${id}-${e.id}-t`}
                        aria-describedby={[
                          start ? `${id}-start` : '',
                          `${id}-${e.id}-d`,
                          `${id}-${e.id}-b`,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={e.description}
                        data-example={e.id}
                        onClick={() => void open(e)}
                      >
                        <span className={`example-thumb${thumb ? '' : ' none'}`} aria-hidden="true">
                          {thumb ? (
                            <img src={thumb} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <span className="example-thumb-none">
                              {e.available ? 'Built from local files' : ''}
                            </span>
                          )}
                          {busy === e.id && <span className="example-busy">Building…</span>}
                        </span>
                        <span className="example-title" id={`${id}-${e.id}-t`}>
                          {e.title}
                        </span>
                        <span className="example-summary" id={`${id}-${e.id}-d`}>
                          {e.summary ?? e.description}
                          {ok === false && ' (Needs its files in the local source_data folder.)'}
                          {ok === null && ' (Checking…)'}
                        </span>
                        <span className="example-tags">
                          <span className="example-badge" id={`${id}-${e.id}-b`}>
                            {e.badge ?? s.badge}
                          </span>
                          {start && (
                            <span className="example-start" id={`${id}-start`}>
                              Start here
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
      {error && <div className="error-text">{error}</div>}
      <p className="muted">Opening an example replaces the current project.</p>
    </Dialog>
  )
}
