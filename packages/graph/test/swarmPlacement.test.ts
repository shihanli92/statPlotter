import { describe, expect, it } from 'vitest'
import { boxMuller, mulberry32 } from '../../stats/test/rng.ts'
import { swarmOffsets } from '../src/index.ts'
import { growthRatio } from './helpers.ts'

// Audit 2 (P1): swarm placements pinned bit for bit before the placement was made sub-quadratic.
// Each case's offsets are hashed (FNV-1a over their float64 bits); the hashes were taken from
// the quadratic walk. The cases are swarms whose placement the change keeps: up to 1,000 points,
// and larger ones that are not crowded (no band one diameter high holds four rows of the width).

/**
 * Normal-shaped values made by plain arithmetic (the sum of twelve uniforms, less six), so the
 * cases are the same numbers on every platform: `boxMuller`'s `Math.log` and `Math.cos` may differ
 * in the last bit between processors (macOS arm64 against CI's Linux x64), and a bit-for-bit pin
 * of what is placed must not hang on that. Uniforms from `mulberry32` are exact binary fractions.
 */
function irwinHall(u: () => number): () => number {
  return () => {
    let s = 0
    for (let i = 0; i < 12; i++) s += u()
    return s - 6
  }
}

/** FNV-1a (32-bit) over the float64 bits of the offsets, as hex. */
function hash(xs: readonly number[]): string {
  const bytes = new Uint8Array(Float64Array.from(xs).buffer)
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

interface Case {
  name: string
  ys: number[]
  d: number
  half: number
  of?: number
}

function cases(): Case[] {
  const out: Case[] = []
  const add = (name: string, ys: number[], d: number, half: number, of?: number) =>
    out.push({ name, ys, d, half, ...(of !== undefined ? { of } : {}) })
  for (const [n, seed] of [
    [1, 1],
    [2, 2],
    [7, 3],
    [40, 4],
    [150, 5],
    [400, 6],
    [1000, 7],
  ] as const) {
    const u = mulberry32(seed)
    const g = irwinHall(mulberry32(seed + 100))
    // Normal values, spread and tight; uniform; values on a coarse grid (many ties); all equal.
    add(
      `normal ${n}`,
      Array.from({ length: n }, () => 150 + 30 * g()),
      6,
      40,
    )
    add(
      `tight ${n}`,
      Array.from({ length: n }, () => 100 + 6 * g()),
      4,
      20,
    )
    add(
      `uniform ${n}`,
      Array.from({ length: n }, () => 200 * u()),
      5,
      25,
    )
    add(
      `ties ${n}`,
      Array.from({ length: n }, () => Math.round(u() * 40) * 3),
      6,
      30,
    )
    add(`equal ${n}`, new Array<number>(n).fill(50), 6, 40)
    // Wide room, so nothing is compressed; and a sample standing for ten times its points.
    add(
      `wide ${n}`,
      Array.from({ length: n }, () => 80 + 20 * g()),
      3,
      1e6,
    )
    add(
      `sample ${n}`,
      Array.from({ length: n }, () => 20_000 * u()),
      4,
      30,
      n * 10,
    )
  }
  // Larger swarms that are not crowded: small symbols over a tall range.
  for (const [n, seed] of [
    [2500, 11],
    [6000, 12],
  ] as const) {
    const u = mulberry32(seed)
    add(
      `tall ${n}`,
      Array.from({ length: n }, () => 4000 * u()),
      2,
      30,
    )
    const g = irwinHall(mulberry32(seed + 100))
    add(
      `tall normal ${n}`,
      Array.from({ length: n }, () => 3000 + 600 * g()),
      2,
      40,
    )
  }
  return out
}

const EXPECTED: Record<string, string> = {
  'equal 1': '9be17165',
  'equal 1000': 'c0f0ccb9',
  'equal 150': 'dc0ff6c9',
  'equal 2': 'd07de736',
  'equal 40': 'f0fba581',
  'equal 400': '595db9ad',
  'equal 7': '22bb99d5',
  'normal 1': '9be17165',
  'normal 1000': 'd7ae765a',
  'normal 150': '41429bbf',
  'normal 2': '69691905',
  'normal 40': '514c4466',
  'normal 400': '2ef97ef1',
  'normal 7': '22be0c0e',
  'sample 1': '9be17165',
  'sample 1000': 'e1dde06e',
  'sample 150': 'dc829466',
  'sample 2': '69691905',
  'sample 40': 'c2b31b7d',
  'sample 400': '6ba58338',
  'sample 7': '9d4d4b25',
  'tall 2500': '3af19076',
  'tall 6000': 'f59bbc6c',
  'tall normal 2500': 'ece63e54',
  'tall normal 6000': '5862fcad',
  'ties 1': '9be17165',
  'ties 1000': '21cd6e12',
  'ties 150': '61c3a72f',
  'ties 2': '69691905',
  'ties 40': '90ff991a',
  'ties 400': '8b3c0fc9',
  'ties 7': '9d4d4b25',
  'tight 1': '9be17165',
  'tight 1000': '08731685',
  'tight 150': 'c8884ec7',
  'tight 2': '39c50619',
  'tight 40': 'b8b4c66d',
  'tight 400': 'bf9186ce',
  'tight 7': 'b1c2f0d3',
  'uniform 1': '9be17165',
  'uniform 1000': 'a5cb94b9',
  'uniform 150': '9a56f71d',
  'uniform 2': '69691905',
  'uniform 40': 'e987f27e',
  'uniform 400': '8d090b8e',
  'uniform 7': 'e0348649',
  'wide 1': '9be17165',
  'wide 1000': 'c31d33b0',
  'wide 150': 'a42c4fc0',
  'wide 2': '69691905',
  'wide 40': 'fa945ea3',
  'wide 400': '55cda775',
  'wide 7': '9d4d4b25',
}

describe('swarm placement (characterised)', () => {
  it('places every case as the quadratic walk did', () => {
    const got = Object.fromEntries(
      cases().map((c) => [c.name, hash(swarmOffsets(c.ys, c.d, c.half, c.of))]),
    )
    expect(got).toEqual(EXPECTED)
  })
})

describe('swarm placement cost (audit 2, P1)', () => {
  // A crowded swarm of a few thousand points (normal values, a few points across): it was placed
  // point by point up to 10,000 points, a walk across the whole band for each (9,999 took a
  // second; a ratio near 16 here); spread evenly past 1,000 now.
  it('a crowded swarm grows linearly from 2,500 to 10,000 points', () => {
    const normal = (n: number) => {
      const g = boxMuller(mulberry32(3))
      return Array.from({ length: n }, () => 150 + 10 * g())
    }
    const sets = new Map([2500, 10_000].map((n) => [n, normal(n)]))
    expect(growthRatio((n) => swarmOffsets(sets.get(n)!, 4, 20), 2500)).toBeLessThan(10)
  })

  // Not crowded but dense (15 points a diameter high on average, the width's limit being 40):
  // placed point by point, each walk bounded by the width.
  it('an uncrowded dense swarm grows linearly from 2,500 to 10,000 points', () => {
    const dense = (n: number) => {
      const u = mulberry32(4)
      return Array.from({ length: n }, () => ((n * 4) / 15) * u())
    }
    const sets = new Map([2500, 10_000].map((n) => [n, dense(n)]))
    // Placed point by point, not spread evenly: some points stay on the centre line.
    expect(swarmOffsets(sets.get(2500)!, 4, 20).filter((x) => x === 0).length).toBeGreaterThan(10)
    expect(growthRatio((n) => swarmOffsets(sets.get(n)!, 4, 20), 2500)).toBeLessThan(10)
  })
})
