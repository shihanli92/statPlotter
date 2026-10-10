import { unzlibSync } from 'fflate'
import { expect } from 'vitest'

// A small structural PDF reader for tests: checks the cross-reference table points at every
// object, and returns each object's dictionary text and (inflated) stream.

export interface PdfObject {
  dict: string
  stream?: Uint8Array
}

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

export function readPdf(bytes: Uint8Array): { objects: Map<number, PdfObject>; trailer: string } {
  const text = latin1(bytes)
  expect(text.startsWith('%PDF-1.')).toBe(true)
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1])
  expect(text.slice(startxref, startxref + 4)).toBe('xref')
  const m = /^xref\n0 (\d+)\n/.exec(text.slice(startxref))!
  const count = Number(m[1])
  const table = startxref + m[0].length
  const objects = new Map<number, PdfObject>()
  for (let i = 1; i < count; i++) {
    const entry = text.slice(table + i * 20, table + (i + 1) * 20)
    expect(entry).toMatch(/^\d{10} 00000 n\r\n$/)
    const at = Number(entry.slice(0, 10))
    const head = `${i} 0 obj\n`
    expect(text.slice(at, at + head.length)).toBe(head)
    const end = text.indexOf('endobj', at)
    const body = text.slice(at + head.length, end)
    const s = body.indexOf('\nstream\n')
    if (s < 0) {
      objects.set(i, { dict: body.trim() })
      continue
    }
    const dict = body.slice(0, s)
    const length = Number(/\/Length (\d+)/.exec(dict)![1])
    const start = at + head.length + s + '\nstream\n'.length
    let data = bytes.subarray(start, start + length)
    expect(text.slice(start + length, start + length + 10)).toBe('\nendstream')
    if (dict.includes('/FlateDecode')) data = unzlibSync(data)
    objects.set(i, { dict, stream: data })
  }
  const trailer = /trailer\n(<<.*>>)/.exec(text.slice(startxref))![1]!
  return { objects, trailer }
}

/** The object a reference in `dict` under `key` points at ("/Contents 4 0 R"). */
export function deref(
  pdf: ReturnType<typeof readPdf>,
  dict: string,
  key: string,
): PdfObject & { id: number } {
  const id = Number(new RegExp(`/${key}\\s*(\\d+) 0 R`).exec(dict)![1])
  return { id, ...pdf.objects.get(id)! }
}

export const streamText = (o: PdfObject) => latin1(o.stream!)

/** The page's text as pdf.js extracts it, its size and the fonts it loaded. */
export async function pdfjsRead(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  const doc = await task.promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const ops = await page.getOperatorList()
  const fontIds = new Set<string>()
  for (const [i, fn] of ops.fnArray.entries())
    if (fn === pdfjs.OPS.setFont) fontIds.add(ops.argsArray[i][0] as string)
  const fonts = [...fontIds].map((id) => {
    const f = page.commonObjs.get(id) as {
      name: string
      missingFile: boolean
      isInvalidPDFjsFont: boolean
      mimetype: string
    }
    // Embedded (not substituted), and a font program pdf.js could read.
    return { name: f.name, embedded: !f.missingFile && !f.isInvalidPDFjsFont, mimetype: f.mimetype }
  })
  const meta = await doc.getMetadata()
  const items = content.items.flatMap((it) => ('str' in it ? [it] : []))
  await task.destroy()
  return {
    width: viewport.width,
    height: viewport.height,
    text: items.map((it) => it.str).join(' '),
    items,
    fonts,
    info: meta.info as Record<string, unknown>,
  }
}
