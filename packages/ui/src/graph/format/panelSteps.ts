import type { Change } from '@ps/engine'
import type { Project } from '@ps/model'

/** What the panel needs of the document store (a `DocumentStore`). */
export interface StepStore {
  getState(): Project
  undo(): boolean
  readonly historyLength: { undo: number; redo: number }
  subscribe(fn: (state: Project, change: Change) => void): () => void
}

/**
 * Roadmap 46: the undo steps the docked Format panel made since its scope (the selection it
 * formats) began, for its Revert button. The panel writes straight to the document, one step per
 * change, quick repeats of one field merged (`DocumentStore.dispatch`'s `coalesce`); Revert undoes
 * those steps, and only while they are the last ones made: a step made elsewhere (a drag, a menu
 * command, a dialog's OK) leaves nothing to revert; an undo or redo of some of them is followed.
 *
 * The steps are known by the undo history's depth: `base` before the scope's first step, `top`
 * after its last; Revert undoes down to `base`. A full history (`HISTORY_STEPS`) drops its oldest
 * step as each one comes, so a new step there looks merged and Revert would undo fewer: never more.
 */
export class PanelSteps {
  /** The scope the steps belong to (the selection's key). */
  private scope: string | null = null
  /** Bumped per scope: coalescing keys never merge a step into another scope's. */
  private serial = 0
  private base: number | null = null
  private top = 0
  /** A change of the panel's own is being made (the store's notices of it are not foreign). */
  private running = false

  constructor(private readonly store: StepStore) {}

  /** Follows the document: a step made elsewhere ends what Revert can take back. */
  attach(): () => void {
    return this.store.subscribe((_, change) => {
      if (!this.running && (change.kind === 'dispatch' || change.kind === 'reset')) this.base = null
    })
  }

  /** Starts a new scope (the selection changed): earlier steps are no longer the panel's. */
  begin(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.serial++
    this.base = null
  }

  /** The coalescing key of a change of `field` in this scope (field + selection, decision 883). */
  key(field: string): string {
    return `format:${this.serial}:${this.scope ?? ''}:${field}`
  }

  private get depth(): number {
    return this.store.historyLength.undo
  }

  /** Runs one change of the panel (`dispatch`, which may throw) and records its step. */
  run(dispatch: () => void): void {
    const before = this.store.getState()
    const d0 = this.depth
    this.running = true
    try {
      dispatch()
    } finally {
      this.running = false
    }
    if (this.store.getState() === before) return
    const d1 = this.depth
    // The scope's first step (a merged one: into the step just below, the panel's own).
    if (this.base === null) this.base = d1 > d0 ? d0 : d0 - 1
    this.top = d1
  }

  /** How many steps Revert would undo now (0: nothing to revert). */
  get count(): number {
    if (this.base === null) return 0
    const d = this.depth
    return d > this.base && d <= this.top ? d - this.base : 0
  }

  /** Undoes every step the panel made in this scope; returns how many it undid. */
  revert(): number {
    const n = this.count
    let undone = 0
    while (undone < n && this.store.undo()) undone++
    return undone
  }
}
