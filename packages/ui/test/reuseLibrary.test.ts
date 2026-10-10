import { describe, expect, it } from 'vitest'
import { folderLibrary, type LibraryFolder } from '../src/reuse/library.ts'
import { countNodes, nextInSeries } from '../src/reuse/names.ts'

/** A folder in memory, recording the operations the library asks for. */
function memoryFolder() {
  const files = new Map<string, { bytes: Uint8Array; modified: number }>()
  const log: string[] = []
  let clock = 0
  const folder: LibraryFolder = {
    ensure: async () => void log.push('ensure'),
    list: async () => [...files].map(([name, f]) => ({ name, modified: f.modified })),
    read: async (name) => {
      const f = files.get(name)
      if (!f) throw new Error('missing')
      return f.bytes
    },
    write: async (name, bytes) => {
      log.push(`write ${name}`)
      files.set(name, { bytes, modified: ++clock })
    },
    rename: async (from, to) => {
      log.push(`rename ${from} → ${to}`)
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    remove: async (name) => void files.delete(name),
  }
  return { folder, files, log }
}

describe('libraries of templates and methods', () => {
  it('keeps one file per name, written in place atomically, newest first', async () => {
    const { folder, files, log } = memoryFolder()
    const lib = folderLibrary(folder, 'psmethod')
    expect(await lib.list()).toEqual([])
    await lib.write('Dose: response?', new Uint8Array([1]))
    await lib.write('Two groups', new Uint8Array([2]))
    expect(log).toEqual([
      'ensure',
      'write Dose_ response_.psmethod.tmp',
      'rename Dose_ response_.psmethod.tmp → Dose_ response_.psmethod',
      'ensure',
      'write Two groups.psmethod.tmp',
      'rename Two groups.psmethod.tmp → Two groups.psmethod',
    ])
    files.set('notes.txt', { bytes: new Uint8Array(), modified: 99 })
    expect((await lib.list()).map((e) => e.name)).toEqual(['Two groups', 'Dose_ response_'])
    expect(await lib.read('Two groups')).toEqual(new Uint8Array([2]))
    expect(await lib.read('Missing')).toBeNull()
    await lib.remove('Two groups')
    expect((await lib.list()).map((e) => e.name)).toEqual(['Dose_ response_'])
  })

  it('lists nothing when the folder does not exist yet', async () => {
    const { folder } = memoryFolder()
    const lib = folderLibrary(
      { ...folder, list: () => Promise.reject(new Error('no folder')) },
      'x',
    )
    expect(await lib.list()).toEqual([])
  })
})

describe('names of copies', () => {
  it('continues a series, or says copy', () => {
    expect(nextInSeries('Day 1')).toBe('Day 2')
    expect(nextInSeries('Day 1', new Set(['Day 2', 'Day 3']))).toBe('Day 4')
    expect(nextInSeries('Plate 09')).toBe('Plate 10')
    expect(nextInSeries('Mouse 3 (left)')).toBe('Mouse 4 (left)')
    expect(nextInSeries('Weights', new Set(['Weights (copy)']))).toBe('Weights (copy 2)')
  })

  it('counts sheets by kind', () => {
    expect(countNodes([{ kind: 'analysis' }, { kind: 'graph' }, { kind: 'graph' }])).toBe(
      '1 analysis and 2 graphs',
    )
    expect(countNodes([{ kind: 'layout' }])).toBe('1 layout')
    expect(countNodes([])).toBe('nothing')
  })
})
