# Special functions and distributions: pnorm/qnorm, pt/qt, pf, pchisq, pbeta, lgamma.
# Each case evaluates one function on a grid (parallel arrays in `input`); params$fn selects it.
# Upper tails are R's own lower.tail = FALSE results (computed directly, not as 1 - cdf).

PACKAGES <- character(0)

oracle <- function(input, params) {
  switch(params$fn,
    normal = list(
      cdf = pnorm(input$z),
      sf = pnorm(input$z, lower.tail = FALSE)
    ),
    normal_quantile = list(
      lower = qnorm(input$p),
      upper = qnorm(input$p, lower.tail = FALSE)
    ),
    t = list(
      cdf = pt(input$t, input$df),
      sf = pt(input$t, input$df, lower.tail = FALSE)
    ),
    # params$upperBySymmetry: upper = -lower. R's qt(lower.tail = FALSE) loses accuracy for
    # df < 1 at tiny p (qt(1e-8, 0.1, lower.tail = FALSE) is off by 1.4e-7 relative, and
    # qt(1e-20, 0.5, lower.tail = FALSE) is Inf), while the lower tail is accurate there.
    t_quantile = list(
      lower = qt(input$p, input$df),
      upper = if (isTRUE(params$upperBySymmetry)) -qt(input$p, input$df) else
        qt(input$p, input$df, lower.tail = FALSE)
    ),
    f = list(
      cdf = pf(input$x, input$df1, input$df2),
      sf = pf(input$x, input$df1, input$df2, lower.tail = FALSE)
    ),
    chisq = list(
      cdf = pchisq(input$x, input$df),
      sf = pchisq(input$x, input$df, lower.tail = FALSE)
    ),
    beta = list(
      lower = pbeta(input$x, input$a, input$b),
      upper = pbeta(input$x, input$a, input$b, lower.tail = FALSE)
    ),
    lgamma = list(lgamma = lgamma(input$x)),
    stop("unknown fn ", params$fn)
  )
}
