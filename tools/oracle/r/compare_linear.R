# Comparing linear regressions (Prism: "Test whether slopes and intercepts are significantly
# different"; ANCOVA as in Zar, Biostatistical Analysis, ch. 18).
#
# Slopes: anova(parallel lines y ~ x + g, separate lines y ~ x * g).
# Intercepts (only when the slopes don't differ, P >= 0.05, else null): anova(one line y ~ x,
# parallel lines y ~ x + g).
# pooledSlope: the common slope of the parallel-lines model.

PACKAGES <- character(0)

oracle <- function(input, params) {
  ds <- input$datasets
  x <- unlist(ds$x); y <- unlist(ds$y)
  g <- factor(rep(seq_len(nrow(ds)), times = lengths(ds$x)))
  separate <- lm(y ~ x * g)
  parallel <- lm(y ~ x + g)
  one <- lm(y ~ x)
  ftest <- function(a) list(F = a$F[2], dfn = a$Df[2], dfd = a$Res.Df[2], p = a$`Pr(>F)`[2])
  slopes <- ftest(anova(parallel, separate))
  intercepts <- if (slopes$p < 0.05) NULL else ftest(anova(one, parallel))
  list(slopes = slopes, intercepts = intercepts, pooledSlope = unname(coef(parallel)["x"]))
}
