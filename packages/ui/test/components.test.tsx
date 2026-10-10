// @vitest-environment happy-dom
import type { NodeId } from '@ps/model'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type Command, CommandsContext, createCommandRegistry } from '../src/commands/index.ts'
import { CommandPalette, type PaletteExtra } from '../src/components/CommandPalette.tsx'
import { Dialog } from '../src/components/Dialog.tsx'
import { lazyComponent, preloadAll } from '../src/components/lazy.tsx'
import { useModalHost } from '../src/components/modals.tsx'
import {
  errorToast,
  NOTICE_MS,
  type ToastMessage,
  Toasts,
  UNDO_NOTICE_MS,
  VALIDATION_MS,
} from '../src/components/Toasts.tsx'
import { Toolbar } from '../src/components/Toolbar.tsx'
import { CommandTip, TOOLTIP_DELAY_MS, Tooltip } from '../src/components/Tooltip.tsx'
import { requestReveal, useReveal } from '../src/table/reveal.ts'

type RowReveal = Parameters<typeof requestReveal>[0]

// Audit 2 (U12): components with logic of their own, rendered with React into happy-dom (a DOM
// in Node): the shared Dialog (named by its heading, Escape, the focus given back), the toasts
// (notices that go, paused while hovered or focused; errors that stay) and the command palette
// (search, keys, running a command).

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let host: HTMLElement | null = null

/** Renders `ui` into a fresh element of the page. */
function render(ui: ReactNode): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(ui))
  return host
}
const rerender = (ui: ReactNode) => act(() => root!.render(ui))
const unmount = () => {
  act(() => root?.unmount())
  root = null
}

afterEach(() => {
  unmount()
  host?.remove()
  host = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const button = (within: ParentNode, name: string) => {
  const b = [...within.querySelectorAll('button')].find(
    (x) => (x.getAttribute('aria-label') ?? x.textContent) === name,
  )
  if (!b) throw new Error(`no button ${name}`)
  return b
}
const click = (el: Element) => act(() => (el as HTMLElement).click())
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  let e: KeyboardEvent | null = null
  act(() => {
    e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(e)
  })
  return e!
}
/** Escape on a modal dialog: the browser's cancel event. */
const cancel = (d: HTMLDialogElement) => {
  const e = new Event('cancel', { cancelable: true })
  act(() => void d.dispatchEvent(e))
  return e
}
/** Types into an input as a user would (React reads the value through its own tracker). */
const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('the shared dialog', () => {
  it('opens modal, named by its heading, with Cancel and its OK button', () => {
    const onClose = vi.fn()
    const onOk = vi.fn()
    const el = render(
      <Dialog title="Sort rows" onClose={onClose} okLabel="Sort" onOk={onOk}>
        <p>Body</p>
      </Dialog>,
    )
    const d = el.querySelector('dialog')!
    expect(d.open).toBe(true)
    const heading = document.getElementById(d.getAttribute('aria-labelledby')!)
    expect(heading?.tagName).toBe('H2')
    expect(heading?.textContent).toBe('Sort rows')
    click(button(d, 'Sort'))
    expect(onOk).toHaveBeenCalledTimes(1)
    click(button(d, 'Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    // Escape closes through the app (the dialog stays until it is unmounted).
    const e = cancel(d)
    expect(e.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(2)
    rerender(
      <Dialog title="Sort rows" onClose={onClose} okLabel="Sort" onOk={onOk} okDisabled>
        <p>Body</p>
      </Dialog>,
    )
    expect(button(d, 'Sort').disabled).toBe(true)
  })

  it('takes a footer of its own instead of Cancel and OK', () => {
    const el = render(
      <Dialog title="About" onClose={() => {}} footer={<button type="button">Close</button>}>
        x
      </Dialog>,
    )
    expect([...el.querySelectorAll('footer button')].map((b) => b.textContent)).toEqual(['Close'])
  })

  it('gives the focus back to where it was when it closes', () => {
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    const el = render(
      <Dialog title="Rename" onClose={() => {}} okLabel="OK">
        <input aria-label="Name" />
      </Dialog>,
    )
    el.querySelector('input')!.focus()
    expect(document.activeElement).toBe(el.querySelector('input'))
    unmount()
    expect(document.activeElement).toBe(before)
  })

  it('leaves the focus where what closed it put it, or where it is when the old place is gone', () => {
    const before = document.createElement('button')
    const elsewhere = document.createElement('input')
    document.body.append(before, elsewhere)
    before.focus()
    render(
      <Dialog title="Rename" onClose={() => {}} okLabel="OK">
        x
      </Dialog>,
    )
    // The command that closed it opened a sheet and focused it.
    elsewhere.focus()
    unmount()
    expect(document.activeElement).toBe(elsewhere)

    before.focus()
    const el = render(
      <Dialog title="Rename" onClose={() => {}} okLabel="OK">
        <input aria-label="Name" />
      </Dialog>,
    )
    el.querySelector('input')!.focus()
    // What had the focus went away meanwhile (a row deleted): nothing to give it back to.
    before.remove()
    unmount()
    expect(document.activeElement).not.toBe(before)
  })
})

describe('the toasts', () => {
  const notice = (msg: string, key = 1): ToastMessage => ({ msg, kind: 'notice', key })
  const error = (msg: string, key = 1): ToastMessage => ({ msg, kind: 'error', key })
  const regions = (el: HTMLElement) => ({
    alert: el.querySelector('[role="alert"]')!,
    status: el.querySelector('[role="status"]')!,
  })

  it('keeps both live regions on the page, the error above the notice', () => {
    const onDismiss = vi.fn()
    const el = render(<Toasts error={null} notice={null} onDismiss={onDismiss} />)
    const r = regions(el)
    expect(r.alert.textContent).toBe('')
    expect(r.status.textContent).toBe('')
    rerender(
      <Toasts error={error('Save failed')} notice={notice('Copied')} onDismiss={onDismiss} />,
    )
    expect(regions(el).alert.textContent).toContain('Save failed')
    expect(regions(el).status.textContent).toContain('Copied')
    expect(
      r.alert.compareDocumentPosition(r.status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    click(button(r.alert, 'Dismiss'))
    expect(onDismiss).toHaveBeenLastCalledWith('error')
    click(button(r.status, 'Dismiss'))
    expect(onDismiss).toHaveBeenLastCalledWith('notice')
  })

  it('lets a notice go after a few seconds; an error stays until dismissed', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <Toasts error={error('Import failed')} notice={notice('Copied')} onDismiss={onDismiss} />,
    )
    act(() => vi.advanceTimersByTime(NOTICE_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith('notice')
    act(() => vi.advanceTimersByTime(NOTICE_MS * 10))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('counts a notice’s time again for the next message, even with the same text', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toasts error={null} notice={notice('Copied', 1)} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(NOTICE_MS - 100))
    rerender(<Toasts error={null} notice={notice('Copied', 2)} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(NOTICE_MS - 100))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('holds a notice while the pointer is on it or the focus in it', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const el = render(<Toasts error={null} notice={notice('Copied')} onDismiss={onDismiss} />)
    const toast = el.querySelector('.toast.notice')!
    act(() => void toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => vi.advanceTimersByTime(NOTICE_MS * 3))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => void toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    // Focus on its button holds it too.
    act(() => button(toast, 'Dismiss').focus())
    act(() => vi.advanceTimersByTime(NOTICE_MS * 3))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => button(toast, 'Dismiss').blur())
    act(() => vi.advanceTimersByTime(NOTICE_MS))
    expect(onDismiss).toHaveBeenCalledWith('notice')
  })

  // Roadmap 43: a notice's action ("Format graph · Undo") and validation messages that go.
  const undoNotice = (run = vi.fn(), key = 1): ToastMessage => ({
    msg: 'Format graph',
    kind: 'notice',
    key,
    duration: UNDO_NOTICE_MS,
    action: { label: 'Undo', run },
  })

  it('carries an action as a real button in the status region: it runs, then the notice goes', () => {
    const onDismiss = vi.fn()
    const run = vi.fn()
    const el = render(<Toasts error={null} notice={undoNotice(run)} onDismiss={onDismiss} />)
    const status = regions(el).status
    expect(status.textContent).toBe('Format graph · Undo×')
    const undo = button(status, 'Undo')
    expect(undo.type).toBe('button')
    click(undo)
    expect(run).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith('notice')
  })

  it('goes after its own time, held while focused; Escape in it dismisses, the focus back', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const before = document.createElement('button')
    document.body.append(before)
    const el = render(<Toasts error={null} notice={undoNotice()} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(UNDO_NOTICE_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    // Reached by keyboard from elsewhere: held, and Escape dismisses it.
    onDismiss.mockClear()
    rerender(<Toasts error={null} notice={undoNotice(vi.fn(), 2)} onDismiss={onDismiss} />)
    before.focus()
    const undo = button(regions(el).status, 'Undo')
    act(() => undo.focus())
    act(() => vi.advanceTimersByTime(UNDO_NOTICE_MS * 5))
    expect(onDismiss).not.toHaveBeenCalled()
    const e = key(undo, 'Escape')
    expect(e.defaultPrevented).toBe(true)
    expect(onDismiss).toHaveBeenCalledWith('notice')
    expect(document.activeElement).toBe(before)
  })

  it('lets a validation message go after a while; a failure stays', () => {
    vi.useFakeTimers()
    expect(errorToast('“abc” is not a number.', 'validation', 1).duration).toBe(VALIDATION_MS)
    expect(errorToast('Save failed', 'failure', 1).duration).toBeUndefined()
    const onDismiss = vi.fn()
    render(
      <Toasts
        error={errorToast('“abc” is not a number.', 'validation', 1)}
        notice={null}
        onDismiss={onDismiss}
      />,
    )
    act(() => vi.advanceTimersByTime(VALIDATION_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledWith('error')
    onDismiss.mockClear()
    rerender(
      <Toasts
        error={errorToast('Save failed', 'failure', 2)}
        notice={null}
        onDismiss={onDismiss}
      />,
    )
    act(() => vi.advanceTimersByTime(VALIDATION_MS * 10))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('the command palette', () => {
  const ran: string[] = []
  const command = (id: string, label: string, o: Partial<Command> = {}): Command => ({
    id,
    label,
    run: () => ran.push(id),
    ...o,
  })
  function palette(extras: PaletteExtra[] = [], onClose = vi.fn()) {
    const registry = createCommandRegistry()
    registry.set('app', 'app', [
      command('file.save', 'Save', { menu: { menu: 'file', group: 0 }, shortcut: 'Mod+S' }),
      command('edit.undo', 'Undo', { enabled: false, menu: { menu: 'edit', group: 0 } }),
      command('graph.new', 'New graph…', { keywords: ['plot', 'chart'] }),
      command('hidden.thing', 'Save hidden', { hideInPalette: true }),
    ])
    const el = render(
      <CommandsContext.Provider value={registry}>
        <CommandPalette extras={extras} onClose={onClose} />
      </CommandsContext.Provider>,
    )
    const input = el.querySelector('input')!
    const rows = () => [...el.querySelectorAll('[role="option"]')]
    const labels = () => rows().map((r) => r.querySelector('.palette-label')!.textContent)
    const active = () => {
      const id = input.getAttribute('aria-activedescendant')
      return id ? document.getElementById(id)?.querySelector('.palette-label')?.textContent : null
    }
    return { el, input, rows, labels, active, onClose }
  }

  it('lists the commands on offer and the shell’s entries, enabled first, with menu paths', () => {
    const extra: PaletteExtra = {
      id: 'analysis.t',
      label: 't test…',
      section: 'Analysis',
      enabled: true,
      run: () => ran.push('t'),
    }
    // An extra with a command's id is left out (the command stands for it).
    const dup: PaletteExtra = { ...extra, id: 'file.save', label: 'Save twice' }
    const p = palette([extra, dup])
    expect(p.el.querySelector('dialog')!.open).toBe(true)
    expect(p.labels()).toEqual(['Save', 'New graph…', 't test…', 'Undo'])
    const save = p.rows()[0]!
    expect(save.querySelector('.palette-section')!.textContent).toBe('File')
    expect(save.querySelector('kbd')).not.toBeNull()
    expect(p.rows()[1]!.querySelector('.palette-section')!.textContent).toBe('Command')
    expect(p.rows()[3]!.getAttribute('aria-disabled')).toBe('true')
    expect(p.active()).toBe('Save')
  })

  it('filters as the query is typed, by labels and keywords, and says when nothing matches', () => {
    const p = palette()
    type(p.input, 'chart')
    expect(p.labels()).toEqual(['New graph…'])
    type(p.input, 'sav')
    expect(p.labels()).toEqual(['Save'])
    type(p.input, 'zzz')
    expect(p.rows()).toHaveLength(0)
    expect(p.el.textContent).toContain('Nothing matches “zzz”.')
    expect(p.input.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('moves through the rows with the arrow keys and runs the chosen one with Enter', () => {
    ran.length = 0
    const p = palette()
    key(p.input, 'ArrowDown')
    expect(p.active()).toBe('New graph…')
    expect(p.rows()[1]!.getAttribute('aria-selected')).toBe('true')
    // Up from the first wraps to the last.
    key(p.input, 'ArrowUp')
    key(p.input, 'ArrowUp')
    expect(p.active()).toBe('Undo')
    // A disabled command doesn't run, nor close the palette.
    const e = key(p.input, 'Enter')
    expect(e.defaultPrevented).toBe(true)
    expect(ran).toEqual([])
    expect(p.onClose).not.toHaveBeenCalled()
    key(p.input, 'PageUp')
    expect(p.active()).toBe('Save')
    key(p.input, 'Enter')
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(ran).toEqual(['file.save'])
  })

  it('runs a clicked row, and closes on Escape and on ⌘K / Ctrl+K', () => {
    ran.length = 0
    const p = palette()
    click(p.rows()[1]!)
    expect(ran).toEqual(['graph.new'])
    expect(p.onClose).toHaveBeenCalledTimes(1)
    cancel(p.el.querySelector('dialog')!)
    expect(p.onClose).toHaveBeenCalledTimes(2)
    // happy-dom isn't a Mac: Ctrl+K.
    key(p.input, 'k', { ctrlKey: true })
    expect(p.onClose).toHaveBeenCalledTimes(3)
    // Other keys are the input's.
    expect(key(p.input, 'a').defaultPrevented).toBe(false)
  })
})

describe('the modal host (audit 2, U26)', () => {
  type Host = ReturnType<typeof useModalHost>
  /** The shell's use of it: owners' dialogs from the slot, the question over them. */
  function Shell({ got }: { got: { host?: Host } }) {
    const host = useModalHost()
    got.host = host
    const a = host.slot<string>('a').open
    const b = host.slot<number>('b').open
    return (
      <>
        {a && <span data-open="a">{a}</span>}
        {b !== null && <span data-open="b">{b}</span>}
        {host.question}
      </>
    )
  }
  const setup = () => {
    const got: { host?: Host } = {}
    const el = render(<Shell got={got} />)
    return { el, host: () => got.host!, shown: () => el.querySelector('[data-open]')?.textContent }
  }

  it('holds one dialog, whoever opened it; an owner closes only its own', () => {
    const { host, shown } = setup()
    expect(host().open).toBe(false)
    act(() => host().slot<string>('a').show('Gallery'))
    expect([shown(), host().open]).toEqual(['Gallery', true])
    expect(host().slot('b').open).toBeNull()
    // Another owner's dialog takes its place (the Gallery's Apply a style…).
    const closeA = host().slot('a').close
    act(() => {
      closeA()
      host().slot<number>('b').show(2)
    })
    expect(shown()).toBe('2')
    // A close of an owner whose dialog is gone leaves the other's.
    act(() => closeA())
    expect(shown()).toBe('2')
    act(() => host().slot('b').close())
    expect([shown(), host().open]).toEqual([undefined, false])
    // Each owner's show and close stay the same between renders.
    const before = host().slot('a')
    act(() => before.show('x'))
    expect(host().slot('a').show).toBe(before.show)
    expect(host().slot('a').close).toBe(before.close)
  })

  it('asks a question in an alert dialog over the others: the button that goes ahead focused', async () => {
    const { el, host } = setup()
    act(() => host().slot<string>('a').show('Templates'))
    let answer: Promise<boolean> | null = null
    act(() => {
      answer = host().confirm({
        title: 'Delete “Weights” for good?',
        message: 'This can’t be undone.',
        ok: 'Delete',
        danger: true,
      })
    })
    const d = el.querySelector('dialog')!
    expect(d.getAttribute('role')).toBe('alertdialog')
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Delete “Weights” for good?',
    )
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toBe(
      'This can’t be undone.',
    )
    expect(document.activeElement).toBe(button(d, 'Delete'))
    expect(button(d, 'Delete').className).toBe('danger')
    expect(host().open).toBe(true)
    click(button(d, 'Delete'))
    expect(await answer!).toBe(true)
    expect(el.querySelector('dialog')).toBeNull()
    // The dialog under it stays.
    expect(host().slot('a').open).toBe('Templates')
  })

  it('answers no to Cancel and Escape; questions asked meanwhile wait their turn', async () => {
    const { el, host } = setup()
    let first: Promise<boolean> | null = null
    let second: Promise<boolean> | null = null
    act(() => {
      first = host().confirm({ title: 'Discard unsaved changes?', ok: 'Discard' })
      second = host().confirm({ title: 'Replace the method “A”?' })
    })
    expect(el.querySelectorAll('dialog')).toHaveLength(1)
    click(button(el.querySelector('dialog')!, 'Cancel'))
    expect(await first!).toBe(false)
    const d = el.querySelector('dialog')!
    expect(d.querySelector('h2')!.textContent).toBe('Replace the method “A”?')
    // No message, an OK button.
    expect(d.hasAttribute('aria-describedby')).toBe(false)
    expect(button(d, 'OK').className).toBe('primary')
    expect(host().open).toBe(true)
    cancel(d)
    expect(await second!).toBe(false)
    expect(host().open).toBe(false)
  })
})

describe('dialogs loaded when first shown (audit 2, P8)', () => {
  it('load once, show when loaded, and fetch ahead with preloadAll', async () => {
    let loads = 0
    const Lazy = lazyComponent(async () => {
      loads++
      return ({ name }: { name: string }) => <p>Hello {name}</p>
    })
    await act(() => preloadAll())
    expect(loads).toBe(1)
    const el = render(<Lazy name="Ada" />)
    await act(async () => {})
    expect(el.textContent).toBe('Hello Ada')
    rerender(<Lazy name="Bo" />)
    expect(el.textContent).toBe('Hello Bo')
    await Lazy.preload()
    expect(loads).toBe(1)
  })

  it('show nothing when their code can’t be loaded, the rest of the app untouched', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazyComponent<object>(() => Promise.reject(new Error('offline')))
    const el = render(
      <div>
        <span>app</span>
        <Broken />
      </div>,
    )
    await act(async () => {})
    expect(el.textContent).toBe('app')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('Go to row (roadmap 34d)', () => {
  function Table({ id, shown }: { id: NodeId; shown: RowReveal[] }) {
    useReveal(id, (r) => shown.push(r))
    return null
  }

  it('shows a row asked for of its table, now or once it opens, once', () => {
    vi.useFakeTimers()
    const shown: RowReveal[] = []
    render(<Table id={'t1' as NodeId} shown={shown} />)
    act(() => requestReveal({ table: 'other' as NodeId, row: 2 }))
    expect(shown).toEqual([])
    act(() => requestReveal({ table: 't1' as NodeId, row: 5 }))
    expect(shown).toEqual([{ table: 't1', row: 5 }])
    // Taken: the table opened again doesn't show it again.
    act(() => vi.runAllTimers())
    unmount()
    render(<Table id={'t1' as NodeId} shown={shown} />)
    expect(shown).toHaveLength(1)
    // Asked for before its table shows: shown when it opens.
    unmount()
    act(() => requestReveal({ table: 't2' as NodeId, row: 1, column: 'a' }))
    render(<Table id={'t2' as NodeId} shown={shown} />)
    expect(shown.at(-1)).toEqual({ table: 't2', row: 1, column: 'a' })
    act(() => vi.runAllTimers())
  })
})

describe('the tooltip (roadmap 43)', () => {
  const tooltip = () => document.querySelector('[role="tooltip"]')
  const pointer = (el: Element, type: 'pointerover' | 'pointerout' | 'pointerdown') =>
    act(() => {
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'mouse',
          ...(type === 'pointerout' ? { relatedTarget: document.body } : {}),
        }),
      )
    })
  const tip = (
    <Tooltip content={<CommandTip name="Save" shortcut="⌘S" hint="Save the project" />}>
      <button type="button">Save</button>
    </Tooltip>
  )

  it('shows after the pointer rests on the element, and goes when it leaves', () => {
    vi.useFakeTimers()
    const el = render(tip)
    const b = button(el, 'Save')
    pointer(b, 'pointerover')
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1))
    expect(tooltip()).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(tooltip()?.textContent).toBe('Save⌘SSave the project')
    // Described by it while shown; never focusable, so it traps nothing.
    expect(b.getAttribute('aria-describedby')).toBe(tooltip()!.id)
    expect(tooltip()!.querySelector('[tabindex], button, a')).toBeNull()
    pointer(b, 'pointerout')
    expect(tooltip()).toBeNull()
    expect(b.hasAttribute('aria-describedby')).toBe(false)
    // A press hides it and keeps it hidden while the pointer stays.
    pointer(b, 'pointerover')
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS))
    expect(tooltip()).not.toBeNull()
    pointer(b, 'pointerdown')
    expect(tooltip()).toBeNull()
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 3))
    expect(tooltip()).toBeNull()
  })

  it('shows at once on keyboard focus (not on a click’s), and Escape hides it', () => {
    const el = render(tip)
    const b = button(el, 'Save')
    key(document.body, 'Tab')
    act(() => b.focus())
    expect(tooltip()?.textContent).toContain('⌘S')
    key(document.body, 'Escape')
    expect(tooltip()).toBeNull()
    act(() => b.blur())
    // Focus that follows a pointer press shows nothing.
    act(() => void window.dispatchEvent(new PointerEvent('pointerdown')))
    act(() => b.focus())
    expect(tooltip()).toBeNull()
  })

  it('says why a disabled button is disabled, from its wrapper (the button gets no events)', () => {
    vi.useFakeTimers()
    const registry = createCommandRegistry()
    registry.set('view', 'view', [
      {
        id: 'format.graph',
        label: 'Format graph…',
        shortcut: 'Mod+Shift+E',
        icon: 'paintbrush',
        toolbar: { group: 40 },
        enabled: false,
        disabledReason: 'Select a graph on the page',
        hint: 'Format the selected graph',
        run: () => {},
      },
    ])
    const el = render(
      <CommandsContext.Provider value={registry}>
        <Toolbar />
      </CommandsContext.Provider>,
    )
    const b = button(el, 'Format graph…')
    expect(b.disabled).toBe(true)
    pointer(b.parentElement!, 'pointerover')
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS))
    expect(tooltip()?.textContent).toMatch(/^Format graph….*E.*Select a graph on the page$/)
    // The hint gives way to the reason while disabled.
    expect(tooltip()?.textContent).not.toContain('Format the selected graph')
  })
})

describe('the toolbar (roadmap 43)', () => {
  const ran: string[] = []
  function toolbar(iconsOnly: boolean) {
    const registry = createCommandRegistry()
    const c = (id: string, label: string, o: Partial<Command> = {}): Command => ({
      id,
      label,
      run: () => ran.push(id),
      ...o,
    })
    registry.set('app', 'app', [
      c('insert.table', 'New data table…', {
        icon: 'table',
        toolbar: { group: 10, order: 10, label: 'New table' },
      }),
      c('edit.undo', 'Undo Edit cells', {
        icon: 'undo-2',
        shortcut: 'Mod+Z',
        toolbar: { group: 20, label: 'Undo' },
      }),
      c('file.export', 'Export…', {
        icon: 'download',
        toolbar: {
          group: 40,
          split: { label: 'Export as', items: ['file.export.svg', '-', 'file.export.pdf'] },
        },
      }),
      c('file.export.svg', 'SVG…'),
      c('file.export.pdf', 'PDF…'),
    ])
    const el = render(
      <CommandsContext.Provider value={registry}>
        <Toolbar iconsOnly={iconsOnly} />
      </CommandsContext.Provider>,
    )
    const bar = el.querySelector('[role="toolbar"]')!
    const labels = () => [...bar.querySelectorAll('.tool-label')].map((l) => l.textContent)
    return { el, bar, labels }
  }

  it('labels each icon (its own short label, else the command’s without “…”), named by the command', () => {
    const { bar, labels } = toolbar(false)
    expect(bar.className).toContain('labelled')
    expect(labels()).toEqual(['New table', 'Undo', 'Export'])
    // Accessible names stay the commands' labels; ▾ is a button of its own.
    expect(
      [...bar.querySelectorAll('button')].map((b) => [
        b.getAttribute('aria-label'),
        b.getAttribute('aria-haspopup'),
      ]),
    ).toEqual([
      ['New data table…', null],
      ['Undo Edit cells', null],
      ['Export…', null],
      ['Export as', 'menu'],
    ])
    for (const b of bar.querySelectorAll('button')) expect(b.hasAttribute('title')).toBe(false)
    click(button(bar, 'New data table…'))
    expect(ran.at(-1)).toBe('insert.table')
  })

  it('shows icons only in the compact mode, with the same names and tooltips', () => {
    const { bar, labels } = toolbar(true)
    expect(bar.className).toContain('icons-only')
    expect(labels()).toEqual([])
    key(document.body, 'Tab')
    act(() => button(bar, 'Undo Edit cells').focus())
    expect(document.querySelector('[role="tooltip"]')?.textContent).toMatch(
      /^Undo Edit cells(⌘Z|Ctrl\+Z)$/,
    )
  })

  it('opens a split button’s menu from ▾, and runs the chosen command', () => {
    const { bar } = toolbar(false)
    const arrow = button(bar, 'Export as')
    expect(arrow.getAttribute('aria-expanded')).toBe('false')
    click(arrow)
    expect(arrow.getAttribute('aria-expanded')).toBe('true')
    const menu = document.querySelector('[role="menu"]')!
    expect(menu.getAttribute('aria-label')).toBe('Export as')
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    expect(items.map((i) => i.textContent)).toEqual(['SVG…', 'PDF…'])
    click(items[1]!)
    expect(ran.at(-1)).toBe('file.export.pdf')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    // The main part runs the command itself.
    click(button(bar, 'Export…'))
    expect(ran.at(-1)).toBe('file.export')
  })
})
