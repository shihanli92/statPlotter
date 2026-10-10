import { writeProjectFile } from '@ps/io'
import { errorMessage } from '../util.ts'
import type { SerializeReply, SerializeRequest } from './serialize.ts'

// Minimal worker scope typing (the DOM and WebWorker libs can't share one program).
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SerializeRequest>) => void) | null
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
}

// Writes project files (recovery copies) off the main thread: JSON and deflate of a large table
// take hundreds of milliseconds, the structured clone that brings it here a tenth of that.
scope.onmessage = (e) => {
  const { id, project, results, view, assets, packed } = e.data
  try {
    const bytes = writeProjectFile(project, { results, view, assets, packed })
    scope.postMessage({ id, bytes }, [bytes.buffer])
  } catch (err) {
    scope.postMessage({ id, error: errorMessage(err) })
  }
}

// Loaded: copies sent from now on come back promptly (see `Serializer.ready`).
scope.postMessage({ ready: true } satisfies SerializeReply)
