import type { Change } from '@ps/engine'
import type { DataTable, DocNode, NodeId, Project } from '@ps/model'

// Roadmap 47 (UX findings N8, N9): the getting-started checklist's model. Five steps, each ticked
// off by watching what happens: the document (a table with values, a graph, an analysis), its
// changes (a format edit: an existing graph or page changed by a step that adds nothing) and the
// figure exporter (an export or copy finished). Ticks stay ticked for the project's session.
// Whether the card shows: on a project that started empty (a new one, not a file with sheets or
// an example), until hidden with × (remembered in localStorage); Help › Getting started shows it
// again on any project.

export type StepId = 'data' | 'graph' | 'analysis' | 'format' | 'export'

export interface StepDef {
  id: StepId
  title: string
  /** What the step's "Show me" does, for its accessible name and tooltip. */
  hint: string
}

/** The steps, in order. */
export const STEPS: readonly StepDef[] = [
  { id: 'data', title: 'Enter or import data', hint: 'Make a data table (or import a file)' },
  { id: 'graph', title: 'Make a graph', hint: 'Make a graph of a data table' },
  { id: 'analysis', title: 'Run an analysis', hint: 'Analyze a data table' },
  { id: 'format', title: 'Format something', hint: 'Open the Format panel on a graph' },
  { id: 'export', title: 'Export a graph', hint: 'Export a graph as a figure' },
]

export type Ticks = Readonly<Record<StepId, boolean>>

export const NO_TICKS: Ticks = {
  data: false,
  graph: false,
  analysis: false,
  format: false,
  export: false,
}

/** Whether a table holds at least one value (a number or a text variable's entry). */
export function tableHasValues(t: DataTable): boolean {
  const filled = (vs: readonly unknown[]) => vs.some((v) => v !== null && v !== undefined)
  if (t.x?.subcolumns.some((c) => filled(c.values))) return true
  return t.dataSets.some(
    (d) => (d.text && filled(d.text)) || d.subcolumns.some((c) => filled(c.values)),
  )
}

/** The steps the document shows done: a table with values, a graph, an analysis. */
export function documentTicks(project: Pick<Project, 'nodes'>): Partial<Record<StepId, true>> {
  const out: Partial<Record<StepId, true>> = {}
  for (const n of Object.values(project.nodes)) {
    if (n.kind === 'table' && !out.data && tableHasValues(n)) out.data = true
    else if (n.kind === 'graph') out.graph = true
    else if (n.kind === 'analysis') out.analysis = true
  }
  return out
}

/** Ticks with more ticked (never unticked). */
export function tickMore(t: Ticks, more: Partial<Record<StepId, boolean>>): Ticks {
  let out = t
  for (const id of Object.keys(more) as StepId[])
    if (more[id] && !out[id]) out = { ...out, [id]: true }
  return out
}

/** A node's fields other than its name, compared by identity (document objects are immutable). */
function sameButName(a: DocNode, b: DocNode): boolean {
  const ka = Object.keys(a).filter((k) => k !== 'name')
  const kb = Object.keys(b).filter((k) => k !== 'name')
  if (ka.length !== kb.length) return false
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  return ka.every((k) => ra[k] === rb[k])
}

/**
 * Whether a change is a format edit: a step (not an undo, redo or reset) that changed an existing
 * graph or layout page other than its name, and added no sheet (making an analysis or a graph
 * isn't formatting, even when it adds to a graph). The format bar, the Format panel and dialogs,
 * the painter, drags on the canvas and Insert's lines all count.
 */
export function isFormatEdit(before: Project, after: Project, change: Change): boolean {
  if (change.kind !== 'dispatch' || change.touched === 'all') return false
  let formatted = false
  for (const id of change.touched as ReadonlySet<NodeId>) {
    const a = before.nodes[id]
    const b = after.nodes[id]
    if (!b) continue
    // A sheet added: not a format edit, whatever else changed.
    if (!a) return false
    if ((b.kind === 'graph' || b.kind === 'layout') && a !== b && !sameButName(a, b))
      formatted = true
  }
  return formatted
}

/** How many steps are done. */
export const doneCount = (t: Ticks): number => STEPS.filter((s) => t[s.id]).length

// ---- Persistence ---------------------------------------------------------------------------------

/** localStorage: 'hidden' (× pressed), 'collapsed' (shown folded), absent (shown open). */
export const GETTING_STARTED_KEY = 'ps.gettingStarted'

export type CardPref = 'open' | 'collapsed' | 'hidden'

export function readCardPref(storage: Pick<Storage, 'getItem'> | null = safeStorage()): CardPref {
  try {
    const v = storage?.getItem(GETTING_STARTED_KEY)
    return v === 'hidden' || v === 'collapsed' ? v : 'open'
  } catch {
    return 'open'
  }
}

export function writeCardPref(
  pref: CardPref,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage(),
): void {
  try {
    if (pref === 'open') storage?.removeItem(GETTING_STARTED_KEY)
    else storage?.setItem(GETTING_STARTED_KEY, pref)
  } catch {}
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}
