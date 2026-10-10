# Principal component regression, as Prism describes it (Statistics Guide, "Principal Component
# Regression (PCR)"): prcomp of the predictors (scale. = standardize), the first k components
# (params$k, a fixed number here), lm(y ~ scores[, 1:k]) with an intercept, and the coefficients
# converted back to the original variables: beta_j = sum_c V[j, c] gamma_c / d_j (d = SDs when
# standardized, else 1), beta_0 = gamma_0 - sum_j beta_j mean_j, with covariance T vcov(gamma) T'.
# Cross-checked: the back-converted fitted values equal the PC regression's.
# Eigenvector signs as pca.R (each eigenvector sums to a positive number).

PACKAGES <- character(0)

fix_sign <- function(v) {
  s <- sum(v)
  if (abs(s) > 1e-8) return(sign(s))
  sign(v[which(abs(v) > 1e-8)[1]])
}

oracle <- function(input, params) {
  y <- input$y
  X <- as.matrix(input$X)
  standardize <- is.null(params$standardize) || isTRUE(params$standardize)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  k <- params$k
  pc <- prcomp(X, center = TRUE, scale. = standardize)
  V <- pc$rotation
  for (c in seq_len(ncol(V))) V[, c] <- V[, c] * fix_sign(V[, c])
  d <- if (standardize) apply(X, 2, sd) else rep(1, ncol(X))
  m <- colMeans(X)
  Z <- sweep(sweep(X, 2, m), 2, d, "/")
  S <- Z %*% V[, 1:k, drop = FALSE]
  fit <- lm(y ~ S)
  g <- unname(coef(fit)); G <- unname(vcov(fit))
  A <- V[, 1:k, drop = FALSE] / d
  T <- rbind(c(1, -colSums(A * m)), cbind(0, A))
  beta <- as.vector(T %*% g)
  VB <- T %*% G %*% t(T)
  stopifnot(isTRUE(all.equal(as.vector(cbind(1, X) %*% beta), unname(fitted(fit)), tolerance = 1e-10)))
  se <- sqrt(diag(VB))
  df <- fit$df.residual
  tc <- qt(1 - (1 - level) / 2, df)
  s <- summary(fit)
  ci <- confint(fit, level = level)
  list(k = k,
       regression = list(
         coefficients = lapply(seq_along(g), function(i) list(
           estimate = g[i], se = sqrt(G[i, i]), lower = unname(ci[i, 1]), upper = unname(ci[i, 2]),
           stat = unname(s$coefficients[i, 3]), p = unname(s$coefficients[i, 4]))),
         rSquared = s$r.squared, adjRSquared = s$adj.r.squared, df = df,
         F = unname(s$fstatistic[1]),
         p = pf(s$fstatistic[1], s$fstatistic[2], s$fstatistic[3], lower.tail = FALSE)[[1]]),
       original = lapply(seq_along(beta), function(i) list(
         estimate = beta[i], se = se[i], lower = beta[i] - tc * se[i], upper = beta[i] + tc * se[i],
         stat = beta[i] / se[i], p = 2 * pt(abs(beta[i] / se[i]), df, lower.tail = FALSE))))
}
