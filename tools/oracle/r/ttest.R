# t tests. params$test selects: "unpaired" (Student / Welch), "paired", "ratio" (paired t on
# log10(b/a)) or "summary" (from mean / SD / n).
#
# Sign convention: the effect is B - A (Prism reports the difference as mean(B) - mean(A)), so
# the oracle calls t.test(b, a); `alternative` refers to B - A.
#
# Cases where t.test() refuses the data ("data are essentially constant", SD = 0) get the
# closed-form values our implementation documents: se = 0 gives t = +-Inf (P = 0) or NaN, the CI
# collapses to the estimate, eta^2 = 1 when |t| = Inf.
#
# params$shift (offset cases): the oracle analyses b - shift and a - shift (exact in double
# arithmetic for 1e9 + noise), which is the same test but keeps R's means from rounding to
# ~1 ulp of 1e9 -- far more than the small difference being tested. Means are shifted back.

PACKAGES <- c("BSDA")

alt_of <- function(params) if (is.null(params$alternative)) "two.sided" else
  switch(params$alternative, "two-sided" = "two.sided", params$alternative)
level_of <- function(params) if (is.null(params$confLevel)) 0.95 else params$confLevel

eta2 <- function(t, df) if (is.infinite(t)) 1 else t^2 / (t^2 + df)

# Closed form used when t.test() refuses the data, and to cross-check it otherwise.
closed <- function(est, se, df, alt, level) {
  t <- est / se
  p <- switch(alt, less = pt(t, df), greater = pt(t, df, lower.tail = FALSE),
              two.sided = 2 * pt(abs(t), df, lower.tail = FALSE))
  alpha <- 1 - level
  ci <- switch(alt,
    less = c(-Inf, est + qt(level, df) * se),
    greater = c(est - qt(level, df) * se, Inf),
    two.sided = est + c(-1, 1) * qt(1 - alpha / 2, df) * se)
  list(t = t, df = df, p = p, ci = ci)
}

from_htest <- function(tt) list(t = unname(tt$statistic), df = unname(tt$parameter),
                                p = tt$p.value, ci = as.vector(tt$conf.int))

check <- function(a, b) {
  for (k in c("t", "df", "p", "ci")) {
    stopifnot(isTRUE(all.equal(a[[k]], b[[k]], tolerance = 1e-9)))
  }
}

unpaired <- function(a, b, params) {
  alt <- alt_of(params); level <- level_of(params)
  eq <- if (is.null(params$equalVariance)) TRUE else params$equalVariance
  shift <- if (is.null(params$shift)) 0 else params$shift
  as <- a - shift; bs <- b - shift
  nA <- length(a); nB <- length(b)
  vA <- if (nA > 1) var(as) else NaN
  vB <- if (nB > 1) var(bs) else NaN
  diff <- mean(bs) - mean(as)
  if (eq) {
    df <- nA + nB - 2
    ss <- (if (nA > 1) (nA - 1) * vA else 0) + (if (nB > 1) (nB - 1) * vB else 0)
    se <- sqrt(ss / df * (1 / nA + 1 / nB))
  } else {
    se <- sqrt(vA / nA + vB / nB)
    df <- se^4 / ((vA / nA)^2 / (nA - 1) + (vB / nB)^2 / (nB - 1))
  }
  r <- closed(diff, se, df, alt, level)
  tt <- tryCatch(t.test(bs, as, var.equal = eq, alternative = alt, conf.level = level),
                 error = function(e) NULL)
  if (!is.null(tt)) {
    r2 <- from_htest(tt)
    check(r, r2)
    r <- r2
  }
  list(t = r$t, df = r$df, p = r$p, meanA = mean(as) + shift, meanB = mean(bs) + shift,
       sdA = sqrt(vA), sdB = sqrt(vB), nA = nA, nB = nB, diff = diff, seDiff = se,
       ciLo = r$ci[1], ciHi = r$ci[2], rSquared = eta2(r$t, r$df))
}

one_sample <- function(d, params) {
  alt <- alt_of(params); level <- level_of(params)
  n <- length(d)
  se <- sd(d) / sqrt(n)
  r <- closed(mean(d), se, n - 1, alt, level)
  tt <- tryCatch(t.test(d, alternative = alt, conf.level = level), error = function(e) NULL)
  if (!is.null(tt)) {
    r2 <- from_htest(tt)
    check(r, r2)
    r <- r2
  }
  list(t = r$t, df = r$df, p = r$p, mean = mean(d), sd = sd(d), se = se, ciLo = r$ci[1],
       ciHi = r$ci[2], n = n, rSquared = eta2(r$t, r$df))
}

paired <- function(a, b, params) {
  d <- b - a
  out <- one_sample(d, params)
  tt <- tryCatch(t.test(b, a, paired = TRUE, alternative = alt_of(params),
                        conf.level = level_of(params)), error = function(e) NULL)
  if (!is.null(tt)) stopifnot(isTRUE(all.equal(unname(tt$statistic), out$t, tolerance = 1e-12)))
  n <- length(a)
  ct <- tryCatch(cor.test(a, b, alternative = "greater"), error = function(e) NULL)
  c(out, list(
    meanA = mean(a), meanB = mean(b),
    pairingR = if (n >= 2) cor(a, b) else NaN,
    pairingP = if (is.null(ct)) NaN else ct$p.value
  ))
}

ratio <- function(a, b, params) {
  if (any(a <= 0) || any(b <= 0)) {
    nan <- NaN
    return(list(t = nan, df = length(a) - 1, p = nan, mean = nan, sd = nan, se = nan,
                ciLo = nan, ciHi = nan, n = length(a), rSquared = nan, ratio = nan,
                ratioCiLo = nan, ratioCiHi = nan))
  }
  out <- one_sample(log10(b / a), params)
  c(out, list(ratio = 10^out$mean, ratioCiLo = 10^out$ciLo, ratioCiHi = 10^out$ciHi))
}

summary_test <- function(A, B, params) {
  alt <- alt_of(params); level <- level_of(params)
  eq <- if (is.null(params$equalVariance)) TRUE else params$equalVariance
  vA <- A$sd^2; vB <- B$sd^2
  diff <- B$mean - A$mean
  if (eq) {
    df <- A$n + B$n - 2
    se <- sqrt(((A$n - 1) * vA + (B$n - 1) * vB) / df * (1 / A$n + 1 / B$n))
  } else {
    se <- sqrt(vA / A$n + vB / B$n)
    df <- se^4 / ((vA / A$n)^2 / (A$n - 1) + (vB / B$n)^2 / (B$n - 1))
  }
  r <- closed(diff, se, df, alt, level)
  if (se > 0) {
    bs <- BSDA::tsum.test(mean.x = B$mean, s.x = B$sd, n.x = B$n, mean.y = A$mean, s.y = A$sd,
                          n.y = A$n, alternative = alt, var.equal = eq, conf.level = level)
    h <- from_htest(bs)
    # tsum.test reports the open end of a one-sided interval as NA
    stopifnot(all(is.infinite(r$ci[is.na(h$ci)])))
    h$ci[is.na(h$ci)] <- r$ci[is.na(h$ci)]
    check(r, h)
  }
  list(t = r$t, df = r$df, p = r$p, meanA = A$mean, meanB = B$mean, sdA = A$sd, sdB = B$sd,
       nA = A$n, nB = B$n, diff = diff, seDiff = se, ciLo = r$ci[1], ciHi = r$ci[2],
       rSquared = eta2(r$t, r$df))
}

# Missing values (null in a case, NA here; audit 3, S8): an unpaired test leaves them out of their
# group, as t.test() does; a paired or ratio test leaves out each pair holding one, as
# t.test(paired = TRUE) does. The app does the same before the statistics run (its analyses), so
# these cases are checked through the analyses (analyses/test/oracleMissing.test.ts).
oracle <- function(input, params) {
  test <- if (is.null(params$test)) "unpaired" else params$test
  a <- input$a; b <- input$b
  if (test %in% c("paired", "ratio")) {
    keep <- !is.na(a) & !is.na(b)
    a <- a[keep]; b <- b[keep]
  } else if (test == "unpaired") {
    a <- a[!is.na(a)]; b <- b[!is.na(b)]
  }
  switch(test,
    unpaired = unpaired(a, b, params),
    paired = paired(a, b, params),
    ratio = ratio(a, b, params),
    summary = summary_test(input$A, input$B, params),
    stop("unknown test ", test))
}
