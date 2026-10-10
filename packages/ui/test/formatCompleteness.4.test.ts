import { vi } from 'vitest'
import { formatCompletenessShard } from './formatCompleteness.ts'

// Roadmap 46 (decision 916): part 4 of the check that the Format places by element render every
// field the stage-1 tabs did (`formatCompleteness.ts`).
vi.mock('../../model/src/ids.ts', async (importOriginal) =>
  (await import('./countedIds.ts')).countedIds(await importOriginal(), { always: false }),
)

formatCompletenessShard(3, 4)
