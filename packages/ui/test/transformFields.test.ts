import { registry } from '@ps/analyses'
import { describe, expect, it } from 'vitest'
import { fillK, kFor, TRANSFORM_FIELDS } from '../src/analysis/transformFields.tsx'

const dataSets = [
  { key: 'a', title: 'A' },
  { key: 'b', title: 'B' },
]

describe('Transform: a different K per data set', () => {
  it('starts every analyzed data set at the common K, keeping K already chosen', () => {
    expect(fillK(dataSets, 2)).toEqual({ a: 2, b: 2 })
    expect(fillK(dataSets, 2, { b: 10, gone: 5 })).toEqual({ a: 2, b: 10 })
    expect(kFor({ b: 10 }, 'a', 3)).toBe(3)
    expect(kFor({ b: 10 }, 'b', 3)).toBe(10)
  })

  it('writes params the Transform analysis accepts', () => {
    const def = registry.get('transform')!
    const params = { y: 'multiplyK', k: 2, kByDataSet: { ...fillK(dataSets, 2), b: 10 } }
    expect(def.params.parse(params)).toMatchObject({ kByDataSet: { a: 2, b: 10 } })
  })

  it('is registered under the component id the Transform form names', () => {
    expect(TRANSFORM_FIELDS['transform.kByDataSet']).toBeTypeOf('function')
    // Once the form declares the field, it must use this component.
    const def = registry.get('transform')!
    const field = def.form.find((f) => f.path[0] === 'kByDataSet')
    if (field) expect(field).toMatchObject({ kind: 'custom', component: 'transform.kByDataSet' })
  })
})
