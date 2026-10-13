import { describe, expect, it } from 'vitest'
import {
  ANALYZE_KEYS,
  CANVAS_KEYS,
  formatShortcut,
  isViewKey,
  NAVIGATOR_KEYS,
  PAGE_KEYS,
  VIEW_KEY_SECTIONS,
} from '../src/commands/index.ts'

// Audit 2, U20: keys the views handle themselves, in one table the shortcut sheet shows and the
// handlers test key presses against.

const press = (key: string, mods: { alt?: boolean; shift?: boolean } = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
})

describe('view keys', () => {
  it('are shown in three sections, each key written as the sheet writes shortcuts', () => {
    expect(VIEW_KEY_SECTIONS.map((s) => s.title)).toEqual([
      'In the navigator',
      'On the canvas',
      'On a page',
      'In the Analyze dialog',
    ])
    for (const s of VIEW_KEY_SECTIONS)
      for (const k of s.items)
        for (const text of k.keys) expect(formatShortcut(text, true)).toBeTruthy()
    expect(NAVIGATOR_KEYS.moveUp.keys.map((k) => formatShortcut(k, true))).toEqual(['⌥↑'])
    expect(NAVIGATOR_KEYS.remove.keys.map((k) => formatShortcut(k, false))).toEqual([
      'Del',
      'Backspace',
    ])
  })

  it('match the key presses the handlers act on, modifiers as written', () => {
    expect(isViewKey(NAVIGATOR_KEYS.moveUp, press('ArrowUp', { alt: true }))).toBe(true)
    expect(isViewKey(NAVIGATOR_KEYS.moveUp, press('ArrowUp'))).toBe(false)
    expect(isViewKey(NAVIGATOR_KEYS.rename, press('F2'))).toBe(true)
    expect(isViewKey(CANVAS_KEYS.next, press(']'))).toBe(true)
    expect(isViewKey(CANVAS_KEYS.previous, press(']'))).toBe(false)
    expect(isViewKey(PAGE_KEYS.remove, press('Backspace'))).toBe(true)
    expect(isViewKey(PAGE_KEYS.nudge, press('ArrowLeft'))).toBe(true)
    expect(isViewKey(PAGE_KEYS.nudge, press('ArrowLeft', { shift: true }))).toBe(false)
    expect(isViewKey(PAGE_KEYS.nudgeMore, press('ArrowLeft', { shift: true }))).toBe(true)
  })

  it('say what the canvas’ keys do now (audit 3: A3 nudges, A11 Delete, A1 entries)', () => {
    expect(CANVAS_KEYS.remove.label).toBe(
      'Delete the selection: annotations and layers deleted; data sets, points and legend entries hidden',
    )
    expect(isViewKey(CANVAS_KEYS.nudge, press('ArrowUp'))).toBe(true)
    expect(isViewKey(CANVAS_KEYS.nudgeMore, press('ArrowUp', { shift: true }))).toBe(true)
    expect(isViewKey(CANVAS_KEYS.nudge, press('ArrowUp', { alt: true }))).toBe(false)
    expect(CANVAS_KEYS.next.label).toMatch(/entry/)
  })

  // Audit 4 (A18): the Analyze dialog's keys, and moving around a zoomed graph or page.
  it('list the Analyze dialog’s keys and panning, written for the platform', () => {
    const text = (k: { keys: readonly string[] }, mac: boolean) =>
      k.keys.map((x) => formatShortcut(x, mac))
    expect(text(ANALYZE_KEYS.search, true)).toEqual(['⌘K'])
    expect(text(ANALYZE_KEYS.search, false)).toEqual(['Ctrl+K'])
    expect(text(ANALYZE_KEYS.tabs, false)).toEqual(['Ctrl+1', 'Ctrl+2'])
    expect(text(ANALYZE_KEYS.run, true)).toEqual(['⌘↩'])
    expect(text(ANALYZE_KEYS.reorder, false)).toEqual(['Alt+Left', 'Alt+Right'])
    expect(text(ANALYZE_KEYS.control, false)).toEqual(['C'])
    for (const k of [CANVAS_KEYS.pan, PAGE_KEYS.pan]) {
      expect(k.label).toMatch(/^With nothing selected, move around a zoomed/)
      expect(text(k, false)).toEqual([
        'Up',
        'Down',
        'Left',
        'Right',
        'PageUp',
        'PageDown',
        'Home',
        'End',
      ])
    }
  })

  it('the navigator’s Select all is ⌘A on macOS, Ctrl+A elsewhere (roadmap 47)', () => {
    const a = (meta: boolean, ctrl: boolean) => ({ ...press('a'), metaKey: meta, ctrlKey: ctrl })
    expect(isViewKey(NAVIGATOR_KEYS.selectAll, a(true, false), true)).toBe(true)
    expect(isViewKey(NAVIGATOR_KEYS.selectAll, a(false, true), true)).toBe(false)
    expect(isViewKey(NAVIGATOR_KEYS.selectAll, a(false, true), false)).toBe(true)
    expect(NAVIGATOR_KEYS.selectAll.keys.map((k) => formatShortcut(k, true))).toEqual(['⌘A'])
    expect(isViewKey(NAVIGATOR_KEYS.extend, press('ArrowDown', { shift: true }))).toBe(true)
    expect(isViewKey(NAVIGATOR_KEYS.extend, press('ArrowDown'))).toBe(false)
  })
})
