import { defaultUserPreset, presetGraph } from '@ps/graph'
import { presetRecipe, readPreset } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { sampleTable } from '../../graph/test/helpers.ts'
import { builderReducer, initialBuilder } from '../src/graph/builder/builderState.ts'
import {
  deletePreset,
  exportPreset,
  importPreset,
  loadPresets,
  movePreset,
  renamePreset,
  savePreset,
  setDefaultPreset,
} from '../src/graph/presets/userPresetStore.ts'
import { memoryLibrary, resilientLibrary } from '../src/reuse/library.ts'
import type { Library } from '../src/services.ts'

// The user's presets in their library (roadmap 33c): saved first in the list, renamed,
// reordered, one default per table kind, exported and imported; storage that falls back to
// memory; the builder starting from the default.

const column = sampleTable('column')
const recipe = (id: string, table = column) => presetRecipe(presetGraph(table, id), table.tableKind)
const names = async (l: Library) => (await loadPresets(l)).map((p) => p.name)

describe('the preset library', () => {
  it('saves new presets first, renames, reorders and deletes them', async () => {
    const lib = memoryLibrary()
    await savePreset(lib, 'Bars', recipe('barsPoints'))
    await savePreset(lib, 'Box', recipe('boxPoints'))
    expect(await names(lib)).toEqual(['Box', 'Bars'])
    await expect(savePreset(lib, 'box', recipe('points'))).rejects.toThrow(/already a preset/)
    await renamePreset(lib, 'Bars', 'Bars ± SEM')
    expect(await names(lib)).toEqual(['Box', 'Bars ± SEM'])
    await expect(renamePreset(lib, 'Box', 'a/b')).rejects.toThrow(/can’t contain/)
    await movePreset(lib, 'Bars ± SEM', -1)
    expect(await names(lib)).toEqual(['Bars ± SEM', 'Box'])
    await movePreset(lib, 'Bars ± SEM', -1)
    expect(await names(lib)).toEqual(['Bars ± SEM', 'Box'])
    await deletePreset(lib, 'Box')
    expect(await names(lib)).toEqual(['Bars ± SEM'])
  })

  it('keeps one default per table kind', async () => {
    const lib = memoryLibrary()
    await savePreset(lib, 'A', recipe('barsPoints'), { isDefault: true })
    await savePreset(lib, 'X', recipe('envelope', sampleTable('xy')), { isDefault: true })
    await savePreset(lib, 'B', recipe('boxPoints'), { isDefault: true })
    let all = await loadPresets(lib)
    expect(defaultUserPreset(all, 'column')?.name).toBe('B')
    expect(defaultUserPreset(all, 'xy')?.name).toBe('X')
    expect(all.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['B', 'X'])
    await setDefaultPreset(lib, 'A', true)
    all = await loadPresets(lib)
    expect(all.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['X', 'A'])
    await setDefaultPreset(lib, 'A', false)
    expect(defaultUserPreset(await loadPresets(lib), 'column')).toBeUndefined()
  })

  it('exports a file another library imports under a free name', async () => {
    const lib = memoryLibrary()
    const saved = await savePreset(lib, 'Bars', recipe('barsPoints'), { isDefault: true })
    const text = exportPreset((await loadPresets(lib))[0]!)
    expect(readPreset(text).isDefault).toBeUndefined()
    const other = memoryLibrary()
    expect((await importPreset(other, text)).name).toBe('Bars')
    expect((await importPreset(other, text)).name).toBe('Bars (2)')
    const back = await loadPresets(other)
    expect(back.map((p) => p.name)).toEqual(['Bars', 'Bars (2)'])
    expect(back[0]!.recipe).toEqual(saved.recipe)
    expect(back.some((p) => p.isDefault)).toBe(false)
    await expect(importPreset(other, '{"format":"x"}')).rejects.toThrow('Not a preset file.')
  })

  it('skips entries that aren’t presets', async () => {
    const lib = memoryLibrary()
    await lib.write('junk', new TextEncoder().encode('hello'))
    await savePreset(lib, 'Bars', recipe('barsPoints'))
    expect(await names(lib)).toEqual(['Bars'])
  })

  it('falls back to memory when the storage fails', async () => {
    const broken: Library = {
      list: () => Promise.reject(new Error('blocked')),
      read: () => Promise.reject(new Error('blocked')),
      write: () => Promise.reject(new Error('blocked')),
      remove: () => Promise.reject(new Error('blocked')),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lib = resilientLibrary(broken)
    await savePreset(lib, 'Bars', recipe('barsPoints'))
    expect(await names(lib)).toEqual(['Bars'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
    // No storage at all: memory from the start.
    const none = resilientLibrary(undefined)
    await savePreset(none, 'Box', recipe('boxPoints'))
    expect(await names(none)).toEqual(['Box'])
  })
})

describe('the builder with user presets', () => {
  it('starts from the kind’s default preset, and applies a recipe like a built-in one', async () => {
    const lib = memoryLibrary()
    const g = presetGraph(column, 'barsPoints')
    const r = presetRecipe(
      { ...g, style: { ...g.style, orientation: 'horizontal' }, drawOrder: 'series' },
      'column',
    )
    await savePreset(lib, 'Sideways', r, { isDefault: true })
    const user = defaultUserPreset(await loadPresets(lib), 'column')!
    const s = initialBuilder(column, undefined, user)
    expect(s).toMatchObject({ preset: 'user:Sideways', custom: false, horizontal: true })
    expect(s.drawOrder).toBe('series')
    expect(s.layers).toEqual(r.layers)
    // A built-in preset afterwards drops the recipe's extras.
    const t = builderReducer(column, s, { type: 'preset', id: 'points' })
    expect(t.drawOrder).toBeUndefined()
    expect(t.preset).toBe('points')
    // Without a default: the kind's own.
    expect(initialBuilder(column).preset).toBe('points')
  })
})
