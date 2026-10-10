import { exactTsvOf, htmlDocument, withExactTsv } from '@ps/io'

// Tables on the clipboard (roadmap 26) as tab-separated text (Excel, this app's grid) and an HTML
// table (Word, PowerPoint and Keynote paste a real table), from a menu command or a click.
//
// Audit 2 X13: text a spreadsheet would run as a formula (= + - @ or a tab or return first, and
// not a number) gets a leading apostrophe in both, as CSV and TSV files have it; the HTML keeps
// the exact text too (`data-ps-tsv` on an element around it), which this app's paste takes
// instead, so cells copied and pasted inside the app are unchanged.

export interface TableCopy {
  /** Tab-separated values. */
  text: string
  /** An HTML table (see `htmlDocument`). */
  html: string
}

/**
 * A copy for the clipboard: `text(guard)` the cells' tab-separated text, guarded for other
 * applications; `html` the guarded HTML fragment, to which the exact text is added for this app.
 */
export const tableCopy = (text: (guard: boolean) => string, html: string): TableCopy => ({
  text: text(true),
  html: htmlDocument(withExactTsv(html, text(false))),
})

/** A paste's cells: this app's own copy exactly (from its HTML), else the plain text. */
export function pastedText(data: Pick<DataTransfer, 'getData'> | null): string {
  const html = data?.getData('text/html')
  return (html ? exactTsvOf(html) : null) ?? data?.getData('text/plain') ?? ''
}

/**
 * The clipboard's cells by the asynchronous clipboard (Edit › Paste from a menu), as `pastedText`
 * takes them; the plain text alone where the HTML can't be read.
 */
export async function readPastedText(): Promise<string> {
  if (navigator.clipboard?.read) {
    let items: ClipboardItems | null = null
    try {
      items = await navigator.clipboard.read()
    } catch {
      // Refused or unsupported: the text below.
    }
    if (items) {
      for (const item of items)
        if (item.types.includes('text/html')) {
          const exact = exactTsvOf(await (await item.getType('text/html')).text())
          if (exact !== null) return exact
        }
      const plain = items.find((i) => i.types.includes('text/plain'))
      return plain ? (await plain.getType('text/plain')).text() : ''
    }
  }
  return navigator.clipboard.readText()
}

/** Puts both forms on a clipboard event's data (the event's default is then prevented). */
export function setClipboardData(e: ClipboardEvent | React.ClipboardEvent, data: TableCopy): void {
  e.clipboardData?.setData('text/plain', data.text)
  e.clipboardData?.setData('text/html', data.html)
  e.preventDefault()
}

/**
 * Copies from a menu command or a click, without the key's own clipboard event. First the
 * copy-event route: `execCommand('copy')` raises a copy event, taken here before anything else
 * sees it (Chromium, Firefox, and WebKit — the desktop app — when `beforecopy` is cancelled, as
 * it is here, even with no text selected). Else the asynchronous clipboard: one item with HTML
 * and text, then the text alone. Rejects when nothing could be written.
 */
export async function copyTable(data: TableCopy, focus?: HTMLElement | null): Promise<void> {
  let copied = false
  const beforeCopy = (e: Event) => e.preventDefault()
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.stopImmediatePropagation()
    setClipboardData(e, data)
    copied = true
  }
  document.addEventListener('beforecopy', beforeCopy, true)
  document.addEventListener('copy', onCopy, true)
  try {
    focus?.focus({ preventScroll: true })
    document.execCommand('copy')
  } catch {
    // Refused (no user gesture, or the command is unsupported): the clipboard API below.
  } finally {
    document.removeEventListener('beforecopy', beforeCopy, true)
    document.removeEventListener('copy', onCopy, true)
  }
  if (copied) return
  const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
  if (Item && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new Item({
          'text/html': new Blob([data.html], { type: 'text/html' }),
          'text/plain': new Blob([data.text], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // Some browsers refuse HTML; the text alone below.
    }
  }
  await navigator.clipboard.writeText(data.text)
}
