import { vi } from 'vitest'

/** More arguments than any call on a small, fixed-size list should take. */
const LIMIT = 1000

/**
 * Runs `fn` with `Math.max`, `Math.min`, `Array.prototype.push` and `String.fromCharCode` made to
 * throw when called with more than 1000 arguments: a spread of a data-sized array, which
 * overflows the call stack above ~10⁵ values. Catches the bug with modest inputs.
 */
export function withSpreadGuard<T>(fn: () => T): T {
  const check = (name: string, n: number) => {
    if (n > LIMIT) throw new Error(`${name} called with ${n} arguments (a spread of a data array)`)
  }
  const { max, min } = Math
  const { push } = Array.prototype
  const { fromCharCode } = String
  const spies = [
    vi.spyOn(Math, 'max').mockImplementation((...a: number[]) => {
      check('Math.max', a.length)
      return max(...a)
    }),
    vi.spyOn(Math, 'min').mockImplementation((...a: number[]) => {
      check('Math.min', a.length)
      return min(...a)
    }),
    vi.spyOn(String, 'fromCharCode').mockImplementation((...a: number[]) => {
      check('String.fromCharCode', a.length)
      return fromCharCode(...a)
    }),
  ]
  // push is patched by hand: a spy records each call with push, which would recurse.
  Array.prototype.push = function (this: unknown[], ...a: unknown[]) {
    check('Array.prototype.push', a.length)
    return push.apply(this, a)
  }
  try {
    return fn()
  } finally {
    Array.prototype.push = push
    for (const s of spies) s.mockRestore()
  }
}
