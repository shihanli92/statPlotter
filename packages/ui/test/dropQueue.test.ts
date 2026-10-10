import { describe, expect, it } from 'vitest'
import { type DropHandled, DropQueue, type QueuedFiles } from '../src/drop/dropQueue.ts'

// Audit 2, U4: the queue of dropped files never stalls: a file that opened no dialog lets the
// next one start; one that opened a dialog waits for it to close.

const file = (name: string) => ({ name, blob: new Blob([]), handle: null })
const settle = () => new Promise((r) => setTimeout(r, 0))

function queueOf(handled: Record<string, Omit<DropHandled, 'outcome'> & { ok?: boolean }>) {
  const seen: string[] = []
  const summaries: string[] = []
  const q = new DropQueue(
    async (next: QueuedFiles) => {
      const name = next.files.map((f) => f.name).join('+')
      seen.push(name)
      const h = handled[name]
      if (!h) throw new Error('boom')
      return {
        outcome: { name, result: h.ok === false ? 'failed' : 'done', ok: h.ok !== false },
        waits: h.waits,
      }
    },
    (s) => summaries.push(s),
  )
  return { q, seen, summaries }
}

describe('the drop queue', () => {
  it('goes on after a project that couldn’t be read (no dialog opened)', async () => {
    const { q, seen, summaries } = queueOf({
      'a.csv': { waits: false },
      'broken.psproj': { waits: false, ok: false },
    })
    q.enqueue([file('broken.psproj'), file('a.csv')], 'other')
    await settle()
    expect(seen).toEqual(['a.csv', 'broken.psproj'])
    expect(q.waitingForDialog).toBe(false)
    expect(summaries).toEqual([
      '2 files dropped: 1 handled, 1 not. a.csv: done. broken.psproj: failed.',
    ])
  })

  it('waits for a dialog to close before the next file', async () => {
    const { q, seen, summaries } = queueOf({ 'a.csv': { waits: true }, 'b.csv': { waits: false } })
    q.enqueue([file('a.csv'), file('b.csv')], 'other')
    await settle()
    expect(seen).toEqual(['a.csv'])
    expect(q.waitingForDialog).toBe(true)
    q.dialogClosed()
    await settle()
    expect(seen).toEqual(['a.csv', 'b.csv'])
    expect(summaries).toHaveLength(1)
  })

  it('puts images together and goes on after a file that threw', async () => {
    const { q, seen, summaries } = queueOf({ 'p.png+q.png': { waits: false } })
    q.enqueue([file('p.png'), file('x.csv'), file('q.png')], 'other')
    await settle()
    expect(seen).toEqual(['p.png+q.png', 'x.csv'])
    expect(summaries[0]).toMatch(/x\.csv: failed \(Error: boom\)/)
  })

  it('a closed dialog with nothing waiting does nothing', async () => {
    const { q, seen } = queueOf({})
    q.dialogClosed()
    await settle()
    expect(seen).toEqual([])
  })
})
