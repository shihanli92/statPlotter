# Multiple linear regression (Prism's "Multiple linear regression", least squares), from lm().
#
# input: y, X (rows), names. params: intercept (default TRUE), confLevel, interactions (pairs of
# 0-based predictor indices; the product X_i·X_j is appended after the main effects, named "A:B").
#
# Choices (Prism's Curve Fitting Guide, "Multiple regression with Prism", and
# reg_choosing-diagnostics-for-mulit.htm / reg_multicollinearity.htm):
# - Coefficient CIs: estimate ± t(df)·SE (confint.lm); P: two-sided t test (summary.lm).
# - R² = 1 − SS/SStot with SStot about the mean of Y, also without an intercept (the Phase 2
#   simple-regression convention; summary.lm's r.squared is uncentred there). Adjusted R² =
#   1 − (SS/df)/(SStot/(n − 1)) (equals summary.lm's with an intercept).
# - Sy.x = sqrt(SS/df) ("divides the sum-of-squares by N-K").
# - AICc = n·ln(SS/n) + 2K + 2K(K+1)/(n − K − 1), K = number of coefficients + 1 (Prism's
#   least-squares AICc, as the nonlinear fits); checked against AIC(lm), which differs by the
#   constant n·(log(2π) + 1). NaN when n − K − 1 ≤ 0.
# - Overall F: summary.lm's fstatistic (with an intercept H0: all slopes 0; without, H0: Y = 0).
#   UNCERTAIN: which null Prism uses when the intercept is excluded.
# - VIF = 1/(1 − R²_j), R²_j from regressing X_j on the other design columns (with the intercept
#   when the model has one; uncentred R² through the origin otherwise), cross-checked against
#   car::vif where it applies (≥ 2 terms). Interaction products are treated as ordinary columns.
#   Prism: "how well each independent (X) variable can be predicted from the other X variables".
# - Collinear design: lm's aliasing (last dependent column NA) -> status 'singular', NaN for the
#   aliased coefficient and all VIFs (car::vif refuses aliased models); the fit is the reduced one.

PACKAGES <- c("car")

design <- function(input, params) {
  X <- as.matrix(input$X)
  if (is.null(dim(X))) X <- matrix(X, ncol = length(input$names))
  colnames(X) <- input$names
  if (!is.null(params$interactions)) {
    ia <- matrix(params$interactions, ncol = 2)
    for (r in seq_len(nrow(ia))) {
      a <- ia[r, 1] + 1; b <- ia[r, 2] + 1
      X <- cbind(X, X[, a] * X[, b])
      colnames(X)[ncol(X)] <- paste0(input$names[a], ":", input$names[b])
    }
  }
  X
}

vif_manual <- function(M, intercept) {
  sapply(seq_len(ncol(M)), function(j) {
    xj <- M[, j]
    others <- M[, -j, drop = FALSE]
    if (intercept) {
      r <- if (ncol(others) > 0) residuals(lm(xj ~ others)) else xj - mean(xj)
      1 / (sum(r^2) / sum((xj - mean(xj))^2))
    } else {
      r <- if (ncol(others) > 0) residuals(lm(xj ~ 0 + others)) else xj
      1 / (sum(r^2) / sum(xj^2))
    }
  })
}

oracle <- function(input, params) {
  y <- input$y
  M <- design(input, params)
  intercept <- is.null(params$intercept) || isTRUE(params$intercept)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  df <- data.frame(y = y, M, check.names = FALSE)
  vars <- sprintf("v%d", seq_len(ncol(M)))
  names(df) <- c("y", vars)
  f <- as.formula(paste("y ~", if (intercept) "" else "0 +", paste(vars, collapse = " + ")))
  fit <- lm(f, data = df)
  s <- summary(fit)
  cf <- coef(fit)
  aliased <- is.na(cf)
  singular <- any(aliased)
  ci <- suppressWarnings(confint(fit, level = level))
  tab <- s$coefficients
  n <- length(y)
  k <- fit$rank
  dfr <- fit$df.residual
  ss <- sum(residuals(fit)^2)
  sstot <- sum((y - mean(y))^2)
  K <- k + 1
  aicc <- if (n - K - 1 > 0) n * log(ss / n) + 2 * K + 2 * K * (K + 1) / (n - K - 1) else NaN
  stopifnot(abs(AIC(fit) - (n * log(ss / n) + 2 * K + n * (log(2 * pi) + 1))) < 1e-9 * abs(AIC(fit)))
  if (intercept && dfr > 0) {
    stopifnot(abs(s$adj.r.squared - (1 - ss / dfr / (sstot / (n - 1)))) < 1e-12)
  }
  vif <- if (singular) rep(NaN, ncol(M)) else vif_manual(M, intercept)
  if (!singular && ncol(M) >= 2) {
    cv <- suppressWarnings(car::vif(fit))
    stopifnot(max(abs(cv - vif) / vif) < 1e-8)
  }
  nm <- c(if (intercept) "Intercept", colnames(M))
  rn <- c(if (intercept) "(Intercept)", vars)
  vifs <- c(if (intercept) list(NULL), as.list(vif))
  coefs <- lapply(seq_along(nm), function(j) {
    r <- rn[j]
    if (aliased[r]) {
      return(list(name = nm[j], estimate = NaN, se = NaN, lower = NaN, upper = NaN, stat = NaN,
                  p = NaN, vif = if (is.null(vifs[[j]])) NULL else NaN))
    }
    list(name = nm[j], estimate = unname(cf[r]), se = tab[r, 2], lower = ci[r, 1],
         upper = ci[r, 2], stat = tab[r, 3], p = tab[r, 4], vif = vifs[[j]])
  })
  fs <- s$fstatistic
  list(
    coefficients = coefs,
    n = n, df = dfr,
    rSquared = 1 - ss / sstot,
    adjRSquared = 1 - ss / dfr / (sstot / (n - 1)),
    syx = s$sigma, ss = ss, aicc = aicc,
    F = unname(fs["value"]), dfn = unname(fs["numdf"]), dfd = unname(fs["dendf"]),
    p = pf(fs["value"], fs["numdf"], fs["dendf"], lower.tail = FALSE)[[1]],
    fitted = unname(fitted(fit)), residuals = unname(residuals(fit)),
    status = if (singular) "singular" else "ok"
  )
}
