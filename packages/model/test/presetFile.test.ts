import { describe, expect, it } from 'vitest'
import {
  newUserPreset,
  PRESET_FORMAT,
  PRESET_VERSION,
  PresetError,
  type PresetRecipe,
  presetNameProblem,
  readPreset,
  uniquePresetName,
  writePreset,
} from '../src/index.ts'

// Preset files (roadmap 33c): a layer stack as a recipe, checked with zod and a version on the
// way in; incompatible files refused with a message for the user.

const recipe: PresetRecipe = {
  tableKind: 'column',
  frame: 'category',
  look: 'column.bar',
  layers: [
    { id: 'bars', geom: 'bar', stat: { kind: 'summary', center: 'mean' } },
    { id: 'points', geom: 'points', stat: { kind: 'identity' }, style: { size: 5 } },
    {
      id: 'error',
      geom: 'errorbar',
      stat: { kind: 'summary', center: 'mean', error: 'SEM' },
      on: 'bars',
    },
  ],
  orientation: 'horizontal',
}

const file = (over: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(writePreset(newUserPreset('Mine', recipe))), ...over })

describe('preset files', () => {
  it('round-trip; an exported file leaves out the library’s order and default', () => {
    const p = { ...newUserPreset('  Bars + points  ', recipe), order: 3, isDefault: true }
    expect(p.name).toBe('Bars + points')
    expect(readPreset(writePreset(p))).toEqual(p)
    const exported = readPreset(writePreset(p, { exported: true }))
    expect(exported).toEqual({ ...p, order: undefined, isDefault: undefined })
    expect(exported.order).toBeUndefined()
    expect(JSON.parse(writePreset(p))).toMatchObject({
      format: PRESET_FORMAT,
      version: PRESET_VERSION,
    })
  })

  it('refuse other files, newer versions and invalid layers with a clear message', () => {
    const refused = (text: string) => {
      try {
        readPreset(text)
      } catch (e) {
        expect(e).toBeInstanceOf(PresetError)
        return (e as Error).message
      }
      throw new Error('accepted')
    }
    expect(refused('not json')).toMatch(/not valid JSON/)
    expect(refused('{"format":"plotting-software-method","version":1}')).toBe('Not a preset file.')
    expect(refused(file({ version: PRESET_VERSION + 1 }))).toMatch(/newer version/)
    expect(refused(file({ name: '' }))).toMatch(/^This preset can’t be used: name/)
    expect(
      refused(file({ recipe: { ...recipe, layers: [{ id: 'x', geom: 'warp', stat: {} }] } })),
    ).toMatch(/recipe\.layers/)
    expect(refused(file({ recipe: { ...recipe, layers: [] } }))).toMatch(/recipe\.layers/)
    // Layer references checked: an attachment to a layer it doesn't have.
    expect(
      refused(
        file({
          recipe: {
            ...recipe,
            layers: [{ ...recipe.layers[2], on: 'nothing' }],
          },
        }),
      ),
    ).toMatch(/no host layer/)
    expect(refused(file({ recipe: { ...recipe, tableKind: 'spreadsheet' } }))).toMatch(/tableKind/)
  })

  it('names: required, not too long, file-safe, not taken', () => {
    expect(presetNameProblem('')).toMatch(/name/)
    expect(presetNameProblem('   ')).toMatch(/name/)
    expect(presetNameProblem('x'.repeat(61))).toMatch(/at most 60/)
    expect(presetNameProblem('a/b')).toMatch(/can’t contain/)
    expect(presetNameProblem('.hidden')).toMatch(/dot/)
    expect(presetNameProblem('Bars', ['bars'])).toBe('There is already a preset called “Bars”.')
    expect(presetNameProblem('Bars', ['Box'])).toBeNull()
    expect(uniquePresetName('Bars', ['Bars', 'Bars (2)'])).toBe('Bars (3)')
    expect(uniquePresetName('New', ['Bars'])).toBe('New')
  })

  // Audit 2 X1: a shared file's name the library can't take looped forever.
  it('a name from a crafted file is made valid and the search ends', () => {
    const named = (name: string, taken: string[] = []) => {
      const n = uniquePresetName(name, taken)
      expect(presetNameProblem(n, taken)).toBeNull()
      return n
    }
    expect(named('a/b')).toBe('a-b')
    expect(named('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(named('.hidden')).toBe('hidden')
    expect(named('. . .')).toBe('Preset')
    expect(named('...', ['Preset'])).toBe('Preset (2)')
    expect(named('a/b', ['a-b', 'A-B (2)'])).toBe('a-b (3)')
    expect(named('x'.repeat(60), ['x'.repeat(60)])).toBe(`${'x'.repeat(56)} (2)`)
    // Many taken: the number's digits still fit in the name.
    const many = [
      'x'.repeat(60),
      ...Array.from({ length: 200 }, (_, i) => `${'x'.repeat(55)} (${i + 2})`),
    ]
    expect(named('x'.repeat(60), many).length).toBeLessThanOrEqual(60)
  })
})
