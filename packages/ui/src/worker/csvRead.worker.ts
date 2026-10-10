import { ImportError } from '@ps/io'
import { errorMessage } from '../util.ts'
import {
  type CsvReadOptions,
  type CsvReadReply,
  compactColumns,
  readBlobColumns,
} from './csvRead.ts'

// Reads a large CSV file into columns off the main thread (roadmap 34e), reporting progress;
// the page cancels it by terminating the worker.

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ blob: Blob; options: CsvReadOptions }>) => void) | null
  postMessage: (msg: CsvReadReply, transfer?: Transferable[]) => void
}

scope.onmessage = async (e) => {
  const { blob, options } = e.data
  try {
    const columns = await readBlobColumns(blob, options, (progress, records) =>
      scope.postMessage({ progress, records }),
    )
    const { result, transfer } = compactColumns(columns)
    scope.postMessage({ result }, transfer)
  } catch (err) {
    scope.postMessage({ error: errorMessage(err), importError: err instanceof ImportError })
  }
}
