import { registry } from '@ps/analyses'
import { describe, expect, it } from 'vitest'
import { CUSTOM_FIELDS } from '../src/analysis/customFields.tsx'
import { SIMULATION_FIELDS } from '../src/analysis/simulationFields.tsx'
import { STATS_FIELDS } from '../src/analysis/statsFields.tsx'
import { TRANSFORM_FIELDS } from '../src/analysis/transformFields.tsx'

const FIELDS = { ...CUSTOM_FIELDS, ...TRANSFORM_FIELDS, ...STATS_FIELDS, ...SIMULATION_FIELDS }

describe('roadmap 20 dialog editors', () => {
  it('every custom field of the new and changed analyses has an editor', () => {
    for (const id of [
      'nonlinearFit',
      'nonlinearFitMV',
      'simulateXY',
      'simulateColumn',
      'simulateContingency',
      'monteCarlo',
    ]) {
      const def = registry.get(id)!
      for (const f of def.form)
        if (f.kind === 'custom')
          expect(FIELDS[f.component], `${id}: ${f.component}`).toBeTypeOf('function')
    }
  })

  it('the Monte Carlo’s default simulation and analysis parse', () => {
    const mc = registry.get('monteCarlo')!.params.parse({}) as {
      simulation: { analysisId: string }
      analysis: { analysisId: string }
    }
    expect(registry.get(mc.simulation.analysisId)).toBeDefined()
    expect(registry.get(mc.analysis.analysisId)).toBeDefined()
  })
})
