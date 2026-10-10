import type { Change } from '@ps/engine'
import { APP_VERSION } from '@ps/model'

// Recovery copies (roadmap 25). While a project has unsaved changes, a copy of it — exactly what
// Save would write — is kept in the app's private storage (web: IndexedDB; desktop: the app data
// folder), never in the user's file. Each open tab or window (a session: one page load) has one
// slot, claimed with a Web Lock for as long as the page lives, so a slot whose page is still open
// is never offered elsewhere; a slot whose page went away with unsaved changes (a crash, a closed
// tab) is offered at the next start. Slots are cleared after a save and when the project is
// replaced or the page closes with nothing unsaved. When the page goes away right after an edit,
// the copy is made on the main thread and its write started in `pagehide` (decision 280).

export const RECOVERY_POLICY = {
  /** A copy is written this long after edits stop… */
  idleMs: 5_000,
  /** …and at least this often while editing goes on. */
  maxDelayMs: 30_000,
  /** At most this many orphaned slots are kept (the newest). */
  maxSlots: 10,
  /** Orphaned slots older than this are deleted. */
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
}
type RecoveryPolicy = typeof RECOVERY_POLICY

/** What a recovery slot says about its copy (small: listed without reading the copies). */
export interface RecoveryRecord {
  format: 1
  /** The page load that wrote it. */
  session: string
  /** The file the project was opened from or last saved to, if any. */
  fileName: string | null
  /** Desktop: that file's path. */
  path: string | null
  /** The project's data tables, for telling copies apart (at most three names). */
  tables: string[]
  tableCount: number
  /** Every sheet: tables, results, graphs, layouts, notes. */
  sheetCount: number
  /** When the copy was written (ms since 1970). */
  time: number
  appVersion: string
  /** Size of the copy in bytes. */
  size: number
}

/** A recovery copy: its record, the project file's bytes and what Save should write to. */
export interface RecoverySlot {
  record: RecoveryRecord
  bytes: Uint8Array
  /** A desktop path or a browser file handle; null where there is none. */
  handle: unknown
}

/** The platform's private storage for recovery copies, one slot per session. */
export interface RecoveryStorage {
  /** Every slot's record (unreadable slots are skipped). */
  list(): Promise<RecoveryRecord[]>
  read(session: string): Promise<RecoverySlot | null>
  /** Replaces the session's slot; the write is all or nothing. */
  write(slot: RecoverySlot): Promise<void>
  remove(session: string): Promise<void>
  /**
   * Gets ready to write without delay (web: opens the database), called at start when the page
   * is idle, so a write started as the page closes is issued at once rather than after an open
   * that would never finish.
   */
  open?(): void
}

/** Session ids are file names on the desktop: keep them plain. */
const SESSION_PATTERN = /^[A-Za-z0-9-]{1,64}$/

function newSessionId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 2 ** 32)
      .toString(16)
      .padStart(8, '0'),
  ).join('-')
}

/** Reads a stored record defensively (storage is outside the app's control). */
export function parseRecoveryRecord(v: unknown): RecoveryRecord | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const str = (x: unknown) => typeof x === 'string'
  const strOrNull = (x: unknown) => x === null || typeof x === 'string'
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
  if (
    r.format !== 1 ||
    !str(r.session) ||
    !SESSION_PATTERN.test(r.session as string) ||
    !strOrNull(r.fileName) ||
    !strOrNull(r.path) ||
    !Array.isArray(r.tables) ||
    !r.tables.every(str) ||
    !num(r.tableCount) ||
    !num(r.sheetCount) ||
    !num(r.time) ||
    !str(r.appVersion) ||
    !num(r.size)
  )
    return null
  return {
    format: 1,
    session: r.session as string,
    fileName: r.fileName as string | null,
    path: r.path as string | null,
    tables: (r.tables as string[]).slice(0, 3),
    tableCount: r.tableCount as number,
    sheetCount: r.sheetCount as number,
    time: r.time as number,
    appVersion: r.appVersion as string,
    size: r.size as number,
  }
}

/** The record for a copy of a project with these data tables and this many sheets. */
export function recoveryRecord(opts: {
  session: string
  file: { name: string; path: string | null } | null
  tableNames: readonly string[]
  sheetCount: number
  time: number
  size: number
}): RecoveryRecord {
  return {
    format: 1,
    session: opts.session,
    fileName: opts.file?.name ?? null,
    path: opts.file?.path ?? null,
    tables: opts.tableNames.slice(0, 3),
    tableCount: opts.tableNames.length,
    sheetCount: opts.sheetCount,
    time: opts.time,
    appVersion: APP_VERSION,
    size: opts.size,
  }
}

/** The project a copy belongs to, for the recovery dialog. */
export const recoveryName = (r: RecoveryRecord): string => r.fileName ?? 'an untitled project'

/** What is in it, e.g. "Weights, Doses, Growth and 2 more tables (14 sheets)". */
export function recoverySummary(r: RecoveryRecord): string {
  const sheets = `${r.sheetCount} sheet${r.sheetCount === 1 ? '' : 's'}`
  if (!r.tables.length) return r.sheetCount ? `No data tables (${sheets})` : 'Empty'
  const more = r.tableCount - r.tables.length
  const names = more > 0 ? `${r.tables.join(', ')} and ${more} more tables` : r.tables.join(', ')
  return `${names} (${sheets})`
}

/** When a copy was written: the time today, "yesterday at …", else the date and time. */
export function recoveryTime(time: number, now: number, locale?: string): string {
  const t = new Date(time)
  const hm = t.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(new Date(now)) - day(t)) / 86_400_000)
  if (days === 0) return hm
  if (days === 1) return `yesterday at ${hm}`
  const sameYear = t.getFullYear() === new Date(now).getFullYear()
  const date = t.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `${date} at ${hm}`
}

// ---------------------------------------------------------------------------------------------
// When to write
// ---------------------------------------------------------------------------------------------

/** The next write: `idleMs` after the last edit, but no later than `maxDelayMs` after the first. */
export function recoveryDueAt(
  firstChange: number,
  lastChange: number,
  policy: Pick<RecoveryPolicy, 'idleMs' | 'maxDelayMs'> = RECOVERY_POLICY,
): number {
  return Math.min(lastChange + policy.idleMs, firstChange + policy.maxDelayMs)
}

export interface Timers {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** Debounces edits into writes by `recoveryDueAt`; `run` is called when one is due. */
export class RecoveryScheduler {
  private first: number | null = null
  private last = 0
  private timer: unknown = null

  constructor(
    private readonly run: () => void,
    private readonly timers: Timers = realTimers,
    private readonly policy: Pick<RecoveryPolicy, 'idleMs' | 'maxDelayMs'> = RECOVERY_POLICY,
  ) {}

  /** Whether edits are waiting to be written. */
  get pending(): boolean {
    return this.first !== null
  }

  /** An edit: (re)schedules the write. */
  changed(): void {
    const now = this.timers.now()
    this.first ??= now
    this.last = now
    this.stopTimer()
    const due = recoveryDueAt(this.first, this.last, this.policy)
    this.timer = this.timers.setTimeout(() => this.fire(), Math.max(0, due - now))
  }

  /** Runs a pending write now (the page is hidden or the window lost focus). */
  flush(): boolean {
    if (!this.pending) return false
    this.fire()
    return true
  }

  /** Nothing to write any more (saved, or another project opened). */
  cancel(): void {
    this.stopTimer()
    this.first = null
  }

  private fire() {
    this.stopTimer()
    this.first = null
    this.run()
  }

  private stopTimer() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }
}

// ---------------------------------------------------------------------------------------------
// Which slots are still open elsewhere
// ---------------------------------------------------------------------------------------------

/** Tells the slots of open pages from orphaned ones. */
interface SessionLiveness {
  /** Marks the session as open until the returned function is called or the page goes away. */
  claim(session: string): () => void
  /** The sessions whose pages are open now. */
  live(): Promise<Set<string>>
}

const LOCK_PREFIX = 'ps-recovery:'

/** The part of the Web Locks API used here. */
export interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<unknown>
  query(): Promise<{ held?: { name?: string }[]; pending?: { name?: string }[] }>
}

/**
 * Web Locks: each page holds a lock named after its session for its lifetime; the browser
 * releases it when the page closes or crashes. The locks of an origin are shared by its tabs
 * (and the desktop app's windows).
 */
export function webLocksLiveness(locks: LockManagerLike): SessionLiveness {
  return {
    claim(session) {
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      locks.request(LOCK_PREFIX + session, () => held).catch(() => {})
      return () => release()
    },
    async live() {
      const state = await locks.query()
      const names = [...(state.held ?? []), ...(state.pending ?? [])].map((l) => l.name ?? '')
      return new Set(
        names.filter((n) => n.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)),
      )
    },
  }
}

/**
 * Where there are no Web Locks: each page writes a heartbeat to localStorage; a session is open
 * while its heartbeat is recent. Background tabs' timers may be throttled to once a minute,
 * hence the generous `staleMs`.
 */
export function heartbeatLiveness(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  timers: {
    now(): number
    setInterval(fn: () => void, ms: number): unknown
    clearInterval(h: unknown): void
  },
  opts: { periodMs: number; staleMs: number } = { periodMs: 15_000, staleMs: 120_000 },
): SessionLiveness {
  const KEY = 'ps.recovery.alive'
  const read = (): Record<string, number> => {
    try {
      const v: unknown = JSON.parse(storage.getItem(KEY) ?? '{}')
      return typeof v === 'object' && v !== null ? (v as Record<string, number>) : {}
    } catch {
      return {}
    }
  }
  const fresh = (all: Record<string, number>) => {
    const now = timers.now()
    return Object.entries(all).filter(
      ([, t]) => typeof t === 'number' && now - t < opts.staleMs && t <= now + opts.staleMs,
    )
  }
  const beat = (session: string, alive: boolean) => {
    const next = Object.fromEntries(fresh(read()).filter(([s]) => s !== session))
    if (alive) next[session] = timers.now()
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {}
  }
  return {
    claim(session) {
      beat(session, true)
      const h = timers.setInterval(() => beat(session, true), opts.periodMs)
      return () => {
        timers.clearInterval(h)
        beat(session, false)
      }
    },
    live: async () => new Set(fresh(read()).map(([s]) => s)),
  }
}

/** Web Locks where the browser has them, else heartbeats in localStorage. */
export function defaultLiveness(): SessionLiveness {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks
  if (locks) return webLocksLiveness(locks)
  let storage: Storage | undefined
  try {
    storage = globalThis.localStorage
  } catch {}
  const none: SessionLiveness = { claim: () => () => {}, live: async () => new Set() }
  if (!storage) return none
  return heartbeatLiveness(storage, {
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  })
}

// ---------------------------------------------------------------------------------------------
// Which slots to offer, which to delete
// ---------------------------------------------------------------------------------------------

/**
 * Orphaned slots (not this session's, no open page) to offer, newest first, at most
 * `maxSlots`; the rest of the orphans — past that count or older than `maxAgeMs` — to delete.
 * Slots of open pages are left alone.
 */
export function sortRecoverySlots(
  records: readonly RecoveryRecord[],
  opts: { own: string; live: ReadonlySet<string>; now: number },
  policy: Pick<RecoveryPolicy, 'maxSlots' | 'maxAgeMs'> = RECOVERY_POLICY,
): { offer: RecoveryRecord[]; remove: string[] } {
  const orphans = records
    .filter((r) => r.session !== opts.own && !opts.live.has(r.session))
    .sort((a, b) => b.time - a.time)
  const offer: RecoveryRecord[] = []
  const remove: string[] = []
  for (const r of orphans) {
    if (opts.now - r.time > policy.maxAgeMs || offer.length >= policy.maxSlots)
      remove.push(r.session)
    else offer.push(r)
  }
  return { offer, remove }
}

// ---------------------------------------------------------------------------------------------
// Desktop storage: two files per slot in the app data folder
// ---------------------------------------------------------------------------------------------

/** File operations in the recovery folder (names only: the platform knows the folder). */
export interface RecoveryFolder {
  /** Creates the folder if it's missing. */
  ensure(): Promise<void>
  list(): Promise<string[]>
  read(name: string): Promise<Uint8Array>
  write(name: string, bytes: Uint8Array): Promise<void>
  /** Replaces `to` by `from` in one step. */
  rename(from: string, to: string): Promise<void>
  remove(name: string): Promise<void>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Recovery slots as files: `<session>.psproj` (the copy) and `<session>.json` (its record).
 * Each is written to a `.tmp` file and renamed into place; the copy first, then the record, so a
 * listed record always has its copy. Removing takes the record first.
 */
export function folderRecoveryStorage(folder: RecoveryFolder): RecoveryStorage {
  const copyName = (s: string) => `${s}.psproj`
  const recordName = (s: string) => `${s}.json`
  const checked = (s: string) => {
    if (!SESSION_PATTERN.test(s)) throw new Error(`invalid recovery session: ${s}`)
    return s
  }
  const replace = async (name: string, bytes: Uint8Array) => {
    await folder.write(`${name}.tmp`, bytes)
    await folder.rename(`${name}.tmp`, name)
  }
  const readRecord = async (session: string) => {
    try {
      const r = parseRecoveryRecord(
        JSON.parse(decoder.decode(await folder.read(recordName(session)))),
      )
      return r?.session === session ? r : null
    } catch {
      return null
    }
  }
  const remove = async (session: string) => {
    for (const name of [recordName(checked(session)), copyName(session)])
      await folder.remove(name).catch(() => {})
  }
  return {
    async list() {
      let names: string[]
      try {
        names = await folder.list()
      } catch {
        return []
      }
      const out: RecoveryRecord[] = []
      for (const name of names) {
        const session = name.endsWith('.json') ? name.slice(0, -'.json'.length) : ''
        if (!SESSION_PATTERN.test(session)) continue
        const r = await readRecord(session)
        if (r) out.push(r)
        // A record that doesn't parse is damaged: its slot can never be offered.
        else await remove(session)
      }
      return out
    },
    async read(session) {
      const record = await readRecord(checked(session))
      if (!record) return null
      try {
        return { record, bytes: await folder.read(copyName(session)), handle: record.path }
      } catch {
        return null
      }
    },
    async write(slot) {
      const session = checked(slot.record.session)
      await folder.ensure()
      await replace(copyName(session), slot.bytes)
      await replace(recordName(session), encoder.encode(JSON.stringify(slot.record)))
    },
    remove,
  }
}

// ---------------------------------------------------------------------------------------------
// The last-moment buffer: a copy made as the page goes away
// ---------------------------------------------------------------------------------------------

/**
 * Synchronous storage that outlives the page, for the copy made in `pagehide`. Storage writes
 * are asynchronous (IndexedDB, the desktop's file commands): Chromium and WebKit abort an
 * IndexedDB transaction still open when the document goes away, even one asked to commit, so a
 * reload or a closed tab right after an edit would lose it. The buffered copy is moved into the
 * storage at the next start (decision 280).
 */
export interface RecoveryBuffer {
  /** Keeps the session's copy now, replacing its last one; false if it can't (too large, full). */
  put(record: RecoveryRecord, bytes: Uint8Array): boolean
  /** Every buffered copy (unreadable ones are dropped). */
  all(): { record: RecoveryRecord; bytes: Uint8Array }[]
  drop(session: string): void
}

const BUFFER_PREFIX = 'ps.recovery.buffer:'

/** At most this many bytes per buffered copy (as base64 a third more; localStorage holds ~5 MB). */
const RECOVERY_BUFFER_MAX_BYTES = 1_500_000

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** A buffer in localStorage (`ps.recovery.buffer:<session>`, the record and base64 bytes). */
export function storageRecoveryBuffer(
  kv: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>,
  maxBytes = RECOVERY_BUFFER_MAX_BYTES,
): RecoveryBuffer {
  const drop = (session: string) => {
    try {
      kv.removeItem(BUFFER_PREFIX + session)
    } catch {}
  }
  return {
    put(record, bytes) {
      if (!SESSION_PATTERN.test(record.session)) return false
      if (bytes.length > maxBytes) {
        drop(record.session)
        return false
      }
      try {
        kv.setItem(
          BUFFER_PREFIX + record.session,
          JSON.stringify({ record, bytes: toBase64(bytes) }),
        )
        return true
      } catch {
        // Over the quota: an older copy left there would only mislead.
        drop(record.session)
        return false
      }
    },
    all() {
      const keys: string[] = []
      try {
        for (let i = 0; i < kv.length; i++) {
          const k = kv.key(i)
          if (k?.startsWith(BUFFER_PREFIX)) keys.push(k)
        }
      } catch {
        return []
      }
      const out: { record: RecoveryRecord; bytes: Uint8Array }[] = []
      for (const k of keys) {
        const session = k.slice(BUFFER_PREFIX.length)
        try {
          const v = JSON.parse(kv.getItem(k) ?? 'null') as { record?: unknown; bytes?: unknown }
          const record = parseRecoveryRecord(v?.record)
          if (record?.session === session && typeof v.bytes === 'string') {
            out.push({ record, bytes: fromBase64(v.bytes) })
            continue
          }
        } catch {}
        drop(session)
      }
      return out
    },
    drop,
  }
}

/** The buffer in this origin's localStorage; none where it can't be used. */
export function defaultRecoveryBuffer(): RecoveryBuffer | undefined {
  try {
    const kv = globalThis.localStorage
    return kv ? storageRecoveryBuffer(kv) : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------------------------
// The controller: this session's slot, written as the document changes
// ---------------------------------------------------------------------------------------------

export interface RecoveryControllerOptions {
  storage: RecoveryStorage
  liveness: SessionLiveness
  session?: string
  /** The document store (its changes schedule writes; its dirty flag gates them). */
  store: {
    subscribe(fn: (state: unknown, change: Change) => void): () => void
    readonly dirty: boolean
  }
  /**
   * The copy to write now: what Save would write, the file it belongs to, the sheet names. The
   * state is taken when this is called. `here`: make the bytes on this thread, synchronously
   * (the page may be going away); otherwise they may come from a worker (a promise).
   */
  snapshot(here: boolean): {
    bytes: Uint8Array | Promise<Uint8Array>
    file: { name: string; path: string | null; handle: unknown } | null
    tableNames: string[]
    sheetCount: number
  }
  /** The worker that makes copies off the main thread, if any (see `createSerializer`). */
  serializer?: { warm(): void; readonly ready: boolean }
  /** Where the copy made as the page goes away is kept at once (see `RecoveryBuffer`). */
  buffer?: RecoveryBuffer
  /**
   * Roadmap 34e: the project holds large tables. Its copies are made in the worker only: one
   * made on the main thread as the page goes away would hold it for seconds and could never fit
   * the buffer, so the slot keeps the last copy stored (its edits at most 5 s older, 30 s while
   * editing without a pause).
   */
  large?: () => boolean
  timers?: Timers
  /** Runs `fn` when the page is idle (serializing stays off the typing path). */
  idle?: (fn: () => void) => void
  /** A copy was written (time), or this session's slot was cleared (null). */
  onStatus?: (written: number | null) => void
  onError?: (e: unknown) => void
}

const whenIdle = (fn: () => void) => {
  const ric = (globalThis as { requestIdleCallback?: (f: () => void, o: object) => unknown })
    .requestIdleCallback
  if (ric) ric(fn, { timeout: 2000 })
  else setTimeout(fn, 0)
}

/**
 * This session's slot, written as the document changes (decisions 136, 280). A copy that is due
 * by the scheduler is made in the serializer's worker; when the page is hidden or blurred
 * (`flush`) the worker makes it only if it is running, else the main thread does; when the page
 * goes away (`leave`) the main thread does, the copy goes into the buffer at once and its
 * storage write is started before `leave` returns. The storage is readied at start and the
 * worker at the first change, each when the page is idle, so neither is first touched while the
 * page is closing.
 */
export class RecoveryController {
  readonly session: string
  private readonly scheduler: RecoveryScheduler
  private readonly timers: Timers
  private chain: Promise<void> = Promise.resolve()
  /** Storage operations queued or running (the next one starts at once when there are none). */
  private queued = 0
  /** The latest write: resolves once its copy is stored (or dropped as stale). */
  private last: Promise<void> = Promise.resolve()
  /** Whether this session's slot may hold a copy. */
  private written = false
  /** Changes seen; a copy is of the revision current when its snapshot was taken. */
  private revision = 0
  /** The newest revision whose copy has been handed to storage… */
  private handed = 0
  /** …and whose write has completed. */
  private stored = 0
  /** The revision of this session's buffered copy, if there is one. */
  private buffered: number | null = null
  /** Bumped when the slot is cleared: copies made before then (still in a worker) are dropped. */
  private epoch = 0

  constructor(private readonly opts: RecoveryControllerOptions) {
    this.session = opts.session ?? newSessionId()
    this.timers = opts.timers ?? realTimers
    this.scheduler = new RecoveryScheduler(
      () => (opts.idle ?? whenIdle)(() => void this.write(false)),
      this.timers,
    )
  }

  /** Claims this session's slot and follows the document; returns the function that stops. */
  start(): () => void {
    const release = this.opts.liveness.claim(this.session)
    let stopped = false
    const idle = this.opts.idle ?? whenIdle
    // Ready the storage while nothing is happening, not at the first copy.
    idle(() => {
      if (stopped) return
      try {
        this.opts.storage.open?.()
      } catch (e) {
        this.opts.onError?.(e)
      }
    })
    // The worker too, once there is something to copy (the first change, or a project that
    // starts unsaved), when idle: a page left right after it opens (a link followed, a reload)
    // then has no worker script loading, whose load cut short WebKit reports as a page error.
    let warmed = false
    const warm = () => {
      if (warmed) return
      warmed = true
      idle(() => {
        if (stopped) return
        try {
          this.opts.serializer?.warm()
        } catch (e) {
          this.opts.onError?.(e)
        }
      })
    }
    if (this.opts.store.dirty) warm()
    const unsubscribe = this.opts.store.subscribe((_, change) => {
      this.revision++
      if (change.kind !== 'reset') {
        warm()
        return this.scheduler.changed()
      }
      // Another project (opened, new, closed): the old one's copy goes. A recovered project
      // starts unsaved and gets a copy of its own.
      this.scheduler.cancel()
      void this.clear()
      if (this.opts.store.dirty) {
        warm()
        this.scheduler.changed()
      }
    })
    return () => {
      stopped = true
      unsubscribe()
      this.scheduler.cancel()
      release()
    }
  }

  /**
   * Writes a pending copy now (page hidden, window blurred); resolves when it is stored. The
   * worker makes it only if it is running: a worker still loading answers late, and starting
   * one now could be cut short by the page going away.
   */
  flush(): Promise<void> {
    if (this.scheduler.pending) {
      // A large project's copy only from a worker that is running (starting one now could be
      // cut short by the page going away); else it stays scheduled.
      const large = !!this.opts.large?.()
      if (large && !this.opts.serializer?.ready) return this.settled()
      this.scheduler.cancel()
      return this.write(!this.opts.serializer?.ready && !large)
    }
    return this.settled()
  }

  /**
   * The page is going away (`pagehide`), or may be (`beforeunload` with unsaved changes: while
   * the browser asks whether to leave, a write started now has time to finish). Nothing unsaved:
   * the slot is cleared. Otherwise, unless the latest edit's copy is stored or buffered already,
   * it is made here and now (a worker's answer would never come back), kept in the buffer, and
   * its storage write is started before this returns; whether a write started as the page
   * unloads completes is up to the browser (decision 280).
   */
  leave(): Promise<void> {
    if (!this.opts.store.dirty) return this.clear()
    if (this.stored >= this.revision || this.buffered === this.revision) return this.settled()
    // Large tables (roadmap 34e): the worker's copy, if it can still be made; else the last one.
    if (this.opts.large?.()) {
      if (!this.scheduler.pending || !this.opts.serializer?.ready) return this.settled()
      this.scheduler.cancel()
      return this.write(false)
    }
    this.scheduler.cancel()
    return this.write(true, true)
  }

  /** Nothing to recover (after a save, a clean close, another project). */
  clear(): Promise<void> {
    this.scheduler.cancel()
    this.epoch++
    this.dropBuffered()
    if (!this.written) return this.chain
    this.written = false
    return this.enqueue(async () => {
      await this.opts.storage.remove(this.session)
      this.opts.onStatus?.(null)
    })
  }

  /**
   * Orphaned copies to offer, newest first, after moving buffered copies of closed pages into
   * the storage and deleting the copies past the limits.
   */
  async orphans(): Promise<RecoveryRecord[]> {
    const live = await this.opts.liveness.live()
    await this.adoptBuffered(live)
    const records = await this.opts.storage.list()
    const { offer, remove } = sortRecoverySlots(records, {
      own: this.session,
      live,
      now: this.timers.now(),
    })
    for (const s of remove) await this.opts.storage.remove(s).catch(() => {})
    return offer
  }

  read(session: string): Promise<RecoverySlot | null> {
    return this.opts.storage.read(session)
  }

  discard(session: string): Promise<void> {
    return this.opts.storage.remove(session)
  }

  /**
   * Buffered copies of pages that are gone become their slots (unless the slot holds a newer
   * copy), keeping the slot's file handle; then the buffer lets them go.
   */
  private async adoptBuffered(live: ReadonlySet<string>) {
    const buffer = this.opts.buffer
    if (!buffer) return
    for (const { record, bytes } of buffer.all()) {
      if (record.session === this.session || live.has(record.session)) continue
      try {
        const slot = await this.opts.storage.read(record.session).catch(() => null)
        if (!slot || slot.record.time <= record.time)
          await this.opts.storage.write({ record, bytes, handle: slot?.handle ?? record.path })
        buffer.drop(record.session)
      } catch (e) {
        // Kept for the next start; given up once older than any slot is kept.
        if (this.timers.now() - record.time > RECOVERY_POLICY.maxAgeMs) buffer.drop(record.session)
        this.opts.onError?.(e)
      }
    }
  }

  /** The latest write and every storage operation queued so far have finished. */
  private settled(): Promise<void> {
    return Promise.all([this.last, this.chain]).then(() => {})
  }

  private dropBuffered() {
    if (this.buffered === null) return
    this.buffered = null
    this.opts.buffer?.drop(this.session)
  }

  /** `here`: serialize on this thread; `buffer`: keep the copy in the buffer as well. */
  private write(here: boolean, buffer = false): Promise<void> {
    // Saved (or replaced) since the write was scheduled: nothing unsaved to keep. Already handed
    // to storage (a write that was waiting for idle time after `leave` or `flush`).
    if (!this.opts.store.dirty || (this.handed >= this.revision && !buffer)) return this.settled()
    const time = this.timers.now()
    const revision = this.revision
    const epoch = this.epoch
    let snap: ReturnType<RecoveryControllerOptions['snapshot']>
    try {
      snap = this.opts.snapshot(here)
    } catch (e) {
      this.opts.onError?.(e)
      return this.settled()
    }
    this.written = true
    const store = (bytes: Uint8Array): Promise<void> => {
      // The slot was cleared meanwhile: this copy is of edits that are saved or replaced.
      if (epoch !== this.epoch) return this.chain
      const record = recoveryRecord({
        session: this.session,
        file: snap.file,
        tableNames: snap.tableNames,
        sheetCount: snap.sheetCount,
        time,
        size: bytes.length,
      })
      if (buffer && this.opts.buffer) {
        if (this.opts.buffer.put(record, bytes)) this.buffered = revision
        else this.dropBuffered()
      }
      // A newer copy was handed over (made on the main thread while this one was in the
      // worker), or this one already is: writing it would put older edits back.
      if (revision <= this.handed) return this.chain
      this.handed = revision
      return this.enqueue(async () => {
        await this.opts.storage.write({ record, bytes, handle: snap.file?.handle ?? null })
        this.stored = Math.max(this.stored, revision)
        // Stored: the buffered copy (this one or an older one) is no longer needed.
        if (this.buffered !== null && this.buffered <= this.stored && epoch === this.epoch)
          this.dropBuffered()
        this.opts.onStatus?.(time)
      })
    }
    this.last =
      snap.bytes instanceof Uint8Array
        ? store(snap.bytes)
        : snap.bytes.then(store, (e) => this.opts.onError?.(e))
    return this.last
  }

  /**
   * Storage operations run one at a time, in order. With none running, the operation starts
   * synchronously (in `pagehide`, its storage call is made before the handler returns).
   */
  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = () => op().catch((e) => this.opts.onError?.(e))
    this.queued++
    const p = this.queued === 1 ? run() : this.chain.then(run)
    this.chain = p.finally(() => {
      this.queued--
    })
    return this.chain
  }
}
