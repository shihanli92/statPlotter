# Normal QQ plot as Prism draws it (Statistics Guide, "QQ plot"): X = the data sorted; Y = the
# value of a Gaussian sample at the same rank, mean + qnorm((i - 0.5)/n) * sd (the data's mean
# and SD, n - 1). params$lognormal: the same on log(values), exponentiated back. Checked against
# qqnorm() (its ppoints use a = 3/8 for n <= 10, so it is compared only for n > 10, where a = 1/2).

PACKAGES <- character(0)

oracle <- function(input, params) {
  v <- sort(input$values)
  n <- length(v)
  t <- if (isTRUE(params$lognormal)) log(v) else v
  z <- qnorm((seq_len(n) - 0.5) / n)
  if (n > 10) stopifnot(isTRUE(all.equal(sort(qqnorm(t, plot.it = FALSE)$x), z, tolerance = 1e-14)))
  pred <- mean(t) + z * sd(t)
  list(actual = v, predicted = if (isTRUE(params$lognormal)) exp(pred) else pred)
}
