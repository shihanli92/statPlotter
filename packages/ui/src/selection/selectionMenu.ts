import { type Command, GROUPS } from '../commands/index.ts'
import type { MenuEntry } from '../components/commandItems.ts'
import type { SameScope } from './sameKind.ts'

// What the context menus of a selection offer from the command registry (roadmap 45): the format
// painter's commands with the count of what they act on, and Select ▸ Same kind. The graph
// canvas and layout pages list them by id; a command not registered is left out of the menu
// (`commandItems`), so a menu lists one as soon as a view registers it.

/**
 * The format painter's commands (roadmap 45: Copy format, Paste format, Paste format with
 * colour), registered by the format bar. The context menus of the canvas and pages list these ids
 * after what applies to the selection, with its count when several are selected ("Paste format
 * (3)"); until they are registered, the menus leave them out. More selection commands slot in by
 * adding their ids here.
 */
export const FORMAT_MENU_IDS: readonly string[] = [
  'format.copyFormat',
  'format.pasteFormat',
  'format.pasteFormatWithColour',
]

/**
 * Context-menu entries for registry commands acting on a selection of `count` elements: a divider,
 * then each command ("Paste format (3)" when several); none of them registered, nothing.
 */
export function selectionCommandEntries(ids: readonly string[], count: number): MenuEntry[] {
  return ids.length ? ['-', ...ids.map((command) => ({ command, count }))] : []
}

/** The registry ids of Select ▸ Same kind, by how far it reaches. */
export const SAME_KIND_IDS: Record<SameScope, string> = {
  kind: 'edit.selectSameKind',
  everyLayer: 'edit.selectSameKindEveryLayer',
  everyGraph: 'edit.selectSameKindEveryGraph',
}

const SCOPE_NAMES: Record<SameScope, string> = {
  kind: '',
  everyLayer: ' in every layer',
  everyGraph: ' in every graph',
}

const sentence = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`

/**
 * The Select ▸ submenu of a context menu: Same kind's commands (registered by the view), named
 * for the submenu ("All titles", "All data sets in every layer"); the wider ones only when they
 * apply.
 */
export function selectMenuEntry(scopes: readonly SameScope[]): MenuEntry {
  return {
    submenu: 'Select',
    entries: scopes.map((s) => ({
      command: SAME_KIND_IDS[s],
      label: (l: string) => sentence(l.replace(/^Select /, '')),
      ...(s === 'kind' ? {} : { ifEnabled: true }),
    })),
  }
}

/**
 * Same kind as registry commands (Edit menu, palette, the context menus' Select ▸): `names` is
 * what each scope would select ("titles", "data sets in every layer"; null: nothing), `run`
 * selects it.
 */
export function sameKindCommands(
  scopes: readonly SameScope[],
  names: (scope: SameScope) => string | null,
  run: (scope: SameScope) => void,
): Command[] {
  return scopes.map((scope, i): Command => {
    const name = names(scope)
    return {
      id: SAME_KIND_IDS[scope],
      label: name ? `Select all ${name}` : `Select same kind${SCOPE_NAMES[scope]}`,
      menu: { menu: 'edit', group: GROUPS.edit.clipboard, order: 61 + i },
      enabled: !!name,
      hideInPalette: scope !== 'kind' && !name,
      keywords: ['same kind', 'similar', 'select same'],
      hint:
        scope === 'kind'
          ? 'Select every element of the kind of the one selected: all titles, all tick labels, all data sets of its layer, all brackets…'
          : scope === 'everyLayer'
            ? 'Select the data sets of every layer, like the one selected'
            : 'Select every element of this kind in every graph on the page',
      run: () => run(scope),
    }
  })
}
