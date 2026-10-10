import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pageItemCommands } from '../src/layout/itemCommands.ts'

// Audit 2, U2: a command id names one action. The registry keeps the first command of an id
// (a view overriding the app's), so two features sharing an id hide one of them (the page's
// Table… hid the app's New data table…). Only these ids are registered by more than one view on
// purpose, each the same action in that view.
const PER_VIEW = new Set([
  'edit.copy',
  'edit.paste',
  'edit.selectAll',
  'file.export',
  'format.axes',
  'format.graph',
  // Format… named by the selection: the canvas' element, or a part of a graph on a page.
  'format.selection',
  // A line, an arrow or a text box: on a graph, or on a page.
  'insert.arrow',
  'insert.line',
  'insert.text',
  'view.everyPoint',
])

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  )
}

/** Every command id written out in the sources, with the files registering it. */
function idsByFile(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (id: string, file: string) => out.set(id, (out.get(id) ?? new Set()).add(file))
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\bid: '([a-z]+\.[A-Za-z.]+)'/g))
      add(m[1]!, file.slice(SRC.length))
  }
  // The page's drawing tools, whose ids are made from the tool names.
  const noop = () => {}
  const page = pageItemCommands({
    selected: 0,
    units: 0,
    anyLocked: false,
    canGroup: false,
    grouped: false,
    lockedCount: 0,
    tool: null,
    setTool: noop,
    zorder: noop,
    group: noop,
    ungroup: noop,
    lock: noop,
    unlockAll: noop,
    align: noop,
    distribute: noop,
    pickImage: noop,
    openTable: noop,
    duplicate: noop,
  })
  for (const c of page) add(c.id, 'layout/itemCommands.ts')
  return out
}

describe('command ids', () => {
  const ids = idsByFile()
  it('finds the app’s commands', () => {
    expect(ids.get('insert.table')).toEqual(new Set(['App.tsx']))
    expect(ids.get('insert.liveTable')).toEqual(new Set(['layout/itemCommands.ts']))
  })
  it('two different features never share an id', () => {
    const shared = [...ids].filter(([id, files]) => files.size > 1 && !PER_VIEW.has(id))
    expect(shared.map(([id, files]) => `${id}: ${[...files].join(', ')}`)).toEqual([])
  })
})
