import { describe, expect, it } from 'vitest'
import {
  type ContourLine,
  contourLines,
  type DotAverage,
  densityAt,
  densityBandwidths,
  dotPlotStats,
  hdrLevels,
  hexbin,
  hexCenters,
  kde2d,
  levelRegion,
  pretty,
} from '../src/index.ts'
import { arr, expectClose, isClose, loadFixtures } from './oracle.ts'
import { mulberry32 } from './rng.ts'
import { growthRatio } from './timing.ts'

// Roadmap 34g's density plots against R: 2D kernel densities (MASS::kde2d with ggplot2's
// bandwidths, and the app's binned estimate for many points), the density at each point, levels
// containing shares of the points, ggplot2's contour levels (R's pretty) and contour lines
// (grDevices::contourLines, as point sets); hexagonal bins (hexbin::hexbin, hcell2xy); dot plot
// statistics (Seurat's DotPlot). tools/oracle/r/{density2d,hexbin,dotplot,pretty}.R.

interface DensityIn {
  x: number[]
  y: number[]
}
interface RLine {
  level: number
  x: number[] | number
  y: number[] | number
}
interface DensityExpected {
  h: number[]
  x: number[]
  y: number[]
  z: number[]
  at: number[]
  hdr: number[]
  breaks: number[]
  lines: RLine[]
  hdrLines: RLine[]
}

/** Every point of the lines at each level, sorted (contour lines compared as point sets). */
function pointSets(
  lines: readonly { level: number; x: ArrayLike<number>; y: ArrayLike<number> }[],
) {
  const out = new Map<number, [number, number][]>()
  for (const l of lines) {
    const list = out.get(l.level) ?? []
    for (let i = 0; i < l.x.length; i++) list.push([l.x[i]!, l.y[i]!])
    out.set(l.level, list)
  }
  for (const [k, list] of out) {
    // R's closed lines repeat their first point; ours don't: each point once.
    const seen = new Map<string, [number, number]>()
    for (const p of list) seen.set(`${p[0].toPrecision(12)},${p[1].toPrecision(12)}`, p)
    out.set(
      k,
      [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    )
  }
  return out
}

function expectSameLines(
  got: readonly ContourLine[],
  want: readonly RLine[],
  scale: number,
  what: string,
) {
  const g = pointSets(got)
  const w = pointSets(want.map((l) => ({ level: l.level, x: arr(l.x), y: arr(l.y) })))
  expect([...g.keys()].sort(), `${what}: levels drawn`).toEqual([...w.keys()].sort())
  for (const [level, pts] of w) {
    const mine = g.get(level)!
    expect(mine.length, `${what}: points at ${level}`).toBe(pts.length)
    pts.forEach(([x, y], i) => {
      expectClose(mine[i]![0], x, { rtol: 1e-10, atol: 1e-12 * scale }, `${what} ${level} x ${i}`)
      expectClose(mine[i]![1], y, { rtol: 1e-10, atol: 1e-12 * scale }, `${what} ${level} y ${i}`)
    })
  }
}

describe('2D kernel densities vs R', () => {
  for (const f of loadFixtures<DensityIn, DensityExpected>('density2d')) {
    it(f.name, () => {
      const p = f.params as {
        n: number
        method: 'exact' | 'binned'
        adjust: number
        probs: number[] | number
        lims?: [number, number, number, number]
      }
      const { x, y } = f.input
      const e = f.expected
      const h = densityBandwidths(x, y, p.adjust)
      h.forEach((v, i) => {
        expectClose(v, e.h[i]!, {}, `h ${i}`)
      })
      const d = kde2d(x, y, { h, n: p.n, method: p.method, ...(p.lims ? { lims: p.lims } : {}) })
      expect(d.binned).toBe(p.method === 'binned')
      d.x.forEach((v, i) => {
        expectClose(v, e.x[i]!, { atol: 1e-14 }, `gx ${i}`)
      })
      d.y.forEach((v, i) => {
        expectClose(v, e.y[i]!, { atol: 1e-14 }, `gy ${i}`)
      })
      // Far from the points the density underflows: absolute to the largest value.
      const top = Math.max(...e.z)
      d.z.forEach((v, i) => {
        expectClose(v, e.z[i]!, { rtol: 1e-10, atol: 1e-14 * top }, `z ${i}`)
      })
      const at = x.map((px, i) => densityAt(d, px, y[i]!))
      at.forEach((v, i) => {
        expectClose(v, e.at[i]!, { rtol: 1e-10, atol: 1e-14 * top }, `at ${i}`)
      })
      const hdr = hdrLevels(at, arr(p.probs))
      hdr.forEach((v, i) => {
        expectClose(v, arr(e.hdr)[i]!, { atol: 1e-14 * top }, `hdr ${i}`)
      })
      const range: [number, number] = [Math.min(...d.z), Math.max(...d.z)]
      expect(pretty(range[0], range[1], 10)).toEqual(arr(e.breaks))
      const scale = Math.max(d.x.at(-1)! - d.x[0]!, d.y.at(-1)! - d.y[0]!)
      // Compared on R's grid, so only the contouring is tested here.
      const grid = { x: e.x, y: e.y, z: e.z }
      expectSameLines(contourLines(grid, arr(e.breaks)), e.lines, scale, 'breaks')
      expectSameLines(contourLines(grid, arr(e.hdr)), e.hdrLines, scale, 'shares')
    })
  }
})

describe('contours', () => {
  /** A cone peaking at (0, 0) on a grid over [−1, 1]². */
  const cone = (n: number) => {
    const g = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1))
    const z = new Float64Array(n * n)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) z[i + j * n] = 1 - Math.hypot(g[i]!, g[j]!)
    return { x: g, y: g, z }
  }
  /** The signed area of a ring (positive: counter-clockwise). */
  const area = (l: ContourLine) => {
    let a = 0
    for (let i = 0; i < l.x.length; i++) {
      const k = (i + 1) % l.x.length
      a += l.x[i]! * l.y[k]! - l.x[k]! * l.y[i]!
    }
    return a / 2
  }
  it('rings round a peak run counter-clockwise, round a dip clockwise', () => {
    const peak = contourLines(cone(21), [0.5])
    expect(peak).toHaveLength(1)
    expect(peak[0]!.closed).toBe(true)
    expect(area(peak[0]!)).toBeGreaterThan(0)
    expectClose(area(peak[0]!), Math.PI * 0.25, { rtol: 0.02 })
    const dip = cone(21)
    const neg = { ...dip, z: dip.z.map((v) => -v) }
    const ring = contourLines(neg, [-0.5])
    expect(area(ring[0]!)).toBeLessThan(0)
  })
  it('closes regions along the grid’s edges', () => {
    const c = cone(11)
    // At 0.2 the region reaches nothing of the edge; at −0.2 it reaches the edges' middles.
    const inner = levelRegion(c, 0.2)
    expect(inner).toHaveLength(1)
    const wide = levelRegion(c, -0.2)
    expect(wide.every((l) => l.closed)).toBe(true)
    const total = wide.reduce((s, l) => s + area(l), 0)
    expect(total).toBeGreaterThan(Math.PI * 1.2 ** 2 * 0.6)
    expect(total).toBeLessThan(4)
    // The whole grid at a level below every value: its boundary.
    const all = levelRegion(c, -10)
    expectClose(
      all.reduce((s, l) => s + area(l), 0),
      4,
      { rtol: 1e-12 },
    )
  })
  it('skips cells with a missing corner and draws nothing without a crossing', () => {
    const c = cone(9)
    const z = Float64Array.from(c.z)
    z[40] = Number.NaN
    expect(contourLines({ ...c, z }, [0.9]).length).toBe(0)
    expect(contourLines(c, [2])).toEqual([])
  })
})

/**
 * Each R line matches one of ours at its level with the same points in the same order (either
 * direction; a ring from any point): the lines' connectivity, not only their points.
 */
function expectSameConnectedLines(got: readonly ContourLine[], want: readonly RLine[]) {
  const close = (a: [number, number], b: [number, number]) =>
    isClose(a[0], b[0], { rtol: 1e-10, atol: 1e-12 }) &&
    isClose(a[1], b[1], { rtol: 1e-10, atol: 1e-12 })
  const pts = (x: ArrayLike<number>, y: ArrayLike<number>) =>
    Array.from(x, (v, i) => [v, y[i]!] as [number, number])
  const mine = got.map((l) => ({ level: l.level, closed: l.closed, p: pts(l.x, l.y) }))
  expect(mine.length, 'lines').toBe(want.length)
  for (const [k, l] of want.entries()) {
    let p = pts(arr(l.x), arr(l.y))
    // R repeats a ring's first point at its end.
    const closed = p.length > 2 && close(p[0]!, p.at(-1)!)
    if (closed) p = p.slice(0, -1)
    const turns = (q: [number, number][]) =>
      closed ? q.map((_, r) => [...q.slice(r), ...q.slice(0, r)]) : [q]
    const hit = mine.findIndex(
      (m) =>
        m.level === l.level &&
        m.closed === closed &&
        m.p.length === p.length &&
        [...turns(m.p), ...turns([...m.p].reverse())].some((q) =>
          q.every((v, i) => close(v, p[i]!)),
        ),
    )
    expect(hit, `R line ${k} at ${l.level}: ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(0)
    mine.splice(hit, 1)
  }
}

describe('contour lines through saddle cells vs R (grDevices::contourLines)', () => {
  for (const f of loadFixtures<
    { x: number[]; y: number[]; z: number[]; levels: number[] | number },
    { lines: RLine[] }
  >('contour')) {
    it(f.name, () => {
      const { x, y, z } = f.input
      expectSameConnectedLines(contourLines({ x, y, z }, arr(f.input.levels)), f.expected.lines)
    })
  }
})

describe('R’s pretty', () => {
  for (const f of loadFixtures<{ range: number[] }, { breaks: number[] | number }>('pretty')) {
    it(f.name, () => {
      const [lo, hi] = f.input.range
      expect(pretty(lo!, hi!, (f.params as { n: number }).n)).toEqual(arr(f.expected.breaks))
    })
  }
})

interface HexExpected {
  cell: number[] | number
  count: number[] | number
  xcm: number[] | number
  ycm: number[] | number
  cx: number[] | number
  cy: number[] | number
  dimen: number[]
}

describe('hexagonal bins vs R', () => {
  for (const f of loadFixtures<DensityIn, HexExpected>('hexbin')) {
    it(f.name, () => {
      const p = f.params as {
        xbins: number
        shape: number
        xbnds?: [number, number]
        ybnds?: [number, number]
      }
      const h = hexbin(f.input.x, f.input.y, p)!
      expect(Array.from(h.cell)).toEqual(arr(f.expected.cell))
      expect(Array.from(h.count)).toEqual(arr(f.expected.count))
      expect(h.dimen).toEqual(f.expected.dimen)
      h.xcm.forEach((v, i) => {
        expectClose(v, arr(f.expected.xcm)[i]!, { atol: 1e-13 }, `xcm ${i}`)
      })
      h.ycm.forEach((v, i) => {
        expectClose(v, arr(f.expected.ycm)[i]!, { atol: 1e-13 }, `ycm ${i}`)
      })
      const c = hexCenters(h)
      c.x.forEach((v, i) => {
        expectClose(v, arr(f.expected.cx)[i]!, { atol: 1e-13 }, `cx ${i}`)
      })
      c.y.forEach((v, i) => {
        expectClose(v, arr(f.expected.cy)[i]!, { atol: 1e-13 }, `cy ${i}`)
      })
    })
  }
  it('refuses an empty range', () => {
    expect(hexbin([1, 1], [2, 3])).toBeNull()
  })
})

interface DotIn {
  values: (number | string | null)[][]
  group: string[]
  levels: string[] | string
}

describe('dot plot statistics vs R (Seurat’s DotPlot)', () => {
  for (const f of loadFixtures<DotIn, { genes: { percent: number[]; average: number[] }[] }>(
    'dotplot',
  )) {
    it(f.name, () => {
      const p = f.params as { average: DotAverage; scale: boolean; threshold: number }
      const levels = arr(f.input.levels) as string[]
      const groups = f.input.group.map((g) => levels.indexOf(g))
      f.input.values.forEach((raw, k) => {
        const values = arr(raw).map((v) => (typeof v === 'number' ? v : Number.NaN))
        const s = dotPlotStats(values, groups, levels.length, p)
        const want = f.expected.genes[k]!
        s.percent.forEach((v, g) => {
          expectClose(v, arr(want.percent)[g]!, {}, `gene ${k} pct ${g}`)
        })
        // Scaled averages near zero: absolute to their scale (about 1).
        s.average.forEach((v, g) => {
          expectClose(v, arr(want.average)[g]!, { rtol: 1e-10, atol: 1e-12 }, `gene ${k} avg ${g}`)
        })
      })
    })
  }
})

describe('linear time', () => {
  const points = (n: number) => {
    const r = mulberry32(7)
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      x[i] = r() * 10 + (i % 3)
      y[i] = r() * 5 + (i % 7) * 0.3
    }
    return { x, y }
  }
  const big = points(1_000_000)
  const sub = (n: number) => ({ x: big.x.subarray(0, n), y: big.y.subarray(0, n) })
  it('kde2d of many points (binned): n log n in the points', () => {
    // Audit 2 (S12): a 10 × 10 grid, so the points' work (the bandwidths' quantiles, binning)
    // is what is timed: a 100 × 100 grid's fixed product took most of 100,000 points' time and
    // held the ratio near 5 for ten times the points. n log n gives about 4.5, quadratic 16.
    const ratio = growthRatio(
      (n) => {
        const { x, y } = sub(n)
        kde2d(x, y, { n: 10, method: 'binned' })
      },
      250_000,
      4,
    )
    expect(ratio).toBeLessThan(9)
  })
  it('hexbin: linear', () => {
    // Each size keeps its fastest of five runs (a call of 100,000 points takes about 2 ms).
    const ratio = growthRatio(
      (n) => {
        const { x, y } = sub(n)
        hexbin(x, y, { xbins: 30 })
      },
      100_000,
      10,
      5,
    )
    expect(ratio).toBeLessThan(16)
  })
  it('dot plot statistics: linear', () => {
    const groups = new Int32Array(1_000_000).map((_, i) => i % 14)
    const ratio = growthRatio(
      (n) => {
        dotPlotStats(big.x.subarray(0, n), groups.subarray(0, n), 14, { scale: true })
      },
      100_000,
      10,
      5,
    )
    expect(ratio).toBeLessThan(16)
  })
})
