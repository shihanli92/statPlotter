import { mean, sd } from '../descriptive/basic.ts'
import { normalQuantile } from '../dist/normal.ts'

export interface QQPlot {
  /** The data, sorted ascending (Prism's X axis). */
  actual: number[]
  /** What a Gaussian (or lognormal) sample would give at the same ranks (Prism's Y axis). */
  predicted: number[]
}

/**
 * Normal QQ plot as Prism draws it (Statistics Guide, "QQ plot"): the values sorted; for the
 * value of rank i (1 = smallest) of n, the percentile (i − 0.5)/n is turned into a standard
 * normal z and then into mean + z·SD, with the mean and SD (n − 1) of the data. With
 * `lognormal`, the same on the logarithms and the prediction exponentiated back (the plot of a
 * lognormal sample is then linear, on the data's own scale). Ties keep their order.
 * Fewer than two values, or a zero SD, give NaN predictions.
 */
export function qqPlot(values: ArrayLike<number>, opts: { lognormal?: boolean } = {}): QQPlot {
  const actual = Array.from(values).sort((a, b) => a - b)
  const n = actual.length
  const t = opts.lognormal ? actual.map(Math.log) : actual
  const m = n > 0 ? mean(Float64Array.from(t)) : Number.NaN
  const s = n > 1 ? sd(Float64Array.from(t)) : Number.NaN
  const predicted = actual.map((_, i) => {
    const z = normalQuantile((i + 1 - 0.5) / n)
    const v = s > 0 ? m + z * s : Number.NaN
    return opts.lognormal ? Math.exp(v) : v
  })
  return { actual, predicted }
}
