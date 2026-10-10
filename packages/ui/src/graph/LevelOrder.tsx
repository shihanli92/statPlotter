import {
  graphRows,
  type LevelSort,
  type LevelVariable,
  levelVariables,
  sortLevels,
} from '@ps/graph'
import { type DataTable, type GraphNode, storedLevels } from '@ps/model'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

// "Order of levels…" (roadmap 34a): the order a graph of variables draws a text variable's
// levels in — its categories, its colour groups and their legend — moved one by one (↑ / ↓,
// Alt+↑ / ↓, drag), sorted A→Z, naturally (roadmap 34f), by the mean of the number variable or by
// count, or reset to the graph's default: the order the levels first appear in the table, or
// natural order for graphs made from 34f on (`GraphNode.levelOrder`). Format graph › Data sets and the graph builder show
// it; levels gone from the table keep their place in the stored order, new ones come last.

/**
 * Most levels listed for moving by hand (roadmap 34e: a variable of thousands of levels); the
 * rest are counted, and the sorts still order them all.
 */
export const MAX_LISTED_LEVELS = 100

/** What a graph of variables' level order is read from. */
type LevelGraph = Pick<GraphNode, 'mapping' | 'levels' | 'levelOrder' | 'frame' | 'seriesSource'> &
  Partial<Pick<GraphNode, 'layers'>>

/** Writes a variable's order (null: the table's), with an undo label. */
type LevelOrderChange = (variable: string, order: string[] | null, label: string) => void

/** Every text variable a graph of variables draws the levels of, each with its order. */
export function LevelOrderEditor({
  table,
  graph,
  onChange,
}: {
  table: DataTable
  graph: LevelGraph
  onChange: LevelOrderChange
}) {
  const vars = levelVariables(table, graph, graphRows(graph, table))
  if (!vars.length) return <p className="muted">The graph draws no levels of a text variable.</p>
  return (
    <>
      <div className="level-orders">
        {vars.map((v) => (
          <LevelList key={v.id} table={table} graph={graph} v={v} onChange={onChange} />
        ))}
      </div>
      <p className="muted">
        Alt+↑ / ↓ or drag moves a level. New levels go at the end; levels no longer in the table
        keep their place for when they return.
      </p>
    </>
  )
}

function LevelList({
  table,
  graph,
  v,
  onChange,
}: {
  table: DataTable
  graph: LevelGraph
  v: LevelVariable
  onChange: LevelOrderChange
}) {
  const stored = graph.levels?.[v.id]
  const name = v.title || 'Untitled'
  const [focus, setFocus] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const items = useRef(new Map<string, HTMLLIElement | null>())
  // Focus follows a level moved with the keyboard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus after the order changes
  useEffect(() => {
    if (focus) items.current.get(focus)?.focus()
  }, [v.levels])
  const write = (order: readonly string[], label: string) =>
    onChange(v.id, storedLevels(order, stored), label)
  const moveTo = (t: string, to: number) => {
    const rest = v.levels.filter((x) => x !== t)
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, t)
    if (rest.every((x, i) => x === v.levels[i])) return
    write(rest, `Reorder ${name}`)
  }
  const sort = (by: LevelSort, label: string) =>
    write(sortLevels(table, graph, v.id, v.levels, by), label)
  const onKeyDown = (e: KeyboardEvent, t: string, i: number) => {
    if (e.target !== e.currentTarget) return
    const up = e.key === 'ArrowUp'
    if (!up && e.key !== 'ArrowDown') return
    e.preventDefault()
    if (e.altKey) {
      setFocus(t)
      moveTo(t, i + (up ? -1 : 1))
    } else items.current.get(v.levels[i + (up ? -1 : 1)] ?? '')?.focus()
  }
  const id = `levels-${v.id}`
  return (
    <fieldset className="field level-order">
      <legend id={id}>
        {name} (
        {v.role === 'categories'
          ? 'categories'
          : v.role === 'shapes'
            ? 'symbols and legend'
            : 'colours and legend'}
        )
      </legend>
      <ol className="level-list" aria-labelledby={id}>
        {v.levels.slice(0, MAX_LISTED_LEVELS).map((t, i) => (
          <li
            key={t}
            ref={(el) => {
              items.current.set(t, el)
            }}
            tabIndex={i === 0 ? 0 : -1}
            aria-label={t}
            draggable
            className={dragging === t ? 'dragging' : undefined}
            onKeyDown={(e) => onKeyDown(e, t, i)}
            onDragStart={(e) => {
              setDragging(t)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', t)
            }}
            onDragOver={(e) => dragging && dragging !== t && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragging) moveTo(dragging, i)
              setDragging(null)
            }}
            onDragEnd={() => setDragging(null)}
          >
            <span className="level-name">{t}</span>
            <span className="order">
              <button
                type="button"
                aria-label={`Move ${t} up`}
                disabled={i === 0}
                onClick={() => {
                  setFocus(null)
                  moveTo(t, i - 1)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${t} down`}
                disabled={i === v.levels.length - 1}
                onClick={() => {
                  setFocus(null)
                  moveTo(t, i + 1)
                }}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
        {v.levels.length > MAX_LISTED_LEVELS && (
          <li className="muted">
            … and {(v.levels.length - MAX_LISTED_LEVELS).toLocaleString('en-US')} more (sort them
            below)
          </li>
        )}
      </ol>
      <div className="level-sorts">
        <button type="button" onClick={() => sort('alpha', `Sort ${name} A to Z`)}>
          Sort A→Z
        </button>
        <button
          type="button"
          title="Numbers inside the names by value: C2 before C10"
          onClick={() => sort('natural', `Sort ${name} naturally`)}
        >
          Sort naturally
        </button>
        {v.value && (
          <button
            type="button"
            title={`Lowest mean of ${v.value} first`}
            onClick={() => sort('mean', `Sort ${name} by mean`)}
          >
            Sort by mean
          </button>
        )}
        <button
          type="button"
          title="Most rows first"
          onClick={() => sort('count', `Sort ${name} by count`)}
        >
          Sort by count
        </button>
        <button
          type="button"
          disabled={!stored}
          onClick={() => onChange(v.id, null, `Reset the order of ${name}`)}
        >
          {graph.levelOrder === 'natural' ? 'Reset to natural order' : 'Reset to table order'}
        </button>
      </div>
    </fieldset>
  )
}
