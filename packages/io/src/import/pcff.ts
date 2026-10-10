/**
 * The record structure of the binary section of a Prism XML project (roadmap 39): the base64
 * `<Template>` element holds zlib data that inflates to `PCFFGRA4` followed by tagged records.
 * Found by reading Prism-made files (docs/design/PZFX_GRAPHS.md); not a published format.
 *
 * A record is a little-endian u16 tag and, unless it is an end marker, a u32 payload length and
 * the payload. Tag bit 15 opens a container: the records after it are its children until the end
 * marker, the tag with bit 14 set in place of bit 15 (`0x8012` … `0x4012`). The low 14 bits name
 * the record.
 */
import { Unzlib } from 'fflate'

export const PCFF_MAGIC = 'PCFFGRA4'

/** Deeper nesting than any Prism file shows; refused rather than followed. */
const MAX_DEPTH = 64

export interface PcffRecord {
  /** The record's name: the tag's low 14 bits. */
  tag: number
  /** Where the record starts in the inflated block. */
  offset: number
  payload: Uint8Array
  /** Containers' records (empty for others). */
  children: PcffRecord[]
}

export class PcffError extends Error {
  override name = 'PcffError'
}

const CONTAINER = 0x8000
const END = 0x4000
const NAME = 0x3fff

/**
 * Reads the records after the magic. End markers close the innermost open container of the same
 * name (an unmatched one closes nothing); containers still open at the end are closed there, as
 * Prism's last records are. Throws `PcffError` on a wrong magic or a length past the end.
 */
export function readPcff(bytes: Uint8Array): PcffRecord {
  const magic = String.fromCharCode(...bytes.subarray(0, PCFF_MAGIC.length))
  if (magic !== PCFF_MAGIC) throw new PcffError('not a Prism graph block (no PCFFGRA4 header)')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const root: PcffRecord = { tag: -1, offset: 0, payload: new Uint8Array(), children: [] }
  const stack: PcffRecord[] = [root]
  let i = PCFF_MAGIC.length
  while (i + 2 <= bytes.length) {
    const tag = view.getUint16(i, true)
    if ((tag & (CONTAINER | END)) === END) {
      const name = tag & NAME
      const at = stack.findLastIndex((r, k) => k > 0 && r.tag === name)
      if (at > 0) stack.length = at
      i += 2
      continue
    }
    if (i + 6 > bytes.length) throw new PcffError(`record at ${i} is cut off`)
    const length = view.getUint32(i + 2, true)
    if (length > bytes.length - i - 6)
      throw new PcffError(`record at ${i} runs past the end (${length} bytes)`)
    const rec: PcffRecord = {
      tag: tag & NAME,
      offset: i,
      payload: bytes.subarray(i + 6, i + 6 + length),
      children: [],
    }
    stack[stack.length - 1]!.children.push(rec)
    i += 6 + length
    if (tag & CONTAINER) {
      if (stack.length > MAX_DEPTH) throw new PcffError('records nested too deeply')
      stack.push(rec)
    }
  }
  return root
}

/** Records of `rec` with this tag (its children only). */
export const childrenOf = (rec: PcffRecord, tag: number): PcffRecord[] =>
  rec.children.filter((c) => c.tag === tag)

/** The first child with this tag. */
export const childOf = (rec: PcffRecord, tag: number): PcffRecord | undefined =>
  rec.children.find((c) => c.tag === tag)

/** Every record below `rec` with this tag, depth first in file order. */
export function descendantsOf(rec: PcffRecord, tag: number, out: PcffRecord[] = []): PcffRecord[] {
  for (const c of rec.children) {
    if (c.tag === tag) out.push(c)
    descendantsOf(c, tag, out)
  }
  return out
}

/** Little-endian readers of a payload that answer undefined past its end. */
export function fields(payload: Uint8Array) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const fits = (at: number, n: number) => at >= 0 && at + n <= payload.byteLength
  return {
    u16: (at: number) => (fits(at, 2) ? view.getUint16(at, true) : undefined),
    u32: (at: number) => (fits(at, 4) ? view.getUint32(at, true) : undefined),
    f64: (at: number) => (fits(at, 8) ? view.getFloat64(at, true) : undefined),
    bytes: (at: number, n: number) => (fits(at, n) ? payload.subarray(at, at + n) : undefined),
    length: payload.byteLength,
  }
}

/**
 * Most bytes a graph block may inflate to: Prism's are kilobytes to a few megabytes, so a block
 * past this is a zlib bomb (audit 2 X2), not a graph.
 */
export const MAX_TEMPLATE_BYTES = 64 * 1024 * 1024
/** Compressed bytes fed to the inflater at a time (at most ~1032 times this comes out). */
const FEED = 16 * 1024

/**
 * The inflated graph block of a `<Template>`'s base64 text; null when it doesn't decode or
 * inflates past `max` bytes (stopped there: the input is fed a slice at a time and the output
 * counted, so a bomb never fills memory).
 */
export function inflateTemplate(base64: string, max = MAX_TEMPLATE_BYTES): Uint8Array | null {
  try {
    const clean = base64.replace(/\s+/g, '')
    const bin = atob(clean)
    const bytes = new Uint8Array(bin.length)
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k)
    const chunks: Uint8Array[] = []
    let total = 0
    let done = false
    const inflater = new Unzlib((chunk, final) => {
      total += chunk.length
      if (total <= max) chunks.push(chunk)
      if (final) done = true
    })
    for (let at = 0; at < bytes.length && total <= max && !done; at += FEED) {
      const end = Math.min(at + FEED, bytes.length)
      inflater.push(bytes.subarray(at, end), end === bytes.length)
    }
    if (total > max || !done) return null
    const out = new Uint8Array(total)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  } catch {
    return null
  }
}
