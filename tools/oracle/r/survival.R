# Survival analysis (Kaplan-Meier and curve comparison).
#
# Kaplan-Meier: survival::survfit. SE = Greenwood. CIs:
#   asymmetric  survfit(conf.type = "log-log") with Greenwood errors.
#   symmetric   survfit(conf.type = "plain"): S +/- z SE truncated to [0, 1].
#   Conventions (TS and fixtures alike): while S = 1, SE = 0 and CI = [1, 1]; once S = 0,
#   SE = 0 and CI = [0, 0] (survfit gives NaN/NA there). A time-0 row (survival 1) is
#   prepended; then one row per distinct time (events and censorings), events before
#   censorings at tied times (as survfit).
# Median and its CI: quantile(survfit(conf.type = "log-log"), 0.5), i.e. the staircase
#   crossing of 1/2 with the midpoint of a flat segment at exactly 1/2 (as Machin), and the
#   Brookmeyer-Crowley interval with the complementary log-log transform, which is where the
#   log-log CI curves cross 1/2. The median CI always uses log-log, whatever the curve CI
#   method. Undefined median -> NaN; upper limit never reached -> Inf ("+infinity");
#   lower limit never reached -> NaN.
#   UNCERTAIN: how to treat S = 0 in the Brookmeyer-Crowley search (here, as in R, those
#   points are ignored), and whether to average at a flat 1/2 for the CI limits as R does.
# Log-rank: survdiff(rho = 0) (the "Mantel-Haenszel approach", also called Mantel-Cox),
#   k groups by U' V^-1 U (the recommended "match SAS and SPSS" option).
# Gehan-Breslow-Wilcoxon: the weighted log-rank statistic with weight = number at risk and
#   the same hypergeometric covariance with weights squared (SAS LIFETEST "Wilcoxon"). There
#   is no R function with this exact variance (coin uses the permutation variance, survMisc
#   is no longer on CRAN), so it is hand-coded; the unweighted version of the same code is
#   checked against survdiff to 1e-12 and the weighted scores U against
#   coin::logrank_test(type = "Gehan-Breslow") (its centred linear statistic is -U).
# Log-rank test for trend: (c'U)^2 / c'Vc with scores c = 1..k (column order, equally
#   spaced), df 1 -- the SAS/SPSS form. c'U is checked against coin's
#   linear-by-linear logrank statistic for an ordered factor.
# Hazard ratio (2 groups; group 2 vs group 1) (Machin, Cheung & Parmar 2006, ch. 3):
#   Mantel-Haenszel  L = (O2 - E2)/V, HR = exp(L), CI exp(L -/+ z/sqrt(V)), V = log-rank var
#   log-rank         HR = (O2/E2)/(O1/E1), CI exp(log HR -/+ z sqrt(1/E1 + 1/E2))
#   Both a ratio and its reciprocal are reported; the fixtures hold group 2 / group 1.
# Ratio of medians (Machin pp. 67-68): M2/M1, CI exp(log ratio -/+
#   z sqrt(1/O1 + 1/O2)); null when a median is undefined (or 0) or a group has no events.
# z = qnorm(1 - (1 - confLevel)/2) throughout (1.96 for 95%).

PACKAGES <- c("survival", "coin")
suppressPackageStartupMessages({
  library(survival)
  library(coin)
})

# input$time / input$event: one array per group (fromJSON may simplify to a matrix).
as_groups <- function(x) {
  if (is.matrix(x)) lapply(seq_len(nrow(x)), function(i) x[i, ]) else as.list(x)
}

km_oracle <- function(time, event, conf, method) {
  n <- length(time)
  if (n == 0) {
    return(list(n = 0L, events = 0L, censored = 0L, steps = list(),
                median = list(value = NaN, lower = NaN, upper = NaN)))
  }
  fit <- survfit(Surv(time, event) ~ 1, conf.int = conf,
                 conf.type = if (method == "symmetric") "plain" else "log-log")
  fll <- survfit(Surv(time, event) ~ 1, conf.int = conf, conf.type = "log-log")
  S <- fit$surv
  se <- ifelse(S == 0, 0, S * fit$std.err)
  lower <- fit$lower
  upper <- fit$upper
  lower[S == 1] <- 1; upper[S == 1] <- 1
  lower[S == 0] <- 0; upper[S == 0] <- 0
  # Greenwood by hand.
  gw <- cumsum(ifelse(fit$n.event > 0, fit$n.event / (fit$n.risk * (fit$n.risk - fit$n.event)),
                      0))
  stopifnot(isTRUE(all.equal(se[S > 0], (S * sqrt(gw))[S > 0], tolerance = 1e-13)))
  steps <- data.frame(
    time = c(0, fit$time), atRisk = c(n, fit$n.risk), events = c(0, fit$n.event),
    censored = c(0, fit$n.censor), survival = c(1, S), se = c(0, se),
    lower = c(1, lower), upper = c(1, upper))
  q <- quantile(fll, 0.5)
  med <- list(value = unname(q$quantile), lower = unname(q$lower), upper = unname(q$upper))
  if (is.na(med$value)) med$value <- NaN
  if (is.na(med$lower)) med$lower <- NaN
  if (is.na(med$upper)) med$upper <- Inf
  list(n = n, events = sum(event), censored = n - sum(event), steps = steps, median = med)
}

# Weighted log-rank scores and covariance; w(N) gives the weight at a time with N at risk.
weighted_lr <- function(time, event, g, k, w) {
  ut <- sort(unique(time[event == 1]))
  U <- O <- E <- numeric(k)
  V <- matrix(0, k, k)
  for (t in ut) {
    n <- tabulate(g[time >= t], k)
    d <- tabulate(g[time == t & event == 1], k)
    N <- sum(n); D <- sum(d); wt <- w(N)
    e <- D * n / N
    O <- O + d; E <- E + e
    U <- U + wt * (d - e)
    if (N > 1) V <- V + wt^2 * D * (N - D) / (N - 1) * (diag(n / N, k) - outer(n / N, n / N))
  }
  list(U = U, V = V, O = O, E = E)
}

quad_test <- function(r) {
  keep <- which(r$E > 0)
  if (length(keep) < 2) return(list(chiSq = NaN, df = max(0, length(keep) - 1), p = NaN))
  idx <- keep[-1]
  chi <- sum(solve(r$V[idx, idx, drop = FALSE], r$U[idx]) * r$U[idx])
  list(chiSq = chi, df = length(idx), p = pchisq(chi, length(idx), lower.tail = FALSE))
}

oracle <- function(input, params) {
  conf <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  method <- if (is.null(params$ciMethod)) "asymmetric" else params$ciMethod
  z <- qnorm(1 - (1 - conf) / 2)
  times <- lapply(as_groups(input$time), as.numeric)
  events <- lapply(as_groups(input$event), as.numeric)
  k <- length(times)
  km <- lapply(seq_len(k), function(j) km_oracle(times[[j]], events[[j]], conf, method))

  time <- unlist(times); event <- unlist(events)
  g <- rep(seq_len(k), vapply(times, length, 0L))
  lr <- weighted_lr(time, event, g, k, function(N) 1)
  gb <- weighted_lr(time, event, g, k, function(N) N)
  logRank <- quad_test(lr)
  gbw <- quad_test(gb)

  # Cross-checks: survdiff for the log-rank test, coin for the weighted scores.
  present <- which(tabulate(g, k) > 0)
  if (length(present) >= 2 && sum(lr$E > 0) >= 2) {
    sd <- survdiff(Surv(time, event) ~ factor(g))
    stopifnot(isTRUE(all.equal(sd$chisq, logRank$chiSq, tolerance = 1e-12)))
    stopifnot(isTRUE(all.equal(unname(sd$exp), lr$E[present], tolerance = 1e-12)))
    gf <- factor(g, levels = present)
    for (tp in c("logrank", "Gehan-Breslow")) {
      ct <- logrank_test(Surv(time, event) ~ gf, type = tp)
      lin <- -as.vector(statistic(ct, "linear") - expectation(ct))
      ref <- if (tp == "logrank") lr$U[present] else gb$U[present]
      stopifnot(isTRUE(all.equal(lin, ref[seq_along(lin)], tolerance = 1e-10)) ||
                  max(abs(ref)) < 1e-10)
    }
  }

  trend <- NULL
  if (k >= 3) {
    s <- seq_len(k)
    num <- sum(s * lr$U); den <- drop(t(s) %*% lr$V %*% s)
    chi <- if (den > 0) num^2 / den else NaN
    trend <- list(chiSq = chi, df = 1, p = pchisq(chi, 1, lower.tail = FALSE))
    if (length(present) == k && den > 0) {
      ct <- logrank_test(Surv(time, event) ~ factor(g, ordered = TRUE), type = "logrank")
      stopifnot(isTRUE(all.equal(-as.vector(statistic(ct, "linear") - expectation(ct)), num,
                                 tolerance = 1e-10)))
    }
  }

  hr <- NULL; mr <- NULL
  if (k == 2) {
    O <- lr$O; E <- lr$E; V <- lr$V[2, 2]
    L <- (O[2] - E[2]) / V
    h <- (O[2] / E[2]) / (O[1] / E[1])
    s <- sqrt(1 / E[1] + 1 / E[2])
    hr <- list(
      mantelHaenszel = list(value = exp(L), lower = exp(L - z / sqrt(V)),
                            upper = exp(L + z / sqrt(V))),
      logRank = list(value = h, lower = exp(log(h) - z * s), upper = exp(log(h) + z * s)))
    m1 <- km[[1]]$median$value; m2 <- km[[2]]$median$value
    if (is.finite(m1) && is.finite(m2) && m1 > 0 && m2 > 0 && O[1] > 0 && O[2] > 0) {
      r <- m2 / m1; hw <- z * sqrt(1 / O[1] + 1 / O[2])
      mr <- list(value = r, lower = r * exp(-hw), upper = r * exp(hw))
    }
  }

  list(km = km, logRank = logRank, gehanBreslowWilcoxon = gbw, logRankTrend = trend,
       hazardRatio = hr, medianRatio = mr, observed = I(lr$O), expected = I(lr$E))
}
