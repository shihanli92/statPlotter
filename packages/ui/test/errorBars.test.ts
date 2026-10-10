import { describe, expect, it } from 'vitest'
import { pairedCenter, pairedError } from '../src/graph/inspector/errorBars.ts'

describe('error bar and centre choices', () => {
  it('pairs the spread with the centre when the centre changes', () => {
    expect(pairedError('median', 'SD')).toBe('IQR')
    expect(pairedError('median', 'SEM')).toBe('IQR')
    expect(pairedError('median', 'MAD')).toBe('MAD')
    expect(pairedError('mean', 'IQR')).toBe('SD')
    expect(pairedError('mean', 'MADn')).toBe('SD')
    expect(pairedError('mean', 'SEM')).toBe('SEM')
    expect(pairedError('median', 'none')).toBe('none')
    expect(pairedError('median', 'range')).toBe('range')
    // The geometric mean with its SD factor (roadmap 30), and back.
    expect(pairedError('geomean', 'SD')).toBe('geoSD')
    expect(pairedError('geomean', 'IQR')).toBe('geoSD')
    expect(pairedError('geomean', 'geoCI')).toBe('geoCI')
    expect(pairedError('mean', 'geoCI')).toBe('SD')
    expect(pairedError('median', 'geoSD')).toBe('IQR')
  })

  it('pairs the centre with the spread chosen', () => {
    expect(pairedCenter('IQR', 'mean')).toBe('median')
    expect(pairedCenter('geoSD', 'mean')).toBe('geomean')
    expect(pairedCenter('SEM', 'median')).toBe('mean')
    expect(pairedCenter('range', 'median')).toBe('median')
    expect(pairedCenter('none', 'geomean')).toBe('geomean')
  })
})
