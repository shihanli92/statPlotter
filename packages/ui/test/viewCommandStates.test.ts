import { createTable, type DataTable, gridColumns } from '@ps/model'
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands/index.ts'
import { pageItemCommands } from '../src/layout/itemCommands.ts'
import { type EditingState, editingCommands } from '../src/table/editingCommands.ts'

// Audit 2 (U12): the layout page's item commands and the table view's editing commands, as plain
// command values: when each is enabled, what it is called, and what it runs.

const byId = (commands: Command[]) => {
  const map = new Map(commands.map((c) => [c.id, c]))
  expect(map.size).toBe(commands.length)
  return (id: string) => {
    const c = map.get(id)
    if (!c) throw new Error(`no command ${id}`)
    return c
  }
}
const enabled = (c: Command) => c.enabled !== false

describe('the layout page’s item commands', () => {
  const calls: string[] = []
  const commands = (o: Partial<Parameters<typeof pageItemCommands>[0]> = {}) =>
    byId(
      pageItemCommands({
        selected: 0,
        units: 0,
        anyLocked: false,
        canGroup: false,
        grouped: false,
        lockedCount: 0,
        tool: null,
        setTool: (t) => calls.push(`tool ${t}`),
        zorder: (op) => calls.push(`zorder ${op}`),
        group: () => calls.push('group'),
        ungroup: () => calls.push('ungroup'),
        lock: () => calls.push('lock'),
        unlockAll: () => calls.push('unlockAll'),
        align: (edge) => calls.push(`align ${edge}`),
        distribute: (axis) => calls.push(`distribute ${axis}`),
        pickImage: () => calls.push('image'),
        openTable: () => calls.push('table'),
        duplicate: () => calls.push('duplicate'),
        ...o,
      }),
    )

  it('needs a selection to order, lock, duplicate or align; three units to distribute', () => {
    const none = commands()
    for (const id of [
      'arrange.bringForward',
      'arrange.sendBackward',
      'arrange.lock',
      'edit.duplicate',
      'arrange.align.left',
      'arrange.distribute.x',
      'arrange.group',
      'arrange.ungroup',
      'arrange.unlockAll',
    ])
      expect(enabled(none(id)), id).toBe(false)
    // Drawing tools, Image… and Table… need nothing selected.
    for (const id of ['insert.line', 'insert.textBox', 'insert.image', 'insert.liveTable'])
      expect(enabled(none(id)), id).toBe(true)

    const two = commands({ selected: 2, units: 2 })
    expect(enabled(two('arrange.bringForward'))).toBe(true)
    expect(enabled(two('arrange.align.middle'))).toBe(true)
    expect(enabled(two('arrange.distribute.y'))).toBe(false)
    expect(two('arrange.align.left').hint).toMatch(/within their bounds/)
    expect(commands({ selected: 1, units: 1 })('arrange.align.left').hint).toMatch(/on the page/)
    expect(enabled(commands({ selected: 3, units: 3 })('arrange.distribute.y'))).toBe(true)
    // A group counts as one unit.
    expect(enabled(commands({ selected: 3, units: 2 })('arrange.distribute.x'))).toBe(false)
  })

  it('leaves locked items where they are, and offers what the selection allows', () => {
    const locked = commands({ selected: 3, units: 3, anyLocked: true, lockedCount: 1 })
    expect(enabled(locked('arrange.lock'))).toBe(false)
    expect(enabled(locked('arrange.align.right'))).toBe(false)
    expect(enabled(locked('arrange.distribute.x'))).toBe(false)
    expect(enabled(locked('arrange.unlockAll'))).toBe(true)
    // Ordering and duplicating still work on locked items.
    expect(enabled(locked('arrange.sendBackward'))).toBe(true)
    expect(enabled(locked('edit.duplicate'))).toBe(true)
    const c = commands({ selected: 2, units: 2, canGroup: true, grouped: true })
    expect(enabled(c('arrange.group'))).toBe(true)
    expect(enabled(c('arrange.ungroup'))).toBe(true)
  })

  it('runs its action; a tool’s command picks it up, or puts it down when held', () => {
    calls.length = 0
    const c = commands({ selected: 3, units: 3 })
    for (const id of [
      'arrange.bringForward',
      'arrange.sendBackward',
      'arrange.group',
      'arrange.ungroup',
      'arrange.lock',
      'arrange.unlockAll',
      'arrange.align.center',
      'arrange.align.bottom',
      'arrange.distribute.x',
      'arrange.distribute.y',
      'insert.image',
      'insert.liveTable',
      'edit.duplicate',
      'insert.arrow',
    ])
      c(id).run()
    expect(calls).toEqual([
      'zorder forward',
      'zorder backward',
      'group',
      'ungroup',
      'lock',
      'unlockAll',
      'align center',
      'align bottom',
      'distribute x',
      'distribute y',
      'image',
      'table',
      'duplicate',
      'tool arrow',
    ])
    calls.length = 0
    const holding = commands({ tool: 'rect' })
    expect(holding('insert.rect').checked).toBe(true)
    expect(holding('insert.ellipse').checked).toBe(false)
    holding('insert.rect').run()
    holding('insert.ellipse').run()
    expect(calls).toEqual(['tool null', 'tool ellipse'])
  })

  it('places Align and Distribute in their Arrange submenus, the tools under Insert', () => {
    const c = commands()
    expect(c('arrange.align.top').menu).toMatchObject({ menu: 'arrange', submenu: 'Align' })
    expect(c('arrange.distribute.x').menu).toMatchObject({ submenu: 'Distribute' })
    expect(c('insert.textBox').menu).toMatchObject({ menu: 'insert' })
    expect(c('insert.line').hint).toMatch(/45° steps/)
    expect(c('insert.rect').hint).toMatch(/square or circle/)
  })
})

describe('the table view’s editing commands', () => {
  const calls: string[] = []
  const table = (rows = 10): DataTable => ({
    ...createTable({ tableKind: 'column', columns: 3, rows }),
    name: 'T',
  })
  const state = (o: Partial<EditingState> = {}): EditingState => {
    const t = o.table ?? table()
    return {
      table: t,
      readOnly: false,
      summary: false,
      sel: { r0: 2, c0: 0, r1: 4, c1: 1 },
      selLast: 4,
      focusCol: gridColumns(t)[0],
      group: 'column',
      firstDataSet: 0,
      dataSetsSelected: 1,
      formattable: 1,
      act: {
        find: () => calls.push('find'),
        findStep: (d) => calls.push(`findStep ${d}`),
        dialog: (d) => calls.push(`dialog ${d}`),
        sort: (keys) => calls.push(`sort ${keys.map((k) => k.descending).join()}`),
        fillDown: () => calls.push('fillDown'),
        fillRight: () => calls.push('fillRight'),
        moveRows: (s) => calls.push(`moveRows ${s}`),
        moveColumns: (s) => calls.push(`moveColumns ${s}`),
      },
      ...o,
    }
  }
  const commands = (o: Partial<EditingState> = {}) => byId(editingCommands(state(o)))

  it('names the column a quick sort sorts by, and finds without replacing when read-only', () => {
    const c = commands()
    expect(c('edit.sortAscending').label).toBe('Sort ascending by Group A')
    expect(c('edit.sortDescending').label).toBe('Sort descending by Group A')
    expect(commands({ focusCol: undefined })('edit.sortAscending')).toMatchObject({
      label: 'Sort ascending by this column',
      enabled: false,
    })
    expect(c('edit.find').label).toBe('Find and replace…')
    expect(commands({ readOnly: true })('edit.find').label).toBe('Find…')
    expect(commands({ group: 'group' })('edit.moveColumnsLeft').label).toBe('Move group left')
  })

  it('changes nothing in a read-only table (results), but still finds', () => {
    const c = commands({ readOnly: true })
    for (const id of [
      'edit.sort',
      'edit.sortAscending',
      'edit.fillDown',
      'edit.fillRight',
      'edit.fillSeries',
      'edit.moveRowsUp',
      'edit.moveRowsDown',
      'edit.moveColumnsLeft',
      'edit.moveColumnsRight',
      'format.column',
    ])
      expect(enabled(c(id)), id).toBe(false)
    for (const id of ['edit.find', 'edit.findNext', 'edit.findPrevious'])
      expect(enabled(c(id)), id).toBe(true)
  })

  it('sorts and moves no rows of summary data or a table of one row', () => {
    const summary = commands({ summary: true })
    for (const id of ['edit.sort', 'edit.moveRowsUp', 'edit.moveRowsDown', 'edit.fillSeries'])
      expect(enabled(summary(id)), id).toBe(false)
    const one = table(1)
    expect(enabled(commands({ table: one, focusCol: gridColumns(one)[0] })('edit.sort'))).toBe(
      false,
    )
  })

  it('fills a selection more than a row (column) long; moves rows and columns within bounds', () => {
    const c = commands()
    expect(enabled(c('edit.fillDown'))).toBe(true)
    expect(enabled(c('edit.fillRight'))).toBe(true)
    const single = commands({ sel: { r0: 2, c0: 1, r1: 2, c1: 1 }, selLast: 2 })
    expect(enabled(single('edit.fillDown'))).toBe(false)
    expect(enabled(single('edit.fillRight'))).toBe(false)
    // Rows 2–4 of 10: up and down; the first row can't go up, the last can't go down.
    expect(enabled(c('edit.moveRowsUp'))).toBe(true)
    expect(enabled(c('edit.moveRowsDown'))).toBe(true)
    const top = commands({ sel: { r0: 0, c0: 0, r1: 1, c1: 0 }, selLast: 1 })
    expect(enabled(top('edit.moveRowsUp'))).toBe(false)
    const bottom = commands({ sel: { r0: 8, c0: 0, r1: 12, c1: 0 }, selLast: 9 })
    expect(enabled(bottom('edit.moveRowsDown'))).toBe(false)
    expect(enabled(bottom('edit.moveRowsUp'))).toBe(true)
    // A selection starting past the table's rows moves nothing.
    expect(enabled(commands({ sel: { r0: 10, c0: 0, r1: 11, c1: 0 } })('edit.moveRowsUp'))).toBe(
      false,
    )
    // Columns: the first can't go left, the last (of three) can't go right; none selected: none.
    expect(enabled(c('edit.moveColumnsLeft'))).toBe(false)
    expect(enabled(c('edit.moveColumnsRight'))).toBe(true)
    const last = commands({ firstDataSet: 1, dataSetsSelected: 2 })
    expect(enabled(last('edit.moveColumnsLeft'))).toBe(true)
    expect(enabled(last('edit.moveColumnsRight'))).toBe(false)
    expect(enabled(commands({ firstDataSet: -1 })('edit.moveColumnsRight'))).toBe(false)
    expect(enabled(commands({ formattable: 0 })('format.column'))).toBe(false)
  })

  it('runs its action', () => {
    calls.length = 0
    const c = commands()
    for (const id of [
      'edit.find',
      'edit.findNext',
      'edit.findPrevious',
      'edit.sort',
      'edit.sortAscending',
      'edit.sortDescending',
      'edit.fillDown',
      'edit.fillRight',
      'edit.fillSeries',
      'edit.moveRowsUp',
      'edit.moveRowsDown',
      'edit.moveColumnsLeft',
      'edit.moveColumnsRight',
      'format.column',
    ])
      c(id).run()
    expect(calls).toEqual([
      'find',
      'findStep 1',
      'findStep -1',
      'dialog sort',
      'sort false',
      'sort true',
      'fillDown',
      'fillRight',
      'dialog fillSeries',
      'moveRows -1',
      'moveRows 1',
      'moveColumns -1',
      'moveColumns 1',
      'dialog format',
    ])
    // Find works while typing in a field (the search box), as its shortcut says.
    expect(c('edit.find')).toMatchObject({ shortcut: 'Mod+F', inTextFields: true })
  })
})
