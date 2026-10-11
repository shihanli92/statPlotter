/**
 * A minimal, non-validating XML parser for the well-formed, machine-written XML found in .xlsx
 * parts and .pzfx files: elements, attributes, text, CDATA, and the predefined and numeric
 * entities. Comments, processing instructions and DOCTYPE declarations are skipped; namespaces are
 * not resolved (names keep their prefix; match with `localName`).
 */
import { ImportError } from './errors.ts'

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}
export type XmlNode = XmlElement | string

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

/** Whether a character code is one JavaScript's `\s` matches. */
function isSpace(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    (c > 127 &&
      (c === 0xa0 ||
        c === 0x1680 ||
        (c >= 0x2000 && c <= 0x200a) ||
        c === 0x2028 ||
        c === 0x2029 ||
        c === 0x202f ||
        c === 0x205f ||
        c === 0x3000 ||
        c === 0xfeff))
  )
}

/** Deeper nesting than any real workbook or .pzfx file; refused rather than processed. */
export const MAX_XML_DEPTH = 1000

/**
 * What `scanXml` reports, in document order. `depth`: how many elements are open around it (the
 * root's own depth is 0). Text is decoded and reported only inside the root; CDATA as it is.
 */
export interface XmlSink {
  open(name: string, attrs: Record<string, string>, selfClosing: boolean, depth: number): void
  close(name: string, depth: number): void
  text(text: string, depth: number): void
}

/**
 * Reads a document as a stream of events (audit 2, P13: a worksheet is read without building
 * its tree), with every check `parseXml` makes: the same errors at the same offsets. Throws
 * ImportError on malformed input.
 */
export function scanXml(text: string, sink: XmlSink): void {
  const names: string[] = []
  let roots = 0
  const n = text.length
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const fail = (msg: string): never => {
    throw new ImportError(`Malformed XML: ${msg} (at offset ${i}).`)
  }
  const skipPast = (end: string) => {
    const j = text.indexOf(end, i)
    if (j < 0) fail(`unterminated ${JSON.stringify(text.slice(i, i + 9))}`)
    i = j + end.length
  }

  while (i < n) {
    const lt = text.indexOf('<', i)
    if (lt !== i) {
      const end = lt < 0 ? n : lt
      if (names.length) sink.text(decodeEntities(text.slice(i, end)), names.length)
      i = end
      continue
    }
    const c = text.charCodeAt(i + 1)
    if (c === 63 /* ? */) {
      skipPast('?>')
    } else if (c === 33 /* ! */) {
      if (text.startsWith('<!--', i)) skipPast('-->')
      else if (text.startsWith('<![CDATA[', i)) {
        const j = text.indexOf(']]>', i)
        if (j < 0) fail('unterminated CDATA')
        sink.text(text.slice(i + 9, j), names.length)
        i = j + 3
      } else {
        // DOCTYPE, possibly with an internal subset in brackets.
        let depth = 0
        let j = i + 2
        for (; j < n; j++) {
          const ch = text.charCodeAt(j)
          if (ch === 91 /* [ */) depth++
          else if (ch === 93 /* ] */) depth--
          else if (ch === 62 /* > */ && depth <= 0) break
        }
        i = j + 1
      }
    } else if (c === 47 /* / */) {
      const j = text.indexOf('>', i)
      if (j < 0) fail('unterminated end tag')
      const name = text.slice(i + 2, j).trim()
      if (!names.length || names[names.length - 1] !== name) fail(`unexpected </${name}>`)
      names.pop()
      sink.close(name, names.length)
      i = j + 1
    } else {
      // Start tag: name, attributes, optional self-closing slash.
      let j = i + 1
      for (; j < n; j++) {
        const ch = text.charCodeAt(j)
        if (ch === 47 || ch === 62 || isSpace(ch)) break
      }
      const name = text.slice(i + 1, j)
      if (!name) fail('empty tag name')
      const attrs: Record<string, string> = {}
      let selfClosing = false
      for (;;) {
        while (j < n && isSpace(text.charCodeAt(j))) j++
        if (j >= n) fail(`unterminated <${name}>`)
        const ch = text.charCodeAt(j)
        if (ch === 62 /* > */) {
          j++
          break
        }
        if (ch === 47 /* / */ && text.charCodeAt(j + 1) === 62) {
          selfClosing = true
          j += 2
          break
        }
        const eq = text.indexOf('=', j)
        if (eq < 0) fail(`bad attribute in <${name}>`)
        const attr = text.slice(j, eq).trim()
        let k = eq + 1
        while (k < n && isSpace(text.charCodeAt(k))) k++
        const q = text[k]
        if (q !== '"' && q !== "'") fail(`unquoted attribute ${attr} in <${name}>`)
        const close = text.indexOf(q as string, k + 1)
        if (close < 0) fail(`unterminated attribute ${attr}`)
        attrs[attr] = decodeEntities(text.slice(k + 1, close))
        j = close + 1
      }
      if (!names.length) roots++
      sink.open(name, attrs, selfClosing, names.length)
      if (!selfClosing) {
        if (names.length + 1 > MAX_XML_DEPTH)
          fail(`elements nested more than ${MAX_XML_DEPTH} deep`)
        names.push(name)
      }
      i = j
    }
  }
  if (names.length) fail(`unclosed <${names[names.length - 1]}>`)
  if (!roots) throw new ImportError('Malformed XML: no root element.')
}

/** Parses a document and returns its root element. Throws ImportError on malformed input. */
export function parseXml(text: string): XmlElement {
  const doc: XmlElement = { name: '#document', attrs: {}, children: [] }
  const stack: XmlElement[] = [doc]
  scanXml(text, {
    open(name, attrs, selfClosing) {
      const el: XmlElement = { name, attrs, children: [] }
      stack[stack.length - 1]!.children.push(el)
      if (!selfClosing) stack.push(el)
    },
    close() {
      stack.pop()
    },
    text(s) {
      stack[stack.length - 1]!.children.push(s)
    },
  })
  return doc.children.find((c): c is XmlElement => typeof c !== 'string')!
}

export const localName = (name: string): string => name.slice(name.indexOf(':') + 1)

export function elements(el: XmlElement, local?: string): XmlElement[] {
  const out: XmlElement[] = []
  for (const c of el.children) {
    if (typeof c !== 'string' && (local === undefined || localName(c.name) === local)) out.push(c)
  }
  return out
}

export function child(el: XmlElement, local: string): XmlElement | undefined {
  for (const c of el.children) {
    if (typeof c !== 'string' && localName(c.name) === local) return c
  }
  return undefined
}

/**
 * Concatenated text of an element and its descendants. `<BR/>` becomes a newline (rich text in
 * pzfx); elements named in `skip` (by local name) are left out.
 */
export function textContent(el: XmlElement, skip: readonly string[] = []): string {
  // Iterative (an explicit stack of [element, next child]): deep nesting can't overflow.
  let s = ''
  const stack: [XmlElement, number][] = [[el, 0]]
  while (stack.length) {
    const top = stack[stack.length - 1]!
    const [e, i] = top
    if (i >= e.children.length) {
      stack.pop()
      continue
    }
    top[1] = i + 1
    const c = e.children[i]!
    if (typeof c === 'string') s += c
    else {
      const local = localName(c.name)
      if (local === 'BR') s += '\n'
      else if (!skip.includes(local)) stack.push([c, 0])
    }
  }
  return s
}

/** Every descendant element, in document order (iterative, like `textContent`). */
export function descendants(el: XmlElement, descend: (e: XmlElement) => boolean): XmlElement[] {
  const out: XmlElement[] = []
  const stack: [XmlElement, number][] = [[el, 0]]
  while (stack.length) {
    const top = stack[stack.length - 1]!
    const [e, i] = top
    if (i >= e.children.length) {
      stack.pop()
      continue
    }
    top[1] = i + 1
    const c = e.children[i]!
    if (typeof c === 'string') continue
    out.push(c)
    if (descend(c)) stack.push([c, 0])
  }
  return out
}
