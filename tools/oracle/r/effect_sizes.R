# Effect sizes.
#
# input$groups (one-way ANOVA): anova(lm(y ~ g)); eta2 = SS_b / SS_t (= R^2), partial eta2 the
#   same, omega2 = (SS_b - df_b MS_w) / (SS_t + MS_w), Cohen's f = sqrt(eta2 / (1 - eta2)).
# input$cells (two-way ANOVA, as the twoway suite): car::Anova(type = 3) with contr.sum, for each
#   source eta2 = SS / SS_total, partial eta2 = SS / (SS + SS_res), partial omega2 =
#   df (MS - MSE) / (df MS + (N - df) MSE), Cohen's f = sqrt(pe / (1 - pe)); order Interaction,
#   Row factor, Column factor.
# input$a, input$b (t tests): Cohen's d = (mean b - mean a) / pooled SD (t.test's var.equal
#   pooled SD, checked through its t: d = t sqrt(1/na + 1/nb)), Hedges' g = d J(df) with the exact
#   J = gamma(df/2) / (sqrt(df/2) gamma((df-1)/2)), Glass's delta = (mean b - mean a) / sd(a);
#   params$paired: d_z = mean(b - a) / sd(b - a) (= t / sqrt(n)), g_z = d_z J(n - 1).

PACKAGES <- c("car")

J <- function(df) exp(lgamma(df / 2) - lgamma((df - 1) / 2)) / sqrt(df / 2)

cells_of <- function(x) {
  v <- x$values
  list(row = x$row, col = x$col,
       values = if (is.matrix(v)) lapply(seq_len(nrow(v)), function(i) v[i, ]) else v)
}

oracle <- function(input, params) {
  if (!is.null(input$groups)) {
    gr <- input$groups
    gr <- if (is.matrix(gr)) lapply(seq_len(nrow(gr)), function(i) gr[i, ]) else gr
    y <- unlist(gr); g <- factor(rep(seq_along(gr), vapply(gr, length, 0L)))
    a <- anova(lm(y ~ g))
    ssb <- a[1, "Sum Sq"]; ssw <- a[2, "Sum Sq"]; msw <- a[2, "Mean Sq"]
    e2 <- ssb / (ssb + ssw)
    return(list(etaSquared = e2, partialEtaSquared = e2,
                partialOmegaSquared = (ssb - a[1, "Df"] * msw) / (ssb + ssw + msw),
                cohensF = sqrt(e2 / (1 - e2))))
  }
  if (!is.null(input$cells)) {
    old <- options(contrasts = c("contr.sum", "contr.poly"))
    on.exit(options(old))
    cl <- cells_of(input$cells)
    len <- vapply(cl$values, length, 0L)
    y <- unlist(cl$values)
    A <- factor(rep(cl$row, len)); B <- factor(rep(cl$col, len))
    an <- car::Anova(lm(y ~ A * B), type = 3)
    terms <- c("A:B", "A", "B")
    ss <- an[terms, "Sum Sq"]; df <- an[terms, "Df"]
    ssr <- an["Residuals", "Sum Sq"]; mse <- ssr / an["Residuals", "Df"]
    N <- length(y)
    pe <- ss / (ss + ssr)
    return(list(etaSquared = ss / sum((y - mean(y))^2), partialEtaSquared = pe,
                partialOmegaSquared = df * (ss / df - mse) / (ss + (N - df) * mse),
                cohensF = sqrt(pe / (1 - pe))))
  }
  a <- input$a; b <- input$b
  if (isTRUE(params$paired)) {
    d <- b - a
    n <- length(d)
    dz <- mean(d) / sd(d)
    tt <- t.test(b, a, paired = TRUE)
    stopifnot(isTRUE(all.equal(dz, unname(tt$statistic) / sqrt(n), tolerance = 1e-12)))
    return(list(cohensD = dz, hedgesG = dz * J(n - 1)))
  }
  na <- length(a); nb <- length(b)
  df <- na + nb - 2
  sp <- sqrt(((na - 1) * var(a) + (nb - 1) * var(b)) / df)
  d <- (mean(b) - mean(a)) / sp
  tt <- t.test(b, a, var.equal = TRUE)
  stopifnot(isTRUE(all.equal(d, unname(tt$statistic) * sqrt(1 / na + 1 / nb), tolerance = 1e-10)))
  list(cohensD = d, hedgesG = d * J(df), glassDelta = (mean(b) - mean(a)) / sd(a))
}
