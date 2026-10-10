import {
  type NodeId,
  nodeById,
  type Project,
  ProjectSettings,
  projectIssues,
  type RowArrayKind,
  rowArraysOf,
  storedNodeIssues,
  tableIssues,
} from '@ps/model'
import { enablePatches, type Patch } from 'immer'
import { cellEditPatches } from './cellEdits.ts'
import { applyCommand, type Command, CommandError, type CommandType } from './commands.ts'
import {
  applyDocPatches,
  compactRowPatches,
  type DocPatch,
  docImmer,
  freezeDoc,
  patchCells,
} from './docPatches.ts'
import { rowEditPatches } from './rowEdits.ts'
import { splitFollowUps } from './splitSets.ts'

enablePatches()

/** The commands applied to a document under the store's Immer: next state and patches. */
export function produceCommands(
  state: Project,
  commands: readonly Command[],
): [Project, Patch[], Patch[]] {
  const [next, patches, inverse] = docImmer.produceWithPatches(state, (draft) => {
    for (const cmd of commands) applyCommand(draft as Project, cmd)
  })
  return [next, patches, inverse]
}

export interface HistoryEntry {
  label: string
  /** The commands applied (kept only by stores that replay them: `DraftStore`). */
  commands?: Command[]
  /** Roadmap 45: the step's coalescing key and when it last grew (`DispatchOptions.coalesce`). */
  coalesce?: { key: string; at: number }
  patches: DocPatch[]
  inverse: DocPatch[]
  /** About how many values its patches hold (`patchCells`), for the history's size bound. */
  cells: number
}

/**
 * Audit 2 (M1, decision 670): the undo history keeps at most this many steps, and drops its
 * oldest steps while its patches hold more than `HISTORY_CELLS` values (about 1.2 GB of
 * numbers; the newest step is always kept). Row inserts and deletes of large tables hold only
 * the rows that changed (`compactRowPatches`), so they count little; a table imported, deleted,
 * sorted or converted counts its cells.
 */
export const HISTORY_STEPS = 200
export const HISTORY_CELLS = 1.5e8

export interface HistoryOptions {
  /** At most this many undo steps (default `HISTORY_STEPS`). */
  steps?: number
  /** At most about this many values in the steps' patches (default `HISTORY_CELLS`). */
  cells?: number
  /** Keep each step's commands (for replaying them: `DraftStore`). */
  keepCommands?: boolean
  /** The clock coalescing steps reads (milliseconds; default `Date.now`), for tests. */
  now?: () => number
}

/**
 * Roadmap 45: a step dispatched with a `coalesce` key merges into the last one when that one has
 * the same key, was made less than this long ago (from its latest part) and nothing came between
 * (no other step, undo or redo): A↑ pressed five times, a colour dragged across a picker.
 */
export const COALESCE_MS = 1500

export interface DispatchOptions {
  /**
   * Merge into the previous step when it has the same key and is recent (`COALESCE_MS`): one undo
   * step for quick repeats of the same change on the same things. Undoing it restores the state
   * before the first of them.
   */
  coalesce?: string
}

export interface Change {
  kind: 'dispatch' | 'undo' | 'redo' | 'reset'
  /** Nodes whose content changed, or 'all' after a reset. */
  touched: ReadonlySet<NodeId> | 'all'
}

export type Listener = (state: Project, change: Change) => void

const LABELS: Record<CommandType, string> = {
  'project.setSettings': 'Change settings',
  'node.add': 'Add',
  'node.remove': 'Delete',
  'node.rename': 'Rename',
  'node.move': 'Move',
  'node.replace': 'Change',
  'folder.add': 'New folder',
  'folder.rename': 'Rename folder',
  'folder.remove': 'Delete folder',
  'folder.move': 'Move folder',
  'folder.file': 'Move to folder',
  'info.setField': 'Edit info',
  'info.setFields': 'Edit info',
  'info.setNotes': 'Edit notes',
  'table.setCells': 'Edit cells',
  'table.setText': 'Edit cells',
  'table.setVariableType': 'Change variable type',
  'table.setFormula': 'Edit formula',
  'table.setExcluded': 'Exclude values',
  'table.insertRows': 'Insert rows',
  'table.deleteRows': 'Delete rows',
  'table.setRowTitle': 'Edit row title',
  'table.showRowTitles': 'Row titles',
  'table.setCellsTable': 'Cells table',
  'table.setLimits': 'Limits',
  'table.addDataSet': 'Add column',
  'table.removeDataSets': 'Delete columns',
  'table.swapXY': 'Swap X and Y',
  'table.renameDataSet': 'Rename column',
  'table.renameX': 'Rename X column',
  'table.moveDataSets': 'Move columns',
  'table.permuteRows': 'Reorder rows',
  'table.setDisplay': 'Format column',
  'table.setColumnWidths': 'Resize column',
  'table.setSubcolumnTitle': 'Rename subcolumn',
  'table.setReplicateCount': 'Change subcolumns',
  'table.setYFormat': 'Change table format',
  'analysis.setParams': 'Change analysis parameters',
  'analysis.setInput': 'Change analyzed data sets',
  'node.set': 'Change format',
  'graph.addLayer': 'Add layer',
  'graph.removeLayer': 'Delete layer',
  'graph.moveLayer': 'Move layer',
  'graph.setLayers': 'Change layers',
}

/** Every command type (the tests generate commands of each, so a new one is tested). */
export const COMMAND_TYPES = Object.keys(LABELS) as readonly CommandType[]

/**
 * Commands that only change cell contents. They check every value they write, so the result only
 * needs the table's (cheap) shape invariants, not a schema parse of every cell.
 */
const CELL_COMMANDS: ReadonlySet<CommandType> = new Set([
  'table.setCells',
  'table.setExcluded',
  'table.setText',
])

const StrictSettings = ProjectSettings.strict()

function touchedBy(patches: readonly DocPatch[]): Set<NodeId> {
  const out = new Set<NodeId>()
  for (const p of patches) {
    if (p.path[0] === 'nodes' && p.path.length >= 2) out.add(p.path[1] as NodeId)
  }
  return out
}

/**
 * The undoable document. Every change goes through dispatch → Immer patches, validated before it
 * is committed; an invalid result throws CommandError and leaves the state untouched.
 */
export class DocumentStore {
  private state: Project
  protected undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private listeners = new Set<Listener>()
  private revision = 0
  private savedRevision = 0
  private readonly limits: Required<Omit<HistoryOptions, 'now'>>
  private readonly now: () => number
  /**
   * The last step may take a coalesced one (roadmap 45): false once anything else happened since
   * it was made (an undo, a redo, a reset).
   */
  private open = false

  constructor(initial: Project, history: HistoryOptions = {}) {
    this.state = freezeDoc(initial)
    this.limits = {
      steps: history.steps ?? HISTORY_STEPS,
      cells: history.cells ?? HISTORY_CELLS,
      keepCommands: history.keepCommands ?? false,
    }
    this.now = history.now ?? Date.now
  }

  getState(): Project {
    return this.state
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * Applies one or more commands as a single undo step (merged into the last step when `opts`
   * says so and it qualifies: `DispatchOptions.coalesce`).
   */
  dispatch(commands: Command | Command[], label?: string, opts: DispatchOptions = {}): void {
    const given = Array.isArray(commands) ? commands : [commands]
    if (given.length === 0) return
    // Cell edits patch the cells alone (roadmap 34e), row inserts and deletes the rows (audit 2,
    // M2); everything else goes through Immer.
    const fast = cellEditPatches(this.state, given) ?? rowEditPatches(this.state, given)
    let next: Project
    let patches: DocPatch[]
    let inverse: DocPatch[]
    if (fast) [next, patches, inverse] = [fast.next, fast.patches, fast.inverse]
    else {
      const [after, fwd, back] = produceCommands(this.state, given)
      next = after
      // Row inserts and deletes of large tables: the rows, not the arrays (audit 2, M1).
      ;[patches, inverse] = compactRowPatches(fwd, back)
    }
    if (patches.length === 0) return
    // Sets of split graphs follow their table (roadmap 34d): a new level's graph comes in the same
    // undo step as the edit that made the level.
    const follow = splitFollowUps(this.state, next)
    if (follow.length) {
      const [after, more, back] = produceCommands(next, follow)
      next = after
      patches = [...patches, ...more]
      inverse = [...back, ...inverse]
    }

    const touched = touchedBy(patches)
    this.validate(next, touched, {
      cellsOnly: !follow.length && given.every((c) => CELL_COMMANDS.has(c.type)),
      settings: patches.some((p) => p.path[0] === 'settings'),
      derived: fast && 'derived' in fast ? fast.derived : undefined,
    })

    const labelled = label ?? LABELS[given[0]!.type]
    const now = this.now()
    const key = opts.coalesce
    const top = this.undoStack.at(-1)
    const cmds = this.limits.keepCommands ? [...given, ...follow] : undefined
    if (
      key !== undefined &&
      this.open &&
      top?.coalesce?.key === key &&
      now - top.coalesce.at >= 0 &&
      now - top.coalesce.at < COALESCE_MS
    ) {
      // One step: this change's patches after the last one's, its inverse before.
      const merged = [...top.patches, ...patches]
      const back = [...inverse, ...top.inverse]
      this.undoStack[this.undoStack.length - 1] = {
        label: labelled,
        ...(cmds ? { commands: [...(top.commands ?? []), ...cmds] } : {}),
        patches: merged,
        inverse: back,
        cells: top.cells + patchCells(patches) + patchCells(inverse),
        coalesce: { key, at: now },
      }
    } else
      this.undoStack.push({
        label: labelled,
        ...(cmds ? { commands: cmds } : {}),
        patches,
        inverse,
        cells: patchCells(patches) + patchCells(inverse),
        ...(key !== undefined ? { coalesce: { key, at: now } } : {}),
      })
    this.open = true
    this.redoStack = []
    this.trimHistory()
    this.setState(freezeDoc(next), { kind: 'dispatch', touched })
  }

  /** Drops the oldest undo steps beyond the history's bounds (the newest always stays). */
  private trimHistory() {
    const { steps, cells } = this.limits
    let total = 0
    for (const e of this.undoStack) total += e.cells
    let drop = 0
    while (
      this.undoStack.length - drop > 1 &&
      (this.undoStack.length - drop > steps || total > cells)
    ) {
      total -= this.undoStack[drop]!.cells
      drop++
    }
    if (drop) this.undoStack.splice(0, drop)
  }

  /** How many steps can be undone and redone. */
  get historyLength(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length }
  }

  undo(): boolean {
    return this.step('undo', this.undoStack, this.redoStack)
  }

  redo(): boolean {
    return this.step('redo', this.redoStack, this.undoStack)
  }

  /** Moves the last entry of `from` to `to`, applying its inverse (undo) or its patches (redo). */
  private step(kind: 'undo' | 'redo', from: HistoryEntry[], to: HistoryEntry[]): boolean {
    const entry = from.pop()
    if (!entry) return false
    this.open = false
    to.push(entry)
    const patches = kind === 'undo' ? entry.inverse : entry.patches
    this.setState(applyDocPatches(this.state, patches), { kind, touched: touchedBy(patches) })
    return true
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null
  }

  /**
   * Replaces the document (e.g. after opening a file) and clears history. `unsaved`: the
   * document differs from its file (a recovered copy), so it starts dirty.
   */
  reset(project: Project, opts: { unsaved?: boolean } = {}): void {
    this.undoStack = []
    this.redoStack = []
    this.open = false
    this.revision = 0
    this.savedRevision = opts.unsaved ? -1 : 0
    this.state = freezeDoc(project)
    this.emit({ kind: 'reset', touched: 'all' })
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision
  }

  markSaved(): void {
    this.savedRevision = this.revision
  }

  /**
   * Checks a change's result before it is committed (the state it starts from is valid: a parsed
   * file, a new project, or the result of changes checked here). `derived`: per-row arrays a
   * row command made from arrays of the state, each with its source.
   */
  private validate(
    next: Project,
    touched: Set<NodeId>,
    opts: { cellsOnly: boolean; settings: boolean; derived?: ReadonlyMap<unknown, unknown> },
  ) {
    const problems: string[] = []
    const report = (
      prefix: string,
      issues: readonly { path: readonly PropertyKey[]; message: string }[],
    ) => {
      for (const i of issues) problems.push(`${prefix}${i.path.join('.')}: ${i.message}`)
    }
    for (const id of touched) {
      const node = nodeById(next.nodes, id)
      if (!node) continue
      if (opts.cellsOnly && node.kind === 'table') report(`${id}.`, tableIssues(node))
      // Audit 2 (M14): every field held (no defaults to fill), parameters plain JSON.
      else report(`${id}.`, storedNodeIssues(node, this.checkedRows(id, opts.derived)))
    }
    if (opts.settings)
      report('settings.', StrictSettings.safeParse(next.settings).error?.issues ?? [])
    // Cell edits can't change references, ids, or the navigator order.
    if (!opts.cellsOnly) report('', projectIssues(next))
    if (problems.length) throw new CommandError(`invalid change:\n  ${problems.join('\n  ')}`)
  }

  /**
   * Audit 2 (M2): the per-row arrays of node `id` as it stands, by kind, and those a row command
   * made from them: checked when they were stored (nothing writes them in place, decision 674),
   * so an edit of the table that leaves them (a rename, a column width) or only takes rows out or
   * puts empty ones in checks none of its cells again.
   */
  private checkedRows(id: NodeId, derived?: ReadonlyMap<unknown, unknown>) {
    const before = nodeById(this.state.nodes, id)
    const known = before?.kind === 'table' ? rowArraysOf(before) : new Map<unknown, RowArrayKind>()
    for (const [made, from] of derived ?? []) {
      const kind = known.get(from)
      if (kind) known.set(made, kind)
    }
    return known
  }

  private setState(next: Project, change: Change) {
    this.state = next
    // Undo/redo move the revision too, so undoing back to the saved state isn't "clean" by
    // accident; simple and conservative.
    this.revision += 1
    this.emit(change)
  }

  private emit(change: Change) {
    for (const fn of this.listeners) fn(this.state, change)
  }
}
