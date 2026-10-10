# Deming (model II) regression as Prism computes it.
#
# Estimates  lambda = SD_X^2 / SD_Y^2 (Prism's "How to: Deming regression": it uses the two SDs
#            only through lambda); slope = [Syy - d Sxx + sqrt((Syy - d Sxx)^2 + 4 d Sxy^2)] /
#            (2 Sxy), d = 1/lambda (Deming 1943, Linnet 1990); intercept = ybar - slope xbar.
#            Cross-checked (1e-7) by minimising sum((y - a - b x)^2) / (1 + lambda b^2) over b with
#            optimize(), and for lambda = 1 against the first principal axis of prcomp().
# SEs        GraphPad FAQ 1690: r = Sxy^2 / (Sxx Syy); SE(slope) = sqrt(b^2 (1 - r) / (r (n - 2)));
#            SE(intercept) = SE(slope) sqrt(sum(x^2) / n); CIs +/- qt(., n - 2) SE. Y at X = x0:
#            FAQ 2230 (the intercept after subtracting x0 from X). P for slope = 0: t = b/SE on
#            n - 2 df (checked against cor.test's P to 1e-6: it forms t from r differently).
# params: lambda (default 1), confLevel (default 0.95), xForY (default 0).

PACKAGES <- character(0)

oracle <- function(input, params) {
  x <- input$x; y <- input$y; n <- length(x)
  lambda <- if (is.null(params$lambda)) 1 else params$lambda
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  x0 <- if (is.null(params$xForY)) 0 else params$xForY
  sxx <- sum((x - mean(x))^2); syy <- sum((y - mean(y))^2)
  sxy <- sum((x - mean(x)) * (y - mean(y)))
  d <- 1 / lambda
  b <- (syy - d * sxx + sqrt((syy - d * sxx)^2 + 4 * d * sxy^2)) / (2 * sxy)
  a <- mean(y) - b * mean(x)
  obj <- function(bb) (syy - 2 * bb * sxy + bb^2 * sxx) / (1 + lambda * bb^2)
  opt <- optimize(obj, b + c(-1, 1) * (abs(b) + 1), tol = 1e-12)$minimum
  stopifnot(abs(opt - b) < 1e-7 * (1 + abs(b)))
  if (lambda == 1) {
    v <- prcomp(cbind(x, y))$rotation[, 1]
    stopifnot(abs(v[2] / v[1] - b) < 1e-9 * (1 + abs(b)))
  }
  r <- sxy^2 / (sxx * syy)
  # 1 - r from the ordinary-regression residuals (exact algebra, no cancellation as r -> 1).
  omr <- sum(residuals(lm(y ~ x))^2) / syy
  stopifnot(abs(omr - (1 - r)) < 1e-6 * (1 - r) + 1e-15)
  df <- n - 2
  se <- sqrt(b^2 * omr / (r * df))
  seAt <- function(c) se * sqrt(sum((x - c)^2) / n)
  tc <- qt(1 - (1 - level) / 2, df)
  t <- b / se
  p <- 2 * pt(abs(t), df, lower.tail = FALSE)
  stopifnot(abs(p - cor.test(x, y)$p.value) < 1e-6 * p)
  ya <- a + b * x0
  list(slope = b, intercept = a, slopeSE = se, interceptSE = seAt(0),
       slopeLo = b - tc * se, slopeHi = b + tc * se,
       interceptLo = a - tc * seAt(0), interceptHi = a + tc * seAt(0),
       xIntercept = -a / b, inverseSlope = 1 / b, t = t, F = t^2, p = p, df = df,
       yAtX = list(x = x0, y = ya, se = seAt(x0), lo = ya - tc * seAt(x0),
                   hi = ya + tc * seAt(x0)))
}
