# Three-way (2 x 2 x k) ANOVA with repeated measures, and the mixed-effects model for missing
# values (any factor may be repeated).
#
# input: y (null = missing), row (0..k-1), col1, col2 (0/1), subject. params: repeated (factor
# indices: 0 row, 1 column factor 1, 2 column factor 2), method ("anova" | "mixed").
#
# RM ANOVA (complete data): car::Anova(lm(Y ~ between factors), idata, idesign, type = 3) with
# contr.sum, univariate tests: SS, df, error SS / df and Geisser-Greenhouse epsilon (and its
# corrected P) per within effect. Cross-checked against aov(y ~ R*F1*F2 + Error(s/(W))) for
# balanced designs (SS and F, 1e-8).
# Mixed model: REML with sum-to-zero fixed effects (full factorial) and random intercepts for
# subject x W' for every proper subset W' of the repeated factors (the RM ANOVA error strata),
# by reml_dense (ref_rm.R) started from lme4; Wald F of each Type III block, containment df:
# the sequential rank contribution of subject x (E intersect W) to [X Z] (terms ordered with
# every term after those nested in it), or the residual df when E contains every repeated factor.
# Cross-checks: lmer logLik (1e-7 abs), lmerTest F (1e-5).
# params ddf = "satterthwaite" (audit 4 S15; the analysis' default): Satterthwaite's
# denominator df from the analytic REML information at that optimum (satt_F, ref_rm.R), so the
# fixture keeps rtol 1e-10; lmerTest's DenDF, which differentiates the deviance numerically at
# lme4's optimum (agreeing to ~1e-7), is the cross-check at 1e-5.
# RM ANOVA also gives the effect sizes (eta^2, partial eta^2 against the effect's own error
# term, Cohen's f).

source(file.path(ORACLE_DIR, "ref_rm.R"))

PACKAGES <- c("car", "lme4", "lmerTest")
suppressPackageStartupMessages({
  library(car)
  library(lme4)
  library(lmerTest)
})

FN <- c("R", "F1", "F2")
EFFECTS <- list(c(1), c(2), c(3), c(1, 2), c(1, 3), c(2, 3), c(1, 2, 3))

oracle <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  W <- sort(unlist(params$repeated)) + 1
  Bt <- setdiff(1:3, W)
  d <- data.frame(y = as.numeric(input$y), R = factor(input$row), F1 = factor(input$col1),
                  F2 = factor(input$col2), s = factor(input$subject))
  method <- if (is.null(params$method)) "anova" else params$method
  if (method == "anova") {
    lv <- lapply(FN[W], function(f) levels(d[[f]]))
    idata <- do.call(expand.grid, rev(setNames(lv, FN[W])))[, rev(seq_along(W)), drop = FALSE]
    idata[] <- lapply(idata, factor)
    key <- do.call(paste, c(d[FN[W]], sep = "."))
    cells <- do.call(paste, c(idata[FN[W]], sep = "."))
    subs <- levels(droplevels(d$s))
    Y <- t(vapply(subs, function(s) {
      ds <- d[d$s == s, ]
      ds$y[match(cells, key[d$s == s])]
    }, numeric(length(cells))))
    B <- d[match(subs, d$s), FN[Bt], drop = FALSE]
    fit <- if (length(Bt)) lm(as.formula(paste("Y ~", paste(FN[Bt], collapse = "*"))), data = B)
           else lm(Y ~ 1)
    av <- Anova(fit, idata = idata, idesign = as.formula(paste("~", paste(FN[W], collapse = "*"))),
                type = 3)
    sm <- summary(av, multivariate = FALSE)
    uni <- unclass(sm$univariate.tests)
    rn <- rownames(uni)
    gg <- sm$pval.adjustments
    effects <- lapply(EFFECTS, function(e) {
      i <- which(vapply(strsplit(rn, ":"), function(p) setequal(p, FN[e]), TRUE))
      out <- list(ss = uni[i, "Sum Sq"], df = uni[i, "num Df"], F = uni[i, "F value"],
                  p = uni[i, "Pr(>F)"], dfd = uni[i, "den Df"],
                  errorSs = uni[i, "Error SS"])
      if (any(e %in% W) && is.matrix(gg) && rn[i] %in% rownames(gg) && is.finite(gg[rn[i], "GG eps"])) {
        out$epsilon <- min(1, gg[rn[i], "GG eps"])
        out$pCorrected <- gg[rn[i], "Pr(>F[GG])"]
      } else if (any(e %in% W)) {
        out$epsilon <- 1
        out$pCorrected <- out$p
      }
      out
    })
    if (all(table(d$R, d$F1, d$F2) == table(d$R, d$F1, d$F2)[1])) {
      balanced <- length(Bt) == 0 || length(unique(table(B[FN[Bt]]))) <= 1
      if (balanced) {
        err <- paste0("Error(s/(", paste(FN[W], collapse = "*"), "))")
        a <- summary(aov(as.formula(paste("y ~ R*F1*F2 +", err)), data = d))
        tabs <- do.call(rbind, lapply(a, function(x) { t <- x[[1]]; t$term <- trimws(rownames(t)); t }))
        for (j in seq_along(EFFECTS)) {
          e <- EFFECTS[[j]]
          hit <- which(vapply(strsplit(tabs$term, ":"), function(p) setequal(p, FN[e]), TRUE))
          stopifnot(abs(tabs$`Sum Sq`[hit] - effects[[j]]$ss) <= 1e-8 * effects[[j]]$ss,
                    abs(tabs$`F value`[hit] - effects[[j]]$F) <= 1e-8 * effects[[j]]$F)
        }
      }
    }
    # Effect sizes for RM designs: eta^2 = SS / SS_total, partial eta^2 = SS / (SS + SS of the
    # error term the effect is tested against), Cohen's f = sqrt(pe / (1 - pe)).
    sst <- sum((d$y - mean(d$y))^2)
    for (j in seq_along(effects)) {
      e <- effects[[j]]
      pe <- e$ss / (e$ss + e$errorSs)
      effects[[j]]$etaSquared <- e$ss / sst
      effects[[j]]$partialEtaSquared <- pe
      effects[[j]]$cohensF <- sqrt(pe / (1 - pe))
    }
    return(list(kind = "anova", effects = effects))
  }
  # ---- mixed model
  d <- d[!is.na(d$y), ]
  shift <- d$y[1]
  d$y <- d$y - shift
  X <- model.matrix(~ R * F1 * F2, d)
  subsetsW <- lapply(0:(2^length(W) - 1), function(m) W[bitwAnd(m, 2^(seq_along(W) - 1)) > 0])
  proper <- Filter(function(w) length(w) < length(W), subsetsW)
  Zs <- list(); gnames <- character(0)
  for (i in seq_along(proper)) {
    g <- interaction(d[c("s", FN[proper[[i]]])], drop = TRUE)
    d[[paste0("g", i)]] <- g
    Zs[[i]] <- model.matrix(~ 0 + g, data.frame(g = g))
    gnames <- c(gnames, paste0("g", i))
  }
  form <- as.formula(paste("y ~ R*F1*F2 +", paste0("(1|", gnames, ")", collapse = " + ")))
  fm <- lmer(form, d, REML = TRUE,
             control = lmerControl(optimizer = "bobyqa", optCtrl = list(rhoend = 1e-12, maxfun = 1e5),
                                   check.conv.singular = "ignore"))
  th <- getME(fm, "theta")[paste0(gnames, ".(Intercept)")]
  # Components lme4 leaves at ~1e-9 are on the boundary: start them at exactly 0 (reml_dense
  # keeps a component at 0 when its gradient points outward).
  f <- reml_dense(d$y, X, Zs, start = ifelse(unname(th) < 1e-4, 0, unname(th)^2))
  stopifnot(abs(as.numeric(logLik(fm)) - f$logLik) < 1e-7, f$logLik >= as.numeric(logLik(fm)) - 1e-10)
  an <- anova(fm, type = 3, ddf = "Satterthwaite")
  ddf <- if (is.null(params$ddf)) "containment" else params$ddf
  cols <- attr(X, "assign")
  effects <- lapply(seq_along(EFFECTS), function(j) {
    e <- EFFECTS[[j]]
    idx <- which(cols == j)
    b <- f$beta[idx]
    Fv <- drop(t(b) %*% solve(f$cov[idx, idx, drop = FALSE], b)) / length(idx)
    term <- paste(FN[e], collapse = ":")
    stopifnot(abs(an[term, "F value"] - Fv) <= 1e-5 * Fv)
    if (ddf == "satterthwaite") {
      # Audit 4 S15: Satterthwaite's denominator df (the analysis' default since 0.3.9) from the
      # analytic REML information at reml_dense's optimum (satt_F, ref_rm.R), cross-checked
      # against lmerTest's DenDF, which differentiates numerically at lme4's optimum (they
      # agree to ~1e-7 here, so 1e-5 as the check).
      L <- matrix(0, length(idx), ncol(X)); L[cbind(seq_along(idx), idx)] <- 1
      sf <- satt_F(f, L)
      stopifnot(abs(sf$F - Fv) <= 1e-10 * Fv,
                abs(an[term, "DenDF"] - sf$dfd) <= 1e-5 * sf$dfd)
      return(list(F = Fv, df = length(idx), dfd = sf$dfd,
                  p = pf(Fv, length(idx), sf$dfd, lower.tail = FALSE)))
    }
    within <- intersect(e, W)
    containing <- if (length(within) == length(W)) integer(0) else
      which(vapply(proper, function(w) setequal(w, within), TRUE))
    rk <- function(M) qr(M, tol = 1e-9)$rank
    cdf <- if (length(containing) == 0) containment(X, Zs) else
      rk(do.call(cbind, c(list(X), Zs[seq_len(containing)]))) -
        rk(do.call(cbind, c(list(X), Zs[seq_len(containing - 1)])))
    list(F = Fv, df = length(idx), dfd = cdf, p = pf(Fv, length(idx), cdf, lower.tail = FALSE))
  })
  list(kind = "mixed", effects = effects, logLik = f$logLik,
       variances = c(f$rho * f$s2, f$s2))
}
