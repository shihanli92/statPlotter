// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ColorRef } from '@ps/model'
import { act, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ColorButtonField } from '../src/components/ColorPicker.tsx'
import { portalHost } from '../src/components/portalHost.ts'

// Decision 1212: a pop-up goes into the open dialog its button is in (a modal dialog makes the
// rest of the page inert and draws over it), else into the body; and no dialog is a containing
// block for fixed descendants, so the pop-ups' viewport coordinates hold inside one.

/** A file of the package, read as text (happy-dom's URL is not Node's: paths, not URLs). */
const source = (path: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), 'utf8')

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

/** A dialog in the body, open or not, holding a div. */
function dialogWith(open: boolean): { dialog: HTMLDialogElement; inside: HTMLDivElement } {
  const dialog = document.body.appendChild(document.createElement('dialog'))
  if (open) dialog.setAttribute('open', '')
  const inside = dialog.appendChild(document.createElement('div'))
  return { dialog, inside }
}

describe('portalHost', () => {
  it('is the body without an anchor, or for an anchor in no open dialog', () => {
    expect(portalHost(null)).toBe(document.body)
    expect(portalHost(undefined)).toBe(document.body)
    const plain = document.body.appendChild(document.createElement('button'))
    expect(portalHost(plain)).toBe(document.body)
    const { inside } = dialogWith(false)
    expect(portalHost(inside)).toBe(document.body)
  })

  it('is the open dialog the anchor is in, the innermost when dialogs nest', () => {
    const { dialog, inside } = dialogWith(true)
    const button = inside.appendChild(document.createElement('button'))
    expect(portalHost(button)).toBe(dialog)
    expect(portalHost(dialog)).toBe(dialog)
    const inner = inside.appendChild(document.createElement('dialog'))
    inner.setAttribute('open', '')
    const deep = inner.appendChild(document.createElement('span'))
    expect(portalHost(deep)).toBe(inner)
  })
})

describe('a colour field in an open dialog', () => {
  const PALETTE = ['#0072b2', '#d55e00', '#009e73']

  function render(inside: HTMLElement, onDialogKey: (e: ReactKeyboardEvent) => void) {
    const onChange = vi.fn<(c: ColorRef | undefined, css: string | null) => void>()
    root = createRoot(inside)
    act(() =>
      root!.render(
        // biome-ignore lint/a11y/noStaticElementInteractions: hears the keys as a Format dialog does
        <div onKeyDown={onDialogKey}>
          <ColorButtonField
            label="Data set colour"
            state={{ css: '#0072b2', value: { palette: 0 } }}
            palette={PALETTE}
            onChange={onChange}
          />
        </div>,
      ),
    )
    return onChange
  }
  const popover = () => document.querySelector<HTMLElement>('[data-testid="color-popover"]')
  /** Presses a key on `el`; true when the press was handled (its default prevented). */
  const press = (el: Element, key: string) => {
    let handled = false
    act(() => {
      handled = !el.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    })
    return handled
  }

  it('opens its popover inside the dialog (its own child), not in the body', () => {
    const { dialog, inside } = dialogWith(true)
    render(inside, () => {})
    const button = inside.querySelector<HTMLButtonElement>('button.color-button')!
    act(() => button.click())
    expect(popover()).not.toBeNull()
    expect(popover()!.parentElement).toBe(dialog)
    // Outside the dialog's scrolling body: its own child.
    expect(inside.contains(popover())).toBe(false)
  })

  it('keeps its keys: Enter picks and Escape closes without the dialog hearing them', () => {
    const { inside } = dialogWith(true)
    const dialogKeys = vi.fn()
    const onChange = render(inside, (e) => dialogKeys(e.key))
    const button = inside.querySelector<HTMLButtonElement>('button.color-button')!
    act(() => button.focus())
    act(() => button.click())
    const list = popover()!.querySelector('[role="listbox"]')!
    press(list, 'ArrowRight')
    // Handled: its default prevented (natively, Escape's would close the dialog).
    expect(press(list, 'Enter')).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith({ palette: 1 }, '#d55e00')
    expect(popover()).toBeNull()
    act(() => button.click())
    expect(press(popover()!.querySelector('[role="listbox"]')!, 'Escape')).toBe(true)
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button)
    // The dialog's own handler (Enter = OK, in the Format dialog) never saw them.
    expect(dialogKeys).not.toHaveBeenCalled()
  })

  it('still opens in the body outside a dialog', () => {
    const inside = document.body.appendChild(document.createElement('div'))
    render(inside, () => {})
    act(() => inside.querySelector<HTMLButtonElement>('button.color-button')!.click())
    expect(popover()!.parentElement).toBe(document.body)
  })
})

describe('the dialogs', () => {
  const css = source('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
  // What makes an element the containing block of its fixed descendants (and clips them with its
  // overflow): a transform of any kind, a filter, containment, a size container, will-change.
  const CONTAINING =
    /(^|;)\s*(transform|translate|rotate|scale|filter|backdrop-filter|perspective|contain|container|container-type|will-change)\s*:/

  it('are never containing blocks for fixed descendants (the style sheet)', () => {
    const offending: string[] = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selectors, body] = m
      for (const s of selectors!.split(',')) {
        const sel = s.trim()
        if (sel.startsWith('@') || sel.includes('::backdrop')) continue
        // The element the rule styles: its last compound selector.
        const last = sel.split(/\s*[\s>+~]\s*/).at(-1)!
        if (!/^dialog\b|\.dialog\b|\.format-dialog\b/.test(last)) continue
        if (CONTAINING.test(body!)) offending.push(sel)
      }
    }
    expect(offending).toEqual([])
    // The container query the Format dialog had is gone (it measures itself instead).
    expect(css).not.toMatch(/@container/)
  })

  it('never move by a transform (the Format dialog moves by its insets)', () => {
    for (const file of ['../src/graph/format/FormatDialog.tsx', '../src/components/Dialog.tsx']) {
      const src = source(file)
      expect(src, file).not.toMatch(/\b(translate|transform|containerType|willChange)\s*:/)
    }
  })
})
