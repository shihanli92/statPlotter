# Nested t test and nested one-way ANOVA (suite nested). The model, in SAS:
#   PROC MIXED METHOD=REML; CLASS Room Condition; MODEL y = Condition;
#        RANDOM Room*Condition / SUBJECT=Room;
#   lmer(y ~ Condition + (1 | Room:Condition), REML = TRUE)
# i.e. groups fixed (sum-to-zero coded here, as lme4 with contr.sum), subcolumns (subjects)
# random within groups, variances >= 0. The treatment F is the Wald F of the group effects with
# containment denominator df (SAS's default for that code): subcolumns with data - groups.
#
# input: long format { y, group, subject } (subject ids unique across groups; null y dropped).
# params: comparisons [{ method, pairs? (0-based [i, j]) }] for the one-way case.
#
# Reference: reml_dense (ref_rm.R) from lme4's estimate; cross-checked against lme4 (variances,
# logLik), nlme::lme, lmerTest (F; its Satterthwaite DenDF equals containment for balanced data)
# and, for balanced data, the ordinary t test / one-way ANOVA of the subject means. Also:
# - subcolumns F test: anova(lm(y ~ group + subject)) row "subject" (within-group subject SS
#   after groups), df S - k and N - S;
# - likelihood-ratio chi2 of the REML fits with and without the random effect (df 1);
# - ICC = var_subject / (var_subject + var_residual).
# Comparisons: differences of least-squares means, SE from the model covariance, containment df;
# P values and CIs from mc_family (ref_rm.R; Tukey / Dunnett via its own integrals).

source(file.path(ORACLE_DIR, "ref_rm.R"))

PACKAGES <- c("lme4", "lmerTest", "nlme")

suppressPackageStartupMessages({
  library(lme4)
  library(lmerTest)
})

mx <- new.env(parent = globalenv())
sys.source(file.path(ORACLE_DIR, "r", "mixed.R"), envir = mx)

# Large cases (hundreds of replicates per subcolumn, audit 3): reml_dense's N x N algebra is
# too noisy there for its own stopping rule (the criterion's rounding noise, ~1e-9 at
# N = 2,680, exceeds the 1e-14 relative decrease its line search asks for, so it never stops)
# and takes minutes per evaluation. With one random intercept, W is block-diagonal by
# subcolumn, W_c^-1 = I - rho/(1 + n_c rho) 11', so every product with W^-1 is a within-
# subcolumn sum plus the subcolumn means weighted by 1/(1 + n_c rho), log|W| =
# sum log(1 + n_c rho), and Newton's method runs on the analytic gradient and Hessian
# (Harville 1977, as reml_dense). Checked against reml_dense's dense criterion and beta at the
# optimum (one evaluation), lme4 (logLik, variances), nlme, lmerTest's F and, for balanced
# data, the ANOVA of the subject means.
LARGE_N <- 1000
LME4_VTOL <- 1e-4

reml_levels <- function(y, X, s, start) {
  N <- length(y); p <- ncol(X)
  n <- as.vector(table(s))
  si <- as.integer(s)
  mean2 <- function(v) { m <- as.vector(tapply(v, s, mean)); m + as.vector(tapply(v - m[si], s, mean)) }
  Xbar <- apply(X, 2, mean2)
  ybar <- mean2(y)
  Xc <- X - Xbar[si, , drop = FALSE]
  Sxx <- crossprod(Xc)
  Sxy <- drop(crossprod(Xc, y - ybar[si]))
  ev <- function(rho) {
    nw <- n / (1 + n * rho)
    M <- Sxx + crossprod(Xbar, nw * Xbar)
    beta <- drop(solve(M, Sxy + drop(crossprod(Xbar, nw * ybar))))
    r <- drop(y - X %*% beta)
    rbar <- mean2(r)
    yPy <- sum((r - rbar[si])^2) + sum(nw * rbar^2)
    u <- nw * rbar
    B <- nw * Xbar
    ZPZ <- diag(nw, length(n)) - B %*% solve(M, t(B))
    dev <- (N - p) * log(yPy) + sum(log1p(n * rho)) + as.numeric(determinant(M)$modulus)
    grad <- -(N - p) * sum(u^2) / yPy + sum(diag(ZPZ))
    H <- (N - p) * (2 * drop(t(u) %*% ZPZ %*% u) / yPy - sum(u^2)^2 / yPy^2) - sum(ZPZ^2)
    list(dev = dev, grad = grad, H = H, beta = beta, M = M, yPy = yPy)
  }
  rho <- max(start, 0)
  for (it in 1:100) {
    e <- ev(rho)
    if (rho == 0 && e$grad >= 0) break
    step <- if (e$H > 0) -e$grad / e$H else -sign(e$grad) * max(rho, 1) / 2
    trial <- max(rho + step, 0)
    done <- abs(trial - rho) <= 1e-15 * (1 + rho)
    rho <- trial
    if (done) break
  }
  e <- ev(rho)
  s2 <- e$yPy / (N - p)
  list(rho = rho, s2 = s2, beta = e$beta, cov = s2 * solve(e$M), grad = e$grad, dev = e$dev, ev = ev,
       logLik = -0.5 * ((N - p) * (1 + log(2 * pi * s2)) + sum(log1p(n * rho)) +
                          as.numeric(determinant(e$M)$modulus)))
}

fit_large <- function(d, X, Zs) {
  fm <- mx$tight_lmer(y ~ g + (1 | s), d)
  f <- reml_levels(d$y, X, d$s, start = unname(getME(fm, "theta"))^2)
  N <- nrow(d); p <- ncol(X)
  # the optimum: gradient ~ 0 (its terms are O(subcolumns)), or >= 0 on the boundary
  stopifnot(abs(f$grad) < 1e-9 || (f$rho == 0 && f$grad >= 0))
  # the same criterion and beta from the dense N x N algebra (reml_dense's), at this optimum
  W <- diag(N) + f$rho * tcrossprod(Zs[[1]])
  Wi <- solve(W)
  WiX <- Wi %*% X
  M <- crossprod(X, WiX)
  b <- drop(solve(M, crossprod(WiX, d$y)))
  Py <- drop(Wi %*% d$y - WiX %*% b)
  dev <- (N - p) * log(sum(d$y * Py)) + as.numeric(determinant(W)$modulus) +
    as.numeric(determinant(M)$modulus)
  mx$close_enough(dev, f$dev, 1e-12, "dense REML criterion")
  mx$close_enough(b, f$beta, 1e-8, "dense beta", atol = 1e-8 * max(abs(f$beta)))
  # lme4 stops where the criterion is flat to rounding: its rho is 2e-5 (relative) from the
  # gradient's root here, so its variances are compared at 1e-4 (1e-5 for the small cases)
  mx$close_enough(sigma(fm)^2, f$s2, LME4_VTOL, "lmer sigma^2")
  vc <- as.data.frame(VarCorr(fm))
  mx$close_enough(sum(vc$vcov), f$s2 * (1 + f$rho), LME4_VTOL, "lmer total variance")
  mx$close_enough(as.numeric(logLik(fm)), f$logLik, 0, "lmer logLik", atol = 1e-7)
  # lme4's own logLik carries rounding of ~1e-12 relative at this size (it reads 8e-9 above
  # ours at an optimum 2e-5 away): compare the criterion here at lme4's optimum instead, to
  # its rounding (the criterion is flat to 1 ulp over that distance)
  stopifnot(f$ev(unname(getME(fm, "theta"))^2)$dev >= f$dev - 1e-14 * abs(f$dev))
  dd <- d
  dd$Xm <- X[, -1, drop = FALSE]
  lm_ <- nlme::lme(y ~ Xm, random = ~ 1 | s, data = dd, method = "REML",
                   control = nlme::lmeControl(tolerance = 1e-12, msTol = 1e-12, niterEM = 200,
                                              msMaxIter = 500))
  mx$close_enough(lm_$sigma^2, f$s2, 1e-4, "lme sigma^2")
  list(f = f, fm = fm)
}

# The treatment F with containment df (lmerTest's F and Satterthwaite DenDF as checks).
ftest_large <- function(f, k, X, Zs, fm) {
  idx <- 2:k
  b <- f$beta[idx]
  Fv <- drop(t(b) %*% solve(f$cov[idx, idx, drop = FALSE], b)) / length(idx)
  an <- anova(fm, type = 3, ddf = "Satterthwaite")
  mx$close_enough(an["g", "F value"], Fv, LME4_VTOL, "lmerTest F")
  cdf <- containment(X, Zs, 1L)
  list(containment = list(F = Fv, dfn = length(idx), dfd = cdf,
                          p = pf(Fv, length(idx), cdf, lower.tail = FALSE)),
       satterthwaite = list(F = Fv, dfn = length(idx), dfd = an["g", "DenDF"]))
}

oracle <- function(input, params) {
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  d0 <- data.frame(y = as.numeric(input$y), g = input$group, s = input$subject)
  d <- d0[!is.na(d0$y), ]
  shift <- d$y[1]
  d$y <- d$y - shift
  k <- length(unique(d$g))
  d$g <- factor(d$g, sort(unique(d$g)))
  d$s <- factor(d$s, unique(d$s))
  S <- nlevels(d$s)
  N <- nrow(d)
  X <- model.matrix(~g, d)
  Zs <- list(model.matrix(~ 0 + s, d))
  r <- if (N > LARGE_N) fit_large(d, X, Zs) else
    mx$fit_all(d, X, Zs, y ~ g + (1 | s), lme_random = ~ 1 | s)
  f <- r$f
  vc <- as.data.frame(VarCorr(r$fm))
  mx$close_enough(vc$vcov[vc$grp == "s"], f$rho * f$s2, if (N > LARGE_N) LME4_VTOL else 1e-5,
                  "lmer subject var", atol = 1e-8)
  tt <- if (N > LARGE_N) ftest_large(f, k, X, Zs, r$fm) else
    mx$ftest(f, 2:k, X, Zs, 1L, r$fm, "g")
  codes <- contr.sum(k)
  xrow <- function(j) c(1, codes[j + 1, ])
  means <- vapply(0:(k - 1), function(j) sum(xrow(j) * f$beta), 0) + shift
  cdf <- containment(X, Zs, 1L)
  stopifnot(cdf == S - k)
  # balanced data: ordinary tests on the subject means
  cnt <- table(d$s)
  if (length(unique(cnt)) == 1 && f$rho[1] > 0) {
    sm <- aggregate(y ~ s + g, d, mean)
    a <- anova(lm(y ~ g, sm))
    mx$close_enough(tt$containment$F, a[1, "F value"], 1e-9, "F vs ANOVA of subject means")
    mx$close_enough(tt$satterthwaite$dfd, cdf, 1e-3, "Satterthwaite = containment (balanced)")
  }
  ll0 <- mx$logLik0(d$y, X)
  chi2 <- max(0, 2 * (f$logLik - ll0))
  a2 <- anova(lm(y ~ g + s, d))
  sub <- list(F = a2["s", "F value"], dfn = a2["s", "Df"], dfd = a2["Residuals", "Df"],
              p = a2["s", "Pr(>F)"])
  vs <- f$rho * f$s2
  out <- list(
    means = means,
    treatment = tt$containment,
    variances = list(subcolumn = vs, residual = f$s2),
    icc = vs / (vs + f$s2),
    subcolumnTest = sub,
    lrt = list(chi2 = chi2, df = 1, p = pchisq(chi2, 1, lower.tail = FALSE)),
    logLik = f$logLik,
    subjects = as.vector(tapply(d$s, d$g, function(v) length(unique(v)))),
    boundary = f$rho[1] == 0)
  L <- function(i, j) xrow(i) - xrow(j)
  if (k == 2) {
    l <- L(1, 0)
    est <- sum(l * f$beta); se <- sqrt(drop(t(l) %*% f$cov %*% l))
    tv <- est / se
    h <- qt(0.975, cdf) * se
    mx$close_enough(tv^2, tt$containment$F, 1e-10, "t^2 = F")
    out$ttest <- list(diff = est, se = se, t = tv, df = cdf, p = 2 * pt(-abs(tv), cdf),
                      lo = est - h, hi = est + h)
  }
  cmp <- list()
  for (spec in as_specs(params$comparisons)) {
    pr <- if (!is.null(spec$pairs)) spec$pairs else if (spec$method == "dunnett")
      lapply(1:(k - 1), function(j) c(0, j)) else mx$all_pairs(k)
    if (is.matrix(pr)) pr <- lapply(seq_len(nrow(pr)), function(i) pr[i, ])
    i <- vapply(pr, `[`, 0, 1); j <- vapply(pr, `[`, 0, 2)
    ls <- t(vapply(seq_along(i), function(a) L(i[a], j[a]), numeric(k)))
    res <- mx$family_rows(f, ls, spec$method, k, "containment", cdf)
    cmp[[length(cmp) + 1]] <- c(list(method = spec$method, i = i, j = j), res)
  }
  out$comparisons <- cmp
  out
}
