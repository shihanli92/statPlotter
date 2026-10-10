// Audit 3 (A13): the focus moved by a shortcut shows its ring. Browsers decide `:focus-visible`
// by what the user last did, and Chromium doesn't count a key pressed with ⌘ or Ctrl (⌘1), so
// the focus moved by one landed without a ring. `focusVisible: true` asks for it (Chromium,
// Firefox); where it isn't honoured, the element carries `focus-ring` until it loses the focus.

/** Moves the focus to `el`, its focus ring shown. */
export function focusVisibly(el: HTMLElement, opts: { preventScroll?: boolean } = {}): void {
  el.focus({ ...opts, focusVisible: true } as FocusOptions)
  let visible = true
  try {
    visible = el.matches(':focus-visible')
  } catch {
    // (No :focus-visible: the browser's own ring.)
  }
  if (visible || document.activeElement !== el) return
  el.classList.add('focus-ring')
  el.addEventListener('blur', () => el.classList.remove('focus-ring'), { once: true })
}
