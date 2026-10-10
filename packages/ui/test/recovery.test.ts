import type { Change } from '@ps/engine'
import { packProject, writeProjectFile } from '@ps/io'
import { APP_VERSION, createProject, createTable } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { syntheticTable } from '../../model/test/synthetic.ts'
import {
  folderRecoveryStorage,
  heartbeatLiveness,
  type LockManagerLike,
  parseRecoveryRecord,
  RECOVERY_POLICY,
  type RecoveryBuffer,
  RecoveryController,
  type RecoveryControllerOptions,
  type RecoveryFolder,
  type RecoveryRecord,
  RecoveryScheduler,
  type RecoverySlot,
  type RecoveryStorage,
  recoveryDueAt,
  recoveryRecord,
  recoverySummary,
  recoveryTime,
  sortRecoverySlots,
  storageRecoveryBuffer,
  type Timers,
  webLocksLiveness,
} from '../src/recovery.ts'
import { createServices, load, serialize } from '../src/services.ts'
import {
  createSerializer,
  type SerializeReply,
  type SerializeRequest,
  type WorkerLike,
} from '../src/worker/serialize.ts'

/** A clock and timers moved by hand. */
function fakeTimers(start = 1_000_000) {
  let now = start
  let next = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  const timers: Timers & {
    advance(ms: number): void
    count(): number
    setInterval(fn: () => void, ms: number): unknown
    clearInterval(h: unknown): void
  } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = next++
      pending.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (h) => void pending.delete(h as number),
    setInterval(fn, ms) {
      const id = next++
      const tick = () => {
        pending.set(id, { at: now + ms, fn: tick })
        fn()
      }
      pending.set(id, { at: now + ms, fn: tick })
      return id
    },
    clearInterval: (h) => void pending.delete(h as number),
    advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...pending].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)
        const first = due[0]
        if (!first) break
        pending.delete(first[0])
        now = first[1].at
        first[1].fn()
      }
      now = end
    },
    count: () => pending.size,
  }
  return timers
}

const record = (session: string, time: number, extra: Partial<RecoveryRecord> = {}) =>
  ({
    ...recoveryRecord({
      session,
      file: null,
      tableNames: ['Data 1'],
      sheetCount: 2,
      time,
      size: 10,
    }),
    ...extra,
  }) satisfies RecoveryRecord

describe('when copies are written', () => {
  const { idleMs, maxDelayMs } = RECOVERY_POLICY

  it('is 5 s after edits stop, but at most 30 s after the first unsaved edit', () => {
    expect(idleMs).toBe(5000)
    expect(maxDelayMs).toBe(30_000)
    expect(recoveryDueAt(0, 0)).toBe(5000)
    expect(recoveryDueAt(0, 12_000)).toBe(17_000)
    expect(recoveryDueAt(0, 28_000)).toBe(30_000)
  })

  it('debounces edits, writes during continuous editing, and flushes on demand', () => {
    const t = fakeTimers()
    const writes: number[] = []
    const s = new RecoveryScheduler(() => writes.push(t.now()), t)
    const start = t.now()
    s.changed()
    t.advance(3000)
    s.changed()
    t.advance(4999)
    expect(writes).toEqual([])
    t.advance(1)
    expect(writes).toEqual([start + 8000])
    expect(s.pending).toBe(false)

    // An edit every second for a minute: a write every 30 s, not never.
    writes.length = 0
    const first = t.now()
    for (let i = 0; i < 60; i++) {
      s.changed()
      t.advance(1000)
    }
    // The last edit (at 59 s) is in the write at 60 s; nothing is left to write afterwards.
    expect(writes).toEqual([first + 30_000, first + 60_000])
    t.advance(10_000)
    expect(writes).toHaveLength(2)

    // Hidden / blurred: now, once.
    s.changed()
    expect(s.flush()).toBe(true)
    expect(s.flush()).toBe(false)
    expect(writes).toHaveLength(3)
    t.advance(60_000)
    expect(writes).toHaveLength(3)

    // Cancelled (saved): nothing.
    s.changed()
    s.cancel()
    t.advance(60_000)
    expect(writes).toHaveLength(3)
    expect(t.count()).toBe(0)
  })
})

describe('slots offered and deleted', () => {
  const now = 100 * 86_400_000
  const day = 86_400_000

  it('offers orphans newest first, never this session or an open one', () => {
    const records = [record('a', now - 3000), record('b', now - 1000), record('own', now)]
    records.push(record('open', now - 2000))
    const { offer, remove } = sortRecoverySlots(records, {
      own: 'own',
      live: new Set(['open']),
      now,
    })
    expect(offer.map((r) => r.session)).toEqual(['b', 'a'])
    expect(remove).toEqual([])
  })

  it('deletes orphans older than 30 days and past the newest 10', () => {
    const records = Array.from({ length: 14 }, (_, i) => record(`s${i}`, now - i * day))
    records.push(record('old', now - 31 * day))
    records.push(record('open-old', now - 40 * day))
    const { offer, remove } = sortRecoverySlots(records, {
      own: 'x',
      live: new Set(['open-old']),
      now,
    })
    expect(offer.map((r) => r.session)).toEqual(Array.from({ length: 10 }, (_, i) => `s${i}`))
    expect(remove.sort()).toEqual(['old', 's10', 's11', 's12', 's13'])
  })
})

describe('record format', () => {
  it('records the file, the tables, the time and the app version', () => {
    const r = recoveryRecord({
      session: 'abc-1',
      file: { name: 'Weights.psproj', path: '/data/Weights.psproj' },
      tableNames: ['Weights', 'Doses', 'Growth', 'Survival', 'Counts'],
      sheetCount: 14,
      time: 5,
      size: 1234,
    })
    expect(r).toEqual({
      format: 1,
      session: 'abc-1',
      fileName: 'Weights.psproj',
      path: '/data/Weights.psproj',
      tables: ['Weights', 'Doses', 'Growth'],
      tableCount: 5,
      sheetCount: 14,
      time: 5,
      appVersion: APP_VERSION,
      size: 1234,
    })
    expect(parseRecoveryRecord(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(recoverySummary(r)).toBe('Weights, Doses, Growth and 2 more tables (14 sheets)')
    expect(recoverySummary(record('a', 1))).toBe('Data 1 (2 sheets)')
    expect(recoverySummary({ ...r, tables: [], tableCount: 0, sheetCount: 1 })).toBe(
      'No data tables (1 sheet)',
    )
    expect(recoverySummary({ ...r, tables: [], tableCount: 0, sheetCount: 0 })).toBe('Empty')
  })

  it('refuses what it did not write', () => {
    const good = record('abc', 1)
    expect(parseRecoveryRecord(good)).toEqual(good)
    for (const bad of [
      null,
      'x',
      { ...good, format: 2 },
      { ...good, session: '../escape' },
      { ...good, session: '' },
      { ...good, time: 'yesterday' },
      { ...good, fileName: 3 },
      { ...good, tables: [1] },
    ])
      expect(parseRecoveryRecord(bad)).toBeNull()
  })

  it('says when, relative to today', () => {
    const now = new Date(2026, 8, 30, 16, 0).getTime()
    expect(recoveryTime(new Date(2026, 8, 30, 14, 32).getTime(), now, 'en-GB')).toBe('14:32')
    expect(recoveryTime(new Date(2026, 8, 29, 9, 5).getTime(), now, 'en-GB')).toBe(
      'yesterday at 09:05',
    )
    expect(recoveryTime(new Date(2026, 8, 12, 9, 5).getTime(), now, 'en-GB')).toBe(
      '12 Sept at 09:05',
    )
    expect(recoveryTime(new Date(2025, 11, 1, 9, 5).getTime(), now, 'en-GB')).toBe(
      '1 Dec 2025 at 09:05',
    )
  })
})

describe('liveness', () => {
  it('Web Locks: a claimed session is live until released', async () => {
    const held = new Map<string, Promise<void>>()
    const locks: LockManagerLike = {
      request(name, cb) {
        const p = cb()
        held.set(name, p)
        return p.then(() => void held.delete(name))
      },
      query: async () => ({ held: [...held.keys()].map((name) => ({ name })) }),
    }
    const live = webLocksLiveness(locks)
    const release = live.claim('abc')
    held.set('something-else', new Promise(() => {}))
    expect(await live.live()).toEqual(new Set(['abc']))
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(await live.live()).toEqual(new Set())
  })

  it('heartbeats: live while beating, stale after two minutes', async () => {
    const t = fakeTimers()
    const data = new Map<string, string>()
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
    const a = heartbeatLiveness(storage, t)
    const b = heartbeatLiveness(storage, t)
    a.claim('a')
    const stopB = b.claim('b')
    t.advance(60_000)
    expect(await a.live()).toEqual(new Set(['a', 'b']))
    stopB()
    expect(await a.live()).toEqual(new Set(['a']))
    // A crashed page stops beating: stale after 120 s (its timers never run again).
    data.set(
      'ps.recovery.alive',
      JSON.stringify({ ...JSON.parse(data.get('ps.recovery.alive')!), c: t.now() }),
    )
    t.advance(119_000)
    expect((await a.live()).has('c')).toBe(true)
    t.advance(2000)
    expect(await a.live()).toEqual(new Set(['a']))
  })
})

/** A recovery folder in memory, recording every operation. */
function memoryFolder() {
  const files = new Map<string, Uint8Array>()
  const log: string[] = []
  let failOn: string | null = null
  const op = (what: string) => {
    log.push(what)
    if (failOn && what.startsWith(failOn)) throw new Error(`failed: ${what}`)
  }
  const folder: RecoveryFolder = {
    ensure: async () => op('ensure'),
    async list() {
      op('list')
      return [...files.keys()]
    },
    async read(name) {
      op(`read ${name}`)
      const f = files.get(name)
      if (!f) throw new Error('no such file')
      return f
    },
    async write(name, bytes) {
      op(`write ${name}`)
      files.set(name, bytes)
    },
    async rename(from, to) {
      op(`rename ${from} ${to}`)
      const f = files.get(from)
      if (!f) throw new Error('no such file')
      files.delete(from)
      files.set(to, f)
    },
    async remove(name) {
      op(`remove ${name}`)
      if (!files.delete(name)) throw new Error('no such file')
    },
  }
  return {
    folder,
    files,
    log,
    fail: (prefix: string | null) => {
      failOn = prefix
    },
  }
}

describe('desktop slots as files', () => {
  const slot = (session: string, bytes = [1, 2, 3]): RecoverySlot => ({
    record: record(session, 7, { path: '/x/a.psproj', fileName: 'a.psproj' }),
    bytes: new Uint8Array(bytes),
    handle: '/x/a.psproj',
  })

  it('writes the copy, then the record, each to a temporary name renamed into place', async () => {
    const m = memoryFolder()
    const storage = folderRecoveryStorage(m.folder)
    await storage.write(slot('abc'))
    expect(m.log).toEqual([
      'ensure',
      'write abc.psproj.tmp',
      'rename abc.psproj.tmp abc.psproj',
      'write abc.json.tmp',
      'rename abc.json.tmp abc.json',
    ])
    expect([...m.files.keys()].sort()).toEqual(['abc.json', 'abc.psproj'])
    expect(await storage.list()).toEqual([slot('abc').record])
    expect(await storage.read('abc')).toEqual(slot('abc'))
    m.log.length = 0
    await storage.remove('abc')
    expect(m.log).toEqual(['remove abc.json', 'remove abc.psproj'])
    expect(m.files.size).toBe(0)
    expect(await storage.read('abc')).toBeNull()
  })

  it('never lists a slot whose copy was not written; drops damaged records', async () => {
    const m = memoryFolder()
    const storage = folderRecoveryStorage(m.folder)
    m.fail('rename abc.psproj.tmp')
    await expect(storage.write(slot('abc'))).rejects.toThrow()
    m.fail(null)
    expect(await storage.list()).toEqual([])

    m.files.set('bad.json', new TextEncoder().encode('{"format":1'))
    m.files.set('bad.psproj', new Uint8Array([1]))
    m.files.set('notes.txt', new Uint8Array([1]))
    await storage.write(slot('good'))
    expect((await storage.list()).map((r) => r.session)).toEqual(['good'])
    expect(m.files.has('bad.json')).toBe(false)
    expect(m.files.has('bad.psproj')).toBe(false)
    expect(m.files.has('notes.txt')).toBe(true)
  })

  it('refuses session ids that are not plain names', async () => {
    const storage = folderRecoveryStorage(memoryFolder().folder)
    await expect(storage.write(slot('../../etc'))).rejects.toThrow(/invalid/)
    await expect(storage.read('../x')).rejects.toThrow(/invalid/)
  })

  it('a missing folder has no slots', async () => {
    const m = memoryFolder()
    m.fail('list')
    expect(await folderRecoveryStorage(m.folder).list()).toEqual([])
  })
})

/** Storage in memory. */
function memoryStorage() {
  const slots = new Map<string, RecoverySlot>()
  const log: string[] = []
  const storage: RecoveryStorage = {
    list: async () => [...slots.values()].map((s) => s.record),
    read: async (s) => slots.get(s) ?? null,
    async write(slot) {
      log.push(`write ${slot.record.session}`)
      slots.set(slot.record.session, slot)
    },
    async remove(s) {
      log.push(`remove ${s}`)
      slots.delete(s)
    },
  }
  return { storage, slots, log }
}

/** A store stand-in: dirty flag and change events by hand. */
function fakeStore() {
  const listeners = new Set<(s: unknown, c: Change) => void>()
  const store = {
    dirty: false,
    subscribe(fn: (s: unknown, c: Change) => void) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    emit(kind: Change['kind'], dirty = kind !== 'reset') {
      store.dirty = dirty
      for (const fn of listeners) fn(null, { kind, touched: 'all' })
    },
  }
  return store
}

describe('the recovery controller', () => {
  const setup = () => {
    const t = fakeTimers()
    const m = memoryStorage()
    const store = fakeStore()
    const claimed: string[] = []
    const status: (number | null)[] = []
    let snapshots = 0
    let file: { name: string; path: string | null; handle: unknown } | null = null
    const c = new RecoveryController({
      storage: m.storage,
      liveness: {
        claim: (s) => {
          claimed.push(s)
          return () => claimed.splice(claimed.indexOf(s), 1)
        },
        live: async () => new Set(['open-elsewhere']),
      },
      session: 'me',
      store,
      snapshot: () => ({
        bytes: new Uint8Array([++snapshots]),
        file,
        tableNames: ['Data 1'],
        sheetCount: 1,
      }),
      timers: t,
      idle: (fn) => fn(),
      onStatus: (s) => status.push(s),
    })
    const settle = () => new Promise((r) => setTimeout(r, 0))
    return {
      t,
      m,
      store,
      c,
      claimed,
      status,
      settle,
      snapshots: () => snapshots,
      setFile: (f: typeof file) => {
        file = f
      },
    }
  }

  it('claims its slot and writes a copy 5 s after an edit, only while unsaved', async () => {
    const { t, m, store, c, claimed, status, settle, snapshots } = setup()
    const stop = c.start()
    expect(claimed).toEqual(['me'])
    store.emit('dispatch')
    t.advance(4999)
    expect(snapshots()).toBe(0)
    t.advance(1)
    await settle()
    expect(m.log).toEqual(['write me'])
    expect(m.slots.get('me')?.record.time).toBe(t.now())
    expect(status).toEqual([t.now()])

    // No further edits: no further writes.
    t.advance(60_000)
    expect(snapshots()).toBe(1)

    // Undone back to saved? Still unsaved by revision; saved: the scheduled write is skipped.
    store.emit('undo')
    store.dirty = false
    t.advance(5000)
    await settle()
    expect(snapshots()).toBe(1)
    stop()
    expect(claimed).toEqual([])
  })

  it('flushes when hidden, clears after a save, and only removes what it wrote', async () => {
    const { m, store, c, status, settle } = setup()
    c.start()
    await c.clear()
    expect(m.log).toEqual([])
    store.emit('dispatch')
    await c.flush()
    expect(m.log).toEqual(['write me'])
    await c.flush()
    expect(m.log).toEqual(['write me'])
    store.dirty = false
    await c.clear()
    expect(m.log).toEqual(['write me', 'remove me'])
    expect(status.at(-1)).toBeNull()
    await settle()
  })

  it('opening another project clears the slot; a recovered one gets its own copy', async () => {
    const { m, store, c, setFile } = setup()
    c.start()
    store.emit('dispatch')
    await c.flush()
    store.emit('reset')
    await c.flush()
    expect(m.log).toEqual(['write me', 'remove me'])
    expect(m.slots.size).toBe(0)

    // store.reset(project, { unsaved: true }): dirty from the start.
    setFile({ name: 'a.psproj', path: '/x/a.psproj', handle: '/x/a.psproj' })
    store.emit('reset', true)
    await c.flush()
    expect(m.slots.get('me')?.record).toMatchObject({ fileName: 'a.psproj', path: '/x/a.psproj' })
    expect(m.slots.get('me')?.handle).toBe('/x/a.psproj')
  })

  it('offers orphans (not its own, not open ones) and deletes those past the limits', async () => {
    const { t, m, c } = setup()
    const day = 86_400_000
    for (const [s, age] of [
      ['me', 0],
      ['open-elsewhere', 0],
      ['crashed', 60_000],
      ['older', day],
      ['ancient', 31 * day],
    ] as const)
      m.slots.set(s, { record: record(s, t.now() - age), bytes: new Uint8Array(), handle: null })
    const offered = await c.orphans()
    expect(offered.map((r) => r.session)).toEqual(['crashed', 'older'])
    expect([...m.slots.keys()].sort()).toEqual(['crashed', 'me', 'older', 'open-elsewhere'])
    await c.discard('older')
    expect(m.slots.has('older')).toBe(false)
  })

  it('reports a copy that could not be made and keeps working', async () => {
    const errors: unknown[] = []
    const m = memoryStorage()
    const store = fakeStore()
    let fail = true
    const c = new RecoveryController({
      storage: m.storage,
      liveness: { claim: () => () => {}, live: async () => new Set() },
      store,
      snapshot: () => {
        if (fail) throw new Error('boom')
        return { bytes: new Uint8Array([1]), file: null, tableNames: [], sheetCount: 0 }
      },
      timers: fakeTimers(),
      idle: (fn) => fn(),
      onError: (e) => errors.push(e),
    })
    c.start()
    store.emit('dispatch')
    await c.flush()
    expect(errors).toHaveLength(1)
    fail = false
    store.emit('dispatch')
    await c.flush()
    expect(m.slots.size).toBe(1)
  })
})

/** A worker stand-in: what was sent, and its answers by hand. */
function fakeWorker() {
  const sent: SerializeRequest[] = []
  let terminated = false
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (msg) => void sent.push(msg),
    terminate: () => {
      terminated = true
    },
  }
  return {
    worker,
    sent,
    reply: (data: SerializeReply) => worker.onmessage?.({ data }),
    /** The script didn't load (or the worker died); whether the error was kept from the page. */
    fail() {
      let prevented = false
      worker.onerror?.({ message: 'load failed', preventDefault: () => (prevented = true) })
      return prevented
    },
    terminated: () => terminated,
  }
}

describe('the serialize worker and its main-thread fallback', () => {
  const project = createProject('P', new Date('2026-01-01T00:00:00Z'))
  const args = [project, new Map(), { selected: null }, new Map()] as const
  const here = () => {
    let calls = 0
    return {
      fallback: () => new Uint8Array([100 + ++calls]),
      calls: () => calls,
    }
  }

  it('starts the worker when warmed (once), is ready when it says so, and uses it', async () => {
    const f = fakeWorker()
    const h = here()
    let created = 0
    const s = createSerializer({
      createWorker: () => {
        created++
        return f.worker
      },
      fallback: h.fallback,
    })
    expect(created).toBe(0)
    s.warm()
    s.warm()
    expect(created).toBe(1)
    expect(s.ready).toBe(false)
    f.reply({ ready: true })
    expect(s.ready).toBe(true)
    const p = s.serialize(...args)
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0]?.project).toBe(project)
    f.reply({ id: f.sent[0]!.id, bytes: new Uint8Array([1, 2]) })
    expect(await p).toEqual(new Uint8Array([1, 2]))
    // An error writing the file is the copy's error (the main thread would fail the same way).
    const q = s.serialize(...args)
    f.reply({ id: f.sent[1]!.id, error: 'too large' })
    await expect(q).rejects.toThrow('too large')
    expect(h.calls()).toBe(0)
  })

  it('sends copies of the columns it keeps coded, so the next copy finds them whole (audit 3, P7)', async () => {
    const f = fakeWorker()
    // As the browser does: what is transferred is gone from this thread.
    f.worker.postMessage = (msg, transfer) =>
      void f.sent.push(structuredClone(msg, { transfer: transfer ?? [] }))
    const s = createSerializer({ createWorker: () => f.worker, fallback: here().fallback })
    const t = syntheticTable({ rows: 30_000, genes: 2, pcs: 0, cellIds: false })
    const big = { ...project, nodes: { [t.id]: t }, order: [t.id] }
    const sizes = () => [...packProject(big).get(t.id)!.columns.values()].map((b) => b.byteLength)
    const before = sizes()
    for (let i = 0; i < 2; i++) {
      const p = s.serialize(big, new Map(), null, new Map())
      // On a busy machine the numbers are coded in slices, letting the thread go between them, so
      // the request can be sent a little later.
      await vi.waitFor(() => expect(f.sent).toHaveLength(i + 1))
      const sent = f.sent.at(-1)!
      expect([...sent.packed.get(t.id)!.columns.values()].map((b) => b.byteLength)).toEqual(before)
      f.reply({ id: sent.id, bytes: new Uint8Array([1]) })
      await p
    }
    expect(sizes()).toEqual(before)
  })

  it('encodes a large table’s numbers a few columns at a time, letting the page go between (audit 3, P7)', async () => {
    const f = fakeWorker()
    const s = createSerializer({ createWorker: () => f.worker, fallback: here().fallback })
    const t = syntheticTable({ rows: 30_000, genes: 4, pcs: 0, cellIds: false })
    const big = { ...project, nodes: { [t.id]: t }, order: [t.id] }
    // Every column takes 10 ms: the thread is let go after each.
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10))
    try {
      const p = s.serialize(big, new Map(), null, new Map())
      expect(f.sent).toHaveLength(0)
      await vi.waitFor(() => expect(f.sent).toHaveLength(1))
      const columns = [...f.sent[0]!.packed.get(t.id)!.columns.values()]
      expect(columns).toEqual([...packProject(big).get(t.id)!.columns.values()])
      f.reply({ id: f.sent[0]!.id, bytes: new Uint8Array([1]) })
      expect(await p).toEqual(new Uint8Array([1]))
    } finally {
      now.mockRestore()
    }
  })

  it('a worker that fails to load is no error: waiting and later copies are made here', async () => {
    const f = fakeWorker()
    const h = here()
    const s = createSerializer({ createWorker: () => f.worker, fallback: h.fallback })
    // Not warmed: the first copy starts it.
    const p = s.serialize(...args)
    expect(f.sent).toHaveLength(1)
    expect(f.fail()).toBe(true)
    expect(await p).toEqual(new Uint8Array([101]))
    expect(s.failed).toBe(true)
    expect(s.ready).toBe(false)
    expect(f.terminated()).toBe(true)
    expect(await s.serialize(...args)).toEqual(new Uint8Array([102]))
    expect(f.sent).toHaveLength(1)
    // A late answer from the dead worker changes nothing.
    f.reply({ ready: true })
    expect(s.ready).toBe(false)
  })

  it('starts no worker while the page is being left (decision 786): copies are made here', async () => {
    const f = fakeWorker()
    const h = here()
    let leaving = true
    let created = 0
    const s = createSerializer({
      createWorker: () => {
        created++
        return f.worker
      },
      fallback: h.fallback,
      leaving: () => leaving,
    })
    s.warm()
    expect(await s.serialize(...args)).toEqual(new Uint8Array([101]))
    expect(created).toBe(0)
    expect(s.failed).toBe(false)
    // The leave was cancelled: the worker starts as before.
    leaving = false
    s.warm()
    expect(created).toBe(1)
  })

  it('no worker, one that cannot be created, or a message it cannot take: the main thread', async () => {
    const h = here()
    const none = createSerializer({ createWorker: null, fallback: h.fallback })
    expect(none.failed).toBe(true)
    none.warm()
    expect(await none.serialize(...args)).toEqual(new Uint8Array([101]))

    const refused = createSerializer({
      createWorker: () => {
        throw new Error('blocked by the content security policy')
      },
      fallback: h.fallback,
    })
    expect(() => refused.warm()).not.toThrow()
    expect(refused.failed).toBe(true)
    expect(await refused.serialize(...args)).toEqual(new Uint8Array([102]))

    const f = fakeWorker()
    f.worker.postMessage = () => {
      throw new Error('DataCloneError')
    }
    const unclonable = createSerializer({ createWorker: () => f.worker, fallback: h.fallback })
    expect(await unclonable.serialize(...args)).toEqual(new Uint8Array([103]))

    const broken = createSerializer({
      createWorker: null,
      fallback: () => {
        throw new Error('no')
      },
    })
    await expect(broken.serialize(...args)).rejects.toThrow('no')
  })
})

/** A buffer in memory. */
function memoryBuffer() {
  const kept = new Map<string, { record: RecoveryRecord; bytes: Uint8Array }>()
  const buffer: RecoveryBuffer = {
    put(record, bytes) {
      kept.set(record.session, { record, bytes })
      return true
    },
    all: () => [...kept.values()],
    drop: (s) => void kept.delete(s),
  }
  return { buffer, kept }
}

describe('leaving right after an edit', () => {
  const setup = (opts: { ready?: boolean; live?: string[] } = {}) => {
    const t = fakeTimers()
    const m = memoryStorage()
    const b = memoryBuffer()
    const store = fakeStore()
    const calls: string[] = []
    const inWorker: (() => void)[] = []
    let n = 0
    let opened = 0
    let warmed = 0
    const serializer = { warm: () => void warmed++, ready: opts.ready ?? true }
    const storage: RecoveryStorage = { ...m.storage, open: () => void opened++ }
    const options: RecoveryControllerOptions = {
      storage,
      liveness: { claim: () => () => {}, live: async () => new Set(opts.live ?? []) },
      session: 'me',
      store,
      serializer,
      buffer: b.buffer,
      snapshot: (onThisThread) => {
        const v = ++n
        calls.push(`${onThisThread ? 'here' : 'worker'} ${v}`)
        const bytes = new Uint8Array([v])
        return {
          bytes: onThisThread
            ? bytes
            : new Promise<Uint8Array>((resolve) => inWorker.push(() => resolve(bytes))),
          file: null,
          tableNames: ['Data 1'],
          sheetCount: 1,
        }
      },
      timers: t,
      idle: (fn) => fn(),
    }
    const settle = () => new Promise((r) => setTimeout(r, 0))
    return {
      t,
      m,
      b,
      store,
      storage,
      options,
      c: new RecoveryController(options),
      calls,
      inWorker,
      serializer,
      settle,
      opened: () => opened,
      warmed: () => warmed,
    }
  }

  it('readies the storage at start and the worker at the first change, not at the first copy', () => {
    const { c, calls, opened, warmed, store } = setup()
    c.start()
    expect(opened()).toBe(1)
    // An untouched project has nothing to copy: no worker loading while the page may go away.
    expect(warmed()).toBe(0)
    store.emit('dispatch')
    store.emit('dispatch')
    expect(warmed()).toBe(1)
    expect(calls).toEqual([])
  })

  it('scheduled copies come from the worker; hidden or blurred, only once it is running', async () => {
    const { t, m, b, store, c, calls, inWorker, serializer, settle } = setup({ ready: false })
    c.start()
    store.emit('dispatch')
    t.advance(5000)
    expect(calls).toEqual(['worker 1'])
    inWorker[0]!()
    await settle()
    expect(m.log).toEqual(['write me'])

    // The worker is still loading: a flush makes the copy here rather than wait for it.
    store.emit('dispatch')
    await c.flush()
    expect(calls).toEqual(['worker 1', 'here 2'])
    serializer.ready = true
    store.emit('dispatch')
    const flushed = c.flush()
    expect(calls).toEqual(['worker 1', 'here 2', 'worker 3'])
    inWorker[1]!()
    await flushed
    expect(m.log).toEqual(['write me', 'write me', 'write me'])
    expect(m.slots.get('me')?.bytes).toEqual(new Uint8Array([3]))
    // Only a page going away uses the buffer.
    expect(b.kept.size).toBe(0)
  })

  it('makes the copy here, buffers it and starts its write before returning', async () => {
    const { t, m, b, store, c, calls } = setup()
    c.start()
    store.emit('dispatch')
    const left = c.leave()
    expect(calls).toEqual(['here 1'])
    expect(m.log).toEqual(['write me'])
    expect(b.kept.get('me')?.bytes).toEqual(new Uint8Array([1]))
    await left
    // Stored: the buffered copy goes; nothing is left to write.
    expect(b.kept.size).toBe(0)
    t.advance(60_000)
    expect(calls).toEqual(['here 1'])
    await c.leave()
    expect(calls).toEqual(['here 1'])
  })

  it('a copy still in the worker is made again here, and its late answer dropped', async () => {
    const { t, m, store, c, calls, inWorker, settle } = setup()
    c.start()
    store.emit('dispatch')
    t.advance(5000)
    expect(calls).toEqual(['worker 1'])
    await c.leave()
    expect(calls).toEqual(['worker 1', 'here 2'])
    expect(m.slots.get('me')?.bytes).toEqual(new Uint8Array([2]))
    // The page survived after all (back-forward cache): the worker's older copy is not written.
    inWorker[0]!()
    await settle()
    expect(m.log).toEqual(['write me'])
    expect(m.slots.get('me')?.bytes).toEqual(new Uint8Array([2]))
  })

  it('a write still being stored: the copy is buffered, not written twice', async () => {
    const { b, store, options, calls } = setup({ ready: false })
    const log: string[] = []
    let finish = () => {}
    options.storage = {
      ...options.storage,
      write: (slot) => {
        log.push(`write ${slot.bytes[0]}`)
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    }
    const c = new RecoveryController(options)
    c.start()
    store.emit('dispatch')
    void c.flush()
    expect(log).toEqual(['write 1'])
    void c.leave()
    expect(calls).toEqual(['here 1', 'here 2'])
    expect(log).toEqual(['write 1'])
    expect(b.kept.get('me')?.bytes).toEqual(new Uint8Array([2]))
    // beforeunload, then pagehide: the copy buffered in the first isn't made again.
    void c.leave()
    expect(calls).toEqual(['here 1', 'here 2'])
    // Another project replaces this one: its buffered copy goes with the slot.
    store.emit('reset')
    expect(b.kept.size).toBe(0)
    finish()
  })

  it('a copy too large for the buffer (images) is still written, without an error', async () => {
    const { m, store, options } = setup()
    const errors: unknown[] = []
    const kept = new Map<string, string>()
    const kv = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
      key: (i: number) => [...kept.keys()][i] ?? null,
      get length() {
        return kept.size
      },
    }
    const big = new Uint8Array(3_000_000)
    const c = new RecoveryController({
      ...options,
      buffer: storageRecoveryBuffer(kv),
      snapshot: () => ({ bytes: big, file: null, tableNames: [], sheetCount: 1 }),
      onError: (e) => errors.push(e),
    })
    c.start()
    store.emit('dispatch')
    const left = c.leave()
    expect(m.log).toEqual(['write me'])
    expect(kept.size).toBe(0)
    await left
    expect(m.slots.get('me')?.bytes).toBe(big)
    expect(errors).toEqual([])
  })

  it('a page left with nothing unsaved clears its slot', async () => {
    const { m, b, store, c, calls } = setup({ ready: false })
    c.start()
    store.emit('dispatch')
    await c.flush()
    store.dirty = false
    await c.leave()
    expect(calls).toEqual(['here 1'])
    expect(m.log).toEqual(['write me', 'remove me'])
    expect(m.slots.size).toBe(0)
    expect(b.kept.size).toBe(0)
  })

  it('buffered copies of closed pages become slots at the next start', async () => {
    const { t, m, b, c } = setup({ live: ['open-page'] })
    const now = t.now()
    const buffered = (s: string, time: number, byte: number) =>
      b.kept.set(s, { record: record(s, time), bytes: new Uint8Array([byte]) })
    buffered('gone', now - 1000, 1)
    buffered('had-a-slot', now - 1000, 2)
    buffered('older', now - 5000, 3)
    buffered('open-page', now - 1000, 4)
    const slot = (s: string, time: number, handle: unknown) =>
      m.slots.set(s, { record: record(s, time), bytes: new Uint8Array([9]), handle })
    slot('had-a-slot', now - 9000, 'handle-a')
    slot('older', now - 2000, 'handle-b')

    const offered = await c.orphans()
    expect(offered.map((r) => r.session).sort()).toEqual(['gone', 'had-a-slot', 'older'])
    expect(m.slots.get('gone')?.bytes).toEqual(new Uint8Array([1]))
    // The newer copy wins; the slot's file handle is kept.
    expect(m.slots.get('had-a-slot')).toMatchObject({
      bytes: new Uint8Array([2]),
      handle: 'handle-a',
    })
    expect(m.slots.get('older')?.bytes).toEqual(new Uint8Array([9]))
    // An open page's buffer is its own business.
    expect([...b.kept.keys()]).toEqual(['open-page'])
    expect(m.slots.has('open-page')).toBe(false)
  })
})

describe('the localStorage buffer', () => {
  const kv = (quota = Number.POSITIVE_INFINITY) => {
    const data = new Map<string, string>()
    return {
      data,
      storage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem(k: string, v: string) {
          if (v.length > quota) throw new Error('QuotaExceededError')
          data.set(k, v)
        },
        removeItem: (k: string) => void data.delete(k),
        key: (i: number) => [...data.keys()][i] ?? null,
        get length() {
          return data.size
        },
      },
    }
  }

  it('keeps one copy per session and reads it back; drops damaged entries', () => {
    const { data, storage } = kv()
    const buffer = storageRecoveryBuffer(storage)
    const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 256)
    expect(buffer.put(record('a', 1), big)).toBe(true)
    expect(buffer.put(record('b', 2), new Uint8Array([1, 2, 3]))).toBe(true)
    expect(buffer.put(record('b', 3), new Uint8Array([4]))).toBe(true)
    data.set('ps.recovery.buffer:bad', '{')
    data.set('ps.recovery.buffer:x', JSON.stringify({ record: record('not-x', 1), bytes: 'AAAA' }))
    data.set('ps.recovery.alive', '{}')
    const all = buffer.all()
    expect(all.map((c) => c.record.session).sort()).toEqual(['a', 'b'])
    expect(all.find((c) => c.record.session === 'a')?.bytes).toEqual(big)
    expect(all.find((c) => c.record.session === 'b')).toEqual({
      record: record('b', 3),
      bytes: new Uint8Array([4]),
    })
    expect([...data.keys()].sort()).toEqual([
      'ps.recovery.alive',
      'ps.recovery.buffer:a',
      'ps.recovery.buffer:b',
    ])
    buffer.drop('a')
    expect(buffer.all().map((c) => c.record.session)).toEqual(['b'])
  })

  it('refuses a copy too large or past the quota, leaving no older one behind', () => {
    const small = kv()
    const buffer = storageRecoveryBuffer(small.storage, 10)
    expect(buffer.put(record('a', 1), new Uint8Array(10))).toBe(true)
    expect(buffer.put(record('a', 2), new Uint8Array(11))).toBe(false)
    expect(small.data.size).toBe(0)

    const full = kv(400)
    const limited = storageRecoveryBuffer(full.storage)
    expect(limited.put(record('a', 1), new Uint8Array(10))).toBe(true)
    expect(limited.put(record('a', 2), new Uint8Array(1000))).toBe(false)
    expect(limited.all()).toEqual([])
  })
})

describe('a recovery copy round trip', () => {
  it('is what Save writes, and reopens as an unsaved project', () => {
    const services = createServices({ fonts: {} as never, platform: {} as never })
    const project = createProject('P', new Date('2026-01-01T00:00:00Z'))
    const table = createTable({ name: 'Weights', rows: 1, columns: 1 })
    project.nodes[table.id] = table
    project.order.push(table.id)
    services.store.reset(project)
    const bytes = serialize(services, { selected: table.id })

    const other = createServices({ fonts: {} as never, platform: {} as never })
    expect(load(other, bytes, { unsaved: true })).toEqual({ selected: table.id, notes: [] })
    expect(other.store.dirty).toBe(true)
    expect(other.store.getState().nodes[table.id]?.name).toBe('Weights')
    expect(load(other, bytes).selected).toBe(table.id)
    expect(other.store.dirty).toBe(false)
  })
})

describe('large tables (roadmap 34e)', () => {
  it('copies of a project with large tables come from the worker, never made here as the page goes', async () => {
    const t = fakeTimers()
    const m = memoryStorage()
    const b = memoryBuffer()
    const store = fakeStore()
    const calls: string[] = []
    const inWorker: (() => void)[] = []
    let n = 0
    const serializer = { warm: () => {}, ready: false }
    const c = new RecoveryController({
      storage: m.storage,
      liveness: { claim: () => () => {}, live: async () => new Set() },
      session: 'me',
      store,
      serializer,
      buffer: b.buffer,
      large: () => true,
      snapshot: (here) => {
        const v = ++n
        calls.push(`${here ? 'here' : 'worker'} ${v}`)
        const bytes = new Uint8Array([v])
        return {
          bytes: here
            ? bytes
            : new Promise<Uint8Array>((resolve) => inWorker.push(() => resolve(bytes))),
          file: null,
          tableNames: ['cells'],
          sheetCount: 1,
        }
      },
      timers: t,
      idle: (fn) => fn(),
    })
    c.start()
    // Hidden while the worker still loads: no copy here, and no worker started now (the page may
    // be going away); the copy stays scheduled, then comes from the worker.
    store.emit('dispatch')
    await c.flush()
    void c.leave()
    expect(calls).toEqual([])
    t.advance(5000)
    expect(calls).toEqual(['worker 1'])
    inWorker[0]!()
    await new Promise((r) => setTimeout(r, 0))
    expect(m.slots.get('me')?.bytes).toEqual(new Uint8Array([1]))
    serializer.ready = true
    // Leaving with an edit pending, the worker running: its copy (best effort), nothing buffered.
    store.emit('dispatch')
    void c.leave()
    expect(calls).toEqual(['worker 1', 'worker 2'])
    expect(b.kept.size).toBe(0)
    // Nothing pending (the copy is on its way): no copy made here.
    store.emit('dispatch')
    t.advance(5000)
    expect(calls).toEqual(['worker 1', 'worker 2', 'worker 3'])
    void c.leave()
    expect(calls).toEqual(['worker 1', 'worker 2', 'worker 3'])
  })

  it('the worker gets large tables as binary columns, transferred, and writes the same file', () => {
    const project = createProject('P', new Date('2026-01-01T00:00:00Z'))
    const table = syntheticTable({ rows: 6000, genes: 4, pcs: 2 })
    project.nodes[table.id] = table
    project.order.push(table.id)
    const sent: { msg: SerializeRequest; transfer?: Transferable[] }[] = []
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (msg, transfer) => void sent.push({ msg, transfer }),
      terminate: () => {},
    }
    const s = createSerializer({ createWorker: () => worker, fallback: () => new Uint8Array() })
    void s.serialize(project, new Map(), null, new Map())
    const { msg, transfer } = sent[0]!
    // The table's JSON names its columns; their bytes are transferred, not cloned.
    expect(JSON.stringify(msg.project.nodes[table.id])).toContain('"$col"')
    const columns = [...msg.packed.get(table.id)!.columns.values()]
    expect(transfer).toHaveLength(columns.length)
    expect(columns.length).toBeGreaterThan(table.dataSets.length - 1)
    const now = new Date('2026-01-02T00:00:00Z')
    expect(writeProjectFile(msg.project, { now, packed: msg.packed })).toEqual(
      writeProjectFile(project, { now }),
    )
  })
})
