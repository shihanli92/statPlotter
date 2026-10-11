# Curves without a model ("Fit spline/LOWESS"). input: x, y, at (points to evaluate).
# params$method:
#   lowess     stats::lowess(x, y, f, iter) (Cleveland; the usual reference, Chambers et al.
#              1983 section 4.11); returns the fitted values at the sorted x.
#   natural    splinefun(x, y, method = "natural") at `at` (x distinct, increasing).
#   akima      Akima (1970) written out from the paper: chord slopes m, two extra on each side by
#              quadratic extrapolation (m[-1] = 2 m[0] - m[1], ...), point slopes
#              t = (|m4 - m3| m2 + |m2 - m1| m3) / (|m4 - m3| + |m2 - m1|) (mean of m2, m3 when both
#              weights are 0), cubic Hermite pieces; end pieces continued outside the data. An
#              independent check of the TS code (no Akima package in the lockfile).
#   regression lm(y ~ splines::ns(x, knots = interior, Boundary.knots = range(x))) with `knots`
#              knots equally spaced from min(x) to max(x) (both included), predicted at `at`.
#   p2p        approx(x, y, xout = at, rule = 2) (constant beyond the ends).

PACKAGES <- character(0)
suppressPackageStartupMessages(library(splines))

akima <- function(x, y, at) {
  n <- length(x)
  m <- diff(y) / diff(x)
  mm1 <- 2 * m[1] - m[2]; mm2 <- 2 * mm1 - m[1]
  mp1 <- 2 * m[n - 1] - m[n - 2]; mp2 <- 2 * mp1 - m[n - 1]
  s <- c(mm2, mm1, m, mp1, mp2)
  t <- vapply(seq_len(n), function(i) {
    m1 <- s[i]; m2 <- s[i + 1]; m3 <- s[i + 2]; m4 <- s[i + 3]
    w1 <- abs(m4 - m3); w2 <- abs(m2 - m1)
    if (w1 + w2 == 0) (m2 + m3) / 2 else (w1 * m2 + w2 * m3) / (w1 + w2)
  }, 0)
  vapply(at, function(v) {
    i <- if (v <= x[1]) 1 else if (v >= x[n]) n - 1 else max(which(x <= v))
    h <- x[i + 1] - x[i]; u <- (v - x[i]) / h
    (2 * u^3 - 3 * u^2 + 1) * y[i] + (u^3 - 2 * u^2 + u) * h * t[i] +
      (-2 * u^3 + 3 * u^2) * y[i + 1] + (u^3 - u^2) * h * t[i + 1]
  }, 0)
}

oracle <- function(input, params) {
  x <- input$x; y <- input$y; at <- input$at
  switch(params$method,
    lowess = {
      f <- if (is.null(params$f)) 2 / 3 else params$f
      iter <- if (is.null(params$iter)) 3 else params$iter
      l <- lowess(x, y, f = f, iter = iter)
      list(x = l$x, y = l$y)
    },
    natural = list(y = splinefun(x, y, method = "natural")(at)),
    akima = list(y = akima(x, y, at)),
    regression = {
      K <- params$knots
      kn <- seq(min(x), max(x), length.out = K)
      fit <- lm(y ~ ns(x, knots = kn[-c(1, K)], Boundary.knots = range(x)))
      list(y = unname(predict(fit, data.frame(x = at))), ss = deviance(fit), df = fit$df.residual)
    },
    p2p = list(y = approx(x, y, xout = at, rule = 2)$y))
}
