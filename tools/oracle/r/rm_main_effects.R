# Main-effect comparisons of a repeated factor in two-way repeated-measures ANOVA without the
# sphericity assumption (roadmap 51c, S10): each comparison with its own error term (Maxwell &
# Delaney 2004, ch. 12 and 14; the multivariate approach emmeans takes with
# afex's `model = "multivariate"`).
#
# Each subject's mean at each level of the compared factor (over the other factor's levels when
# that one is repeated too); per comparison a - b, one difference per subject:
#   other factor between subjects (G groups): lm(d ~ group, contr.sum): the intercept is the mean
#     of the group means (the least-squares marginal difference), its SE and the residual df
#     n - G;
#   both factors repeated: the paired t test of the subjects' means (t.test(d)).
# The comparisons' covariance (Dunnett's correlations) is the pooled within-group covariance of
# their d's times sum(1/n_g)/G^2. P values and CIs per method: mc_family (ref_rm.R), as every RM
# suite.
#
# input: long format { y, row, col, subject } (complete data). params: repeated, family
# ('mainRows' / 'mainColumns'), comparisons [{ kind: 'allPairs' / 'vsControl', method }].

source(file.path(ORACLE_DIR, "ref_rm.R"))

PACKAGES <- character(0)

as_specs <- function(x) {
  if (is.data.frame(x)) return(lapply(seq_len(nrow(x)), function(i) as.list(x[i, ])))
  x
}

oracle <- function(input, params) {
  d <- data.frame(y = input$y, r = input$row, c = input$col, s = input$subject)
  d <- d[!is.na(d$y), ]
  along <- if (params$family == "mainColumns") "c" else "r"
  other <- if (along == "c") "r" else "c"
  L <- max(d[[along]]) + 1
  subj <- sort(unique(d$s))
  n <- length(subj)
  m <- t(vapply(subj, function(s) vapply(0:(L - 1), function(l)
    mean(d$y[d$s == s & d[[along]] == l]), 0), numeric(L)))
  between <- params$repeated != "both"
  grp <- if (between) vapply(subj, function(s) d[[other]][d$s == s][1], 0) else rep(0, n)
  g <- factor(grp)
  G <- nlevels(g)
  out <- list()
  for (spec in as_specs(params$comparisons)) {
    pairs <- if (spec$kind == "vsControl") lapply(1:(L - 1), function(b) c(0, b)) else
      unlist(lapply(0:(L - 2), function(a) lapply((a + 1):(L - 1), function(b) c(a, b))),
             recursive = FALSE)
    D <- vapply(pairs, function(p) m[, p[1] + 1] - m[, p[2] + 1], numeric(n))
    D <- matrix(D, nrow = n)
    est <- se <- df <- numeric(length(pairs))
    for (q in seq_along(pairs)) {
      if (G > 1) {
        old <- options(contrasts = c("contr.sum", "contr.poly"))
        f <- summary(lm(D[, q] ~ g))
        options(old)
        est[q] <- f$coefficients[1, 1]; se[q] <- f$coefficients[1, 2]; df[q] <- f$df[2]
        stopifnot(abs(est[q] - mean(tapply(D[, q], g, mean))) < 1e-12 * (1 + abs(est[q])))
      } else {
        tt <- t.test(D[, q])
        est[q] <- unname(tt$estimate); se[q] <- unname(tt$stderr); df[q] <- unname(tt$parameter)
      }
    }
    gm <- apply(D, 2, function(col) tapply(col, g, mean))
    gm <- matrix(gm, nrow = G)
    res <- D - gm[as.integer(g), , drop = FALSE]
    ng <- as.vector(table(g))
    V <- crossprod(res) / (n - G) * sum(1 / ng) / G^2
    stopifnot(max(abs(sqrt(diag(V)) - se)) < 1e-10 * max(se))
    lam <- if (spec$method == "dunnett") product_lambdas(cov2cor(V)) else NULL
    r <- mc_family(est, se, df, spec$method, k = L, lam = lam)
    out[[length(out) + 1]] <- list(kind = spec$kind, method = spec$method, diff = r$diff,
                                   se = r$se, df = r$df, stat = r$stat, p = r$p, lo = r$lo,
                                   hi = r$hi, tolP = tol_p(spec$method, df))
  }
  list(comparisons = out)
}
