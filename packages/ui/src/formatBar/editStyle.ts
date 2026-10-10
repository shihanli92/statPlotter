import type { DocumentStore } from '@ps/engine'
import { FONT_SHORT, type FontRegistry, type StylePath } from '@ps/graph'
import type { GraphPathSegment } from '@ps/model'
import type { ElementStylePatch } from '../richText/RichTextEditor.tsx'
import { type TextSlot, textCommands } from './selectionStyles.ts'

// Roadmap 45 (the user's choice): in the in-place text editor with the whole text selected (as
// it opens), font, size and colour set the element's style as the format bar does — the field
// cleared from the element's runs in the same step — rather than giving every run the value.

/** The selection key of the element whose text an in-place edit opened (its content's path). */
export function editedElement(path: readonly GraphPathSegment[]): StylePath | null {
  if (path[0] === 'title') return ['title']
  if (path[0] === 'axes' && path[2] === 'title') return path.slice(0, 3) as StylePath
  if (path[0] === 'annotations') return path.slice(0, 2) as StylePath
  return null
}

/** The undo label of a whole-text change. */
export function patchLabel(patch: ElementStylePatch): string {
  if (patch.size !== undefined) return `Font size ${patch.size} pt`
  if (patch.font !== undefined) return `Font ${FONT_SHORT[patch.font]}`
  return 'Text colour'
}

/**
 * Sets the edited element's style (one step; quick repeats merge), once the family chosen is
 * loaded (a drawing never measures with another font).
 */
export function setEditedStyle(
  store: DocumentStore,
  fonts: Pick<FontRegistry, 'has' | 'ensure'>,
  slot: TextSlot | undefined,
  patch: ElementStylePatch,
): void {
  if (!slot) return
  const go = () =>
    store.dispatch(textCommands([slot], patch), patchLabel(patch), {
      coalesce: `edit:${slot.node}:${JSON.stringify(slot.path)}:${Object.keys(patch).join()}`,
    })
  if (patch.font && !fonts.has(patch.font)) void fonts.ensure([patch.font]).then(go, () => {})
  else go()
}
