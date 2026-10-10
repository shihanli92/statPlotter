import { FONT_STACKS } from '@ps/graph'
import { type ColorRef, FontId, mergeRuns, type RichText, type TextRun } from '@ps/model'
import { cleanSize, type Style, trimRuns, withFormat } from './model.ts'

// Between the editor's model and its contenteditable element: runs → markup, the element's text
// and caret ↔ offsets, and pasted HTML → runs. Written against a minimal DOM interface so the
// tests can use small fake trees.

/** The parts of a DOM node these functions use. */
export interface DomNode {
  nodeType: number
  nodeName: string
  nodeValue: string | null
  childNodes: ArrayLike<DomNode>
  parentNode: DomNode | null
  getAttribute?(name: string): string | null
}

const TEXT = 3
const ELEMENT = 1

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Tags for the formats, outermost first. */
const TAGS: [keyof Style, string][] = [
  ['bold', 'b'],
  ['italic', 'i'],
  ['underline', 'u'],
  ['sup', 'sup'],
  ['sub', 'sub'],
]

/** How the editor shows runs' own font, size and colour. */
export interface RunView {
  /** The palette colour references resolve against. */
  palette: readonly string[]
  /** The element's size: a run's size shows relative to it (none: sizes aren't shown). */
  size?: number
}

/** A colour reference as a CSS colour (null: "the series' colour", shown as the text's). */
export function cssColor(c: ColorRef, palette: readonly string[]): string | null {
  if ('rgb' in c) return c.rgb
  if ('palette' in c) return palette.length ? palette[c.palette % palette.length]! : null
  return null
}

/** A colour reference in an attribute: `p<index>`, `#rrggbb` or `series`. */
const colorKey = (c: ColorRef) => ('rgb' in c ? c.rgb : 'palette' in c ? `p${c.palette}` : 'series')
function parseColorKey(k: string): ColorRef | undefined {
  if (/^#[0-9a-fA-F]{6}$/.test(k)) return { rgb: k }
  if (/^p\d+$/.test(k)) return { palette: Number(k.slice(1)) }
  return k === 'series' ? { series: true } : undefined
}

/** Shown sizes stay within these multiples of the element's, so the editor keeps its shape. */
const SHOWN_SIZE = [0.5, 3] as const

/**
 * A run's own font, size and colour as a <span>: CSS to show them, data attributes to read them
 * back from our own copies. Double-quoted and in the order browsers serialize, so the editable's
 * innerHTML reads back exactly as written.
 */
function valueSpan(r: TextRun, view: RunView | undefined): string {
  const off = (['bold', 'italic'] as const).filter((f) => r[f] === false)
  if (!r.font && r.size === undefined && !r.color && !off.length) return ''
  const css: string[] = []
  const data: string[] = []
  // Not bold or italic in an element that is (roadmap 28b).
  if (r.bold === false) css.push('font-weight: normal;')
  if (r.italic === false) css.push('font-style: normal;')
  for (const f of off) data.push(` data-${f}="false"`)
  if (r.font) {
    css.push(`font-family: ${FONT_STACKS[r.font]};`)
    data.push(` data-font="${r.font}"`)
  }
  if (r.size !== undefined) {
    if (view?.size) {
      const em = Math.min(SHOWN_SIZE[1], Math.max(SHOWN_SIZE[0], r.size / view.size))
      css.push(`font-size: ${Math.round(em * 1000) / 1000}em;`)
    }
    data.push(` data-size="${r.size}"`)
  }
  if (r.color) {
    const c = cssColor(r.color, view?.palette ?? [])
    if (c) css.push(`color: ${c};`)
    data.push(` data-color="${colorKey(r.color)}"`)
  }
  return `<span${css.length ? ` style="${css.join(' ')}"` : ''}${data.join('')}>`
}

/**
 * The editable's markup for runs: each run in its format tags (and a span for its own font, size
 * and colour), line breaks as <br>. A trailing break gets a second <br>, without which browsers
 * show no empty last line (`editableText` drops the last <br> of the element).
 */
export function runsToHtml(runs: RichText, view?: RunView): string {
  let out = ''
  for (const r of runs) {
    if (!r.text) continue
    const tags = TAGS.filter(([f]) => r[f] === true).map(([, t]) => t)
    const body = r.text.split('\n').map(esc).join('<br>')
    const span = valueSpan(r, view)
    out +=
      span +
      tags.map((t) => `<${t}>`).join('') +
      body +
      [...tags]
        .reverse()
        .map((t) => `</${t}>`)
        .join('') +
      (span ? '</span>' : '')
  }
  return runs.some((r) => r.text) && runs[runs.length - 1]?.text.endsWith('\n') ? `${out}<br>` : out
}

const isBr = (n: DomNode) => n.nodeType === ELEMENT && n.nodeName.toUpperCase() === 'BR'
const BLOCKS = new Set(['DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'])
const isBlock = (n: DomNode) => n.nodeType === ELEMENT && BLOCKS.has(n.nodeName.toUpperCase())

/** The text leaves of the editable in order: text nodes, and <br>s as one '\n' each. */
function leaves(root: DomNode): { node: DomNode; text: string }[] {
  const out: { node: DomNode; text: string }[] = []
  const walk = (n: DomNode) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === TEXT) out.push({ node: c, text: c.nodeValue ?? '' })
      else if (isBr(c)) out.push({ node: c, text: '\n' })
      else if (c.nodeType === ELEMENT) {
        // A block the browser made (e.g. a <div> for a new line) starts on its own line.
        if (isBlock(c) && out.some((l) => l.text) && !out[out.length - 1]!.text.endsWith('\n'))
          out.push({ node: c, text: '\n' })
        walk(c)
      }
    }
  }
  walk(root)
  // The last <br> only makes an empty last line show (see `runsToHtml`).
  const last = out[out.length - 1]
  if (last && isBr(last.node)) out.pop()
  return out
}

/** The editable's plain text (line breaks as '\n'). */
export const editableText = (root: DomNode): string =>
  leaves(root)
    .map((l) => l.text)
    .join('')

/** The plain-text offset of a DOM position (node, offset) inside the editable. */
export function offsetOf(root: DomNode, node: DomNode, offset: number): number {
  const ls = leaves(root)
  const lengths = new Map(ls.map((l) => [l.node, l.text.length]))
  const total = ls.reduce((a, l) => a + l.text.length, 0)
  let at = 0
  // Document order: a block's line break counts before its children.
  const walk = (n: DomNode): boolean => {
    if (n.nodeType !== TEXT && !isBr(n)) at += n === root ? 0 : (lengths.get(n) ?? 0)
    const kids = Array.from(n.childNodes)
    for (const [i, c] of kids.entries()) {
      if (n === node && i === offset) return true
      if (c === node && c.nodeType === TEXT) {
        at += offset
        return true
      }
      if (c.nodeType === TEXT || isBr(c)) at += lengths.get(c) ?? 0
      else if (walk(c)) return true
    }
    return n === node
  }
  walk(root)
  return Math.min(at, total)
}

/**
 * The DOM position for a plain-text offset: inside a text node where there is one (the end of
 * the earlier node at a boundary), else before or after a <br> (an empty line).
 */
export function pointAt(root: DomNode, offset: number): { node: DomNode; offset: number } {
  let at = 0
  let afterBreak: { node: DomNode; offset: number } | null = null
  for (const l of leaves(root)) {
    const len = l.text.length
    if (l.node.nodeType === TEXT) {
      if (offset <= at + len) return { node: l.node, offset: offset - at }
    } else if (isBr(l.node) && offset === at) return positionOf(l.node, 0)
    at += len
    // Right after a break: the text that follows if any, else after the <br>.
    if (offset === at && isBr(l.node)) afterBreak = positionOf(l.node, 1)
  }
  return afterBreak ?? { node: root, offset: root.childNodes.length }
}

/** The position just before (0) or after (1) a node, in its parent. */
function positionOf(n: DomNode, side: 0 | 1): { node: DomNode; offset: number } {
  const parent = n.parentNode!
  return { node: parent, offset: Array.from(parent.childNodes).indexOf(n) + side }
}

// ---- Pasting HTML ------------------------------------------------------------------------------

/**
 * Formats a pasted element sets or clears (tags, then inline styles, which win); font, size and
 * colour only from our own copies (`own`), whose data attributes hold them.
 */
function elementStyle(n: DomNode, s: Style, own: boolean): Style {
  let out = s
  if (own) {
    const font = FontId.safeParse(n.getAttribute?.('data-font')).data
    const size = cleanSize(Number(n.getAttribute?.('data-size') ?? Number.NaN))
    const color = parseColorKey(n.getAttribute?.('data-color') ?? '')
    out = {
      ...out,
      ...(n.getAttribute?.('data-bold') === 'false' ? { bold: false } : {}),
      ...(n.getAttribute?.('data-italic') === 'false' ? { italic: false } : {}),
      ...(font ? { font } : {}),
      ...(size !== null ? { size } : {}),
      ...(color ? { color } : {}),
    }
  }
  const tag = n.nodeName.toUpperCase()
  if (tag === 'B' || tag === 'STRONG') out = withFormat(out, 'bold', true)
  if (tag === 'I' || tag === 'EM') out = withFormat(out, 'italic', true)
  if (tag === 'U' || tag === 'INS') out = withFormat(out, 'underline', true)
  if (tag === 'SUP') out = withFormat(out, 'sup', true)
  if (tag === 'SUB') out = withFormat(out, 'sub', true)
  const css = (n.getAttribute?.('style') ?? '').toLowerCase()
  const prop = (name: string) =>
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(css)?.[1]?.trim()
  const weight = own ? undefined : prop('font-weight')
  if (weight) out = withFormat(out, 'bold', weight === 'bold' || Number(weight) >= 600)
  const fontStyle = own ? undefined : prop('font-style')
  if (fontStyle) out = withFormat(out, 'italic', fontStyle !== 'normal')
  const deco = prop('text-decoration') ?? prop('text-decoration-line')
  if (deco) out = withFormat(out, 'underline', deco.includes('underline'))
  const align = prop('vertical-align')
  if (align === 'super') out = withFormat(out, 'sup', true)
  if (align === 'sub') out = withFormat(out, 'sub', true)
  return out
}

const SKIPPED = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'TEMPLATE'])

/**
 * Runs from pasted HTML: bold, italic, underline, superscript and subscript from tags and inline
 * styles (so text copied from word processors keeps them), line breaks from <br> and blocks.
 * `preserve` (our own copies) keeps whitespace as it is and reads runs' font, size and colour;
 * otherwise runs of whitespace collapse as a browser shows them, and a word processor's fonts,
 * sizes and colours are left behind (the text takes the element's). Leading and trailing
 * whitespace and breaks are dropped.
 */
export function htmlRuns(root: DomNode, preserve: boolean): RichText {
  const out: TextRun[] = []
  const text = () => out.map((r) => r.text).join('')
  const walk = (n: DomNode, s: Style) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === TEXT) {
        let t = c.nodeValue ?? ''
        if (!preserve) {
          t = t.replace(/\s+/g, ' ')
          if (/(^|\n| )$/.test(text()) && t.startsWith(' ')) t = t.slice(1)
        }
        if (t) out.push({ ...s, text: t })
      } else if (c.nodeType === ELEMENT && !SKIPPED.has(c.nodeName.toUpperCase())) {
        if (isBr(c)) {
          out.push({ text: '\n' })
          continue
        }
        const block = isBlock(c)
        if (block && text() && !text().endsWith('\n')) out.push({ text: '\n' })
        walk(c, elementStyle(c, s, preserve))
        if (block && text() && !text().endsWith('\n')) out.push({ text: '\n' })
      }
    }
  }
  walk(root, {})
  return trimRuns(mergeRuns(out))
}
