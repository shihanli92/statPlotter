# Wilcoxon signed-rank test on differences d = b - a (paired: input a, b) or d = x - mu
# (one-sample: input x, mu). 'greater' = positive location of d.
#
# Ranks: zeroMethod "wilcoxon" drops zero differences, then ranks |d|; "pratt" ranks all |d|
# (zeros included) and then drops the zeros.
# P value:
#   exact    coin::wilcoxsign_test(zero.method = "Wilcoxon" / "Pratt", distribution = "exact"),
#            cross-checked with wilcox.test(exact = TRUE) when there are no ties or zeros
#   normal   wilcoxon: wilcox.test(exact = FALSE, correct = params$correct)
#            pratt:    correct = false: coin asymptotic test. correct = true (the default, which
#                      neither R function offers): hand-coded (signed_rank_normal) -- W+ against
#                      mean sum(r)/2 and variance sum(r^2)/4 of the Pratt ranks, with
#                      wilcox.test's continuity correction (two-sided sign(z)/2, greater 1/2,
#                      less -1/2). The same function is checked against wilcox.test (both
#                      correct values, Wilcoxon ranks) and coin (Pratt, no correction) on every
#                      normal-approximation case.
# Hodges-Lehmann pseudo-median and CI: wilcox.test(conf.int = TRUE) with the same flags. R
# drops zero differences first and uses its asymptotic root-finding when there are ties or
# zeros; the Pratt option does not change the HL computation.
# params$exact = "auto" resolves to exact when the number of non-zero differences <= 100.
# All differences zero: no test is possible; P, HL are NaN.

PACKAGES <- c("coin")

suppressPackageStartupMessages(library(coin))

alt_of <- function(params) if (is.null(params$alternative)) "two.sided" else
  switch(params$alternative, "two-sided" = "two.sided", params$alternative)

# Normal approximation for ranks r of the non-zero differences (pos: which are positive).
signed_rank_normal <- function(r, pos, alt, correct) {
  z <- sum(r[pos]) - sum(r) / 2
  sigma <- sqrt(sum(r^2) / 4)
  corr <- if (!correct) 0 else switch(alt, two.sided = sign(z) * 0.5, greater = 0.5, less = -0.5)
  z <- (z - corr) / sigma
  switch(alt, less = pnorm(z), greater = pnorm(z, lower.tail = FALSE),
         two.sided = 2 * min(pnorm(z), pnorm(z, lower.tail = FALSE)))
}

oracle <- function(input, params) {
  one <- !is.null(input$x)
  if (one) {
    y1 <- input$x; y2 <- rep(input$mu, length(input$x)); d <- input$x - input$mu
  } else {
    y1 <- input$b; y2 <- input$a; d <- input$b - input$a
  }
  zm <- if (is.null(params$zeroMethod)) "wilcoxon" else params$zeroMethod
  alt <- alt_of(params)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  correct <- if (is.null(params$correct)) TRUE else params$correct
  nz <- d[d != 0]
  n1 <- length(nz)
  exact <- if (is.null(params$exact) || identical(params$exact, "auto")) n1 <= 100 else
    params$exact
  r <- if (zm == "pratt") rank(abs(d))[d != 0] else rank(abs(nz))
  ties <- anyDuplicated(abs(nz)) > 0
  coin_zm <- if (zm == "pratt") "Pratt" else "Wilcoxon"

  if (n1 == 0) {
    p <- NaN
  } else if (exact) {
    p <- as.numeric(pvalue(wilcoxsign_test(y1 ~ y2, zero.method = coin_zm,
                                           distribution = "exact", alternative = alt)))
    if (!ties && n1 == length(d)) {
      pw <- if (one) wilcox.test(input$x, mu = input$mu, exact = TRUE, alternative = alt)$p.value
            else wilcox.test(input$b, input$a, paired = TRUE, exact = TRUE,
                             alternative = alt)$p.value
      stopifnot(isTRUE(all.equal(p, pw, tolerance = 1e-12)))
    }
  } else {
    # The hand-coded reference, validated on the paths R covers.
    rw <- rank(abs(nz))
    for (cc in c(FALSE, TRUE)) {
      pw <- if (one) wilcox.test(input$x, mu = input$mu, exact = FALSE, correct = cc,
                                 alternative = alt)$p.value
            else wilcox.test(input$b, input$a, paired = TRUE, exact = FALSE, correct = cc,
                             alternative = alt)$p.value
      stopifnot(isTRUE(all.equal(signed_rank_normal(rw, nz > 0, alt, cc), pw,
                                 tolerance = 1e-12)))
    }
    pc <- as.numeric(pvalue(wilcoxsign_test(y1 ~ y2, zero.method = coin_zm,
                                            distribution = "asymptotic", alternative = alt)))
    stopifnot(isTRUE(all.equal(signed_rank_normal(r, nz > 0, alt, FALSE), pc,
                               tolerance = 1e-10)))
    p <- if (zm == "wilcoxon") {
      if (one) wilcox.test(input$x, mu = input$mu, exact = FALSE, correct = correct,
                           alternative = alt)$p.value
      else wilcox.test(input$b, input$a, paired = TRUE, exact = FALSE, correct = correct,
                       alternative = alt)$p.value
    } else if (!correct) pc else signed_rank_normal(r, nz > 0, alt, TRUE)
  }
  hl <- suppressWarnings(
    if (one) wilcox.test(input$x, mu = input$mu, conf.int = TRUE, exact = exact,
                         correct = correct, alternative = alt, conf.level = level)
    else wilcox.test(input$b, input$a, paired = TRUE, conf.int = TRUE, exact = exact,
                     correct = correct, alternative = alt, conf.level = level))
  wPlus <- sum(r[nz > 0]); wMinus <- sum(r[nz < 0])
  list(
    wPlus = wPlus, wMinus = wMinus, W = wPlus - wMinus,
    n = length(d), nNonZero = n1, nZero = length(d) - n1,
    p = p,
    method = if (exact) "exact" else "normal",
    ties = ties,
    medianDiff = median(d),
    hlEstimate = unname(hl$estimate),
    hlLo = hl$conf.int[1],
    hlHi = hl$conf.int[2]
  )
}
