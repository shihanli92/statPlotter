import type { FontRegistry } from '@ps/graph'
import { createProject } from '@ps/model'
import { afterEach, describe, expect, it } from 'vitest'
import { createLayoutFor, newPageOf, newPageSpec } from '../src/layout/figure.ts'
import { savePreferences } from '../src/styles/styleStore.ts'

// Audit 2, U9: new pages of graphs (Add to page, an image dropped, Split into a set, Duplicate
// and stack) take the page size chosen in Preferences.

describe('new pages', () => {
  afterEach(() => savePreferences(undefined, {}))

  it('are Letter unless Preferences choose another size', async () => {
    expect(newPageSpec()).toEqual({ width: 612, height: 792 })
    await savePreferences(undefined, { pageSize: 'a4' })
    expect(newPageSpec()).toEqual({ width: 595.28, height: 841.89 })
    expect(newPageSpec('landscape')).toEqual({ width: 841.89, height: 595.28 })
    // Given a size (the examples), that size.
    expect(newPageSpec('portrait', 'letter')).toEqual({ width: 612, height: 792 })
  })

  it('place their items on the page they make', async () => {
    await savePreferences(undefined, { pageSize: 'a4' })
    let seen: unknown = null
    const layout = newPageOf('Page', (page) => {
      seen = page
      return []
    })
    expect(seen).toEqual(layout.page)
    expect(layout.page.width).toBe(595.28)
    expect(layout.panelLabels.show).toBe(true)
    // Dropped images' page (audit 2, U24): no panel labels.
    expect(newPageOf('Images', () => [], { labels: { show: false } }).panelLabels.show).toBe(false)
  })

  it('New layout: the size it is given, Letter by default', () => {
    const project = createProject()
    const fonts = undefined as unknown as FontRegistry
    expect(createLayoutFor(project, fonts, 'Layout 1').page).toEqual({ width: 612, height: 792 })
    const a4 = createLayoutFor(project, fonts, 'Layout 1', 'a4')
    expect(a4.page).toEqual({ width: 595.28, height: 841.89 })
    expect([a4.name, a4.items, a4.panelLabels.show]).toEqual(['Layout 1', [], true])
  })
})
