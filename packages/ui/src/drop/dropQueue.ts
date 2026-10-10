import {
  type DropOutcome,
  type DropStep,
  type DropTarget,
  dropSteps,
  dropSummary,
  type FileSource,
} from './dropRouter.ts'

// The queue handling dropped files one after another (roadmap 39), as a plain class (audit 2,
// U4): a file that opens a dialog (an import, the image prompt) waits for it to close before the
// next one starts; a file whose handling opened none (an unreadable project) doesn't, so the
// queue never stalls; at the end, a summary.

/** A dropped file: its bytes, and a handle to save to (a project dropped in a browser that gives one). */
export interface DroppedFile {
  name: string
  blob: Blob
  handle: unknown
}

/** Modifier keys held at the drop (roadmap 40: Alt or Shift imports a project into this one). */
export interface DropModifiers {
  alt: boolean
  shift: boolean
}

export const NO_MODS: DropModifiers = { alt: false, shift: false }

/**
 * What handling one file did: its summary line, and whether it opened a dialog to wait for
 * (only when one did open: a failure that opened none must say `waits: false`).
 */
export interface DropHandled {
  outcome: DropOutcome
  waits: boolean
}

/** A step waiting its turn, with how its files came. */
export interface QueuedFiles {
  step: DropStep
  files: DroppedFile[]
  target: DropTarget
  mods: DropModifiers
  source: FileSource
}

export class DropQueue {
  private queue: QueuedFiles[] = []
  private outcomes: DropOutcome[] = []
  private busy = false
  private waiting = false

  constructor(
    private readonly handle: (next: QueuedFiles) => Promise<DropHandled>,
    /** The summary, and whether every file was handled. */
    private readonly onSummary: (text: string, ok: boolean) => void,
  ) {}

  /** Whether a file is waiting for its dialog to close. */
  get waitingForDialog(): boolean {
    return this.waiting
  }

  /** Queues dropped files (images together, as one entry) and starts on them. */
  enqueue(
    files: readonly DroppedFile[],
    target: DropTarget,
    mods: DropModifiers = NO_MODS,
    source: FileSource = 'drop',
  ): void {
    const byName = new Map<string, DroppedFile[]>()
    for (const f of files) byName.set(f.name, [...(byName.get(f.name) ?? []), f])
    const { steps, refused } = dropSteps(files.map((f) => f.name))
    for (const r of refused)
      this.outcomes.push({ name: r.name, result: 'not opened (one project at a time)', ok: false })
    let images: QueuedFiles | null = null
    for (const step of steps) {
      const file = byName.get(step.name)!.shift()!
      if (step.kind === 'image') {
        if (images) images.files.push(file)
        else {
          images = { step, files: [file], target, mods, source }
          this.queue.push(images)
        }
      } else this.queue.push({ step, files: [file], target, mods, source })
    }
    void this.pump()
  }

  /** The dialog a file waited for closed (or none is open): the next one's turn. */
  dialogClosed(): void {
    if (!this.waiting) return
    this.waiting = false
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.busy || this.waiting) return
    const next = this.queue.shift()
    if (!next) {
      const all = this.outcomes
      if (all.length > 1 || all[0]?.notify)
        this.onSummary(
          dropSummary(all),
          all.every((o) => o.ok),
        )
      this.outcomes = []
      return
    }
    this.busy = true
    let done: DropHandled
    try {
      done = await this.handle(next)
    } catch (e) {
      done = {
        outcome: { name: next.step.name, result: `failed (${String(e)})`, ok: false },
        waits: false,
      }
    }
    this.outcomes.push(done.outcome)
    this.busy = false
    if (done.waits) this.waiting = true
    else void this.pump()
  }
}
