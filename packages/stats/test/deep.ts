import { expect } from 'vitest'
import { expectClose, type Tolerance } from './oracle.ts'

/**
 * Compares every value in `expected` (numbers, nulls, booleans, arrays and nested objects)
 * with the same path in `got`; keys absent from `expected` are ignored.
 */
export function expectDeepClose(
  got: unknown,
  expected: unknown,
  tol: Partial<Tolerance> = {},
  path = '',
): void {
  if (expected === null) {
    expect(got, path).toBeNull()
    return
  }
  if (typeof expected === 'number') {
    expect(typeof got, `${path} type`).toBe('number')
    expectClose(got as number, expected, tol, path)
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(got) || ArrayBuffer.isView(got), `${path} is array`).toBe(true)
    const g = got as ArrayLike<unknown>
    expect(g.length, `${path}.length`).toBe(expected.length)
    expected.forEach((e, i) => {
      expectDeepClose(g[i], e, tol, `${path}[${i}]`)
    })
    return
  }
  if (typeof expected === 'object') {
    expect(got, path).toBeTypeOf('object')
    expect(got, path).not.toBeNull()
    for (const [k, e] of Object.entries(expected as Record<string, unknown>)) {
      expectDeepClose((got as Record<string, unknown>)[k], e, tol, path ? `${path}.${k}` : k)
    }
    return
  }
  expect(got, path).toBe(expected)
}
