# Simple linear regression, from lm().
#
# input: x, y, optional weights, bandX (points for the confidence / prediction bands).
# params: throughOrigin, throughPoint ([x0, y0]: the line forced through that point, fitted as
# lm(y - y0 ~ 0 + (x - x0)); intercept = y0 - slope x0 with no SE, X intercept x0 - y0/slope),
# confLevel.
#
# CIs: confint(lm). Bands: predict(lm, interval = "confidence" / "prediction"); for weighted fits
# predict() gives the new observation unit weight, which is our documented convention too.
# F (slope != 0): summary(lm)$fstatistic, which equals t^2 for one predictor also without an
# intercept.
# R^2: our convention 1 - SSres/SStot with SStot about the (weighted) mean of Y, computed
# explicitly (summary()$r.squared is the uncentred version when there is no intercept).
# X intercept CI: Fieller's interval, computed explicitly from vcov(lm): the x with
# (a + b x)^2 <= t^2 var(a + b x); NaN when b^2 <= t^2 var(b) (unbounded).

PACKAGES <- character(0)

fieller <- function(a, b, vaa, vab, vbb, t) {
  A <- b^2 - t^2 * vbb
  # isTRUE: no residual df (n = 2, audit 3 S8) leaves t, and so A, NaN.
  if (!isTRUE(A > 0)) return(c(NaN, NaN))
  B <- a * b - t^2 * vab
  C <- a^2 - t^2 * vaa
  r <- sort((-B + c(-1, 1) * sqrt(B^2 - A * C)) / A)
  # both roots lie on the boundary of the Fieller set
  for (x0 in r) stopifnot(abs((a + b * x0)^2 - t^2 * (vaa + 2 * x0 * vab + x0^2 * vbb)) <=
                          1e-8 * (a^2 + (b * x0)^2))
  r
}

oracle <- function(input, params) {
  x <- input$x; y <- input$y
  w <- if (is.null(input$weights)) rep(1, length(x)) else input$weights
  pt <- params$throughPoint
  origin <- isTRUE(params$throughOrigin) || !is.null(pt)
  x0 <- if (is.null(pt)) 0 else pt[1]
  y0 <- if (is.null(pt)) 0 else pt[2]
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  xs <- x - x0
  ys <- y - y0
  fit <- if (origin) lm(ys ~ 0 + xs, weights = w) else lm(y ~ x, weights = w)
  s <- summary(fit)
  V <- vcov(fit)
  ci <- confint(fit, level = level)
  df <- fit$df.residual
  t <- qt(1 - (1 - level) / 2, df)
  ss <- sum(w * residuals(fit)^2)
  ybar <- sum(w * y) / sum(w)
  if (origin) {
    b <- unname(coef(fit)[1]); a <- y0 - b * x0
    vbb <- V[1, 1]; vab <- 0; vaa <- 0
    ciA <- c(NaN, NaN); seA <- NaN
    xint <- c(NaN, NaN)
  } else {
    a <- unname(coef(fit)["(Intercept)"]); b <- unname(coef(fit)["x"])
    vbb <- V["x", "x"]; vab <- V["x", "(Intercept)"]; vaa <- V["(Intercept)", "(Intercept)"]
    ciA <- ci["(Intercept)", ]; seA <- sqrt(vaa)
    xint <- fieller(a, b, vaa, vab, vbb, t)
  }
  fs <- s$fstatistic
  stopifnot(isTRUE(all.equal(unname(fs["value"]), b^2 / vbb, tolerance = 1e-10)))
  out <- list(
    n = length(x), df = df, slope = b, intercept = a,
    slopeSE = sqrt(vbb), interceptSE = seA,
    slopeLo = ci[nrow(ci), 1], slopeHi = ci[nrow(ci), 2], interceptLo = unname(ciA[1]),
    interceptHi = unname(ciA[2]),
    xIntercept = if (origin) x0 - y0 / b else -a / b, xInterceptLo = xint[1],
    xInterceptHi = xint[2],
    inverseSlope = 1 / b,
    r2 = 1 - ss / sum(w * (y - ybar)^2),
    syx = s$sigma, ssResidual = ss,
    F = unname(fs["value"]), dfn = unname(fs["numdf"]), dfd = unname(fs["dendf"]),
    p = pf(fs["value"], fs["numdf"], fs["dendf"], lower.tail = FALSE)[[1]],
    cov = c(vbb, vab, vaa)
  )
  if (!is.null(input$bandX)) {
    nd <- if (origin) data.frame(xs = input$bandX - x0) else data.frame(x = input$bandX)
    cf <- suppressWarnings(predict(fit, nd, interval = "confidence", level = level)) + y0
    pr <- suppressWarnings(predict(fit, nd, interval = "prediction", level = level)) + y0
    out$band <- list(y = unname(cf[, "fit"]), confLo = unname(cf[, "lwr"]),
                     confHi = unname(cf[, "upr"]), predLo = unname(pr[, "lwr"]),
                     predHi = unname(pr[, "upr"]))
  }
  out
}
