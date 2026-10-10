import { registry } from '@ps/analyses'
import { type SearchHit, type SearchTarget, searchProject } from '@ps/engine'
import type { NodeId } from '@ps/model'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useDoc } from '../context.tsx'

/** One line of the results: a sheet (its name) or one of its matches. */
interface Line {
  key: string
  node: NodeId
  target: SearchTarget
  hit?: SearchHit
}

const Snippet = ({ hit }: { hit: SearchHit }) => (
  <span className="snippet">
    {hit.before}
    <mark>{hit.match}</mark>
    {hit.after}
  </span>
)

/**
 * Project search's results (roadmap 40): grouped by sheet, best first, each match with its
 * snippet. ↑/↓ in the search box move through them, Enter (or a click) goes there, Escape clears.
 */
export function SearchPanel({
  query,
  inputRef,
  onJump,
  onClear,
}: {
  query: string
  inputRef: RefObject<HTMLInputElement | null>
  onJump: (node: NodeId, target: SearchTarget) => void
  onClear: () => void
}) {
  const project = useDoc((d) => d)
  const results = useMemo(
    () => searchProject(project, query, { analysisTitle: (id) => registry.get(id)?.title }),
    [project, query],
  )
  const lines = useMemo(
    () =>
      results.flatMap((r): Line[] => [
        { key: `${r.node}:sheet`, node: r.node, target: { kind: 'name' } },
        ...r.hits
          .filter((h) => h.target.kind !== 'name')
          .map((hit, i) => ({ key: `${r.node}:${i}`, node: r.node, target: hit.target, hit })),
      ]),
    [results],
  )
  // The active line, back to the first for each new query.
  const [at, setAt] = useState({ query, line: 0 })
  const active = at.query === query ? at.line : 0
  const setActive = (line: number) => setAt({ query, line })
  const list = useRef<HTMLDivElement>(null)
  const latest = useRef({ lines, active, onJump, onClear, setActive })
  latest.current = { lines, active, onJump, onClear, setActive }

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const onKey = (e: KeyboardEvent) => {
      const { lines, active, onJump, onClear, setActive } = latest.current
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.max(
          0,
          Math.min(lines.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)),
        )
        setActive(next)
        list.current?.querySelector(`[data-line="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'Enter') {
        const line = lines[active]
        if (line) {
          e.preventDefault()
          onJump(line.node, line.target)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClear()
      }
    }
    input.addEventListener('keydown', onKey)
    return () => input.removeEventListener('keydown', onKey)
  }, [inputRef])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    if (lines.length) input.setAttribute('aria-activedescendant', `search-line-${active}`)
    else input.removeAttribute('aria-activedescendant')
  }, [inputRef, active, lines.length])

  if (!results.length)
    return (
      <p className="nav-empty" role="status">
        Nothing matches “{query.trim()}”.
      </p>
    )
  let n = -1
  return (
    <div className="nav-results" role="listbox" aria-label="Search results" ref={list}>
      <p className="hint" role="status">
        {results.length} {results.length === 1 ? 'sheet' : 'sheets'}
      </p>
      {results.map((r) => {
        const nameHit = r.hits.find((h) => h.target.kind === 'name')
        n++
        const sheetLine = n
        return (
          // biome-ignore lint/a11y/useSemanticElements: a listbox group
          <div key={r.node} role="group" aria-label={r.name} className="result-group">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the search box's keys choose results */}
            <div
              role="option"
              tabIndex={-1}
              id={`search-line-${sheetLine}`}
              data-line={sheetLine}
              aria-selected={active === sheetLine}
              className={`result-sheet ${active === sheetLine ? 'active' : ''}`}
              onClick={() => onJump(r.node, { kind: 'name' })}
            >
              <span className={`icon icon-${r.kind}`} aria-hidden />
              {nameHit ? <Snippet hit={nameHit} /> : <span className="snippet">{r.name}</span>}
            </div>
            {r.hits
              .filter((h) => h.target.kind !== 'name')
              .map((hit, i) => {
                n++
                const line = n
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the search box's keys choose results
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: matches have no identity
                    key={i}
                    role="option"
                    tabIndex={-1}
                    id={`search-line-${line}`}
                    data-line={line}
                    aria-selected={active === line}
                    className={`result-hit ${active === line ? 'active' : ''}`}
                    onClick={() => onJump(r.node, hit.target)}
                  >
                    <span className="result-label">{hit.label}</span>
                    <Snippet hit={hit} />
                  </div>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
