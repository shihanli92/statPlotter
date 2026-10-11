import { mergeRuns, type RichText, type TextRun } from '@ps/model'
import { localName, type XmlElement } from './xml.ts'

// .pzfx files hold formatted titles as nested tags inside the text: <B>, <I>, <U>, <Sup>, <Sub>,
// <Font Face=… Size=… Color=…> and <BR/>, with layout wrappers such as <TextAlign>. Case varies
// between versions, so tags are matched case-insensitively, with long names accepted too. Older
// files write Greek letters as Latin letters in the Symbol font (<Font Face="Symbol">m</Font> for
// µ); those are mapped to the Unicode letters. Colours, sizes and faces are not kept.

type Flag = 'bold' | 'italic' | 'underline' | 'sup' | 'sub'

const TAGS: Record<string, Flag> = {
  b: 'bold',
  bold: 'bold',
  strong: 'bold',
  i: 'italic',
  italic: 'italic',
  em: 'italic',
  u: 'underline',
  underline: 'underline',
  sup: 'sup',
  superscript: 'sup',
  sub: 'sub',
  subscript: 'sub',
}

/** The Symbol font's Latin positions of the Greek letters (and µ). */
const SYMBOL_FONT: Record<string, string> = Object.fromEntries(
  [...'abgdezhqiklmnxoprstufcyw'].map((c, i) => [c, 'αβγδεζηθικλμνξοπρστυφχψω'[i]!]),
)
Object.assign(
  SYMBOL_FONT,
  Object.fromEntries([...'GDQLXPSFYW'].map((c, i) => [c, 'ΓΔΘΛΞΠΣΦΨΩ'[i]!])),
  { j: 'ϕ', v: 'ϖ' },
)

/**
 * The runs of a pzfx text element. Whitespace is treated as `normalize` says, across runs (so the
 * plain text is exactly what the plain reader gives): 'collapse' (titles: runs of whitespace,
 * line breaks included, become one space) or 'trim' (cells).
 */
export function richTextOf(el: XmlElement, normalize: 'collapse' | 'trim'): RichText {
  const runs: TextRun[] = []
  const walk = (e: XmlElement, f: Omit<TextRun, 'text'>, symbol: boolean) => {
    for (const c of e.children) {
      if (typeof c === 'string') {
        const text = symbol ? [...c].map((ch) => SYMBOL_FONT[ch] ?? ch).join('') : c
        runs.push({ ...f, text })
        continue
      }
      const name = localName(c.name).toLowerCase()
      if (name === 'br') {
        runs.push({ ...f, text: '\n' })
        continue
      }
      const flag = TAGS[name]
      const next = { ...f }
      if (flag === 'sup' || flag === 'sub') {
        delete next.sup
        delete next.sub
      }
      if (flag) next[flag] = true
      const face = name === 'font' ? c.attrs.Face : undefined
      walk(c, next, face === undefined ? symbol : /^symbol$/i.test(face))
    }
  }
  walk(el, {}, false)

  // Whitespace across runs, as the plain reader treats the joined text.
  let lastSpace = true
  const out: TextRun[] = []
  for (const r of runs) {
    let text = r.text
    if (normalize === 'collapse') {
      text = text.replace(/\s+/g, ' ')
      if (lastSpace && text.startsWith(' ')) text = text.slice(1)
      if (text) lastSpace = text.endsWith(' ')
    }
    out.push({ ...r, text })
  }
  // Trim the ends: leading from the first runs, trailing from the last.
  for (const r of out) {
    r.text = r.text.replace(/^\s+/, '')
    if (r.text) break
  }
  for (let k = out.length - 1; k >= 0; k--) {
    out[k]!.text = out[k]!.text.replace(/\s+$/, '')
    if (out[k]!.text) break
  }
  return mergeRuns(out)
}
