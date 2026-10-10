# Mann-Whitney U / Wilcoxon rank-sum test of A vs B; the effect is B - A, so R is called as
# wilcox.test(b, a) and coin with group B as the first factor level. 'greater' = B larger.
#
# P value:
#   exact, no ties   wilcox.test(exact = TRUE), cross-checked with coin
#   exact, ties      coin::wilcox_test(distribution = "exact") (two-sided: P(|T| >= |t|))
#   normal           wilcox.test(exact = FALSE, correct = params$correct)
# Hodges-Lehmann estimate and CI of B - A: wilcox.test(b, a, conf.int = TRUE) with the same
# exact / correct flags (R itself falls back to its asymptotic root-finding with ties).
# params$exact = "auto" resolves to exact when nA + nB <= 100 (our provisional rule).
# All-tied data: coin cannot run (zero variance); the exact P is then 1 (every permutation
# gives the observed statistic), and the normal / HL values are NaN (R refuses).

PACKAGES <- c("coin")

suppressPackageStartupMessages(library(coin))

alt_of <- function(params) if (is.null(params$alternative)) "two.sided" else
  switch(params$alternative, "two-sided" = "two.sided", params$alternative)

oracle <- function(input, params) {
  a <- input$a; b <- input$b
  nA <- length(a); nB <- length(b)
  alt <- alt_of(params)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  correct <- if (is.null(params$correct)) TRUE else params$correct
  exact <- if (is.null(params$exact) || identical(params$exact, "auto")) (nA + nB) <= 100 else
    params$exact
  r <- rank(c(a, b))
  ties <- length(unique(r)) != length(r)
  all_tied <- length(unique(c(a, b))) == 1
  uB <- unname(wilcox.test(b, a, exact = FALSE)$statistic)
  stopifnot(uB == sum(r[nA + seq_len(nB)]) - nB * (nB + 1) / 2)

  g <- factor(c(rep("b", nB), rep("a", nA)), levels = c("b", "a"))
  y <- c(b, a)
  if (all_tied) {
    p <- if (exact) 1 else NaN
  } else if (exact) {
    p <- as.numeric(pvalue(wilcox_test(y ~ g, distribution = "exact", alternative = alt)))
    if (!ties) {
      pw <- wilcox.test(b, a, exact = TRUE, alternative = alt)$p.value
      stopifnot(isTRUE(all.equal(p, pw, tolerance = 1e-12)))
    }
  } else {
    p <- wilcox.test(b, a, exact = FALSE, correct = correct, alternative = alt)$p.value
  }
  hl <- tryCatch(suppressWarnings(wilcox.test(b, a, conf.int = TRUE, exact = exact,
                                              correct = correct, alternative = alt,
                                              conf.level = level)),
                 error = function(e) NULL)
  list(
    uA = nA * nB - uB, uB = uB, U = min(uB, nA * nB - uB),
    sumRanksA = sum(r[seq_len(nA)]), sumRanksB = sum(r[nA + seq_len(nB)]),
    medianA = median(a), medianB = median(b),
    p = as.numeric(p),
    method = if (exact) "exact" else "normal",
    ties = ties,
    hlEstimate = if (is.null(hl)) NaN else unname(hl$estimate),
    hlLo = if (is.null(hl)) NaN else hl$conf.int[1],
    hlHi = if (is.null(hl)) NaN else hl$conf.int[2]
  )
}
