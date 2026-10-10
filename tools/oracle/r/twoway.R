# Two-way ANOVA (ordinary). input$cells: [{row, col, values}]; params$interaction (default
# TRUE); params$summary only changes the TS side (mean/SD/N input); params$shift is subtracted
# from the data (exactly) before fitting and added back to the marginal means.
#
#   sources     car::Anova(lm(y ~ A * B), type = 3) with contr.sum (Type III), or the additive
#               lm(y ~ A + B) (where Type II = Type III, checked); order Interaction, Row factor,
#               Column factor, Residual; pctOfTotal = 100 SS / sum((y - mean(y))^2)
#   rowMeans / colMeans   emmeans (least-squares marginal means)
#   comparisons (interaction model with every cell filled): simple effects "compare columns
#               within each row" with the pooled MSE and residual df:
#                 Tukey, one family per row: k = number of columns (P from the integrate()
#                   reference, cross-checked with emmeans(adjust = "tukey"); CI critical value
#                   as the root of that reference);
#                 Sidak, one family per row (m = C(C, 2); cross-checked with emmeans) and one
#                   family for all rows (m = R C(C, 2)).

source(file.path(ORACLE_DIR, "ref_integrals.R"))

PACKAGES <- c("car", "emmeans")

cells_of <- function(x) {
  v <- x$values
  vals <- if (is.matrix(v)) lapply(seq_len(nrow(v)), function(i) v[i, ]) else v
  list(row = x$row, col = x$col, values = vals)
}

oracle <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly"))
  on.exit(options(old))
  cl <- cells_of(input$cells)
  len <- vapply(cl$values, length, 0L)
  shift <- if (is.null(params$shift)) 0 else params$shift
  y <- unlist(cl$values) - shift
  A <- factor(rep(cl$row, len)); B <- factor(rep(cl$col, len))
  interaction <- is.null(params$interaction) || isTRUE(params$interaction)
  fit <- if (interaction) lm(y ~ A * B) else lm(y ~ A + B)
  an <- car::Anova(fit, type = 3)
  if (!interaction) {
    a2 <- car::Anova(fit, type = 2)
    stopifnot(isTRUE(all.equal(a2[c("A", "B"), "Sum Sq"], an[c("A", "B"), "Sum Sq"],
                               tolerance = 1e-10)))
  }
  sst <- sum((y - mean(y))^2)
  terms <- if (interaction) c("A:B", "A", "B", "Residuals") else c("A", "B", "Residuals")
  ss <- an[terms, "Sum Sq"]; dfs <- an[terms, "Df"]
  src <- list(ss = ss, df = dfs, ms = ss / dfs, F = an[terms, "F value"],
              p = an[terms, "Pr(>F)"], pctOfTotal = 100 * ss / sst)
  src$F[length(terms)] <- NaN; src$p[length(terms)] <- NaN
  dfr <- fit$df.residual
  mse <- sum(residuals(fit)^2) / dfr
  rm <- suppressMessages(summary(emmeans::emmeans(fit, ~A)))
  cm <- suppressMessages(summary(emmeans::emmeans(fit, ~B)))
  R <- nlevels(A); C <- nlevels(B)
  out <- list(sources = src, ssTotal = sst, mse = mse, dfResidual = dfr,
              rowMeans = rm$emmean + shift, colMeans = cm$emmean + shift,
              balanced = length(unique(len)) == 1 && length(len) == R * C)
  # (not for offset data: comparisons of absolute 1e9-level cell means are the caller's
  # precision problem, not the ANOVA's)
  if (interaction && length(len) == R * C && shift == 0) {
    emm <- emmeans::emmeans(fit, ~ B | A)
    pr <- as.data.frame(summary(pairs(emm, adjust = "none")))
    lv <- strsplit(as.character(pr$contrast), " - ")
    c1 <- as.numeric(sub("B", "", vapply(lv, `[`, "", 1)))
    c2 <- as.numeric(sub("B", "", vapply(lv, `[`, "", 2)))
    t <- pr$t.ratio
    q <- sqrt(2) * abs(t)
    pTukey <- vapply(q, ptukey_ref, 0, k = C, df = dfr, lower = FALSE)
    pe <- as.data.frame(summary(pairs(emm, adjust = "tukey")))
    stopifnot(all(abs(pe$p.value - pTukey) < 1e-8))
    critT <- upper_quantile(function(x) ptukey_ref(x, C, dfr, lower = FALSE), 0.05,
                            qtukey(0.95, C, dfr)) / sqrt(2)
    mRow <- C * (C - 1) / 2
    mAll <- R * mRow
    sid <- function(p, m) pmin(1, -expm1(m * log1p(-p)))
    critS <- function(m) qt(1 - (-expm1(log1p(-0.05) / m)) / 2, dfr)
    raw <- pr$p.value
    ps <- as.data.frame(summary(pairs(emm, adjust = "sidak")))
    stopifnot(all(abs(ps$p.value - sid(raw, mRow)) < 1e-12))
    out$comparisons <- list(
      row = as.numeric(as.character(pr$A)), c1 = c1, c2 = c2, diff = pr$estimate, se = pr$SE,
      t = t, df = pr$df,
      pTukeyRow = pTukey, loTukeyRow = pr$estimate - critT * pr$SE,
      hiTukeyRow = pr$estimate + critT * pr$SE,
      pSidakRow = sid(raw, mRow), loSidakRow = pr$estimate - critS(mRow) * pr$SE,
      hiSidakRow = pr$estimate + critS(mRow) * pr$SE,
      pSidakAll = sid(raw, mAll), loSidakAll = pr$estimate - critS(mAll) * pr$SE,
      hiSidakAll = pr$estimate + critS(mAll) * pr$SE
    )
  }
  out
}
