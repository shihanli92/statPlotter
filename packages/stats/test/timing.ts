/**
 * Complexity guards that survive a loaded machine: instead of a wall-clock bound, compare the
 * CPU time of this thread at size k·n with that at size n. CPU time leaves out the time the
 * thread waits for a core (wall-clock ratios of linear work reached 15 in a full parallel run
 * on a busy machine); runs alternate between the sizes and each size keeps its fastest run. With
 * k = 4, linear work gives a ratio of about 4, quadratic 16 and cubic 64.
 */
export function growthRatio(run: (n: number) => void, n: number, k = 4, runs = 3): number {
  let small = Number.POSITIVE_INFINITY
  let large = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    small = Math.min(
      small,
      cpuMs(() => run(n)),
    )
    large = Math.min(
      large,
      cpuMs(() => run(k * n)),
    )
  }
  return large / small
}

/**
 * CPU time of `b` over that of `a` (the same work done two ways): runs alternate between them
 * and each keeps its fastest, as in `growthRatio`.
 */
export function cpuRatio(a: () => void, b: () => void, runs = 5): number {
  let ta = Number.POSITIVE_INFINITY
  let tb = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    ta = Math.min(ta, cpuMs(a))
    tb = Math.min(tb, cpuMs(b))
  }
  return tb / ta
}

/**
 * CPU time (user + system) of the current thread per call of f, in ms. The thread CPU clock
 * advances in coarse steps on some systems (Linux CI measured a fast call as 0 ms, making the
 * ratio infinite), so f is repeated until at least MIN_MS of CPU time has been measured.
 */
function cpuMs(f: () => void): number {
  let calls = 0
  let total = 0
  const t0 = process.threadCpuUsage()
  do {
    f()
    calls++
    const t = process.threadCpuUsage(t0)
    total = (t.user + t.system) / 1000
  } while (total < MIN_MS && calls < MAX_CALLS)
  return total / calls
}

const MIN_MS = 20
const MAX_CALLS = 10_000
