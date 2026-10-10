# Newman-Keuls (Student-Newman-Keuls) comparisons after one-way ANOVA, all pairs (i < j, 0-based;
# diff = mean_i - mean_j). Written out from the step-down definition:
#   means ranked ascending; pair (i, j) spans r = |rank_i - rank_j| + 1 ranked means;
#   q = sqrt(2) |diff| / SE, SE = sqrt(MSE (1/n_i + 1/n_j)) (Tukey-Kramer), MSE and df from the
#   one-way ANOVA; step P = P(Q_{r, df} >= q) from the integrate() reference (ref_integrals.R;
#   cross-checked with R's ptukey at 1e-6);
#   reported P = max of the step P over every pair whose range contains (i, j) (itself included),
#   so that P < alpha exactly when the classical procedure (test the widest range first, stop
#   below a non-significant range) declares the pair significant -- checked here at alpha 0.05
#   by running that procedure with R's qtukey critical values.

source(file.path(ORACLE_DIR, "ref_integrals.R"))

PACKAGES <- character(0)

as_groups <- function(x) if (is.matrix(x)) lapply(seq_len(nrow(x)), function(i) x[i, ]) else x

oracle <- function(input, params) {
  groups <- as_groups(input$groups)
  k <- length(groups)
  n <- vapply(groups, length, 0L)
  means <- vapply(groups, mean, 0)
  sds <- vapply(groups, sd, 0)
  df <- sum(n) - k
  mse <- sum((n - 1) * sds^2) / df
  pairs <- t(combn(k, 2))
  i <- pairs[, 1]; j <- pairs[, 2]
  rk <- rank(means, ties.method = "first")
  lo <- pmin(rk[i], rk[j]); hi <- pmax(rk[i], rk[j])
  r <- hi - lo + 1
  diff <- means[i] - means[j]
  se <- sqrt(mse * (1 / n[i] + 1 / n[j]))
  q <- sqrt(2) * abs(diff) / se
  step <- mapply(function(qq, rr) ptukey_ref(qq, rr, df, lower = FALSE), q, r)
  stopifnot(all(abs(step - ptukey(q, r, df, lower.tail = FALSE)) < 1e-6))
  p <- vapply(seq_along(q), function(a) max(step[lo <= lo[a] & hi >= hi[a]]), 0)
  # The classical procedure at alpha = 0.05.
  sig <- rep(NA, length(q))
  for (a in order(-r)) {
    inside <- which(lo <= lo[a] & hi >= hi[a] & seq_along(q) != a)
    blocked <- length(inside) > 0 && any(!sig[inside])
    sig[a] <- !blocked && q[a] > qtukey(0.95, r[a], df)
  }
  stopifnot(all(sig == (p < 0.05)))
  list(i = i - 1, j = j - 1, diff = diff, se = se, stat = sqrt(2) * diff / se, df = df, p = p,
       significant = sig)
}
