import { describe, it } from 'vitest'
import { registry } from '../src/index.ts'
import { expectEveryDesign } from './graphResultsCases.ts'

// Results on graphs (graphResults.test.ts) for every design of nonlinearFit: in a file of its own so
// that it runs beside the other analyses' (audit 4, T8). Each set of labels runs once with
// profile-likelihood CIs, the other designs with asymptotic ones (graphResultsCases.ts, PROFILED).

describe('ready results on graphs: every design, every field, the sheet’s value', () => {
  it('nonlinearFit', () => expectEveryDesign(registry.get('nonlinearFit')!))
})
