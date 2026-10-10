# Mixed-effects models for repeated measures with missing values (suite mixed), as GraphPad
# Prism fits them "instead of" RM ANOVA.
#
# What Prism documents (Prism 11 Statistics Guide and knowledge base):
#   stat_how-to-report-the-methods-used.htm: "This mixed model uses a compound symmetry
#     covariance matrix, and is fit using Restricted Maximum Likelihood (REML)".
#   stat_repeated-measures-tab1way.htm: with no missing values "the two are completely
#     equivalent"; a subject variance estimated at zero or negative makes them differ.
#   FAQ 2211 (updated-reml-calculation-method-920): variances are constrained positive; Prism
#     tries two sets of starting values and keeps the best fit.
#   FAQ 2103 / 2104 (R and SAS code "so they can understand what Prism is doing"):
#     one-way:  PROC MIXED METHOD=REML; MODEL effort=Type; RANDOM Int / SUBJECT=Subject;
#               lmer(effort ~ Type + (1|Subject)) with contr.sum
#     two-way, both factors repeated: RANDOM Int A B / SUBJECT=S (subject, A x subject,
#               B x subject)
#   stat_interpreting-results-mixed-mod.htm: fixed-effect P value; random-effect SD and variance;
#     "was the matching effective?" by a chi-square comparing the full model with one without
#     the repeated-measures random effect(s); GG correction applies to mixed fits too
#     (stat_notes-for-a-statistical-consul.htm: "The Geisser-Greenhouse correction only changes
#     the degrees of freedom").
# NOT documented: the denominator df of the F tests and comparisons, and how epsilon is
# estimated with missing values. We provide both df methods and test both:
#   containment    SAS's default for the published SAS code (DDFM=CONTAIN): the smallest rank
#                  contribution to [X Z] of the random terms containing the effect (subject for
#                  the between-subjects factor, subject x row / subject x column for the
#                  factors of a both-repeated design), else the residual df N - rank([X Z]).
#                  Equals the RM ANOVA df with complete data, and matches the guide's
#                  "(n-1)(a-1)(b-1)" df for comparisons after two-way RM ANOVA. The rank
#                  contribution is taken as the drop in rank when the term is removed (SAS's
#                  exact definition for unbalanced designs is an open question).
#   satterthwaite  lmerTest's method (cross-checked).
# The TS default is containment. No GG correction is computed for mixed fits.
#
# input: one-way { rows } with null = missing; two-way { y, row, col, subject } with null y.
# Model: sum-to-zero coded fixed effects (cell means for two-way with interaction), random
# intercepts per subject (and subject x row, subject x column when both factors are repeated),
# REML with variances >= 0.
#
# Reference values: reml_dense (ref_rm.R), a dense Newton solver of the profiled REML score
# equations started from lme4's estimate, polished to a gradient of ~1e-12 (or held on the
# boundary 0 when the gradient points outward). Cross-checks per case:
#   lme4::lmer (bobyqa, rhoend 1e-12): variance components (rel 1e-5), logLik (1e-8 abs);
#   nlme::lme (one random term): variances (rel 1e-4);
#   lmerTest anova(type 3) Satterthwaite F and DenDF (rel 1e-6 / 1e-3: lmerTest differentiates
#     numerically at lme4's optimum);
#   emmeans (lmer.df = "satterthwaite"): least-squares means, SEs (1e-5) and df (1e-3) of the
#     comparisons.
# Tolerance: the TS and R optima agree to ~1e-14 relative; fixtures are compared at rtol 1e-10.
#
# Comparisons: diff = difference of least-squares means (cell means, or marginal means averaged
# over the other factor), SE from the model covariance; df = containment df of the effect (cell
# comparisons with the full model: the residual/interaction df; main effects and the additive
# model: the factor's df) or Satterthwaite per comparison. P values as in rmanova.R; Dunnett
# with lambda from the least-squares product fit to the comparisons' correlations (as the TS).

source(file.path(ORACLE_DIR, "ref_rm.R"))

PACKAGES <- c("lme4", "lmerTest", "nlme", "emmeans")

suppressPackageStartupMessages({
  library(lme4)
  library(lmerTest)
})

close_enough <- function(a, b, rtol, what, atol = 1e-300) {
  if (!isTRUE(all(abs(a - b) <= rtol * pmax(abs(b), 1e-300) + atol)))
    stop(what, ": ", paste(format(a, digits = 15), collapse = " "), " vs ",
         paste(format(b, digits = 15), collapse = " "))
}

tight_lmer <- function(formula, data) {
  lmer(formula, data, REML = TRUE,
       control = lmerControl(optimizer = "bobyqa", optCtrl = list(rhoend = 1e-12, maxfun = 1e5),
                             check.conv.singular = "ignore"))
}

all_pairs <- function(k) {
  out <- list()
  for (i in 0:(k - 2)) for (j in (i + 1):(k - 1)) out[[length(out) + 1]] <- c(i, j)
  out
}

# Fit reference + cross-checks. d: data.frame(y, ...); X, Zs; lmer formula; lme random.
fit_all <- function(d, X, Zs, form, lme_random = NULL) {
  fm <- tight_lmer(form, d)
  th <- getME(fm, "theta")
  grp <- c("s", "sr", "sc")[seq_along(Zs)]  # lme4 orders terms by number of levels
  th <- th[paste0(grp, ".(Intercept)")]
  f <- reml_dense(d$y, X, Zs, start = unname(th)^2)
  # optimum: gradient ~ 0 on free components, >= 0 on the boundary
  free <- f$rho > 0
  stopifnot(all(abs(f$grad[free]) < 1e-8), all(f$grad[!free] >= -1e-10))
  vc <- as.data.frame(VarCorr(fm))
  lme4_var <- vc$vcov
  ref_var <- c(f$rho * f$s2, f$s2)
  # lme4's term order differs from ours: match by value set is fragile; compare residual and sum
  close_enough(sigma(fm)^2, f$s2, 1e-5, "lmer sigma^2")
  close_enough(sum(lme4_var), sum(ref_var), 1e-5, "lmer total variance")
  close_enough(as.numeric(logLik(fm)), f$logLik, 0, "lmer logLik", atol = 1e-7)
  stopifnot(f$logLik >= as.numeric(logLik(fm)) - 1e-10)
  if (!is.null(lme_random)) {
    dd <- d
    dd$Xm <- X[, -1, drop = FALSE]
    lm_ <- nlme::lme(y ~ Xm, random = lme_random, data = dd, method = "REML",
                     control = nlme::lmeControl(tolerance = 1e-12, msTol = 1e-12, niterEM = 200,
                                                msMaxIter = 500))
    close_enough(lm_$sigma^2, f$s2, 1e-4, "lme sigma^2")
  }
  list(f = f, fm = fm)
}

logLik0 <- function(y, X) {
  N <- length(y); p <- ncol(X)
  s2 <- sum(lm.fit(X, y)$residuals^2) / (N - p)
  -0.5 * ((N - p) * (1 + log(2 * pi * s2)) + as.numeric(determinant(crossprod(X))$modulus))
}

# F test of the coefficient block `idx` (Type III with contr.sum): containment and Satterthwaite.
ftest <- function(f, idx, X, Zs, containing, fm = NULL, term = NULL) {
  L <- matrix(0, length(idx), ncol(X)); L[cbind(seq_along(idx), idx)] <- 1
  b <- f$beta[idx]
  Fv <- drop(t(b) %*% solve(f$cov[idx, idx, drop = FALSE], b)) / length(idx)
  sf <- satt_F(f, L)
  close_enough(sf$F, Fv, 1e-10, "F via eigen")
  cdf <- containment(X, Zs, containing)
  if (!is.null(fm)) {
    an <- anova(fm, type = 3, ddf = "Satterthwaite")
    close_enough(an[term, "F value"], Fv, 1e-5, paste("lmerTest F", term))
    close_enough(an[term, "DenDF"], sf$dfd, 2e-3, paste("lmerTest DenDF", term))
  }
  list(containment = list(F = Fv, dfn = length(idx), dfd = cdf,
                          p = pf(Fv, length(idx), cdf, lower.tail = FALSE)),
       satterthwaite = list(F = Fv, dfn = length(idx), dfd = sf$dfd,
                            p = pf(Fv, length(idx), sf$dfd, lower.tail = FALSE)))
}

# Comparisons of contrasts `ls` (rows) within one family.
family_rows <- function(f, ls, method, k, ddf, cdf) {
  ls <- rbind(ls)
  est <- drop(ls %*% f$beta)
  V <- ls %*% f$cov %*% t(ls)
  se <- sqrt(diag(V))
  df <- if (ddf == "satterthwaite") satt_dense(f, ls) else rep(cdf, nrow(ls))
  lam <- if (method == "dunnett") product_lambdas(abs(cov2cor(V))) else NULL
  mc_family(est, se, df, method, k = k, lam = lam)
}

# ---- one-way ------------------------------------------------------------------------------------
oneway <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  Y <- input$rows
  keep <- rowSums(!is.na(Y)) > 0
  Y <- Y[keep, , drop = FALSE]
  n <- nrow(Y); k <- ncol(Y)
  shift <- t(Y)[!is.na(t(Y))][1]
  d <- data.frame(y = as.vector(t(Y)) - shift, s = factor(rep(1:n, each = k)), t = factor(rep(1:k, n)))
  d <- d[!is.na(d$y), ]
  X <- model.matrix(~t, d)
  Zs <- list(model.matrix(~ 0 + s, d))
  r <- fit_all(d, X, Zs, y ~ t + (1 | s), lme_random = ~ 1 | s)
  f <- r$f
  close_enough(as.data.frame(VarCorr(r$fm))$vcov[1], f$rho * f$s2, 1e-5, "lmer subject var", atol = 1e-8)
  tt <- ftest(f, 2:k, X, Zs, integer(0), r$fm, "t")
  codes <- contr.sum(k)
  xrow <- function(j) c(1, codes[j + 1, ])
  means <- vapply(0:(k - 1), function(j) sum(xrow(j) * f$beta), 0) + shift
  em <- as.data.frame(summary(emmeans::emmeans(r$fm, ~t)))
  close_enough(em$emmean + shift, means, 1e-6, "emmeans means")
  ll0 <- logLik0(d$y, X)
  close_enough(as.numeric(logLik(lm(y ~ t, d), REML = TRUE)), ll0, 0, "lm REML logLik", atol = 1e-9)
  chi2 <- max(0, 2 * (f$logLik - ll0))
  out <- list(
    kind = "mixed",
    treatment = tt$containment,
    treatmentSatterthwaite = tt$satterthwaite,
    mixed = list(subjectVariance = f$rho * f$s2, residualVariance = f$s2, logLik = f$logLik,
                 nObs = nrow(d), nSubjects = n,
                 matching = list(chi2 = chi2, df = 1, p = pchisq(chi2, 1, lower.tail = FALSE))),
    means = means,
    n = colSums(!is.na(Y)),
    boundary = f$rho[1] == 0)
  cdf <- containment(X, Zs)
  cmp <- list()
  for (spec in as_specs(params$comparisons)) for (ddf in c("containment", "satterthwaite")) {
    pr <- if (!is.null(spec$pairs)) spec$pairs else if (spec$method == "dunnett")
      lapply(setdiff(0:(k - 1), spec$control), function(j) c(spec$control, j)) else all_pairs(k)
    i <- vapply(pr, `[`, 0, 1); j <- vapply(pr, `[`, 0, 2)
    ls <- t(vapply(seq_along(i), function(a) xrow(i[a]) - xrow(j[a]), numeric(k)))
    res <- family_rows(f, ls, spec$method, length(unique(c(i, j))), ddf, cdf)
    if (ddf == "satterthwaite" && spec$method != "dunnett") {
      em <- as.data.frame(summary(pairs(emmeans::emmeans(r$fm, ~t, lmer.df = "satterthwaite"),
                                        adjust = "none")))
      lab <- paste0("t", i + 1, " - t", j + 1)
      hit <- match(lab, as.character(em$contrast))
      close_enough(em$SE[hit], res$se, 1e-5, "emmeans SE")
      close_enough(em$df[hit], res$df, 2e-3, "emmeans df")
    }
    cmp[[length(cmp) + 1]] <- c(list(ddf = ddf, method = spec$method, i = i, j = j), res,
                                list(tolP = tol_p(spec$method, res$df)))
  }
  out$comparisons <- cmp
  out
}

# ---- two-way ------------------------------------------------------------------------------------
twoway <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  rep_ <- params$repeated
  inter <- isTRUE(params$interaction)
  d0 <- data.frame(y = input$y, r = input$row, c = input$col, s = input$subject)
  R <- max(d0$r) + 1; C <- max(d0$c) + 1
  d <- d0[!is.na(d0$y), ]
  shift <- d$y[1]
  d$y <- d$y - shift
  d$r <- factor(d$r, 0:(R - 1)); d$c <- factor(d$c, 0:(C - 1)); d$s <- factor(d$s)
  X <- if (inter) model.matrix(~ r * c, d) else model.matrix(~ r + c, d)
  Zs <- list(model.matrix(~ 0 + s, d))
  form <- if (inter) y ~ r * c + (1 | s) else y ~ r + c + (1 | s)
  vnames <- "subject"
  if (rep_ == "both") {
    d$sr <- interaction(d$s, d$r, drop = TRUE); d$sc <- interaction(d$s, d$c, drop = TRUE)
    Zs <- c(Zs, list(model.matrix(~ 0 + sr, d), model.matrix(~ 0 + sc, d)))
    form <- update(form, . ~ . + (1 | sr) + (1 | sc))
    vnames <- c("subject", "subjectRow", "subjectColumn")
  }
  r <- fit_all(d, X, Zs, form, lme_random = if (rep_ == "both") NULL else ~ 1 | s)
  f <- r$f
  vc <- as.data.frame(VarCorr(r$fm))
  lme_names <- c(subject = "s", subjectRow = "sr", subjectColumn = "sc")
  for (t in seq_along(vnames)) {
    close_enough(vc$vcov[vc$grp == lme_names[vnames[t]]], f$rho[t] * f$s2, 1e-5,
                 paste("lmer var", vnames[t]), atol = 1e-8)
  }
  rows_idx <- 2:R; cols_idx <- (R + 1):(R + C - 1)
  int_idx <- if (inter) (R + C):ncol(X) else integer(0)
  cont_row <- switch(rep_, both = 2L, columns = 1L, rows = integer(0))
  cont_col <- switch(rep_, both = 3L, columns = integer(0), rows = 1L)
  src <- list()
  add <- function(key, idx, containing, term) {
    tt <- ftest(f, idx, X, Zs, containing, r$fm, term)
    src[[length(src) + 1]] <<- c(list(key = key), tt$containment,
                                 list(satterthwaite = tt$satterthwaite))
  }
  if (inter) add("interaction", int_idx, integer(0), "r:c")
  add("row", rows_idx, cont_row, "r")
  add("column", cols_idx, cont_col, "c")
  # design row of a cell, and least-squares means
  nd <- expand.grid(c = factor(0:(C - 1), 0:(C - 1)), r = factor(0:(R - 1), 0:(R - 1)))
  Xc <- if (inter) model.matrix(~ r * c, nd) else model.matrix(~ r + c, nd)
  xcell <- function(rr, cc) Xc[rr * C + cc + 1, ]
  cellMeans <- t(vapply(0:(R - 1), function(rr) vapply(0:(C - 1), function(cc) sum(xcell(rr, cc) * f$beta), 0), numeric(C))) + shift
  cellMeans <- matrix(cellMeans, R, C)
  em <- as.data.frame(summary(emmeans::emmeans(r$fm, ~ r * c)))
  close_enough(em$emmean[order(em$r, em$c)] + shift, as.vector(t(cellMeans)), 1e-6, "emmeans cells")
  cellN <- matrix(as.vector(table(d$r, d$c)), R, C)
  variances <- setNames(as.list(c(f$rho * f$s2, f$s2)), c(vnames, "residual"))
  chi2 <- max(0, 2 * (f$logLik - logLik0(d$y, X)))
  out <- list(kind = "mixed", sources = src, cellMeans = cellMeans, cellN = cellN,
              mixed = list(variances = variances, logLik = f$logLik, nObs = nrow(d),
                           nSubjects = nlevels(d$s),
                           matching = list(chi2 = chi2, df = length(vnames),
                                           p = pchisq(chi2, length(vnames), lower.tail = FALSE))),
              boundary = any(f$rho == 0))
  cmp <- list()
  for (spec in as_specs(params$comparisons)) for (ddf in c("containment", "satterthwaite")) {
    fam <- spec$family
    simple <- fam %in% c("withinRows", "withinColumns")
    alongCols <- fam %in% c("withinRows", "mainColumns")
    L <- if (alongCols) C else R
    outer_n <- if (simple) (if (alongCols) R else C) else 1
    control <- if (is.null(spec$control)) 0 else spec$control
    lp <- if (spec$kind == "vsControl") lapply(setdiff(0:(L - 1), control), function(k) c(control, k)) else all_pairs(L)
    lof <- function(rr, cc) {
      if (rr >= 0 && cc >= 0) return(xcell(rr, cc))
      if (rr >= 0) return(colMeans(Xc[rr * C + 0:(C - 1) + 1, , drop = FALSE]))
      colMeans(Xc[0:(R - 1) * C + cc + 1, , drop = FALSE])
    }
    cdf <- if (simple && inter) containment(X, Zs) else containment(X, Zs, if (alongCols) cont_col else cont_row)
    fams <- list(); meta <- list()
    for (o in seq_len(outer_n) - 1) {
      mk <- function(l) if (simple) (if (alongCols) c(o, l) else c(l, o)) else (if (alongCols) c(-1, l) else c(l, -1))
      ab <- lapply(lp, function(pq) list(A = mk(pq[1]), B = mk(pq[2])))
      ls <- t(vapply(ab, function(x) lof(x$A[1], x$A[2]) - lof(x$B[1], x$B[2]), numeric(ncol(X))))
      fams[[length(fams) + 1]] <- ls
      meta <- c(meta, ab)
    }
    single <- isTRUE(spec$singleFamily) && !(spec$method %in% c("tukey", "dunnett"))
    res <- if (single) list(family_rows(f, do.call(rbind, fams), spec$method, L, ddf, cdf))
           else lapply(fams, function(ls) family_rows(f, ls, spec$method, L, ddf, cdf))
    cat_ <- function(field) unlist(lapply(res, `[[`, field))
    e <- c(list(ddf = ddf), spec,
           list(diff = cat_("diff"), se = cat_("se"), df = cat_("df"), t = cat_("t"),
                stat = cat_("stat"), p = cat_("p"), lo = cat_("lo"), hi = cat_("hi")))
    if (simple || !alongCols) { e$rowA <- vapply(meta, function(x) x$A[1], 0); e$rowB <- vapply(meta, function(x) x$B[1], 0) }
    if (simple || alongCols) { e$colA <- vapply(meta, function(x) x$A[2], 0); e$colB <- vapply(meta, function(x) x$B[2], 0) }
    e$tolP <- tol_p(spec$method, e$df)
    if (ddf == "satterthwaite") check_emmeans(r$fm, e, d)
    cmp[[length(cmp) + 1]] <- e
  }
  out$comparisons <- cmp
  out
}

check_emmeans <- function(fm, e, dd) {
  fam <- e$family
  spec <- switch(fam, withinRows = ~ c | r, withinColumns = ~ r | c, mainRows = ~ r, mainColumns = ~ c)
  em <- suppressMessages(emmeans::emmeans(fm, spec, lmer.df = "satterthwaite", data = dd))
  pr <- as.data.frame(summary(pairs(em, adjust = "none")))
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
    close_enough(pr$SE[hit], e$se[x], 1e-5, paste("emmeans SE", fam))
    close_enough(pr$df[hit], e$df[x], 2e-3, paste("emmeans df", fam))
  }
}

oracle <- function(input, params) {
  if (params$design == "oneway") oneway(input, params) else twoway(input, params)
}
