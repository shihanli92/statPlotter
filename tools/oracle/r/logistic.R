# Multiple logistic regression (Prism's "Multiple logistic regression"), from glm(binomial).
#
# input: y (0/1), X (rows), names. params: intercept, confLevel, ciMethod ('profile' default |
# 'wald'), cutoff (default 0.5), interactions (as multreg.R).
#
# Prism's documented methods (Curve Fitting Guide, "Multiple logistic regression"):
# - Fit: maximum likelihood (glm, converged tightly: epsilon 1e-14, maxit 100).
# - Coefficient P: Wald z = estimate/SE, two-sided normal ("The absolute value of Z, calculated
#   as the coefficient estimate divided by its standard error"; reg_multiple_logistic_results_
#   p_values.htm).
# - CIs: profile likelihood ("Prism actually calculates ... profile likelihood confidence
#   intervals", reg_multiple_logistic_results_parameters.htm). Computed here exactly: for each
#   coefficient the signed root sign(b − b̂)·sqrt(2(ℓ̂ − ℓ_j(b))) = ±z is solved with uniroot
#   (tol 1e-13), ℓ_j(b) from glm.fit with the coefficient as an offset; cross-checked loosely
#   against confint() (MASS-style spline profile, ~1e-3). Wald on request: confint.default.
#   Odds-ratio limits = exp(coefficient limits).
# - Null model: intercept-only (Prism's "intercept-only model"); without an intercept, eta = 0
#   (p = 1/2), as glm's null deviance. UNCERTAIN: Prism's choice without an intercept.
# - LR test: 2(ℓ − ℓ0) on (number of non-intercept coefficients) df.
# - AICc: −2ℓ + 2K + 2K(K+1)/(n − K − 1), K = number of coefficients (checked vs AIC(glm)).
# - Pseudo R² (reg_multiple_logistic_pseudo_r_squared.htm): Tjur = |mean p̂(y=1) − mean p̂(y=0)|;
#   McFadden = 1 − ℓ/ℓ0; Cox-Snell = 1 − (L0/L)^(2/n); Nagelkerke = CS/(1 − L0^(2/n)).
# - Hosmer-Lemeshow (reg_multiple_logistic_hypothesis_tests.htm: "sorting the observations by
#   their predicted probability, and splitting them into 10 groups of equal numbers of
#   observations"; E = N·mean p̂; Pearson statistic over the 0s and 1s): hand-coded — group g
#   holds sorted positions floor(g·n/10) .. floor((g+1)·n/10) − 1, ties in p̂ kept in row order;
#   df = 10 − 2 (the guide gives no df; 8 is Hosmer & Lemeshow's). UNCERTAIN: Prism's handling
#   of n not divisible by 10 and of tied p̂ (ResourceSelection::hoslem.test cuts at quantiles
#   instead, which differs with ties).
# - ROC area: Mann-Whitney area of p̂ (ties ½), checked vs wilcox.test. SE: Hanley & McNeil (1982)
#   with Q1, Q2 computed from the data (their Table II; Prism's ROC "Calculation details" page:
#   "Prism actually computes Q1 and Q2 using a more complicated equation" linking to that paper);
#   CI = area ± z·SE clipped to [0, 1] (UNCERTAIN: Prism's CI form); P from z = (A − ½)/SE0 with
#   SE0² = (0.25 + (na + nn − 2)/12)/(na·nn) (FAQ 1191). Not DeLong (pROC).
# - Classification table: positive when p̂ > cutoff ("greater than 0.5").
# - Separation: glm's "fitted probabilities numerically 0 or 1" (10·eps) -> status 'separation';
#   coefficients NaN. Aliased columns (NA in glm) -> 'singular'.

PACKAGES <- character(0)

design <- function(input, params) {
  X <- as.matrix(input$X)
  if (is.null(dim(X))) X <- matrix(X, ncol = length(input$names))
  colnames(X) <- input$names
  if (!is.null(params$interactions)) {
    ia <- matrix(params$interactions, ncol = 2)
    for (r in seq_len(nrow(ia))) {
      a <- ia[r, 1] + 1; b <- ia[r, 2] + 1
      X <- cbind(X, X[, a] * X[, b])
      colnames(X)[ncol(X)] <- paste0(input$names[a], ":", input$names[b])
    }
  }
  X
}

CTRL <- glm.control(epsilon = 1e-14, maxit = 100)

loglik_offset <- function(M, y, off) {
  if (ncol(M) == 0) {
    p <- plogis(off)
    return(sum(dbinom(y, 1, p, log = TRUE)))
  }
  f <- suppressWarnings(glm.fit(M, y, family = binomial(), offset = off,
                                control = CTRL))
  -f$deviance / 2
}

profile_ci <- function(M, y, beta, se, ll, level) {
  z <- qnorm(1 - (1 - level) / 2)
  t(sapply(seq_along(beta), function(j) {
    signed <- function(b) {
      d <- 2 * (ll - loglik_offset(M[, -j, drop = FALSE], y, b * M[, j]))
      sign(b - beta[j]) * sqrt(max(0, d))
    }
    lo <- uniroot(function(b) signed(b) + z, c(beta[j] - 2 * z * se[j], beta[j]),
                  extendInt = "upX", tol = 1e-13)$root
    hi <- uniroot(function(b) signed(b) - z, c(beta[j], beta[j] + 2 * z * se[j]),
                  extendInt = "upX", tol = 1e-13)$root
    c(lo, hi)
  }))
}

hl <- function(y, p, G = 10) {
  n <- length(y)
  o <- order(p, seq_len(n))
  chi <- 0
  for (g in 0:(G - 1)) {
    idx <- o[(floor(g * n / G) + 1):floor((g + 1) * n / G)]
    e1 <- sum(p[idx]); o1 <- sum(y[idx]); N <- length(idx)
    chi <- chi + (o1 - e1)^2 / e1 + ((N - o1) - (N - e1))^2 / (N - e1)
  }
  list(chiSq = chi, df = G - 2, p = pchisq(chi, G - 2, lower.tail = FALSE))
}

auc_hm <- function(y, s, level) {
  pos <- s[y == 1]; neg <- s[y == 0]
  na <- length(pos); nn <- length(neg)
  A <- mean(outer(pos, neg, function(a, b) (a > b) + 0.5 * (a == b)))
  W <- suppressWarnings(wilcox.test(pos, neg, exact = FALSE)$statistic)
  stopifnot(abs(A - W / (na * nn)) < 1e-12)
  # Hanley & McNeil Table II rows 6-7, per subject rather than per rating level.
  q2 <- sapply(pos, function(a) {
    L <- sum(neg < a); m <- sum(neg == a); L^2 + L * m + m^2 / 3
  })
  q1 <- sapply(neg, function(b) {
    U <- sum(pos > b); m <- sum(pos == b); U^2 + U * m + m^2 / 3
  })
  Q2 <- sum(q2) / (na * nn^2); Q1 <- sum(q1) / (nn * na^2)
  se <- sqrt((A * (1 - A) + (na - 1) * (Q1 - A^2) + (nn - 1) * (Q2 - A^2)) / (na * nn))
  se0 <- sqrt((0.25 + (na + nn - 2) / 12) / (na * nn))
  z <- qnorm(1 - (1 - level) / 2)
  list(value = A, se = se, lower = max(0, A - z * se), upper = min(1, A + z * se),
       p = 2 * pnorm(abs(A - 0.5) / se0, lower.tail = FALSE))
}

oracle <- function(input, params) {
  y <- input$y
  M0 <- design(input, params)
  intercept <- is.null(params$intercept) || isTRUE(params$intercept)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  method <- if (is.null(params$ciMethod)) "profile" else params$ciMethod
  cutoff <- if (is.null(params$cutoff)) 0.5 else params$cutoff
  M <- if (intercept) cbind("(Intercept)" = 1, M0) else M0
  nm <- c(if (intercept) "Intercept", colnames(M0))
  warn <- character(0)
  # glm's QR tolerance is min(1e-7, epsilon/1000), so aliasing is detected with the default
  # epsilon first; the tight fit then uses the non-aliased columns only.
  aliased <- is.na(coef(suppressWarnings(glm(y ~ 0 + M, family = binomial()))))
  Mk <- M[, !aliased, drop = FALSE]
  catch <- function(expr) withCallingHandlers(expr, warning = function(w) {
    warn <<- c(warn, conditionMessage(w)); invokeRestart("muffleWarning")
  })
  fit <- catch(glm(y ~ 0 + Mk, family = binomial(), control = CTRL))
  # glm's vcov uses the weights of its last iteration, i.e. at the previous iterate (~1e-7 away
  # at epsilon 1e-14). Refitting from the estimates puts the weights at the maximum.
  if (!any(grepl("numerically 0 or 1", warn)) && fit$converged) {
    for (r in 1:2) fit <- catch(glm(y ~ 0 + Mk, family = binomial(), start = coef(fit),
                                    control = CTRL))
  }
  n <- length(y); n1 <- sum(y); n0 <- n - n1
  p <- unname(fitted(fit))
  separated <- any(grepl("numerically 0 or 1", warn))
  cf <- rep(NA_real_, ncol(M))
  cf[!aliased] <- unname(coef(fit))
  status <- if (separated) "separation" else if (!fit$converged) "notConverged" else
    if (any(aliased)) "singular" else "ok"
  usable <- status %in% c("ok", "singular")
  ll <- as.numeric(logLik(fit))
  k <- sum(!aliased)
  ll0 <- if (intercept) (if (n1 > 0) n1 * log(n1 / n) else 0) + (if (n0 > 0) n0 * log(n0 / n) else 0)
         else n * log(0.5)
  if (!intercept) stopifnot(abs(-fit$null.deviance / 2 - ll0) < 1e-10 * abs(ll0))
  if (intercept && n1 > 0 && n0 > 0) {
    stopifnot(abs(as.numeric(logLik(glm(y ~ 1, family = binomial(), control = CTRL))) - ll0) <
              1e-10 * abs(ll0))
  }
  stopifnot(abs(AIC(fit) - (-2 * ll + 2 * k)) < 1e-9 * abs(AIC(fit)))
  lrDf <- if (intercept) k - 1 else k
  coefs <- vector("list", length(nm))
  if (usable) {
    V <- vcov(fit)
    b <- cf[!aliased]
    se <- sqrt(diag(V))
    ci <- if (method == "wald") {
      confint.default(fit, level = level)
    } else {
      pci <- profile_ci(Mk, y, b, se, ll, level)
      mci <- suppressMessages(confint(fit, level = level))
      stopifnot(max(abs(pci - mci) / (1 + abs(mci))) < 2e-3)
      pci
    }
    # VIF from the predictors alone, as multiple linear regression.
    vif <- rep(NaN, ncol(M0))
    if (status == "ok") {
      vif <- sapply(seq_len(ncol(M0)), function(j) {
        xj <- M0[, j]; others <- M0[, -j, drop = FALSE]
        if (intercept) {
          r <- if (ncol(others) > 0) residuals(lm(xj ~ others)) else xj - mean(xj)
          sum((xj - mean(xj))^2) / sum(r^2)
        } else {
          r <- if (ncol(others) > 0) residuals(lm(xj ~ 0 + others)) else xj
          sum(xj^2) / sum(r^2)
        }
      })
    }
    vifs <- c(if (intercept) list(NULL), as.list(vif))
    a <- 0
    for (j in seq_along(nm)) {
      if (aliased[j]) {
        coefs[[j]] <- list(name = nm[j], estimate = NaN, se = NaN, lower = NaN, upper = NaN,
                           stat = NaN, p = NaN, oddsRatio = NaN, orLower = NaN, orUpper = NaN,
                           vif = vifs[[j]])
        next
      }
      a <- a + 1
      zv <- b[a] / se[a]
      coefs[[j]] <- list(name = nm[j], estimate = b[a], se = unname(se[a]),
                         lower = unname(ci[a, 1]), upper = unname(ci[a, 2]), stat = unname(zv),
                         p = 2 * pnorm(abs(zv), lower.tail = FALSE), oddsRatio = exp(b[a]),
                         orLower = exp(unname(ci[a, 1])), orUpper = exp(unname(ci[a, 2])),
                         vif = vifs[[j]])
    }
  } else {
    for (j in seq_along(nm)) {
      coefs[[j]] <- list(name = nm[j], estimate = NaN, se = NaN, lower = NaN, upper = NaN,
                         stat = NaN, p = NaN, oddsRatio = NaN, orLower = NaN, orUpper = NaN)
    }
  }
  base <- list(coefficients = coefs, n = n, nEvents = n1, nullLogLik = ll0, status = status)
  if (!usable) {
    base$logLik <- ll
    return(base)
  }
  cs <- 1 - exp(2 * (ll0 - ll) / n)
  tp <- sum(y == 1 & p > cutoff); fp <- sum(y == 0 & p > cutoff)
  tn <- sum(y == 0 & p <= cutoff); fn <- sum(y == 1 & p <= cutoff)
  c(base, list(
    logLik = ll,
    lrChiSq = 2 * (ll - ll0), lrDf = lrDf,
    lrP = pchisq(2 * (ll - ll0), lrDf, lower.tail = FALSE),
    aicc = if (n - k - 1 > 0) -2 * ll + 2 * k + 2 * k * (k + 1) / (n - k - 1) else NaN,
    pseudoR2 = list(tjur = abs(mean(p[y == 1]) - mean(p[y == 0])), mcFadden = 1 - ll / ll0,
                    coxSnell = cs, nagelkerke = cs / (1 - exp(2 * ll0 / n))),
    hosmerLemeshow = if (n >= 10) hl(y, p) else NULL,
    auc = auc_hm(y, p, level),
    classification = list(cutoff = cutoff, tp = tp, fp = fp, tn = tn, fn = fn,
                          positivePredictivePower = tp / (tp + fp),
                          negativePredictivePower = tn / (tn + fn),
                          fractionCorrect = (tp + tn) / n),
    fitted = p
  ))
}
