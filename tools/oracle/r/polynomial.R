# Polynomial regression, weights optional. Coefficients in ascending powers of x.
#
# The raw monomial basis is badly conditioned for data away from 0 (x = 100..110, degree 4:
# kappa ~ 1e13), and lm(y ~ poly(x, d, raw = TRUE)) then loses digits even in SS. So the oracle
# fits in the centred variable u = x - c (c = mid-range, well conditioned), maps coefficients
# and covariance back to powers of x exactly as the TS code documents (binomial expansion, M V
# M^T), and cross-checks the raw-basis lm() loosely. CIs: coef +- qt(1 - alpha/2, df) * SE.
# R^2 = 1 - SS_w / sum(w (y - ybar_w)^2) (summary()$r.squared for a model with intercept).

PACKAGES <- character(0)

oracle <- function(input, params) {
  x <- input$x; y <- input$y; d <- input$degree
  w <- if (is.null(input$weights)) rep(1, length(x)) else input$weights
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  cc <- (min(x) + max(x)) / 2
  u <- x - cc
  fit <- lm(y ~ poly(u, d, raw = TRUE), weights = w)
  stopifnot(!anyNA(coef(fit)))
  s <- summary(fit)
  p <- d + 1
  M <- matrix(0, p, p)  # M[i, k]: coefficient of x^(i-1) in (x - cc)^(k-1)
  for (k in 1:p) for (i in 1:k) M[i, k] <- choose(k - 1, i - 1) * (-cc)^(k - i)
  coef <- as.vector(M %*% coef(fit))
  V <- M %*% vcov(fit) %*% t(M)
  se <- sqrt(diag(V))
  t <- qt(1 - (1 - level) / 2, fit$df.residual)
  raw <- lm(y ~ poly(x, d, raw = TRUE), weights = w)
  stopifnot(isTRUE(all.equal(unname(coef(raw)), coef, tolerance = 1e-4)))
  list(
    coef = coef, se = se, lo = coef - t * se, hi = coef + t * se,
    r2 = s$r.squared, syx = s$sigma, ssResidual = sum(w * residuals(fit)^2),
    df = fit$df.residual, cov = as.vector(t(V))
  )
}
