import { describe, expect, it } from 'vitest'
import { progressStride, reportProgress } from '../src/progress.ts'

// Roadmap 42: loops report every so many steps, about one report per million operations.

describe('progress reporting', () => {
  it('reports every step of a million operations or more, fewer of lighter steps', () => {
    expect(progressStride(1e6)).toBe(1)
    expect(progressStride(3e7)).toBe(1)
    expect(progressStride(4000)).toBe(250)
    expect(progressStride(3)).toBe(333_333)
    expect(progressStride(0)).toBe(1e6)
    expect(progressStride(Number.NaN)).toBe(1e6)
  })

  it('reports every `stride` steps, and nothing without a listener', () => {
    const heard: [number, number][] = []
    for (let s = 1; s <= 10; s++) reportProgress((d, t) => heard.push([d, t]), s, 10, 4)
    expect(heard).toEqual([
      [4, 10],
      [8, 10],
    ])
    expect(() => reportProgress(undefined, 4, 10, 4)).not.toThrow()
  })
})
