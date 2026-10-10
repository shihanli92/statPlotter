# Summary statistics the graphs draw (roadmap 30): error bars and box-plot whiskers.
#
# - Geometric mean exp(mean(log x)), geometric SD factor exp(sd(log x)) and the CI of the
#   geometric mean exp(mean(log x) +- qt(1 - alpha/2, n - 1) * sd(log x) / sqrt(n)), cross-checked
#   with t.test(log(x))$conf.int; NaN when a value is <= 0 (and the SD factor and CI for n < 2).
#   Error bars "geometric mean x/÷ geometric SD factor" run from geoMean / geoSdFactor to
#   geoMean * geoSdFactor.
# - Whisker percentiles by quantile(type = 6) (as the graphs' quartiles): 1-99, 2.5-97.5, 5-95
#   and 10-90.
# - Tukey whiskers: the most extreme values within 1.5 IQR of the quartiles, the quartiles by
#   quantile(type = 6) (not boxplot.stats' hinges); the values outside are outliers.

PACKAGES <- character(0)

PROBS <- c(0.01, 0.025, 0.05, 0.1, 0.9, 0.95, 0.975, 0.99)

oracle <- function(input, params) {
  x <- input$values
  n <- length(x)
  level <- if (is.null(params$level)) 0.95 else params$level
  pos <- all(x > 0)
  lx <- if (pos) log(x) else NULL
  gci <- c(NaN, NaN)
  if (pos && n >= 2) {
    gci <- exp(mean(lx) + c(-1, 1) * qt(1 - (1 - level) / 2, n - 1) * sd(lx) / sqrt(n))
    tt <- exp(t.test(lx, conf.level = level)$conf.int)
    stopifnot(isTRUE(all.equal(as.vector(tt), gci, tolerance = 1e-13)))
  }
  gm <- if (pos) exp(mean(lx)) else NaN
  gsdf <- if (pos && n >= 2) exp(sd(lx)) else NaN
  q <- quantile(x, c(0.25, 0.75), type = 6, names = FALSE)
  f <- 1.5 * (q[2] - q[1])
  inside <- x[x >= q[1] - f & x <= q[2] + f]
  list(
    n = n,
    geoMean = gm,
    geoSdFactor = gsdf,
    geoSdLo = gm / gsdf,
    geoSdHi = gm * gsdf,
    geoCiLo = gci[1],
    geoCiHi = gci[2],
    probs = PROBS,
    quantiles = quantile(x, PROBS, type = 6, names = FALSE),
    q1 = q[1],
    q3 = q[2],
    tukeyLo = min(inside),
    tukeyHi = max(inside),
    outliers = sort(x[x < min(inside) | x > max(inside)])
  )
}
