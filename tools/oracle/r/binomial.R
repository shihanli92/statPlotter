# Binomial test, confidence interval of a proportion, chi-square goodness of fit (the
# "Compare observed distribution with expected" and "Fraction / proportion" analyses).
#
# fn = "binomial":
#   Binomial test   binom.test: exact, two-sided P by summing the probabilities of outcomes
#                   no more likely than the observed one (tolerance 1 + 1e-7) -- the
#                   "method of small P values" (a published worked example,
#                   7 of 100 at 0.2, gives P = 0.00061307). pLess = P(X <= k),
#                   pGreater = P(X >= k).
#   Proportion CI   (three methods)
#     clopperPearson  binom.test()$conf.int (Beta quantiles).
#     wilson          Wilson score without continuity correction (none is offered),
#                     cross-checked with prop.test(correct = FALSE).
#     wilsonBrown     the recommended hybrid (Brown, Cai & DasGupta 2001, sec. 4.1.1,
#                     "modified Wilson"): the lower limit becomes the one-sided Poisson bound
#                     qchisq(alpha, 2x) / (2n) for x = 1, 2, or x = 3 with n > 50 (the
#                     rule's "N = 3 and the denominator exceeds 50"), and symmetrically the
#                     upper limit 1 - qchisq(alpha, 2(n - x)) / (2n); alpha = 1 - confLevel,
#                     not alpha/2, as in the paper (its example: x = 2 gives 0.355/n).
#                     x = 0 -> lower 0, x = n -> upper 1, the other limit by Wilson; these take
#                     precedence over the Poisson rule (so x = n = 1 or 2 keeps Wilson's lower
#                     limit).
#                     UNCERTAIN: the published rule says "N = D - 3, and N > 50" for the upper
#                     limit; read here as D > 50 (the mirror image of the lower-limit rule).
# fn = "gof": chisq.test(observed, p = expected / sum(expected)); df = k - 1; no Yates.
# params$confLevel (default 0.95).

PACKAGES <- character(0)

wilson <- function(x, n, z) {
  p <- x / n
  center <- (x + z^2 / 2) / (n + z^2)
  half <- z * sqrt(n) / (n + z^2) * sqrt(p * (1 - p) + z^2 / (4 * n))
  c(if (x == 0) 0 else center - half, if (x == n) 1 else center + half)
}

oracle <- function(input, params) {
  if (params$fn == "gof") {
    o <- input$observed; e <- input$expected
    ct <- suppressWarnings(chisq.test(o, p = e / sum(e)))
    E <- sum(o) * e / sum(e)
    stopifnot(isTRUE(all.equal(unname(ct$statistic), sum((o - E)^2 / E), tolerance = 1e-12)))
    return(list(chiSq = unname(ct$statistic), df = unname(ct$parameter), p = ct$p.value))
  }
  conf <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  k <- input$k; n <- input$n; p0 <- input$p0
  z <- qnorm(1 - (1 - conf) / 2); alpha <- 1 - conf
  bt <- binom.test(k, n, p0, conf.level = conf)
  w <- wilson(k, n, z)
  if (k > 0 && k < n) {
    pt <- suppressWarnings(prop.test(k, n, conf.level = conf, correct = FALSE)$conf.int)
    stopifnot(isTRUE(all.equal(w, as.vector(pt), tolerance = 1e-12)))
  }
  wb <- w
  xstar <- function(v) v == 1 || v == 2 || (v == 3 && n > 50)
  if (k != n && xstar(k)) wb[1] <- 0.5 * qchisq(alpha, 2 * k) / n
  if (k != 0 && xstar(n - k)) wb[2] <- 1 - 0.5 * qchisq(alpha, 2 * (n - k)) / n
  est <- function(l) list(value = k / n, lower = l[1], upper = l[2])
  list(
    binomialTest = list(
      p = as.numeric(bt$p.value),  # binom.test returns TRUE (not 1) when k == n p0
      pLess = binom.test(k, n, p0, alternative = "less")$p.value,
      pGreater = binom.test(k, n, p0, alternative = "greater")$p.value),
    proportionCI = list(
      wilsonBrown = est(wb), wilson = est(w), clopperPearson = est(as.vector(bt$conf.int))))
}
