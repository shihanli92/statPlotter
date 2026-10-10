import {
  Fragment,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ExpandSections, LiveFields } from '../../components/fields.tsx'
import type { PanelContext } from '../inspector/context.ts'
import { sameTarget } from './formatHost.ts'
import type { FormatTarget } from './route.ts'
import {
  harvestFields,
  jumpTarget,
  type RevealResult,
  revealField,
  type SearchEntry,
  type SearchPlace,
  type SearchResult,
  searchFields,
  searchPlaces,
} from './search.ts'
import { FormatSections } from './sections.tsx'

// Roadmap 46 (UX review V5): the search box of the Format panel's header (and the dialog's): a
// combobox over a listbox of the graph's fields ("Y axis › Numbers › Thousands separators"),
// read off a rendering of every place (`search.ts`). ↑ / ↓ move, Enter jumps (the element
// selected, its place shown, the field focused and highlighted), Escape clears.

const noop = () => {}

/** One option of the list: a result, or one of the layers of a result of several. */
interface SearchOption {
  result: SearchResult
  entry: SearchEntry
}

/** The results' options in order: a result of several layers gives one per layer. */
export const optionsOf = (results: readonly SearchResult[]): SearchOption[] =>
  results.flatMap((result) => (result.layers ?? [result.entry]).map((entry) => ({ result, entry })))

/**
 * Every place of the graph rendered where nobody sees it (a portal into an element outside the
 * document, every section open, writes going nowhere), its fields read once it has rendered.
 */
function SearchIndexer({
  ctx,
  places,
  onIndex,
}: {
  ctx: PanelContext
  places: readonly SearchPlace[]
  onIndex: (entries: SearchEntry[]) => void
}) {
  const [box] = useState(() => document.createElement('div'))
  const quiet: PanelContext = {
    ...ctx,
    set: noop,
    dispatch: noop,
    onSelect: noop,
    onError: noop,
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, as it renders
  useLayoutEffect(() => {
    const entries = places.flatMap((place, i) => {
      const root = box.querySelector(`[data-search-place="${i}"]`)
      return root ? harvestFields(root, place) : []
    })
    onIndex(entries)
  }, [])
  return createPortal(
    <ExpandSections.Provider value={true}>
      <LiveFields.Provider value={true}>
        {places.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: places are positional here
          <div key={i} data-search-place={i}>
            <FormatSections ctx={quiet} target={p.target} setTarget={noop} />
          </div>
        ))}
      </LiveFields.Provider>
    </ExpandSections.Provider>,
    box,
  )
}

/**
 * A field to reveal once its place is shown: `jump(entry)` waits for the shell's target to be
 * the entry's, then opens its section if collapsed and focuses it (`revealField`).
 */
export function useFieldReveal(
  root: RefObject<HTMLElement | null>,
  target: FormatTarget,
): (e: SearchEntry) => void {
  const [pending, setPending] = useState<{ entry: SearchEntry; seq: number } | null>(null)
  const seq = useRef(0)
  const shown = JSON.stringify(target)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target compared by value
  useEffect(() => {
    if (!pending || !sameTarget(jumpTarget(pending.entry), target)) return
    let frames = 0
    let raf = 0
    const tick = () => {
      const r: RevealResult = revealField(root.current, pending.entry)
      if (r === 'retry' && frames++ < 20) raf = requestAnimationFrame(tick)
      else setPending(null)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [pending, shown])
  return (entry) => setPending({ entry, seq: ++seq.current })
}

/** The search box with its results. `current`: the place shown (its data set is searched). */
export function FormatSearch({
  ctx,
  current,
  onJump,
}: {
  ctx: PanelContext
  current: FormatTarget
  onJump: (e: SearchEntry) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [index, setIndex] = useState<{ key: unknown[]; entries: SearchEntry[] } | null>(null)
  // The index follows the graph (and the data set shown); built when there is a query.
  const key = [ctx.graph, ctx.project, ctx.lookup, JSON.stringify(current)]
  const fresh = !!index && index.key.every((k, i) => k === key[i])
  const places = query.trim() && !fresh ? searchPlaces(ctx, current) : []
  const results = index && query.trim() ? searchFields(index.entries, query) : []
  // Roadmap 47: the options, a result of several layers giving one per layer (in its row).
  const options = optionsOf(results)
  const open = !!query.trim() && options.length > 0
  const at = Math.min(active, Math.max(0, options.length - 1))
  const optionId = (i: number) => `${id}-r${i}`
  useEffect(() => {
    if (open) document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' })
  })

  const choose = (i: number) => {
    const o = options[i]
    if (!o) return
    setQuery('')
    setActive(0)
    onJump(o.entry)
  }
  return (
    <div className="format-search">
      <input
        type="text"
        role="combobox"
        className="format-search-input"
        aria-label="Search the Format options"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? optionId(at) : undefined}
        placeholder="Search options (e.g. thousands)"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (options.length)
              setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
          } else if (e.key === 'Enter') {
            // Never the dialog's OK.
            e.preventDefault()
            choose(at)
          } else if (e.key === 'Escape' && query) {
            // Clears; a second Escape leaves the panel as from any field.
            e.preventDefault()
            setQuery('')
            setActive(0)
          }
        }}
      />
      {open && (
        <div
          id={`${id}-list`}
          className="format-search-results"
          role="listbox"
          aria-label="Matching options"
        >
          {results.map((r) => {
            const first = options.findIndex((o) => o.result === r)
            const option = (i: number, label: string, text: ReactNode, cls?: string) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox's keys choose
              <span
                key={i}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={i === at}
                aria-label={label}
                className={[cls, i === at ? 'active' : ''].filter(Boolean).join(' ') || undefined}
                // The focus stays in the box until a result is chosen.
                onMouseDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(i)}
                onClick={(e) => {
                  e.stopPropagation()
                  choose(i)
                }}
              >
                {text}
              </span>
            )
            const key = `${r.path}|${r.entry.label}|${r.entry.nth}|${r.entry.section}`
            if (!r.layers)
              return option(
                first,
                `${r.path} › ${r.entry.label}`,
                <>
                  <span className="format-search-path">{r.path} › </span>
                  <span className="format-search-label">{r.entry.label}</span>
                </>,
                'format-search-row',
              )
            // One row naming its layers, each an option (the front-most first).
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox's keys choose
              // biome-ignore lint/a11y/useSemanticElements: a listbox's group of options
              <div
                key={key}
                role="group"
                aria-label={`${r.path} › ${r.entry.label}, in ${r.layers.length} layers`}
                className={`format-search-row layers ${
                  options[at]?.result === r ? 'active-row' : ''
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(first)}
              >
                <span className="format-search-path">{r.path} › </span>
                <span className="format-search-label">{r.entry.label}</span>
                <span className="format-search-path"> — </span>
                {r.layers.map((l, j) => (
                  <Fragment key={JSON.stringify(l.target)}>
                    {j > 0 && <span className="format-search-path">, </span>}
                    {option(
                      first + j,
                      `${r.path} › ${r.entry.label} — ${l.layer ?? l.element}`,
                      l.layer ?? l.element,
                      'format-search-layer',
                    )}
                  </Fragment>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {!!query.trim() && fresh && !options.length && (
        <p className="format-search-empty" role="status">
          No options match “{query.trim()}”.
        </p>
      )}
      {places.length > 0 && (
        <SearchIndexer
          ctx={ctx}
          places={places}
          onIndex={(entries) => setIndex({ key, entries })}
        />
      )}
    </div>
  )
}
