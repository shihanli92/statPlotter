# Repeated-measures ANOVA with complete data (suite rmanova).
#
# Conventions:
#   one-way RM ANOVA table, "was the matching effective?",
#     R^2 = SS_treatment / (SS_treatment + SS_residual)
#   Geisser-Greenhouse epsilon-hat only (no Huynh-Feldt, no lower bound); the correction
#     multiplies both df
#   one-way comparisons: sphericity assumed -> pooled MS_residual; not assumed -> each comparison
#     of two groups uses only the data in those two groups (essentially a paired t test)
#     (Maxwell & Delaney pp. 552-555)
#   two-way F denominators: between factor / subjects; within and interaction / residual; both
#     repeated: effect / effect x subjects, interaction / residual
#   two-way comparisons always use a pooled error term, df (n-1)(a-1) (one factor repeated) or
#     (n-1)(a-1)(b-1) (both)
#   main-effect comparisons of a repeated factor are disabled when sphericity is not assumed
#
# input: one-way { rows } (subjects x treatments); two-way { y, row, col, subject } (long).
# params: design, sphericity, repeated, interaction, shift (subtracted exactly before fitting),
#         comparisons (list of specs).
#
#   one-way     aov(y ~ t + Error(s/t)) sums of squares; car::Anova(lm(Y ~ 1), idata, idesign,
#               type = 3) univariate tests and GG epsilon (checked against the double-centred
#               covariance formula); matching F = MS_individual / MS_residual.
#   two-way     car::Anova(lm(Y ~ A), idata, idesign = ~B, type = 3) (one factor repeated, Type III
#               with contr.sum for unequal group sizes) or car::Anova(lm(Y ~ 1), idesign = ~R*C)
#               (both repeated): SS, df, F, P, GG epsilon per within effect. Subjects row:
#               SS = error SS of the between (intercept) stratum, F = MS_subjects / MS_residual.
#   comparisons (hand-coded): the mixed model's SEs with the ANOVA (moment) variance estimates:
#               one factor repeated (A between with n_g subjects, B within):
#                 B within A_g: 2 MS_res / n_g; B main: 2 MS_res (1/a^2) sum 1/n_g;
#                 A within B_w: (MS_subj + (b-1) MS_res)/b (1/n_g + 1/n_h); A main: MS_subj/b (..)
#               both repeated: cells within a row: 2 (MS_CxS + (R-1) MS_res)/(R n); column main:
#                 2 MS_CxS/(R n); symmetrically for rows.
#               df: "containment" = the df of the effect's error (cells -> residual df, main effects
#               -> their error df); "satterthwaite" = Satterthwaite's df of the combined MS.
#               Cross-checked (SE to 1e-6, df to 1e-4) with emmeans on lmer/lmerTest fits when
#               the REML variance components are interior (then REML = ANOVA estimates).
#               One-way pooled: SE = sqrt(2 MS_res / n), df (k-1)(n-1) (cross-checked likewise);
#               paired ('gg'): SE = SD(d)/sqrt(n), df n - 1 (checked with t.test(paired = TRUE)).
#               P values: Tukey from ptk (ref_rm.R; matches ptukey_ref of ref_integrals.R to
#               ~1e-14, unlike R's ptukey at small df), CI critical value by uniroot on it; Dunnett from the product-correlation reference pdun (ref_rm.R) with lambda
#               from the group sizes (exact for the pooled cases); for paired differences the
#               equal-n distribution (lambda = sqrt(1/2)) with df n - 1 (the differences' own
#               correlations are ignored; with small n they are far from product form);
#               Sidak/Bonferroni/Holm-Sidak/Fisher/BKY closed forms.
#
# Choices of ours: epsilon is reported whenever sphericity is 'gg'; the
# Subjects F in two-way designs (the table shows a P for subjects; the denominator
# MS_residual is our reading); main-effect comparisons for the between factor use MS_subjects;
# Satterthwaite-vs-residual df for comparisons of the between factor at one level of the
# within factor (no published formula).

source(file.path(ORACLE_DIR, "ref_rm.R"))

PACKAGES <- c("car", "lme4", "lmerTest", "emmeans")

suppressPackageStartupMessages({
  library(lme4)
  library(lmerTest)
})

pairs_for <- function(spec, k) {
  if (!is.null(spec$pairs)) {
    p <- spec$pairs
    return(if (is.matrix(p)) lapply(seq_len(nrow(p)), function(i) p[i, ]) else p)
  }
  if (spec$method == "dunnett") return(lapply(setdiff(0:(k - 1), spec$control), function(j) c(spec$control, j)))
  all_pairs(k)
}

all_pairs <- function(k) {
  out <- list()
  for (i in 0:(k - 2)) for (j in (i + 1):(k - 1)) out[[length(out) + 1]] <- c(i, j)
  out
}

close_enough <- function(a, b, rtol, what) {
  if (!isTRUE(all(abs(a - b) <= rtol * pmax(abs(b), 1e-300) + 1e-300)))
    stop(what, ": ", paste(format(a, digits = 15), collapse = " "), " vs ",
         paste(format(b, digits = 15), collapse = " "))
}

tight_lmer <- function(formula, data) {
  lmer(formula, data, REML = TRUE,
       control = lmerControl(optimizer = "bobyqa", optCtrl = list(rhoend = 1e-12, maxfun = 1e5),
                             check.conv.singular = "ignore"))
}

# ---- one-way ------------------------------------------------------------------------------------
oneway <- function(input, params) {
  shift <- if (is.null(params$shift)) 0 else params$shift
  Y <- input$rows - shift
  n <- nrow(Y); k <- ncol(Y)
  d <- data.frame(y = as.vector(t(Y)), s = factor(rep(1:n, each = k)), t = factor(rep(1:k, n)))
  su <- summary(aov(y ~ t + Error(s / t), d))
  ssS <- su[["Error: s"]][[1]][["Sum Sq"]]
  within <- su[["Error: s:t"]][[1]]
  ssT <- within["t", "Sum Sq"]; ssE <- within["Residuals", "Sum Sq"]
  dfT <- k - 1; dfS <- n - 1; dfE <- dfT * dfS
  msT <- ssT / dfT; msS <- ssS / dfS; msE <- ssE / dfE
  F <- msT / msE
  p <- pf(F, dfT, dfE, lower.tail = FALSE)
  av <- car::Anova(lm(Y ~ 1), idata = data.frame(t = factor(1:k)), idesign = ~t, type = 3)
  s <- summary(av, multivariate = FALSE)
  ut <- s$univariate.tests
  close_enough(ut["t", "Sum Sq"], ssT, 1e-10, "car SS")
  close_enough(ut["t", "F value"], F, 1e-10, "car F")
  # GG epsilon: double-centred covariance
  E <- scale(Y, scale = FALSE); E <- E - rowMeans(E)
  S <- crossprod(E)
  eps <- sum(diag(S))^2 / (dfT * sum(S^2))
  # Same epsilon from orthonormal contrasts (Box 1954): tr(C'SC)^2 / ((k-1) tr((C'SC)^2)).
  Cm <- qr.Q(qr(contr.helmert(k)))
  S2 <- t(Cm) %*% cov(Y) %*% Cm
  close_enough(sum(diag(S2))^2 / (dfT * sum(S2^2)), eps, 1e-10, "contrast GG eps")
  if (k > 2 && !is.na(s$pval.adjustments["t", "GG eps"])) {
    close_enough(s$pval.adjustments["t", "GG eps"], eps, 1e-10, "car GG eps")
  }
  if (k == 2) stopifnot(abs(eps - 1) < 1e-14)
  ssTot <- sum((Y - mean(Y))^2)
  out <- list(
    kind = "anova",
    treatment = list(F = F, dfn = dfT, dfd = dfE, p = p),
    epsilon = eps,
    corrected = if (params$sphericity == "gg") list(dfn = eps * dfT, dfd = eps * dfE,
                                                    p = pf(F, eps * dfT, eps * dfE, lower.tail = FALSE)),
    table = list(ss = c(ssT, ssS, ssE, ssTot), df = c(dfT, dfS, dfE, n * k - 1),
                 ms = c(msT, msS, msE, NaN), F = c(F, msS / msE, NaN, NaN),
                 p = c(p, pf(msS / msE, dfS, dfE, lower.tail = FALSE), NaN, NaN)),
    matching = list(F = msS / msE, p = pf(msS / msE, dfS, dfE, lower.tail = FALSE),
                    effective = pf(msS / msE, dfS, dfE, lower.tail = FALSE) < 0.05),
    rSquared = ssT / (ssT + ssE),
    means = colMeans(Y) + shift,
    n = rep(n, k))
  if (params$sphericity == "gg" && k > 2 && !is.na(s$pval.adjustments["t", "GG eps"])) {
    close_enough(s$pval.adjustments["t", "Pr(>F[GG])"], out$corrected$p, 1e-9, "car GG p")
  }
  interior <- msS > msE
  if (interior && shift == 0) {
    fm <- tight_lmer(y ~ t + (1 | s), d)
    em <- as.data.frame(summary(pairs(emmeans::emmeans(fm, ~t, lmer.df = "satterthwaite"),
                                      adjust = "none")))
    close_enough(em$SE, rep(sqrt(2 * msE / n), nrow(em)), 1e-6, "emmeans pooled SE")
    close_enough(em$df, rep(dfE, nrow(em)), 1e-4, "emmeans pooled df")
  }
  cmp <- list()
  sph <- if (params$sphericity == "gg") c("assumed", "gg") else "assumed"
  for (spec in as_specs(params$comparisons)) for (sp in sph) {
    pr <- pairs_for(spec, k)
    i <- vapply(pr, `[`, 0, 1); j <- vapply(pr, `[`, 0, 2)
    m <- colMeans(Y)
    diff <- m[i + 1] - m[j + 1]
    if (sp == "assumed") {
      se <- rep(sqrt(2 * msE / n), length(i)); df <- rep(dfE, length(i))
      R <- outer(seq_along(i), seq_along(i), Vectorize(function(a, b)
        ((i[a] == i[b]) - (i[a] == j[b]) - (j[a] == i[b]) + (j[a] == j[b])) / 2))
    } else {
      D <- sapply(seq_along(i), function(a) Y[, i[a] + 1] - Y[, j[a] + 1])
      D <- matrix(D, nrow = n)
      se <- apply(D, 2, sd) / sqrt(n); df <- rep(n - 1, length(i))
      tt <- vapply(seq_along(i), function(a) t.test(Y[, i[a] + 1], Y[, j[a] + 1], paired = TRUE)$statistic, 0)
      close_enough(diff / se, tt, 1e-10, "paired t")
      R <- cor(D)
    }
    # Dunnett: product correlation from the comparisons (pooled: exactly 1/2); paired: the
    # equal-n distribution (lambda = sqrt(1/2)) with df n - 1, as the TS code.
    lam <- if (spec$method == "dunnett") rep(sqrt(0.5), length(i)) else NULL
    kk <- length(unique(c(i, j)))
    res <- mc_family(diff, se, df, spec$method, k = kk, lam = lam)
    res$i <- i; res$j <- j
    entry <- c(list(sphericity = sp, method = spec$method), res)
    entry$tolP <- tol_p(spec$method, df)
    cmp[[length(cmp) + 1]] <- entry
  }
  out$comparisons <- cmp
  out
}

# ---- two-way ------------------------------------------------------------------------------------
twoway <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  rep_ <- params$repeated
  d <- data.frame(y = input$y, r = input$row, c = input$col, s = input$subject)
  R <- max(d$r) + 1; C <- max(d$c) + 1
  subj <- sort(unique(d$s))
  cellMeans <- matrix(tapply(d$y, list(factor(d$r, 0:(R - 1)), factor(d$c, 0:(C - 1))), mean), R, C)
  cellN <- matrix(as.vector(table(factor(d$r, 0:(R - 1)), factor(d$c, 0:(C - 1)))), R, C)
  src <- list()
  add_src <- function(key, ss, df, errSS = NA, errDf = NA, eps = NULL) {
    ms <- ss / df
    e <- list(key = key, ss = ss, df = df, ms = ms)
    if (!is.na(errSS)) {
      Fv <- ms / (errSS / errDf)
      e$F <- Fv; e$p <- pf(Fv, df, errDf, lower.tail = FALSE); e$dfd <- errDf
      if (!is.null(eps)) {
        e$epsilon <- eps
        if (params$sphericity == "gg") e$pCorrected <- pf(Fv, eps * df, eps * errDf, lower.tail = FALSE)
      }
    } else {
      e$F <- NaN; e$p <- NaN
    }
    src[[length(src) + 1]] <<- e
  }
  if (rep_ == "both") {
    n <- length(subj)
    Y <- t(vapply(subj, function(s) {
      x <- d[d$s == s, ]
      x$y[order(x$r, x$c)]
    }, numeric(R * C)))
    idata <- expand.grid(C = factor(1:C), R = factor(1:R))  # column order (r, c), c fastest
    av <- car::Anova(lm(Y ~ 1), idata = idata, idesign = ~R * C, type = 3)
    s <- summary(av, multivariate = FALSE)
    ut <- s$univariate.tests
    adj <- s$pval.adjustments
    ge <- function(term, lev) if (lev > 2) adj[term, "GG eps"] else 1
    ssE <- ut["R:C", "Error SS"]; dfE <- ut["R:C", "den Df"]
    add_src("interaction", ut["R:C", "Sum Sq"], ut["R:C", "num Df"], ssE, dfE,
            if (R > 2 || C > 2) adj["R:C", "GG eps"] else 1)
    add_src("row", ut["R", "Sum Sq"], ut["R", "num Df"], ut["R", "Error SS"], ut["R", "den Df"], ge("R", R))
    add_src("column", ut["C", "Sum Sq"], ut["C", "num Df"], ut["C", "Error SS"], ut["C", "den Df"], ge("C", C))
    add_src("subjects", ut["(Intercept)", "Error SS"], n - 1, ssE, dfE)
    add_src("rowSubjects", ut["R", "Error SS"], ut["R", "den Df"])
    add_src("columnSubjects", ut["C", "Error SS"], ut["C", "den Df"])
    add_src("residual", ssE, dfE)
    ms <- list(RS = ut["R", "Error SS"] / ut["R", "den Df"], dfRS = ut["R", "den Df"],
               CS = ut["C", "Error SS"] / ut["C", "den Df"], dfCS = ut["C", "den Df"],
               E = ssE / dfE, dfE = dfE, n = n)
    # aov cross-check (balanced)
    ao <- summary(aov(y ~ factor(r) * factor(c) + Error(factor(s) / (factor(r) * factor(c))), d))
    close_enough(ao[["Error: factor(s):factor(r):factor(c)"]][[1]]["Residuals", "Sum Sq"], ssE, 1e-10, "aov SSE")
    fitf <- y ~ r * c + (1 | s) + (1 | s:r) + (1 | s:c)
  } else {
    betweenIsRow <- rep_ == "columns"
    a <- if (betweenIsRow) R else C
    b <- if (betweenIsRow) C else R
    grp <- vapply(subj, function(s) (if (betweenIsRow) d$r else d$c)[d$s == s][1], 0)
    Y <- t(vapply(subj, function(s) {
      x <- d[d$s == s, ]
      x$y[order(if (betweenIsRow) x$c else x$r)]
    }, numeric(b)))
    A <- factor(grp)
    av <- car::Anova(lm(Y ~ A), idata = data.frame(B = factor(1:b)), idesign = ~B, type = 3)
    s <- summary(av, multivariate = FALSE)
    ut <- s$univariate.tests
    adj <- s$pval.adjustments
    epsB <- if (b > 2) adj["B", "GG eps"] else 1
    ssE <- ut["B", "Error SS"]; dfE <- ut["B", "den Df"]
    ssS <- ut["A", "Error SS"]; dfS <- ut["A", "den Df"]
    key_between <- if (betweenIsRow) "row" else "column"
    key_within <- if (betweenIsRow) "column" else "row"
    add_src("interaction", ut["A:B", "Sum Sq"], ut["A:B", "num Df"], ssE, dfE, epsB)
    bet <- list(key_between, ut["A", "Sum Sq"], ut["A", "num Df"], ssS, dfS)
    wit <- list(key_within, ut["B", "Sum Sq"], ut["B", "num Df"], ssE, dfE, epsB)
    if (betweenIsRow) { do.call(add_src, bet); do.call(add_src, wit) } else { do.call(add_src, wit); do.call(add_src, bet) }
    add_src("subjects", ssS, dfS, ssE, dfE)
    add_src("residual", ssE, dfE)
    ng <- as.vector(table(factor(grp, 0:(a - 1))))
    ms <- list(S = ssS / dfS, dfS = dfS, E = ssE / dfE, dfE = dfE, ng = ng, a = a, b = b,
               betweenIsRow = betweenIsRow)
    fitf <- y ~ r * c + (1 | s)
  }
  out <- list(kind = "anova", sources = src, cellMeans = cellMeans, cellN = cellN)
  # comparisons
  interior <- NULL
  cmp <- list()
  for (spec in as_specs(params$comparisons)) {
    for (ddf in c("containment", "satterthwaite")) {
      cmp[[length(cmp) + 1]] <- c(list(ddf = ddf), spec,
                                  anova_family(spec, ddf, rep_, R, C, cellMeans, ms))
    }
  }
  # emmeans cross-check of SE and Satterthwaite df when the REML fit is interior
  dd <- transform(d, r = factor(r), c = factor(c), s = factor(s))
  fm <- tight_lmer(fitf, dd)
  if (all(as.data.frame(VarCorr(fm))$vcov > 1e-6)) {
    for (e in cmp) if (e$ddf == "satterthwaite") check_emmeans(fm, e, dd)
  }
  out$comparisons <- cmp
  out
}

# Rows of one comparison spec: returns a list of columns (diff, se, df, t, stat, p, lo, hi,
# rowA, rowB, colA, colB).
anova_family <- function(spec, ddf, rep_, R, C, cm, ms) {
  fam <- spec$family
  simple <- fam %in% c("withinRows", "withinColumns")
  alongCols <- fam %in% c("withinRows", "mainColumns")
  L <- if (alongCols) C else R
  outer_n <- if (simple) (if (alongCols) R else C) else 1
  control <- if (is.null(spec$control)) 0 else spec$control
  lp <- if (spec$kind == "vsControl") lapply(setdiff(0:(L - 1), control), function(k) c(control, k)) else all_pairs(L)
  sat <- function(parts) {  # list of c(coef, ms, df)
    V <- sum(vapply(parts, function(x) x[1] * x[2], 0))
    list(V = V, df = V^2 / sum(vapply(parts, function(x) (x[1] * x[2])^2 / x[3], 0)))
  }
  # V, df, weight(r, c) (r or c may be -1 for marginal means)
  if (rep_ == "both") {
    n <- ms$n
    if (simple) {
      if (fam == "withinRows") { e <- ms$CS; edf <- ms$dfCS; other <- R } else { e <- ms$RS; edf <- ms$dfRS; other <- C }
      sv <- sat(list(c(1 / other, e, edf), c((other - 1) / other, ms$E, ms$dfE)))
      V <- sv$V; df <- if (ddf == "satterthwaite") sv$df else ms$dfE
    } else {
      if (fam == "mainColumns") { V <- ms$CS / R; df <- ms$dfCS } else { V <- ms$RS / C; df <- ms$dfRS }
    }
    w <- function(r, c) 1 / n
  } else {
    grp_of <- function(r, c) if (ms$betweenIsRow) r else c
    withinFam <- if (ms$betweenIsRow) fam %in% c("withinRows", "mainColumns") else fam %in% c("withinColumns", "mainRows")
    if (withinFam) {
      V <- ms$E; df <- ms$dfE
      w <- if (simple) function(r, c) 1 / ms$ng[grp_of(r, c) + 1] else function(r, c) sum(1 / ms$ng) / ms$a^2
    } else if (simple) {
      sv <- sat(list(c(1 / ms$b, ms$S, ms$dfS), c((ms$b - 1) / ms$b, ms$E, ms$dfE)))
      V <- sv$V; df <- if (ddf == "satterthwaite") sv$df else ms$dfE
      w <- function(r, c) 1 / ms$ng[grp_of(r, c) + 1]
    } else {
      V <- ms$S / ms$b; df <- ms$dfS
      w <- function(r, c) 1 / ms$ng[grp_of(r, c) + 1]
    }
  }
  mean_of <- function(r, c) {
    if (r >= 0 && c >= 0) return(cm[r + 1, c + 1])
    if (r >= 0) return(mean(cm[r + 1, ]))
    mean(cm[, c + 1])
  }
  cols <- list()
  families <- list()
  for (o in seq_len(outer_n) - 1) {
    rc <- lapply(lp, function(pq) {
      mk <- function(l) if (simple) (if (alongCols) c(o, l) else c(l, o)) else (if (alongCols) c(-1, l) else c(l, -1))
      list(A = mk(pq[1]), B = mk(pq[2]))
    })
    diff <- vapply(rc, function(x) mean_of(x$A[1], x$A[2]) - mean_of(x$B[1], x$B[2]), 0)
    wa <- vapply(rc, function(x) w(x$A[1], x$A[2]), 0)
    wb <- vapply(rc, function(x) w(x$B[1], x$B[2]), 0)
    se <- sqrt(V * (wa + wb))
    lam <- if (spec$method == "dunnett") sqrt(wa / (wa + wb)) else NULL  # A = control
    families[[length(families) + 1]] <- list(rc = rc, diff = diff, se = se, df = rep(df, length(diff)), lam = lam)
  }
  single <- isTRUE(spec$singleFamily) && !(spec$method %in% c("tukey", "dunnett"))
  res <- if (single) {
    all <- list(diff = unlist(lapply(families, `[[`, "diff")), se = unlist(lapply(families, `[[`, "se")),
                df = unlist(lapply(families, `[[`, "df")))
    list(mc_family(all$diff, all$se, all$df, spec$method, k = L))
  } else {
    lapply(families, function(f) mc_family(f$diff, f$se, f$df, spec$method, k = L, lam = f$lam))
  }
  cat_ <- function(field) unlist(lapply(res, `[[`, field))
  rc <- unlist(lapply(families, `[[`, "rc"), recursive = FALSE)
  out <- list(diff = cat_("diff"), se = cat_("se"), df = cat_("df"), t = cat_("t"), stat = cat_("stat"),
              p = cat_("p"), lo = cat_("lo"), hi = cat_("hi"))
  if (simple || !alongCols) { out$rowA <- vapply(rc, function(x) x$A[1], 0); out$rowB <- vapply(rc, function(x) x$B[1], 0) }
  if (simple || alongCols) { out$colA <- vapply(rc, function(x) x$A[2], 0); out$colB <- vapply(rc, function(x) x$B[2], 0) }
  out$tolP <- tol_p(spec$method, out$df)
  out
}

check_emmeans <- function(fm, e, dd) {
  fam <- e$family
  spec <- switch(fam, withinRows = ~ c | r, withinColumns = ~ r | c, mainRows = ~ r, mainColumns = ~ c)
  em <- suppressMessages(emmeans::emmeans(fm, spec, lmer.df = "satterthwaite", data = dd))
  pr <- as.data.frame(summary(pairs(em, adjust = "none")))
  # emmeans labels "c1 - c2" (levels 0-based as factors of the data values)
  lab <- strsplit(as.character(pr$contrast), " - ")
  a <- as.numeric(sub("^[rc]", "", vapply(lab, `[`, "", 1)))
  b <- as.numeric(sub("^[rc]", "", vapply(lab, `[`, "", 2)))
  by <- if (fam == "withinRows") as.numeric(as.character(pr$r)) else if (fam == "withinColumns") as.numeric(as.character(pr$c)) else rep(-1, nrow(pr))
  A <- if (fam %in% c("withinRows", "mainColumns")) e$colA else e$rowA
  B <- if (fam %in% c("withinRows", "mainColumns")) e$colB else e$rowB
  O <- if (fam == "withinRows") e$rowA else if (fam == "withinColumns") e$colA else rep(-1, length(A))
  for (x in seq_along(A)) {
    hit <- which(((a == A[x] & b == B[x]) | (a == B[x] & b == A[x])) & by == O[x])
    stopifnot(length(hit) == 1)
    close_enough(pr$SE[hit], e$se[x], 1e-6, paste("emmeans SE", fam))
    close_enough(pr$df[hit], e$df[x], 1e-4, paste("emmeans df", fam))
  }
}

oracle <- function(input, params) {
  if (params$design == "oneway") oneway(input, params) else twoway(input, params)
}
