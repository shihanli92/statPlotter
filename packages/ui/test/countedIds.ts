// Ids counted instead of drawn at random, for building the examples (audit 2, P22): the model's
// id generators replaced by a counter (`zid000001`…) that starts again at 0 for each example
// built (`counted`), as the v1 example fixtures were written, so a document is the same whichever
// test file built it. A test file installs it with
//
//   vi.mock('../../model/src/ids.ts', async (importOriginal) =>
//     (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
//   )
//
// `always`: every id counted (documents compared by their text), or only those drawn while an
// example is built (the rest random, so ids made afterwards never meet a counted one). This
// module imports nothing of the model (the mock's factory loads it while the model's ids load).

interface Ids {
  newNodeId: () => string
  newColumnId: () => string
  newSeriesId: () => string
  newAnnotationId: () => string
  newLayoutItemId: () => string
  newGroupId: () => string
}

const state = { installed: false, always: true, counting: true, n: 0 }

/** The ids module with its generators counting (see the module comment). */
export function countedIds<M extends Ids>(mod: M, opts: { always: boolean }): M {
  state.installed = true
  state.always = opts.always
  state.counting = opts.always
  const next = (random: () => string) => () =>
    state.counting ? `zid${String(++state.n).padStart(6, '0')}` : random()
  return {
    ...mod,
    newNodeId: next(mod.newNodeId),
    newColumnId: next(mod.newColumnId),
    newSeriesId: next(mod.newSeriesId),
    newAnnotationId: next(mod.newAnnotationId),
    newLayoutItemId: next(mod.newLayoutItemId),
    newGroupId: next(mod.newGroupId),
  }
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs `build` with ids counted from 0 (one build at a time: the counter is shared). A file
 * building examples must install the mock (without it the ids would be random).
 */
export function counted<T>(build: () => Promise<T>): Promise<T> {
  if (!state.installed)
    throw new Error('countedIds is not installed: vi.mock the model’s ids.ts (see countedIds.ts)')
  const run = queue.then(async () => {
    state.counting = true
    state.n = 0
    try {
      return await build()
    } finally {
      state.counting = state.always
    }
  })
  queue = run.catch(() => undefined)
  return run
}
