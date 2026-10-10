import type { StylePath } from '@ps/graph'
import type { GraphNode } from '@ps/model'
import { type Selection, type SelKey, selectionOf } from './selection.ts'

// Audit 3 (U2): a graph's annotations are selected by their index in `graph.annotations` (the
// scene's targets and the edits' paths are indices), but held by their ids, as a page's items
// are (decision 691): an undo, a removal or an insertion before the selected annotation never
// moves the selection to another one. The views keep the held form in their state and derive the
// index form each render (`placeAnnotations`); every selection they set is held first
// (`holdAnnotations`).

/** The head of a held annotation path: `[HELD, id, …rest]` for `['annotations', index, …rest]`. */
const HELD = 'annotation#'

type Annotations = GraphNode['annotations']

/** The annotations of the graph a key is in (undefined: not a graph's element). */
export type AnnotationsOf = (key: SelKey) => Annotations | undefined

const pathOf = (k: SelKey): StylePath | null => (k.kind === 'item' ? null : k.path)
const withPath = (k: SelKey, path: StylePath): SelKey =>
  k.kind === 'item' || k.path === path ? k : { ...k, path }

/** An annotation path by its id (others as they are). */
export function holdAnnotationPath(p: StylePath, annotations: Annotations): StylePath {
  if (p[0] !== 'annotations' || p.length < 2) return p
  const a = annotations[Number(p[1])]
  return a ? [HELD, a.id, ...p.slice(2)] : p
}

/** A held annotation path by its index now; null when the annotation is gone. */
export function placeAnnotationPath(p: StylePath, annotations: Annotations): StylePath | null {
  if (p[0] !== HELD) return p
  const i = annotations.findIndex((a) => a.id === p[1])
  return i < 0 ? null : ['annotations', i, ...p.slice(2)]
}

/** The selection with its annotation keys held by id (the same object when it has none). */
export function holdAnnotations(s: Selection, of: AnnotationsOf): Selection {
  return mapKeys(s, (k) => {
    const p = pathOf(k)
    const list = p && of(k)
    return p && list ? withPath(k, holdAnnotationPath(p, list)) : k
  })
}

/**
 * The selection with its held annotation keys at their indices now: keys of annotations gone
 * left out (the primary staying if it is kept, else the last key left). The same object when it
 * holds no annotation.
 */
export function placeAnnotations(s: Selection, of: AnnotationsOf): Selection {
  return mapKeys(s, (k) => {
    const p = pathOf(k)
    if (!p || p[0] !== HELD) return k
    const placed = placeAnnotationPath(p, of(k) ?? [])
    return placed ? withPath(k, placed) : null
  })
}

function mapKeys(s: Selection, f: (k: SelKey) => SelKey | null): Selection {
  let changed = false
  const mapped = s.keys.map((k) => {
    const m = f(k)
    if (m !== k) changed = true
    return m
  })
  if (!changed) return s
  const primary = mapped[s.primary] ?? null
  const keys = mapped.filter((k): k is SelKey => k !== null)
  return selectionOf(keys, primary ?? undefined, primary ? s.drill : undefined)
}
