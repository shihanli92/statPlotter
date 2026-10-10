import { FONT_STACKS, FONT_VARIANTS, FONTS } from '@ps/graph'
import type { FontId, RichText } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import {
  type DomNode,
  editableText,
  htmlRuns,
  offsetOf,
  pointAt,
  runsToHtml,
} from '../src/richText/dom.ts'
import {
  applyTextChange,
  applyValues,
  cleanSize,
  clearFormatting,
  EditHistory,
  FONT_SIZES,
  formatsAt,
  inheritFormats,
  replaceRange,
  sameRichText,
  selectionStyles,
  singleLine,
  sliceRuns,
  stepSize,
  styleAt,
  toggleFormat,
  trimRuns,
  typeText,
  valuesOf,
  withFormat,
} from '../src/richText/model.ts'
import { SYMBOL_GROUPS } from '../src/richText/symbols.ts'

// The rich text editor (roadmap 28): its model as pure functions, and its DOM mapping against
// small fake trees.

const IC50: RichText = [{ text: 'IC' }, { text: '50', sub: true }, { text: ' (nM)' }]

describe('editor model', () => {
  it('slices and replaces runs, merging equal neighbours', () => {
    expect(sliceRuns(IC50, 1, 4)).toEqual([{ text: 'C' }, { text: '50', sub: true }])
    expect(replaceRange(IC50, 2, 4, [{ text: '90', sub: true }])).toEqual([
      { text: 'IC' },
      { text: '90', sub: true },
      { text: ' (nM)' },
    ])
    expect(replaceRange(IC50, 2, 4, [])).toEqual([{ text: 'IC (nM)' }])
  })

  it('toggles a format over part of a run, and off when all of it has it', () => {
    const t: RichText = [{ text: 'Hello world' }]
    const b = toggleFormat(t, 6, 11, 'bold')
    expect(b).toEqual([{ text: 'Hello ' }, { text: 'world', bold: true }])
    // Over a range half bold: all bold; then all plain again.
    const all = toggleFormat(b, 3, 11, 'bold')
    expect(all).toEqual([{ text: 'Hel' }, { text: 'lo world', bold: true }])
    expect(toggleFormat(all, 3, 11, 'bold')).toEqual(t)
    expect(toggleFormat(t, 3, 3, 'bold')).toBe(t)
  })

  it('keeps superscript and subscript exclusive, and other formats alongside', () => {
    const sup = toggleFormat(IC50, 2, 4, 'sup')
    expect(sup[1]).toEqual({ text: '50', sup: true })
    const both = toggleFormat(toggleFormat(sup, 0, 4, 'italic'), 0, 2, 'underline')
    expect(both).toEqual([
      { text: 'IC', italic: true, underline: true },
      { text: '50', sup: true, italic: true },
      { text: ' (nM)' },
    ])
    expect(formatsAt(both, { anchor: 0, focus: 4 })).toMatchObject({
      italic: true,
      underline: false,
      sup: false,
    })
  })

  it('reports the caret format as the one typing continues', () => {
    expect(formatsAt(IC50, { anchor: 4, focus: 4 }).sub).toBe(true)
    expect(formatsAt(IC50, { anchor: 2, focus: 2 }).sub).toBe(false)
    // At a line's start: the character after.
    const lines: RichText = [{ text: 'a\n' }, { text: 'b', bold: true }]
    expect(styleAt(lines, 2)).toEqual({ bold: true })
    expect(styleAt([], 0)).toEqual({})
  })

  it('types with the neighbour style or a chosen one, over a selection with its first style', () => {
    expect(typeText(IC50, 4, 4, '0')).toEqual([
      { text: 'IC' },
      { text: '500', sub: true },
      { text: ' (nM)' },
    ])
    expect(typeText(IC50, 4, 4, '!', { italic: true })[2]).toEqual({ text: '!', italic: true })
    expect(typeText(IC50, 2, 4, '90')).toEqual([
      { text: 'IC' },
      { text: '90', sub: true },
      { text: ' (nM)' },
    ])
  })

  it('reads a DOM text change as an edit of the model', () => {
    // Typing a repeated letter: the caret decides where it went.
    const t: RichText = [{ text: 'al', bold: true }, { text: 'l' }]
    expect(applyTextChange(t, 'alll', 3)).toEqual([{ text: 'all', bold: true }, { text: 'l' }])
    expect(applyTextChange(t, 'alll', 4)).toEqual([{ text: 'al', bold: true }, { text: 'll' }])
    // Deleting across formats, replacing (IME, spelling), and a chosen style.
    expect(applyTextChange(IC50, 'I0 (nM)', 1)).toEqual([
      { text: 'I' },
      { text: '0', sub: true },
      { text: ' (nM)' },
    ])
    expect(applyTextChange(IC50, 'IC50 (µM)', 7)).toEqual([
      { text: 'IC' },
      { text: '50', sub: true },
      { text: ' (µM)' },
    ])
    expect(applyTextChange([], 'x', 1, { sup: true })).toEqual([{ text: 'x', sup: true }])
    expect(applyTextChange(IC50, 'IC50 (nM)', 3)).toBe(IC50)
  })

  it('makes single-line text, trims and compares', () => {
    expect(singleLine([{ text: 'a\nb', bold: true }])).toEqual([{ text: 'a b', bold: true }])
    expect(trimRuns([{ text: '  a', bold: true }, { text: 'b ' }])).toEqual([
      { text: 'a', bold: true },
      { text: 'b' },
    ])
    expect(sameRichText([{ text: 'a' }, { text: 'b' }], [{ text: 'ab' }])).toBe(true)
    expect(sameRichText([{ text: 'a', bold: true }], [{ text: 'a' }])).toBe(false)
  })

  it('keeps its own undo history, typing merged into one step', () => {
    const h = new EditHistory({ runs: [], sel: { anchor: 0, focus: 0 } })
    const snap = (text: string) => ({ runs: [{ text }], sel: { anchor: 0, focus: 0 } })
    h.push(snap('a'), true, 0)
    h.push(snap('ab'), true, 100)
    h.push(snap('ab!'), false, 150)
    h.push(snap('ab!c'), true, 5000)
    expect(h.undo()).toEqual(snap('ab!'))
    expect(h.undo()).toEqual(snap('ab'))
    expect(h.undo()).toEqual({ runs: [], sel: { anchor: 0, focus: 0 } })
    expect(h.undo()).toBeNull()
    expect(h.redo()).toEqual(snap('ab'))
    h.push(snap('x'), false, 6000)
    expect(h.redo()).toBeNull()
  })
})

// ---- A tiny DOM ------------------------------------------------------------------------------

interface Fake extends DomNode {
  childNodes: Fake[]
  parentNode: Fake | null
}

function el(
  name: string,
  kids: (Fake | string)[] = [],
  attrs?: string | Record<string, string>,
): Fake {
  const all = typeof attrs === 'string' ? { style: attrs } : (attrs ?? {})
  const n: Fake = {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    nodeValue: null,
    childNodes: [],
    parentNode: null,
    getAttribute: (a) => all[a] ?? null,
  }
  for (const k of kids) {
    const c: Fake =
      typeof k === 'string'
        ? { nodeType: 3, nodeName: '#text', nodeValue: k, childNodes: [], parentNode: null }
        : k
    c.parentNode = n
    n.childNodes.push(c)
  }
  return n
}

describe("formats over the element's own (roadmap 28b)", () => {
  const bold = { bold: true, italic: false }

  it('reads a bold element as bold, and toggling off stores bold: false', () => {
    const t: RichText = [{ text: 'Enzyme activity' }]
    expect(formatsAt(t, { anchor: 0, focus: 15 }).bold).toBe(false)
    expect(formatsAt(t, { anchor: 0, focus: 15 }, bold).bold).toBe(true)
    const off = toggleFormat(t, 7, 15, 'bold', bold)
    expect(off).toEqual([{ text: 'Enzyme ' }, { text: 'activity', bold: false }])
    expect(formatsAt(off, { anchor: 7, focus: 15 }, bold).bold).toBe(false)
    // Mixed: on for all, which is the element's own (no value), so the runs merge back.
    expect(toggleFormat(off, 0, 15, 'bold', bold)).toEqual(t)
    // Italic in the bold element is stored as before.
    expect(toggleFormat(t, 0, 6, 'italic', bold)).toEqual([
      { text: 'Enzyme', italic: true },
      { text: ' activity' },
    ])
  })

  it('stores a format only where it differs from the element', () => {
    expect(withFormat({}, 'bold', false, bold)).toEqual({ bold: false })
    expect(withFormat({ bold: false }, 'bold', true, bold)).toEqual({})
    expect(withFormat({}, 'bold', true)).toEqual({ bold: true })
    expect(withFormat({ bold: true }, 'bold', false)).toEqual({})
    expect(withFormat({ sub: true }, 'sup', true, bold)).toEqual({ sup: true })
  })

  it('drops pasted formats the element has anyway', () => {
    expect(inheritFormats([{ text: 'a', bold: true }, { text: 'b' }], bold)).toEqual([
      { text: 'ab' },
    ])
    expect(inheritFormats([{ text: 'a', bold: false }], {})).toEqual([{ text: 'a' }])
    expect(inheritFormats([{ text: 'a', bold: false }], bold)).toEqual([{ text: 'a', bold: false }])
  })

  it('shows and copies a not-bold run in a bold element', () => {
    expect(runsToHtml([{ text: 'a' }, { text: 'b', bold: false, italic: false }])).toBe(
      'a<span style="font-weight: normal; font-style: normal;" data-bold="false" data-italic="false">b</span>',
    )
    const copy = el('span', [
      el('span', ['b'], { style: 'font-weight: normal;', 'data-bold': 'false' }),
    ])
    expect(htmlRuns(copy, true)).toEqual([{ text: 'b', bold: false }])
  })
})

describe('editor font, size and colour (roadmap 28b)', () => {
  const t: RichText = [{ text: 'Hello big world' }]

  it('sets and clears a font, size or colour over part of the text', () => {
    const big = applyValues(t, 6, 9, { size: 20 })
    expect(big).toEqual([{ text: 'Hello ' }, { text: 'big', size: 20 }, { text: ' world' }])
    const both = applyValues(big, 6, 15, { font: 'mono', color: { palette: 2 } })
    expect(both).toEqual([
      { text: 'Hello ' },
      { text: 'big', size: 20, font: 'mono', color: { palette: 2 } },
      { text: ' world', font: 'mono', color: { palette: 2 } },
    ])
    // Undefined clears ("Automatic" colour, the element's font); equal neighbours merge.
    expect(applyValues(both, 0, 15, { font: undefined, color: undefined })).toEqual([
      { text: 'Hello ' },
      { text: 'big', size: 20 },
      { text: ' world' },
    ])
    expect(applyValues(t, 3, 3, { size: 9 })).toBe(t)
  })

  it('clears every run-level format from the selection only', () => {
    const rich: RichText = [
      { text: 'IC', bold: true, size: 14 },
      { text: '50', sub: true, color: { rgb: '#d55e00' }, font: 'serif' },
      { text: ' nM', italic: true, underline: true },
    ]
    expect(clearFormatting(rich, 1, 4)).toEqual([
      { text: 'I', bold: true, size: 14 },
      { text: 'C50' },
      { text: ' nM', italic: true, underline: true },
    ])
    expect(clearFormatting(rich, 0, 7)).toEqual([{ text: 'IC50 nM' }])
  })

  it('grows and shrinks through the size list, each run from its own size', () => {
    expect(FONT_SIZES[0]).toBe(6)
    expect(FONT_SIZES.at(-1)).toBe(72)
    expect(stepSize(12, 1)).toBe(14)
    expect(stepSize(12, -1)).toBe(11)
    expect(stepSize(13, 1)).toBe(14)
    expect(stepSize(13, -1)).toBe(12)
    expect(stepSize(28, 1)).toBe(36)
    // Beyond the list: tens, as Word does; below it, a point at a time; within the limits.
    expect(stepSize(72, 1)).toBe(80)
    expect(stepSize(85, 1)).toBe(90)
    expect(stepSize(80, -1)).toBe(72)
    expect(stepSize(95, -1)).toBe(90)
    expect(stepSize(6, -1)).toBe(5)
    expect(stepSize(1, -1)).toBe(1)
    expect(stepSize(400, 1)).toBe(400)
  })

  it('cleans typed sizes to the half point within the limits', () => {
    expect(cleanSize(10.3)).toBe(10.5)
    expect(cleanSize(0.2)).toBe(1)
    expect(cleanSize(1000)).toBe(400)
    expect(cleanSize(Number.NaN)).toBeNull()
    expect(cleanSize(0)).toBeNull()
  })

  it('reports the selection font, size and colour, blank when mixed', () => {
    const base = { font: 'sans' as FontId, size: 12 }
    const rich: RichText = [
      { text: 'ab' },
      { text: 'cd', size: 18, color: { palette: 1 } },
      { text: 'ef', font: 'serif', size: 18, color: { palette: 1 } },
    ]
    const at = (a: number, b: number) =>
      valuesOf(selectionStyles(rich, { anchor: a, focus: b }), base)
    expect(at(0, 2)).toEqual({ font: 'sans', size: 12, color: undefined })
    expect(at(2, 6)).toEqual({ font: null, size: 18, color: { palette: 1 } })
    expect(at(0, 6)).toEqual({ font: null, size: null, color: null })
    // A caret: what typing continues.
    expect(at(4, 4)).toEqual({ font: 'sans', size: 18, color: { palette: 1 } })
  })
})

describe('editor DOM', () => {
  it('writes runs as format tags and line breaks', () => {
    expect(runsToHtml(IC50)).toBe('IC<sub>50</sub> (nM)')
    expect(runsToHtml([{ text: 'a<b', bold: true, italic: true, underline: true }])).toBe(
      '<b><i><u>a&lt;b</u></i></b>',
    )
    expect(runsToHtml([{ text: 'a\nb' }])).toBe('a<br>b')
    // A trailing break needs a second <br> to show its empty line.
    expect(runsToHtml([{ text: 'a\n' }])).toBe('a<br><br>')
    expect(runsToHtml([])).toBe('')
  })

  it("shows runs' own font, size and colour in a span, reading our copies back", () => {
    const view = { palette: ['#0072b2', '#d55e00'], size: 12 }
    const rich: RichText = [
      { text: 'a' },
      { text: 'b', size: 24, color: { palette: 1 }, bold: true },
      { text: 'c', font: 'mono', color: { rgb: '#123456' } },
      { text: 'd', size: 100 },
    ]
    expect(runsToHtml(rich, view)).toBe(
      'a' +
        '<span style="font-size: 2em; color: #d55e00;" data-size="24" data-color="p1"><b>b</b></span>' +
        `<span style="font-family: ${FONT_STACKS.mono}; color: #123456;" data-font="mono" data-color="#123456">c</span>` +
        // Shown sizes stay within 0.5–3 times the element's.
        '<span style="font-size: 3em;" data-size="100">d</span>',
    )
    // Without an element size (grid titles), sizes aren't shown but still copied.
    expect(runsToHtml([{ text: 'x', size: 30 }], { palette: [] })).toBe(
      '<span data-size="30">x</span>',
    )
    const span = (text: string, attrs: Record<string, string>) => el('span', [text], attrs)
    const copy = el('span', [
      'a',
      span('b', { 'data-size': '24', 'data-color': 'p1' }),
      span('c', { 'data-font': 'mono', 'data-color': '#123456', style: 'color: #123456' }),
    ])
    expect(htmlRuns(copy, true)).toEqual([
      { text: 'a' },
      { text: 'b', size: 24, color: { palette: 1 } },
      { text: 'c', font: 'mono', color: { rgb: '#123456' } },
    ])
    // Another application's fonts, sizes and colours are left behind.
    expect(htmlRuns(copy, false)).toEqual([{ text: 'abc' }])
  })

  it('reads the text back, the last <br> being only a placeholder', () => {
    expect(editableText(el('div', ['IC', el('sub', ['50']), ' (nM)']))).toBe('IC50 (nM)')
    expect(editableText(el('div', ['a', el('br'), el('br')]))).toBe('a\n')
    expect(editableText(el('div', [el('br')]))).toBe('')
    // A browser-made block starts a line.
    expect(editableText(el('div', ['a', el('div', ['b'])]))).toBe('a\nb')
  })

  it('maps caret positions both ways', () => {
    const sub = el('sub', ['50'])
    const root = el('div', ['IC', sub, ' (nM)', el('br'), 'x'])
    const [ic, , tail, br, x] = root.childNodes
    expect(offsetOf(root, sub.childNodes[0]!, 1)).toBe(3)
    expect(offsetOf(root, tail!, 0)).toBe(4)
    expect(offsetOf(root, root, 3)).toBe(9)
    expect(offsetOf(root, root, 4)).toBe(10)
    expect(offsetOf(root, root, 5)).toBe(11)
    expect(offsetOf(root, sub, 1)).toBe(4)
    expect(pointAt(root, 1)).toEqual({ node: ic, offset: 1 })
    // At a boundary: the end of the earlier text.
    expect(pointAt(root, 2)).toEqual({ node: ic, offset: 2 })
    expect(pointAt(root, 10)).toEqual({ node: x, offset: 0 })
    expect(pointAt(root, 11)).toEqual({ node: x, offset: 1 })
    expect(br).toBeDefined()
    // Empty lines: before and after <br>s.
    const empty = el('div', ['a', el('br'), el('br')])
    expect(pointAt(empty, 2)).toEqual({ node: empty, offset: 2 })
    expect(offsetOf(empty, empty, 2)).toBe(2)
    expect(pointAt(el('div'), 0).offset).toBe(0)
  })

  it('reads pasted HTML: tags, inline styles, blocks and whitespace', () => {
    const word = el('div', [
      el('p', ['  IC', el('sub', ['50']), '\n  of ', el('span', ['drug'], 'font-weight: 700')]),
      el('p', [
        el('span', ['n'], 'font-style:italic'),
        ' = 3',
        el('span', ['2'], 'vertical-align: super'),
      ]),
      el('style', ['p { color: red }']),
    ])
    expect(htmlRuns(word, false)).toEqual([
      { text: 'IC' },
      { text: '50', sub: true },
      { text: ' of ' },
      { text: 'drug', bold: true },
      { text: '\n' },
      { text: 'n', italic: true },
      { text: ' = 3' },
      { text: '2', sup: true },
    ])
    // Google Docs wraps everything in a bold tag styled as normal.
    expect(htmlRuns(el('b', ['plain'], 'font-weight:normal'), false)).toEqual([{ text: 'plain' }])
    expect(htmlRuns(el('span', ['a  b', el('u', ['c'])]), true)).toEqual([
      { text: 'a  b' },
      { text: 'c', underline: true },
    ])
  })
})

describe('symbol picker', () => {
  it('offers only symbols every bundled font face draws', () => {
    const missing: string[] = []
    for (const g of SYMBOL_GROUPS)
      for (const [ch, name] of g.symbols)
        for (const id of Object.keys(FONTS) as FontId[])
          for (const v of FONT_VARIANTS)
            if (!fonts.get(id, v).hasGlyphForCodePoint(ch.codePointAt(0)!))
              missing.push(`${ch} (${name}) ${id}/${v}`)
    expect(missing).toEqual([])
    const all = SYMBOL_GROUPS.flatMap((g) => g.symbols.map(([c]) => c))
    expect(new Set(all).size).toBe(all.length)
    for (const c of [
      'α',
      'Ω',
      '±',
      '°',
      'µ',
      '×',
      '÷',
      '≤',
      '≥',
      '≈',
      '≠',
      '→',
      '←',
      '↑',
      '↓',
      '‰',
      '∞',
      '√',
      '∑',
      'Å',
      '′',
      '″',
    ])
      expect(all, c).toContain(c)
  })
})
