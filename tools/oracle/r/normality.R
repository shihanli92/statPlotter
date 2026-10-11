# Normality tests:
#
#   dagostino        D'Agostino-Pearson omnibus K2 (D'Agostino, Belanger & D'Agostino 1990),
#                    the usually recommended test; n >= 8. Hand-coded below; z scores cross-checked
#                    against moments::agostino.test (D'Agostino 1970) and moments::anscombe.test
#                    (Anscombe & Glynn 1983). Differences from moments: asinh(Y/alpha) instead of
#                    log(Y/alpha + sqrt(...)) (more accurate for small Y), and the real cube root
#                    in the kurtosis transform where anscombe.test's ^(1/3) gives NaN for a
#                    negative base (strongly platykurtic small samples).
#                    skewness = sqrt(b1) = m3/m2^1.5, kurtosis = b2 - 3 (moment ratios, n
#                    denominators), NOT the adjusted G1/G2 of the descriptive statistics.
#   shapiroWilk      shapiro.test (Royston 1995, AS R94);
#                    3 <= n <= 5000 (for sample sizes below 5000; R allows
#                    5000 itself, as do we).
#   andersonDarling  nortest::ad.test; reported: A2* = A2 (1 + 0.75/n + 2.25/n^2) ("stat"),
#                    ad.test's statistic is A2 ("a2"); n >= 8. P: D'Agostino & Stephens (1986)
#                    piecewise formula, as ad.test.
#                    A2 is recomputed with a compensated sum (see ad_stat) and checked against
#                    ad.test to 1e-10.
#   ks               nortest::lillie.test (KS distance with estimated mean/SD, Dallal-Wilkinson
#                    P, Stephens' formula for P > 0.1); n >= 5. Reported as "P > 0.10" when
#                    the Dallal-Wilkinson P exceeds 0.1 (pAbove010).
# Below a test's minimum n (or with zero spread) every value is NaN.
#
# params$shift: analyse x - shift (exact for 1e9 + noise); all four tests are location-invariant.
#   R's shapiro.test scales by the range before centring, which loses ~1e-4 relative for
#   1e9 + 1e-3 noise; the shift keeps R accurate.
# params$log: test log(x) (lognormality test).

PACKAGES <- c("nortest", "moments")

suppressPackageStartupMessages({ library(nortest); library(moments) })

cbrt <- function(v) sign(v) * abs(v)^(1/3)

dago <- function(x) {
  n <- length(x)
  nan <- list(stat = NaN, p = NaN, skewness = NaN, kurtosis = NaN, zSkewness = NaN,
              zKurtosis = NaN)
  if (n < 8) return(nan)
  d <- x - mean(x)
  m2 <- sum(d^2) / n
  if (m2 == 0) return(nan)
  sqb1 <- (sum(d^3) / n) / m2^1.5
  b2 <- (sum(d^4) / n) / m2^2
  y <- sqb1 * sqrt((n + 1) * (n + 3) / (6 * (n - 2)))
  beta2 <- 3 * (n^2 + 27 * n - 70) * (n + 1) * (n + 3) / ((n - 2) * (n + 5) * (n + 7) * (n + 9))
  w2 <- -1 + sqrt(2 * (beta2 - 1))
  delta <- 1 / sqrt(log(sqrt(w2)))
  alpha <- sqrt(2 / (w2 - 1))
  z1 <- delta * asinh(y / alpha)
  eb2 <- 3 * (n - 1) / (n + 1)
  vb2 <- 24 * n * (n - 2) * (n - 3) / ((n + 1)^2 * (n + 3) * (n + 5))
  xk <- (b2 - eb2) / sqrt(vb2)
  sb1 <- (6 * (n^2 - 5 * n + 2) / ((n + 7) * (n + 9))) *
    sqrt(6 * (n + 3) * (n + 5) / (n * (n - 2) * (n - 3)))
  A <- 6 + (8 / sb1) * (2 / sb1 + sqrt(1 + 4 / sb1^2))
  z2 <- (1 - 2 / (9 * A) - cbrt((1 - 2 / A) / (1 + xk * sqrt(2 / (A - 4))))) / sqrt(2 / (9 * A))
  # Cross-checks against the moments package.
  zs <- unname(agostino.test(x)$statistic["z"])
  stopifnot(isTRUE(all.equal(z1, zs, tolerance = 1e-8)))
  za <- suppressWarnings(unname(anscombe.test(x)$statistic["z"]))
  if (!is.nan(za)) stopifnot(isTRUE(all.equal(z2, za, tolerance = 1e-9)))
  k2 <- z1^2 + z2^2
  list(stat = k2, p = pchisq(k2, 2, lower.tail = FALSE), skewness = sqb1, kurtosis = b2 - 3,
       zSkewness = z1, zKurtosis = z2)
}

# ad.test's A2 with the sum of the ~n^2-sized terms compensated (ad.test's mean() is off by
# ~1e-12 at n = 5000 on platforms without long double), and its P formula.
neumaier <- function(v) {
  s <- 0; c <- 0
  for (t in v) {
    y <- s + t
    c <- c + if (abs(s) >= abs(t)) (s - y) + t else (t - y) + s
    s <- y
  }
  s + c
}
ad_stat <- function(x) {
  x <- sort(x); n <- length(x)
  z <- (x - mean(x)) / sd(x)
  h <- (2 * seq_len(n) - 1) * (pnorm(z, log.p = TRUE) + rev(pnorm(-z, log.p = TRUE)))
  -n - neumaier(h) / n
}
ad_p <- function(AA) {
  if (AA < 0.2) 1 - exp(-13.436 + 101.14 * AA - 223.73 * AA^2)
  else if (AA < 0.34) 1 - exp(-8.318 + 42.796 * AA - 59.938 * AA^2)
  else if (AA < 0.6) exp(0.9177 - 4.279 * AA - 1.38 * AA^2)
  else if (AA < 10) exp(1.2937 - 5.709 * AA + 0.0186 * AA^2)
  else 3.7e-24
}

oracle <- function(input, params) {
  x <- input$x
  if (isTRUE(params$log)) x <- log(x)
  if (!is.null(params$shift)) x <- x - params$shift
  n <- length(x)
  constant <- length(unique(x)) == 1

  sw <- if (n >= 3 && n <= 5000 && !constant) {
    s <- shapiro.test(x)
    list(stat = unname(s$statistic), p = s$p.value)
  } else list(stat = NaN, p = NaN)

  ad <- if (n >= 8 && !constant) {
    a <- ad.test(x)
    A <- ad_stat(x)
    stopifnot(abs(A - unname(a$statistic)) < 1e-10 * A)
    AA <- (1 + 0.75 / n + 2.25 / n^2) * A
    list(stat = AA, p = ad_p(AA), a2 = A)
  } else list(stat = NaN, p = NaN, a2 = NaN)

  ks <- if (n >= 5 && !constant) {
    l <- lillie.test(x)
    K <- unname(l$statistic)
    Kd <- if (n <= 100) K else K * (n / 100)^0.49
    nd <- min(n, 100)
    pdw <- exp(-7.01256 * Kd^2 * (nd + 2.78019) + 2.99587 * Kd * sqrt(nd + 2.78019) -
                 0.122119 + 0.974598 / sqrt(nd) + 1.67997 / nd)
    list(stat = K, p = l$p.value, pAbove010 = pdw > 0.1)
  } else list(stat = NaN, p = NaN, pAbove010 = FALSE)

  list(dagostino = if (constant) dago(numeric(0)) else dago(x), shapiroWilk = sw,
       andersonDarling = ad, ks = ks)
}
