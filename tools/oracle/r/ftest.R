# F test for equality of two variances. Convention: F = larger variance / smaller,
# DFn from the group with the larger variance, two-sided P. R's var.test(a, b) uses
# var(a)/var(b); its two-sided P, 2 * min(P(F' <= F), P(F' >= F)), is the same either way
# round, which the oracle asserts.

PACKAGES <- character(0)

oracle <- function(input, params) {
  a <- input$a; b <- input$b
  vA <- var(a); vB <- var(b)
  a_larger <- vA >= vB
  F <- if (a_larger) vA / vB else vB / vA
  dfn <- (if (a_larger) length(a) else length(b)) - 1
  dfd <- (if (a_larger) length(b) else length(a)) - 1
  p <- 2 * min(pf(F, dfn, dfd), pf(F, dfn, dfd, lower.tail = FALSE))
  vt <- tryCatch(var.test(a, b), error = function(e) NULL)
  if (!is.null(vt) && is.finite(F)) {
    stopifnot(isTRUE(all.equal(vt$p.value, p, tolerance = 1e-12)))
    stopifnot(isTRUE(all.equal(max(vt$statistic, 1 / vt$statistic), F, tolerance = 1e-14)))
  }
  list(F = F, dfn = dfn, dfd = dfd, p = p, varA = vA, varB = vB)
}
