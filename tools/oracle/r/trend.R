# Post-test for linear trend after one-way ANOVA. input$groups in column order, scored
# x = 1..k. params$summary only changes the TS side.
#
#   slope       coef(lm(means ~ x)) -- unweighted regression of the column means
#   linear      anova(lm(y ~ x + g)) on all values: the SS of x (sequential) is the linear
#               regression SS of the values on their column number; F = SS_x / MS_residual of the
#               full one-way model (the residual of y ~ x + g is the within-group residual),
#               df (1, N - k); cross-checked with the contrast formula (sum n (x - xbar_w) ybar)^2 /
#               sum n (x - xbar_w)^2
#   nonlinear   the SS of g after x in the same table (df k - 2), F and P from that table
#   r2Effect = SS_x / SS_total, r2Alerting = SS_x / SS_between

PACKAGES <- character(0)

as_groups <- function(x) if (is.matrix(x)) lapply(seq_len(nrow(x)), function(i) x[i, ]) else x

oracle <- function(input, params) {
  groups <- as_groups(input$groups)
  k <- length(groups)
  n <- vapply(groups, length, 0L)
  y <- unlist(groups)
  x <- rep(seq_len(k), n)
  g <- factor(x)
  a <- anova(lm(y ~ x + g))
  means <- vapply(groups, mean, 0)
  slope <- unname(coef(lm(means ~ seq_len(k)))[2])
  N <- length(y)
  xw <- sum(n * seq_len(k)) / N
  ssl <- sum(n * (seq_len(k) - xw) * means)^2 / sum(n * (seq_len(k) - xw)^2)
  stopifnot(isTRUE(all.equal(ssl, a["x", "Sum Sq"], tolerance = 1e-10)))
  ssb <- sum(a[c("x", "g"), "Sum Sq"], na.rm = TRUE)
  sst <- sum((y - mean(y))^2)
  out <- list(slope = slope, ssLinear = a["x", "Sum Sq"], F = a["x", "F value"], dfn = 1,
              dfd = a["Residuals", "Df"], p = a["x", "Pr(>F)"],
              r2Effect = a["x", "Sum Sq"] / sst, r2Alerting = a["x", "Sum Sq"] / ssb)
  out$nonlinear <- if (k > 2) list(ss = a["g", "Sum Sq"], df = a["g", "Df"], F = a["g", "F value"],
                                   p = a["g", "Pr(>F)"])
                   else list(ss = 0, df = 0, F = NaN, p = NaN)
  out
}
