import { type Command, GROUPS } from '../commands/index.ts'
import { ALIGN_EDGES, type AlignEdge, type ZOrder } from './arrange.ts'
import { DRAW_TOOLS, type DrawTool } from './tools.ts'

// The layout view's commands for page items of any kind (roadmap 32): drawing tools, Image… and
// Table…, Duplicate, one step forward or back, Group / Ungroup / Lock, Align ▸ and Distribute ▸.

/** A place in the Arrange menu. */
export const arrangeMenu = (group: number, order: number, submenu?: string) => ({
  menu: 'arrange' as const,
  group,
  order,
  ...(submenu ? { submenu } : {}),
})

export function pageItemCommands(o: {
  /** How many items are selected, and how many units (items or groups) they make. */
  selected: number
  units: number
  anyLocked: boolean
  canGroup: boolean
  grouped: boolean
  lockedCount: number
  tool: DrawTool | null
  setTool: (t: DrawTool | null) => void
  zorder: (op: ZOrder) => void
  group: () => void
  ungroup: () => void
  lock: () => void
  unlockAll: () => void
  align: (edge: AlignEdge) => void
  distribute: (axis: 'x' | 'y') => void
  pickImage: () => void
  openTable: () => void
  duplicate: () => void
}): Command[] {
  return [
    {
      id: 'arrange.bringForward',
      label: 'Bring forward',
      menu: arrangeMenu(GROUPS.arrange.order, 12),
      enabled: o.selected > 0,
      run: () => o.zorder('forward'),
    },
    {
      id: 'arrange.sendBackward',
      label: 'Send backward',
      menu: arrangeMenu(GROUPS.arrange.order, 14),
      enabled: o.selected > 0,
      run: () => o.zorder('backward'),
    },
    {
      id: 'arrange.group',
      label: 'Group',
      menu: arrangeMenu(GROUPS.arrange.group, 10),
      shortcut: 'Mod+G',
      enabled: o.canGroup,
      hint: 'Make the selected items one: they move, resize and stack together',
      run: o.group,
    },
    {
      id: 'arrange.ungroup',
      label: 'Ungroup',
      menu: arrangeMenu(GROUPS.arrange.group, 20),
      shortcut: 'Mod+Shift+G',
      enabled: o.grouped,
      run: o.ungroup,
    },
    {
      id: 'arrange.lock',
      label: 'Lock',
      menu: arrangeMenu(GROUPS.arrange.group, 30),
      enabled: o.selected > 0 && !o.anyLocked,
      hint: 'Keep the selected items from being picked or moved on the page (unlock them from the Page panel)',
      run: o.lock,
    },
    {
      id: 'arrange.unlockAll',
      label: 'Unlock all',
      menu: arrangeMenu(GROUPS.arrange.group, 40),
      enabled: o.lockedCount > 0,
      run: o.unlockAll,
    },
    ...ALIGN_EDGES.map(
      ([edge, label], i): Command => ({
        id: `arrange.align.${edge}`,
        label,
        menu: arrangeMenu(GROUPS.arrange.align, 1 + i, 'Align'),
        enabled: o.units > 0 && !o.anyLocked,
        keywords: ['align'],
        hint:
          o.units > 1
            ? 'Line up the selected items within their bounds'
            : 'Line up the selected item on the page',
        run: () => o.align(edge),
      }),
    ),
    {
      id: 'arrange.distribute.x',
      label: 'Horizontally',
      menu: arrangeMenu(GROUPS.arrange.align, 7, 'Distribute'),
      enabled: o.units >= 3 && !o.anyLocked,
      keywords: ['distribute', 'space evenly'],
      hint: 'Space three or more items evenly from left to right',
      run: () => o.distribute('x'),
    },
    {
      id: 'arrange.distribute.y',
      label: 'Vertically',
      menu: arrangeMenu(GROUPS.arrange.align, 8, 'Distribute'),
      enabled: o.units >= 3 && !o.anyLocked,
      keywords: ['distribute', 'space evenly'],
      hint: 'Space three or more items evenly from top to bottom',
      run: () => o.distribute('y'),
    },
    ...DRAW_TOOLS.map(
      (t, i): Command => ({
        id: `insert.${t.tool === 'text' ? 'textBox' : t.tool}`,
        label: t.label,
        menu: { menu: 'insert', group: GROUPS.insert.page, order: 30 + i },
        icon: t.icon,
        checked: o.tool === t.tool,
        keywords: ['draw', 'shape'],
        hint: `${t.hint} (Shift: ${t.tool === 'line' || t.tool === 'arrow' ? '45° steps' : 'square or circle'}; Escape puts the tool down)`,
        run: () => o.setTool(o.tool === t.tool ? null : t.tool),
      }),
    ),
    {
      id: 'insert.image',
      label: 'Image…',
      menu: { menu: 'insert', group: GROUPS.insert.page, order: 40 },
      icon: 'image',
      keywords: ['picture', 'photo', 'png', 'jpeg', 'micrograph', 'blot'],
      hint: 'Place a PNG or JPEG image on the page (or paste one, or drop the file on the page)',
      run: o.pickImage,
    },
    {
      // Not 'insert.table': that is the app's New data table… (audit 2, U2).
      id: 'insert.liveTable',
      label: 'Table…',
      menu: { menu: 'insert', group: GROUPS.insert.page, order: 41 },
      icon: 'table',
      keywords: ['live table', 'results table'],
      hint: 'Show a data table or a sheet of results on the page, kept up to date',
      run: o.openTable,
    },
    {
      id: 'edit.duplicate',
      label: 'Duplicate',
      menu: { menu: 'edit', group: GROUPS.edit.clipboard, order: 35 },
      shortcut: 'Mod+D',
      enabled: o.selected > 0,
      hint: 'A copy of the selected items, a little down and to the right',
      run: o.duplicate,
    },
  ]
}
