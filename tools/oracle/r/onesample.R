# One-sample t test: t.test(x, mu = mu, alternative, conf.level).
#   mean, ciLo, ciHi   the sample mean and its CI (R's estimate and conf.int)
#   diff, diffLo/Hi    the "discrepancy" mean - mu and its CI (conf.int - mu, computed on the
#                      shifted data so it is exact for large offsets)
#   rSquared           t^2 / (t^2 + df)
# params$shift: the oracle analyses x - shift and mu - shift (both exact for 1e9 + noise) and
# adds the shift back to mean / CI.

PACKAGES <- character(0)

alt_of <- function(params) if (is.null(params$alternative)) "two.sided" else
  switch(params$alternative, "two-sided" = "two.sided", params$alternative)

oracle <- function(input, params) {
  shift <- if (is.null(params$shift)) 0 else params$shift
  x <- input$x - shift
  mu <- input$mu - shift
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  tt <- t.test(x, mu = mu, alternative = alt_of(params), conf.level = level)
  t <- unname(tt$statistic); df <- unname(tt$parameter)
  m <- unname(tt$estimate)
  list(
    t = t, df = df, p = tt$p.value,
    mean = m + shift, sd = sd(x), se = unname(tt$stderr),
    ciLo = tt$conf.int[1] + shift, ciHi = tt$conf.int[2] + shift,
    n = length(x), mu = input$mu,
    diff = m - mu, diffLo = tt$conf.int[1] - mu, diffHi = tt$conf.int[2] - mu,
    rSquared = if (is.infinite(t)) 1 else t^2 / (t^2 + df)
  )
}
