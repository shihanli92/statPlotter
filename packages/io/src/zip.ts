import { unzipSync } from 'fflate'

/** Largest decompressed size accepted for one archive entry. */
export const MAX_ENTRY_BYTES = 256 * 2 ** 20
/** Largest decompressed size accepted for a whole archive. */
export const MAX_TOTAL_BYTES = 512 * 2 ** 20

/** The archive would decompress to more than the limits allow (e.g. a zip bomb). */
export class ZipTooLargeError extends Error {}

const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`

/** Most entries an archive may list (a project or workbook has hundreds at most). */
export const MAX_ENTRIES = 100_000
/** Deflate can't compress more than ~1032:1; a declared size past this ratio is a lie. */
const MAX_RATIO = 1100

/** What `unzipLimited` may still inflate: the limits, and how much of `total` is left. */
export interface ZipLimits {
  entry: number
  total: number
  /** A lower limit for some entries (e.g. images in a project file). */
  entryFor?: (name: string) => number | undefined
}

/**
 * Unzips the entries `keep` accepts, refusing archives whose declared sizes exceed the limits
 * before anything is inflated. fflate allocates each entry's declared size up front and inflates
 * into it, so a size that lies can't produce more output than was checked, and a declared size
 * past what its compressed bytes could inflate to (`MAX_RATIO`), compressed sizes adding up to
 * more than the file, or more than `MAX_ENTRIES` entries refuse the archive before the
 * allocation (audit 2 X3). The entries come back in an object without a prototype, and an entry
 * named `__proto__` is skipped, so a name from inside a file (a relationship's target) looks up
 * only entries. `used` (when given) is told the declared bytes inflated.
 */
export function unzipLimited(
  bytes: Uint8Array,
  keep: (name: string) => boolean = () => true,
  limits: ZipLimits = { entry: MAX_ENTRY_BYTES, total: MAX_TOTAL_BYTES },
  used?: (bytes: number) => void,
): Record<string, Uint8Array> {
  let total = 0
  let count = 0
  let compressed = 0
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (++count > MAX_ENTRIES)
        throw new ZipTooLargeError(`The archive lists more than ${MAX_ENTRIES} entries.`)
      compressed += f.size
      if (compressed > bytes.length)
        throw new ZipTooLargeError('The archive’s entries claim more bytes than the file holds.')
      if (f.name === '__proto__' || !keep(f.name)) return false
      if (f.originalSize > f.size * MAX_RATIO + 1024)
        throw new ZipTooLargeError(
          `${f.name} claims to decompress to ${mb(f.originalSize)} from ${f.size} bytes.`,
        )
      const limit = limits.entryFor?.(f.name) ?? limits.entry
      if (f.originalSize > limit) {
        throw new ZipTooLargeError(
          `${f.name} would decompress to ${mb(f.originalSize)} (limit ${mb(limit)}).`,
        )
      }
      total += f.originalSize
      if (total > limits.total) {
        throw new ZipTooLargeError(`The archive would decompress to more than ${mb(limits.total)}.`)
      }
      return true
    },
  })
  used?.(total)
  const out: Record<string, Uint8Array> = Object.create(null)
  for (const [name, data] of Object.entries(files)) out[name] = data
  return out
}
