# Poisson regression (Prism's multiple Poisson regression), from glm(family = poisson).
#
# input: y (counts), X (rows), names. params: intercept (default TRUE), confLevel (0.95),
# ciMethod ('wald' default | 'profile').
#
# - Fit: glm, epsilon 1e-14, maxit 100, refitted twice from its own estimates so vcov's weights
#   sit at the maximum (as logistic.R).
# - Coefficients: Wald z = estimate / SE (Prism reports |z|), two-sided normal P. CIs: Wald
#   (confint.default; Prism's "SE times a critical ratio") or profile likelihood solved exactly
#   with uniroot (tol 1e-13) on glm.fit offsets, cross-checked loosely (2e-3) against confint().
#   Rate ratios = exp(estimate and limits).
# - Log-likelihoods: logLik(fit) (full, with -log y!); null = intercept-only glm (without an
#   intercept, mu = 1 as glm's null deviance); saturated = sum(dpois(y, y, log = TRUE)).
#   Deviance = 2 (LLmax - LL) (checked = deviance(fit)); pseudo R^2 = (LL - LL0)/(LLmax - LL0)
#   (Prism's "Goodness of fit with Poisson regression").
# - Dispersion: Pearson chi^2 / (n - k) = summary(glm(quasipoisson))$dispersion.
# - AICc: -2 LL + 2k + 2k(k + 1)/(n - k - 1) (checked AIC(fit) = -2 LL + 2k).

PACKAGES <- character(0)

CTRL <- glm.control(epsilon = 1e-14, maxit = 100)

loglik_offset <- function(M, y, off) {
  if (ncol(M) == 0) return(sum(dpois(y, exp(off), log = TRUE)))
  f <- glm.fit(M, y, family = poisson(), offset = off, control = CTRL)
  sum(dpois(y, f$fitted.values, log = TRUE))
}

profile_ci <- function(M, y, beta, se, ll, level) {
  z <- qnorm(1 - (1 - level) / 2)
  t(sapply(seq_along(beta), function(j) {
    signed <- function(b) {
      d <- 2 * (ll - loglik_offset(M[, -j, drop = FALSE], y, b * M[, j]))
      sign(b - beta[j]) * sqrt(max(0, d))
    }
    lo <- uniroot(function(b) signed(b) + z, c(beta[j] - 2 * z * se[j], beta[j]),
                  extendInt = "upX", tol = 1e-13)$root
    hi <- uniroot(function(b) signed(b) - z, c(beta[j], beta[j] + 2 * z * se[j]),
                  extendInt = "upX", tol = 1e-13)$root
    c(lo, hi)
  }))
}

oracle <- function(input, params) {
  y <- input$y
  X <- as.matrix(input$X)
  if (is.null(dim(X))) X <- matrix(X, ncol = length(input$names))
  colnames(X) <- input$names
  intercept <- is.null(params$intercept) || isTRUE(params$intercept)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  method <- if (is.null(params$ciMethod)) "wald" else params$ciMethod
  M <- if (intercept) cbind("(Intercept)" = 1, X) else X
  nm <- c(if (intercept) "Intercept", colnames(X))
  fit <- glm(y ~ 0 + M, family = poisson(), control = CTRL)
  for (r in 1:2) fit <- glm(y ~ 0 + M, family = poisson(), start = coef(fit), control = CTRL)
  n <- length(y); k <- ncol(M)
  ll <- as.numeric(logLik(fit))
  stopifnot(abs(AIC(fit) - (-2 * ll + 2 * k)) < 1e-9 * abs(AIC(fit)))
  llmax <- sum(dpois(y, y, log = TRUE))
  ll0 <- if (intercept) as.numeric(logLik(glm(y ~ 1, family = poisson(), control = CTRL))) else
    sum(dpois(y, 1, log = TRUE))
  stopifnot(abs(2 * (llmax - ll) - deviance(fit)) < 1e-9 * (1 + deviance(fit)))
  if (!intercept) stopifnot(abs(2 * (llmax - ll0) - fit$null.deviance) < 1e-9 * (1 + fit$null.deviance))
  b <- unname(coef(fit)); se <- unname(sqrt(diag(vcov(fit))))
  ci <- if (method == "wald") unname(confint.default(fit, level = level)) else {
    pci <- profile_ci(M, y, b, se, ll, level)
    mci <- unname(suppressMessages(confint(fit, level = level)))
    stopifnot(max(abs(pci - mci) / (1 + abs(mci))) < 2e-3)
    pci
  }
  mu <- unname(fitted(fit))
  pearson <- sum((y - mu)^2 / mu)
  qp <- summary(glm(y ~ 0 + M, family = quasipoisson(), start = b, control = CTRL))$dispersion
  stopifnot(abs(qp - pearson / (n - k)) < 1e-8 * qp)
  coefs <- lapply(seq_along(nm), function(j) {
    zv <- b[j] / se[j]
    list(name = nm[j], estimate = b[j], se = se[j], lower = ci[j, 1], upper = ci[j, 2],
         stat = zv, p = 2 * pnorm(abs(zv), lower.tail = FALSE), rateRatio = exp(b[j]),
         rrLower = exp(ci[j, 1]), rrUpper = exp(ci[j, 2]))
  })
  lrDf <- if (intercept) k - 1 else k
  list(coefficients = coefs, n = n, logLik = ll, nullLogLik = ll0, maxLogLik = llmax,
       deviance = 2 * (llmax - ll), nullDeviance = 2 * (llmax - ll0),
       lrChiSq = 2 * (ll - ll0), lrDf = lrDf,
       lrP = pchisq(2 * (ll - ll0), lrDf, lower.tail = FALSE),
       pseudoR2 = (ll - ll0) / (llmax - ll0), pearsonChiSq = pearson,
       dispersion = pearson / (n - k),
       aicc = -2 * ll + 2 * k + 2 * k * (k + 1) / (n - k - 1),
       fitted = mu)
}
