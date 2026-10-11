# Power and sample size ("Sample size and power"), from base R.
#
# params$design:
#   ttest    power.t.test(n, delta, sd, sig.level, type = "two.sample" | "paired" | "one.sample",
#            alternative, strict = TRUE): two-sided power counts both tails.
#   anova    power.anova.test(groups, n, between.var, within.var, sig.level), with the noncentral
#            F tail recomputed as a Poisson mixture of pbeta upper tails summed to 1e-18 (R's
#            pnbeta stops at an absolute error of 1e-9, which would limit the comparison);
#            cross-checked against power.anova.test (1e-8).
#   prop     power.prop.test(n, p1, p2, sig.level, alternative) (normal approximation).
#   cor      Fisher z: pnorm(sqrt(n - 3) |atanh r| - z) (+ pnorm(-sqrt(n - 3)|atanh r| - z) when
#            two-sided), z = qnorm(1 - alpha/sides).
#   logrank  Schoenfeld, equal allocation, n = events: pnorm(sqrt(d/4)|log HR| - z) (+ other
#            tail).
# Each case gives `power` at `n`, and `nFor` = the fractional n where power = `target`, solved by
# uniroot (tol 1e-14) on the same power function (power.t.test's own solution uses tol ~1e-4, so
# it is compared loosely, 1e-3).

PACKAGES <- character(0)

ncf_sf <- function(x, d1, d2, lambda) {
  if (lambda == 0) return(pf(x, d1, d2, lower.tail = FALSE))
  z <- d1 * x / (d1 * x + d2)
  c <- lambda / 2
  j0 <- floor(c)
  s <- 0; m <- 0
  j <- j0
  repeat {
    w <- exp(-c + j * log(c) - lgamma(j + 1))
    s <- s + w * pbeta(z, d1 / 2 + j, d2 / 2, lower.tail = FALSE); m <- m + w
    if (w < 1e-18 * m && j > c) break
    j <- j + 1
  }
  if (j0 > 0) for (j in (j0 - 1):0) {
    w <- exp(-c + j * log(c) - lgamma(j + 1))
    s <- s + w * pbeta(z, d1 / 2 + j, d2 / 2, lower.tail = FALSE); m <- m + w
    if (w < 1e-18 * m) break
  }
  s
}

oracle <- function(input, params) {
  a <- params$alpha
  tails <- if (is.null(params$tails)) 2 else params$tails
  alt <- if (tails == 2) "two.sided" else "one.sided"
  pw <- switch(params$design,
    ttest = function(n) power.t.test(n = n, delta = params$delta, sd = params$sd, sig.level = a,
                                     type = params$type, alternative = alt, strict = TRUE)$power,
    anova = function(n) {
      k <- params$groups
      lambda <- (k - 1) * n * params$betweenVar / params$withinVar
      p <- ncf_sf(qf(a, k - 1, (n - 1) * k, lower.tail = FALSE), k - 1, (n - 1) * k, lambda)
      ref <- power.anova.test(groups = k, n = n, between.var = params$betweenVar,
                              within.var = params$withinVar, sig.level = a)$power
      stopifnot(abs(p - ref) < 1e-8)
      p
    },
    prop = function(n) power.prop.test(n = n, p1 = params$p1, p2 = params$p2, sig.level = a,
                                       alternative = alt)$power,
    cor = function(n) {
      z <- qnorm(1 - a / tails); e <- sqrt(n - 3) * abs(atanh(params$r))
      pnorm(e - z) + if (tails == 2) pnorm(-e - z) else 0
    },
    logrank = function(n) {
      z <- qnorm(1 - a / tails); e <- sqrt(n / 4) * abs(log(params$hr))
      pnorm(e - z) + if (tails == 2) pnorm(-e - z) else 0
    })
  nFor <- uniroot(function(n) pw(n) - params$target, c(params$lo, 1e6), tol = 1e-14)$root
  if (params$design == "ttest") {
    loose <- power.t.test(power = params$target, delta = params$delta, sd = params$sd,
                          sig.level = a, type = params$type, alternative = alt, strict = TRUE)$n
    stopifnot(abs(loose - nFor) < 1e-3 * nFor)
  }
  list(power = pw(params$n), nFor = nFor)
}
