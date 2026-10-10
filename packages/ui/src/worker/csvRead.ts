import { CsvColumnReader, type CsvColumns, type CsvColumnsOptions, ImportError } from '@ps/io'

// Reading a large CSV file (roadmap 34e): the file streamed in chunks, decoded and split straight
// into columns (`CsvColumnReader`), with progress; in a worker where there is one (the page stays
// responsive and Cancel stops it at once), else on this thread.

export interface CsvReadOptions extends Omit<CsvColumnsOptions, 'skip'> {
  /** Columns (0-based) to leave out. */
  skip: number[]
}

/** The worker's messages: progress (fraction of the bytes, records so far), then the result. */
export type CsvReadReply =
  | { progress: number; records: number }
  | { result: CsvColumns }
  | { error: string; importError: boolean }

const BOMS: [number[], string][] = [
  [[0xef, 0xbb, 0xbf], 'utf-8'],
  [[0xff, 0xfe], 'utf-16le'],
  [[0xfe, 0xff], 'utf-16be'],
]

/** Bytes read between progress reports. */
const REPORT_BYTES = 2 * 2 ** 20

/**
 * The file's records as columns: decoded by its byte-order mark (UTF-8, UTF-16), else as UTF-8,
 * read again as Windows-1252 when it isn't valid UTF-8 (as `decodeText`).
 */
export async function readBlobColumns(
  blob: Blob,
  options: CsvReadOptions,
  onProgress: (fraction: number, records: number) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<CsvColumns> {
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer())
  const bom = BOMS.find(([b]) => b.every((x, i) => head[i] === x))
  const attempt = async (encoding: string, fatal: boolean) => {
    const reader = new CsvColumnReader({ ...options, skip: new Set(options.skip) })
    const decoder = new TextDecoder(encoding, { fatal })
    const stream = blob
      .slice(bom ? bom[0].length : 0)
      .stream()
      .getReader()
    let done = 0
    let reported = 0
    for (;;) {
      const { value, done: end } = await stream.read()
      if (end) break
      if (cancelled()) {
        await stream.cancel()
        throw new ImportError('Cancelled.')
      }
      reader.push(decoder.decode(value, { stream: true }))
      done += value.length
      if (done - reported >= REPORT_BYTES) {
        reported = done
        onProgress(done / Math.max(1, blob.size), reader.count)
      }
    }
    reader.push(decoder.decode())
    onProgress(1, reader.count)
    return reader.end()
  }
  if (bom) return attempt(bom[1], false)
  try {
    return await attempt('utf-8', true)
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
    return attempt('windows-1252', false)
  }
}

/** The result's arrays at their own size (the reader's have room to grow), for transfer. */
export function compactColumns(c: CsvColumns): { result: CsvColumns; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = []
  const columns = c.columns.map((col) => {
    if (!col) return null
    const nums = col.nums.slice()
    const codes = col.codes ? col.codes.slice() : null
    transfer.push(nums.buffer)
    if (codes) transfer.push(codes.buffer)
    return { ...col, nums, codes }
  })
  return { result: { ...c, columns }, transfer }
}

export interface CsvRead {
  promise: Promise<CsvColumns>
  /** Stops reading (the promise rejects with an ImportError "Cancelled."). */
  cancel(): void
}

/** Reads a CSV file into columns in a worker (on this thread where there is none). */
export function startCsvRead(
  blob: Blob,
  options: CsvReadOptions,
  onProgress: (fraction: number, records: number) => void,
  opts: { worker?: boolean } = {},
): CsvRead {
  if (typeof Worker === 'undefined' || opts.worker === false) {
    let stop = false
    return {
      promise: readBlobColumns(blob, options, onProgress, () => stop),
      cancel: () => {
        stop = true
      },
    }
  }
  const worker = new Worker(new URL('./csvRead.worker.ts', import.meta.url), { type: 'module' })
  let settle: { reject: (e: unknown) => void } | null = null
  const promise = new Promise<CsvColumns>((resolve, reject) => {
    settle = { reject }
    worker.onmessage = (e: MessageEvent<CsvReadReply>) => {
      const d = e.data
      if ('progress' in d) onProgress(d.progress, d.records)
      else {
        worker.terminate()
        if ('result' in d) resolve(d.result)
        else reject(d.importError ? new ImportError(d.error) : new Error(d.error))
      }
    }
    worker.onerror = (e) => {
      e.preventDefault()
      worker.terminate()
      reject(new Error(e.message || 'The file could not be read.'))
    }
    worker.postMessage({ blob, options })
  })
  return {
    promise,
    cancel: () => {
      worker.terminate()
      settle?.reject(new ImportError('Cancelled.'))
    },
  }
}
