import { registry } from '@ps/analyses'
import { describe, expect, it } from 'vitest'
import {
  combinations,
  MV_FIELDS,
  mvField,
  otherVariables,
  variableInfo,
} from '../src/analysis/mvFields.tsx'

const dataSets = [
  { key: 'y', title: 'Y' },
  { key: 'a', title: 'A', text: true, levels: ['M', 'F'] },
  { key: 'b', title: 'B' },
  { key: 'c', title: 'C' },
]

describe('editors of multiple-variables analyses', () => {
  it('offer a text variable’s values, or a few distinct numbers, as levels', () => {
    expect(variableInfo({ text: [' M', 'F', null, 'M', ''], subcolumns: [] })).toEqual({
      text: true,
      levels: ['M', 'F'],
    })
    expect(variableInfo({ subcolumns: [{ type: 'number', values: [10, 20, null, 10] }] })).toEqual({
      levels: ['10', '20'],
    })
    const many = Array.from({ length: 60 }, (_, i) => i)
    expect(variableInfo({ subcolumns: [{ type: 'number', values: many }] })).toEqual({})
  })

  it('list the variables other than the roles, with fallbacks', () => {
    expect(otherVariables(dataSets, {}, 'y=0').map((d) => d.key)).toEqual(['a', 'b', 'c'])
    expect(otherVariables(dataSets, { y: 'b' }, 'y=0').map((d) => d.key)).toEqual(['y', 'a', 'c'])
    expect(otherVariables(dataSets, {}, 'time=0,event=1').map((d) => d.key)).toEqual(['b', 'c'])
  })

  it('offer every two- and three-way interaction', () => {
    expect(combinations(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['a', 'b', 'c'],
    ])
  })

  it('are registered for every mv.* component the analyses use', () => {
    const used = registry
      .list()
      .flatMap((d) => d.form)
      .flatMap((f) => (f.kind === 'custom' && f.component.startsWith('mv.') ? [f.component] : []))
    expect(used.length).toBeGreaterThan(0)
    for (const c of used) expect(MV_FIELDS[c], c).toBeTypeOf('function')
    expect(mvField('mv.unknown:y=0')).toBeUndefined()
  })
})
