# Three-way ANOVA (ordinary; Prism's 2 x 2 x k layout) and factorial effect sizes.
# input$cells: [{levels: [a, b, c] (0-based), values}]; params$summary only changes the TS side;
# params$shift is subtracted (exactly) before fitting and added back to the marginal means.
#
#   sources     car::Anova(lm(y ~ A * B * C), type = 3) with contr.sum (Type III); order A, B, C,
#               A:B, A:C, B:C, A:B:C, Residual; pctOfTotal = 100 SS / sum((y - mean(y))^2)
#   effect sizes  eta2 = SS / SS_total, partial eta2 = SS / (SS + SS_res), partial omega2 =
#               df (MS - MSE) / (df MS + (N - df) MSE) (Olejnik & Algina 2003), Cohen's f =
#               sqrt(pe / (1 - pe))
#   marginalMeans  emmeans (least-squares means) of A, B and C
#   comparisons of cell means with the pooled MSE and residual df (emmeans(~ A:B:C), pairs with
#               adjust = "none" for the t ratios, checked against the explicit formula):
#     allCells   every pair of cells, ordered row by row (factor A slowest, then data sets
#                A-D = (B, C) = (0,0), (0,1), (1,0), (1,1)); Tukey with k = number of cells
#                (P from the integrate() reference, ref_integrals.R), Sidak over the family
#     oneFactor  pairs of cells that differ in one factor only; Holm-Sidak and Sidak over them
#     vsControl  the first cell vs every other; Sidak

source(file.path(ORACLE_DIR, "ref_integrals.R"))
source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- c("car", "emmeans")

cells_of <- function(x) {
  lv <- x$levels
  if (is.list(lv)) lv <- do.call(rbind, lv)
  v <- x$values
  vals <- if (is.matrix(v)) lapply(seq_len(nrow(v)), function(i) v[i, ]) else v
  list(levels = lv, values = vals)
}

oracle <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly"))
  on.exit(options(old))
  cl <- cells_of(input$cells)
  len <- vapply(cl$values, length, 0L)
  shift <- if (is.null(params$shift)) 0 else params$shift
  y <- unlist(cl$values) - shift
  A <- factor(rep(cl$levels[, 1], len)); B <- factor(rep(cl$levels[, 2], len))
  C <- factor(rep(cl$levels[, 3], len))
  fit <- lm(y ~ A * B * C)
  an <- car::Anova(fit, type = 3)
  terms <- c("A", "B", "C", "A:B", "A:C", "B:C", "A:B:C", "Residuals")
  sst <- sum((y - mean(y))^2)
  ss <- an[terms, "Sum Sq"]; dfs <- an[terms, "Df"]
  ms <- ss / dfs
  N <- length(y)
  dfr <- fit$df.residual
  mse <- ms[8]
  src <- list(ss = ss, df = dfs, ms = ms, F = an[terms, "F value"], p = an[terms, "Pr(>F)"],
              pctOfTotal = 100 * ss / sst)
  src$F[8] <- NaN; src$p[8] <- NaN
  e <- 1:7
  pe <- ss[e] / (ss[e] + ss[8])
  eff <- list(etaSquared = ss[e] / sst, partialEtaSquared = pe,
              partialOmegaSquared = dfs[e] * (ms[e] - mse) / (dfs[e] * ms[e] + (N - dfs[e]) * mse),
              cohensF = sqrt(pe / (1 - pe)))
  mm <- lapply(list(~A, ~B, ~C), function(f) suppressMessages(summary(emmeans::emmeans(fit, f)))$emmean + shift)
  out <- list(sources = src, effectSizes = eff, ssTotal = sst, mse = mse, dfResidual = dfr,
              marginalMeans = mm)
  if (shift != 0) return(out)

  # Cells in Prism order: A (rows) slowest, then (B, C).
  key <- paste(cl$levels[, 1], cl$levels[, 2], cl$levels[, 3])
  ord <- order(cl$levels[, 1], cl$levels[, 2], cl$levels[, 3])
  means <- vapply(cl$values, mean, 0)[ord]; n <- len[ord]; lv <- cl$levels[ord, , drop = FALSE]
  K <- length(means)
  cmp <- function(pairs) {
    i <- pairs[, 1]; j <- pairs[, 2]
    d <- means[i] - means[j]
    se <- sqrt(mse * (1 / n[i] + 1 / n[j]))
    t <- d / se
    list(i = i - 1, j = j - 1, diff = d, se = se, t = t, raw = 2 * pt(-abs(t), dfr))
  }
  all <- t(combn(K, 2))
  ca <- cmp(all)
  # cross-check the t ratios with emmeans' pooled-error contrasts
  emm <- suppressMessages(emmeans::emmeans(fit, ~ A:B:C))
  pr <- as.data.frame(summary(pairs(emm, adjust = "none")))
  stopifnot(nrow(pr) == nrow(all))
  stopifnot(isTRUE(all.equal(sort(abs(pr$t.ratio)), sort(abs(ca$t)), tolerance = 1e-8)))
  q <- sqrt(2) * abs(ca$t)
  m <- length(q)
  crit_t <- upper_quantile(function(x) ptukey_ref(x, K, dfr, lower = FALSE), 0.05,
                           qtukey(0.95, K, dfr)) / sqrt(2)
  ca$pTukey <- vapply(q, ptukey_ref, 0, k = K, df = dfr, lower = FALSE)
  ca$loTukey <- ca$diff - crit_t * ca$se; ca$hiTukey <- ca$diff + crit_t * ca$se
  ca$pSidak <- pmin(1, sidak_adj(ca$raw, m))
  one <- all[apply(all, 1, function(p) sum(lv[p[1], ] != lv[p[2], ]) == 1), , drop = FALSE]
  co <- cmp(one)
  co$pHolmSidak <- holm_sidak(co$raw)
  co$pSidak <- pmin(1, sidak_adj(co$raw, length(co$raw)))
  ctl <- cbind(1, 2:K)
  cc <- cmp(ctl)
  cc$pSidak <- pmin(1, sidak_adj(cc$raw, K - 1))
  c(out, list(allCells = ca, oneFactor = co, vsControl = cc))
}
