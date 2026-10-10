import type { AnnotationId, GraphNode, LayoutItemId, NodeId } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  type AnnotationsOf,
  holdAnnotations,
  placeAnnotations,
} from '../src/selection/annotationKeys.ts'
import { elementKey, selectionOf } from '../src/selection/selection.ts'

// Audit 3 (U2): a graph's annotations selected on the canvas or on a page are held by id, so an
// undo, a removal or an insertion before the selected one keeps the selection on it.

const g = 'g1' as NodeId
const text = (id: string) =>
  ({ id: id as AnnotationId, type: 'text' }) as unknown as GraphNode['annotations'][number]

describe('annotation keys held by id', () => {
  it('follow their annotation when the list changes before it, and go with it', () => {
    let list = [text('a'), text('b')]
    const of: AnnotationsOf = (k) => (k.kind === 'element' ? list : undefined)
    const sel = selectionOf([elementKey(g, ['title']), elementKey(g, ['annotations', 1, 'label'])])
    const held = holdAnnotations(sel, of)
    // A comes back before… (the list was [b] when the selection was made: the same id held).
    list = [text('z'), text('a'), text('b')]
    const placed = placeAnnotations(held, of)
    expect(placed.keys.map((k) => (k.kind === 'element' ? k.path : null))).toEqual([
      ['title'],
      ['annotations', 2, 'label'],
    ])
    expect(placed.primary).toBe(1)
    // B removed: its key goes, the one left becomes the primary.
    list = [text('z'), text('a')]
    const gone = placeAnnotations(held, of)
    expect(gone.keys).toEqual([elementKey(g, ['title'])])
    expect(gone.primary).toBe(0)
  })

  it('leave a selection without annotations as it is (the same object)', () => {
    const of: AnnotationsOf = () => [text('a')]
    const sel = selectionOf([elementKey(g, ['axes', 'y'])])
    expect(holdAnnotations(sel, of)).toBe(sel)
    expect(placeAnnotations(sel, of)).toBe(sel)
  })

  it('hold a page’s parts of graphs by id too', () => {
    let list = [text('a'), text('b')]
    const of: AnnotationsOf = (k) => (k.kind === 'pageElement' ? list : undefined)
    const key = {
      kind: 'pageElement' as const,
      layout: 'l1' as NodeId,
      item: 'i1' as LayoutItemId,
      path: ['annotations', 0],
    }
    const held = holdAnnotations(selectionOf([key]), of)
    list = [text('b'), text('a')]
    expect(placeAnnotations(held, of).keys).toEqual([{ ...key, path: ['annotations', 1] }])
  })
})
