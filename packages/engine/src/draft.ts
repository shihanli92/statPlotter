import type { Project } from '@ps/model'
import { type Command, copyData } from './commands.ts'
import { DocumentStore, produceCommands } from './store.ts'

/**
 * A scratch copy of the document for a modal editor (the Format dialogs). Commands dispatched to
 * the draft are applied and validated exactly as on the real store, but only the draft changes:
 * listeners of the real document (recompute, autosave, other views) never see the intermediate
 * states. `commit` replays the commands still in effect on the parent as one undo step;
 * discarding is dropping the draft.
 *
 * Replay is exact because commands are serializable data whose values were computed against the
 * draft's state, which starts equal to the parent's. The dialogs using it are modal, so the parent
 * does not change in between; if it did, the replay would still validate against the new state.
 */
export class DraftStore extends DocumentStore {
  private readonly base: Project

  constructor(private readonly parent: DocumentStore) {
    // Every step, with its commands: they are what `commit` replays.
    super(parent.getState(), { steps: Infinity, cells: Infinity, keepCommands: true })
    this.base = parent.getState()
  }

  /** Whether the draft's commands change the document it started from (they may cancel out). */
  get changed(): boolean {
    const cmds = this.commands()
    if (!cmds.length || this.getState() === this.base) return false
    const [, patches] = produceCommands(this.base, cmds)
    return patches.length > 0
  }

  /**
   * The commands still in effect (undone ones dropped), in the order they were applied. Copies:
   * values the draft has applied are frozen with its state, and a replay must be able to write
   * inside them.
   */
  commands(): Command[] {
    return copyData(this.undoStack.flatMap((e) => e.commands ?? []))
  }

  /**
   * Applies the draft to the parent as a single undo step labelled `label`. Returns false when
   * there was nothing to apply (no commands, or they cancel out). Throws CommandError, leaving the
   * parent untouched, if the parent rejects the replay.
   */
  commit(label: string): boolean {
    if (!this.changed) return false
    const cmds = this.commands()
    const before = this.parent.getState()
    this.parent.dispatch(cmds, label)
    return this.parent.getState() !== before
  }
}
