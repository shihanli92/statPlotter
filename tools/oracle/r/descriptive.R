# Descriptive statistics: the column-statistics table (describe()) plus a quantile grid.
#
# Quantiles: quantile(type = 6). Skewness / kurtosis: e1071 type 2 (adjusted Fisher-Pearson G1
# and excess G2). They are computed on x - x[1], which changes nothing mathematically but lets
# R's uncorrected two-pass moments stay accurate for data with a large offset (1e9 + noise),
# where the rounding error left in mean(x) otherwise dominates the third moment.
# CI of the mean: mean +- qt(1 - alpha/2, n - 1) * sd / sqrt(n), cross-checked with
# t.test()$conf.int wherever t.test() accepts the data (it refuses constant data).
# Geometric statistics: exp of the log-scale mean, sd and CI; NaN if any value <= 0.

PACKAGES <- c("e1071")

PROBS <- c(0, 0.01, 0.1, 0.25, 0.3, 0.5, 0.75, 0.9, 0.99, 1)

mean_ci <- function(x, level) {
  n <- length(x)
  if (n < 2) return(c(NaN, NaN))
  alpha <- 1 - level
  ci <- mean(x) + c(-1, 1) * qt(1 - alpha / 2, n - 1) * sd(x) / sqrt(n)
  tt <- tryCatch(t.test(x, conf.level = level)$conf.int, error = function(e) NULL)
  if (!is.null(tt)) stopifnot(isTRUE(all.equal(as.vector(tt), ci, tolerance = 1e-13)))
  ci
}

oracle <- function(input, params) {
  x <- input$values
  n <- length(x)
  level <- if (is.null(params$level)) 0.95 else params$level
  xs <- x - x[1]
  moment_ok <- sd(x) > 0
  skew <- if (n >= 3 && moment_ok) e1071::skewness(xs, type = 2) else NaN
  kurt <- if (n >= 4 && moment_ok) e1071::kurtosis(xs, type = 2) else NaN
  ci <- mean_ci(x, level)
  pos <- all(x > 0)
  lx <- if (pos) log(x) else NULL
  gci <- if (pos) exp(mean_ci(lx, level)) else c(NaN, NaN)
  q <- quantile(x, c(0.25, 0.5, 0.75), type = 6, names = FALSE)
  list(
    n = n,
    mean = mean(x),
    sd = sd(x),
    sem = sd(x) / sqrt(n),
    min = min(x),
    q1 = q[1],
    median = median(x),
    q3 = q[3],
    max = max(x),
    range = max(x) - min(x),
    ciLo = ci[1],
    ciHi = ci[2],
    cv = sd(x) / mean(x),
    skewness = skew,
    kurtosis = kurt,
    sum = sum(x),
    geoMean = if (pos) exp(mean(lx)) else NaN,
    geoSdFactor = if (pos) exp(sd(lx)) else NaN,
    geoCiLo = gci[1],
    geoCiHi = gci[2],
    probs = PROBS,
    quantiles = quantile(x, PROBS, type = 6, names = FALSE)
  )
}
