// @vitest-environment happy-dom
import type { ColorRef } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AutoChoice,
  ColorButtonField,
  type ColorState,
  colorChoices,
  currentChoice,
  moveIn,
  parseHex,
  recentColours,
  rememberColour,
} from '../src/components/ColorPicker.tsx'

// Roadmap 46 (V6): the colour control of the Format panel's fields and the format bar — a button
// opening a popover of choices (Automatic, the palette, greys, recent colours) and a custom colour.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const PALETTE = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#f0e442',
  '#000000',
  '#882255',
]

let root: Root | null = null
let host: HTMLElement | null = null
beforeEach(() => localStorage.clear())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

function render(state: ColorState, automatic: AutoChoice | null = null) {
  const onChange = vi.fn<(c: ColorRef | undefined, css: string | null) => void>()
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() =>
    root!.render(
      <ColorButtonField
        label="Data set colour"
        state={state}
        palette={PALETTE}
        automatic={automatic}
        onChange={onChange}
      />,
    ),
  )
  return onChange
}

const button = () => host!.querySelector('button.color-button') as HTMLButtonElement
const popover = () => document.querySelector('[data-testid="color-popover"]') as HTMLElement | null
const list = () => popover()!.querySelector('[role="listbox"]') as HTMLElement
const option = (name: string) =>
  [...popover()!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.getAttribute('aria-label') === name,
  )!
const key = (el: HTMLElement, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
const open = () => act(() => button().click())
const nameOf = (b: HTMLElement) =>
  (b.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ')

describe('the colour choices', () => {
  it('are Automatic and the series’ colour on rows of their own, then the palette, greys and recent colours by rows of 8', () => {
    const rows = colorChoices(PALETTE, {
      automatic: { label: 'Automatic' },
      allowSeries: true,
      recent: ['#123456'],
    })
    expect(rows.map((r) => r.map((c) => c.id))).toEqual([
      ['auto'],
      ['series'],
      ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
      ['p8'],
      // Black is in the palette: not repeated among the greys.
      ['g404040', 'g808080', 'gbfbfbf', 'gffffff'],
      ['r123456'],
    ])
    expect(rows[2]![0]!.value).toEqual({ palette: 0 })
    expect(rows[4]![0]!.value).toEqual({ rgb: '#404040' })
    expect(rows.flat().some((c) => c.label === 'Black')).toBe(false)
  })

  it('know the current one: Automatic, a palette entry by index, else the same colour; none when mixed', () => {
    const rows = colorChoices(PALETTE, { automatic: { label: 'Automatic' } })
    expect(currentChoice(rows, { css: '#0072b2', auto: true })).toBe('auto')
    expect(currentChoice(rows, { css: '#009e73', value: { palette: 2 } })).toBe('p2')
    expect(currentChoice(rows, { css: '#808080', value: { rgb: '#808080' } })).toBe('g808080')
    // A colour the palette has, stored as a colour: its palette swatch.
    expect(currentChoice(rows, { css: '#D55E00' })).toBe('p1')
    expect(currentChoice(rows, { css: '#d55e00', mixed: true })).toBeNull()
    expect(currentChoice(rows, { css: '#abcdef' })).toBeNull()
  })

  it('are walked by the arrows: along the order, and by rows at the same column', () => {
    const rows = colorChoices(PALETTE, { automatic: { label: 'Automatic' } })
    expect(moveIn(rows, 'auto', 'ArrowRight')).toBe('p0')
    expect(moveIn(rows, 'p0', 'ArrowLeft')).toBe('auto')
    // The row below is shorter: its last.
    expect(moveIn(rows, 'p3', 'ArrowDown')).toBe('p8')
    expect(moveIn(rows, 'p8', 'ArrowDown')).toBe('g404040')
    expect(moveIn(rows, 'p3', 'ArrowUp')).toBe('auto')
    expect(moveIn(rows, 'p7', 'ArrowRight')).toBe('p8')
    expect(moveIn(rows, 'p2', 'End')).toBe(rows.flat().at(-1)!.id)
    expect(moveIn(rows, 'p2', 'Home')).toBe('auto')
    expect(moveIn(rows, null, 'ArrowDown')).toBe('auto')
  })

  it('read hex colours loosely and remember the recent ones, most recent first', () => {
    expect(parseHex('ABC')).toBe('#aabbcc')
    expect(parseHex(' #12AB3f ')).toBe('#12ab3f')
    expect(parseHex('#12345')).toBeNull()
    rememberColour('#111111')
    rememberColour('#222222')
    rememberColour('#111111')
    expect(recentColours()).toEqual(['#111111', '#222222'])
    for (let i = 0; i < 12; i++) rememberColour(`#0000${String(i).padStart(2, '0')}`)
    expect(recentColours()).toHaveLength(8)
  })
})

describe('a colour field', () => {
  it('is a button named by its label and colour, opening a dialog with a listbox', () => {
    render({ css: '#009e73', value: { palette: 2 } })
    expect(nameOf(button())).toBe('Data set colour #009E73')
    expect(button().getAttribute('aria-haspopup')).toBe('dialog')
    expect(popover()).toBeNull()
    open()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(popover()!.getAttribute('role')).toBe('dialog')
    expect(popover()!.getAttribute('aria-label')).toBe('Data set colour')
    // In the body, not inside the panel.
    expect(popover()!.parentElement).toBe(document.body)
    expect(document.activeElement).toBe(list())
    expect(option('Palette colour 3').getAttribute('aria-selected')).toBe('true')
    expect(list().getAttribute('aria-activedescendant')).toBe(option('Palette colour 3').id)
  })

  it('picks a palette colour, a grey, Automatic', () => {
    const onChange = render({ css: '#0072b2', auto: true }, { label: 'Automatic', css: '#0072b2' })
    expect(nameOf(button())).toBe('Data set colour Automatic')
    open()
    expect(option('Automatic').getAttribute('aria-selected')).toBe('true')
    act(() => option('Palette colour 5').click())
    expect(onChange).toHaveBeenLastCalledWith({ palette: 4 }, '#e69f00')
    expect(popover()).toBeNull()
    open()
    act(() => option('Dark grey').click())
    expect(onChange).toHaveBeenLastCalledWith({ rgb: '#404040' }, '#404040')
    open()
    act(() => option('Automatic').click())
    expect(onChange).toHaveBeenLastCalledWith(undefined, '#0072b2')
  })

  it('from the keyboard: arrows move, Enter picks and gives the focus back; Escape closes', () => {
    const onChange = render({ css: '#0072b2', value: { palette: 0 } })
    act(() => button().focus())
    open()
    key(list(), 'ArrowRight')
    key(list(), 'ArrowDown')
    expect(list().getAttribute('aria-activedescendant')).toBe(option('Palette colour 9').id)
    key(list(), 'Enter')
    expect(onChange).toHaveBeenLastCalledWith({ palette: 8 }, '#882255')
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button())
    open()
    key(list(), 'ArrowRight')
    key(list(), 'Escape')
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('shows mixed colours striped, nothing chosen; a choice applies to all', () => {
    const onChange = render({ css: '', mixed: true })
    expect(nameOf(button())).toBe('Data set colour Mixed')
    expect(button().querySelector('.color-chip')!.classList.contains('mixed')).toBe(true)
    open()
    expect(popover()!.querySelectorAll('[aria-selected="true"]')).toHaveLength(0)
    act(() => option('Palette colour 8').click())
    expect(onChange).toHaveBeenLastCalledWith({ palette: 7 }, '#000000')
  })

  it('takes a custom colour typed in hex (the popover staying), remembered among the recent ones', () => {
    const onChange = render({ css: '#0072b2', value: { palette: 0 } })
    open()
    const hex = popover()!.querySelector('input[aria-label="Hex colour"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      set.call(hex, '#123456')
      hex.dispatchEvent(new Event('input', { bubbles: true }))
    })
    key(hex, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith({ rgb: '#123456' }, '#123456')
    expect(popover()).not.toBeNull()
    key(hex, 'Escape')
    open()
    expect(option('Recent colour #123456')).toBeDefined()
    act(() => option('Recent colour #123456').click())
    expect(onChange).toHaveBeenLastCalledWith({ rgb: '#123456' }, '#123456')
  })
})
