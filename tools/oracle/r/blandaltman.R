# Bland-Altman method comparison:
#
# - The dialog offers "Difference (A - B)", "Ratio (A / B)", "%Difference (100*(A - B)/
#   average)" and the B - A, B / A, 100*(B - A)/average variants, each "vs. average".
#   params$measure = difference / ratio / percent, params$order = aMinusB / bMinusA.
# - x = (a + b) / 2; y = the measure; bias = mean(y); "SD of bias" = sd(y); 95% limits of
#   agreement = bias +- 1.96 sd ("plus or minus 1.96 times its SD"), 1.96 exactly: a published
#   sample output (bias 0.238095, SD 6.96351, limits -13.4104 to 13.8866) is reproduced by
#   1.96 but not by qnorm(0.975) (which gives -13.4101). Other levels: qnorm((1 + level) / 2).
# - Ratios and percents are analysed on their own scale (no log transform).
# - CIs: bias +- t sd / sqrt(n) and limits +- t sd sqrt(3 / n), t on
#   n - 1 df (Bland & Altman 1986), cross-checked with BlandAltmanLeh::bland.altman.stats
#   (difference measure; mode 1 = A - B, mode 2 = B - A).
# params: measure, order, confLevel.

PACKAGES <- c("BlandAltmanLeh")

oracle <- function(input, params) {
  a <- as.numeric(input$a); b <- as.numeric(input$b)
  measure <- if (is.null(params$measure)) "difference" else params$measure
  order <- if (is.null(params$order)) "aMinusB" else params$order
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  u <- if (order == "aMinusB") a else b
  v <- if (order == "aMinusB") b else a
  x <- (u + v) / 2
  y <- switch(measure, difference = u - v, ratio = u / v, percent = 100 * (u - v) / x)
  n <- length(y)
  bias <- mean(y); s <- sd(y)
  z <- if (level == 0.95) 1.96 else qnorm((1 + level) / 2)
  t <- qt((1 + level) / 2, n - 1)
  lower <- bias - z * s; upper <- bias + z * s
  hb <- t * s / sqrt(n); hl <- t * s * sqrt(3 / n)
  if (measure == "difference") {
    st <- BlandAltmanLeh::bland.altman.stats(a, b, two = z, mode = if (order == "aMinusB") 1 else 2,
                                             conf.int = level)
    ci <- unname(st$CI.lines)
    stopifnot(
      isTRUE(all.equal(st$mean.diffs, bias, tolerance = 1e-14)),
      isTRUE(all.equal(unname(c(st$lower.limit, st$upper.limit)), c(lower, upper),
                       tolerance = 1e-14)),
      isTRUE(all.equal(ci, c(lower - hl, lower + hl, bias - hb, bias + hb, upper - hl,
                             upper + hl), tolerance = 1e-12)))
  }
  list(measure = measure, order = order, x = I(x), y = I(y), bias = bias, sd = s,
       lower = lower, upper = upper, z = z,
       biasCI = c(bias - hb, bias + hb), lowerCI = c(lower - hl, lower + hl),
       upperCI = c(upper - hl, upper + hl), n = n)
}
