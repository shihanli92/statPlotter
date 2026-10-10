# Contingency tables as GraphPad Prism documents them (Statistics Guide, "Contingency tables").
#
# Chi-square     Pearson, expected r_i c_j / N; df (r-1)(c-1); a zero margin gives NaN (as R).
#                Yates (2x2 only): sum((|O - E| - 1/2)^2 / E) with NO cap -- Prism's guide
#                ("Chi-square or Fisher's test?") says it applies the correction even when
#                |O - E| < 1/2; R's chisq.test caps it at |O - E|. Checked against chisq.test
#                wherever the two definitions agree.
# Fisher         fisher.test (two-sided = sum of probabilities <= observed x (1 + 1e-7),
#                Prism's "method of summing small P values"); 2x2 also alternative less and
#                greater. r x c: FEXACT (network algorithm) -- the TS side has its own network
#                algorithm (columns as stages, merged pasts, closed-form completion sums).
# Trend          Cochran-Armitage with scores 1..k, first column = success (Prism; Altman
#                1991 pp. 261-265): prop.trend.test, cross-checked by the closed form.
# 2x2 estimates  rows = groups (row 1 treated/exposed), columns = outcome (col 1 present).
#   Relative risk     Koopman asymptotic score (Prism's recommended method), hand-coded as in
#                     Fagerland, Lydersen & Laake (2017, sec. 4.7): roots of
#                     T(phi) = (p1 - phi p2)/sqrt(p1~(1 - p1~)/n1 + phi^2 p2~(1 - p2~)/n2) = +/- z
#                     with the constrained MLEs, solved on log(phi) to 1e-15. Cross-checked
#                     against PropCIs::riskscoreci (closed-form cubic) and
#                     contingencytables::Koopman_asymptotic_score_CI_2x2 (uniroot tol 1e-7).
#                     x1 = 0 -> lower 0; x2 = 0 -> upper Inf; x1 = x2 = 0 -> [0, Inf]; an
#                     empty row -> NaN.
#   Difference        p1 - p2, Newcombe hybrid score (1998, method 10) and with continuity
#                     correction (method 11), which Prism recommends and uses by default here.
#                     Hand-coded; method 10 cross-checked against
#                     contingencytables::Newcombe_hybrid_score_CI_2x2, and both reproduce
#                     Newcombe's worked example (case t2x2_newcombe).
#   NNT               1/difference; limits 1/upper and 1/lower of the difference (Prism takes
#                     "the reciprocal of both confidence limits"); lower > upper when the
#                     difference's CI contains 0. null when the difference is 0 or NaN.
#   Odds ratio        ad/bc, Baptista-Pike exact conditional interval (Prism's recommended
#                     method): inf/sup of {theta: P(theta) > alpha}, P the two-sided "sum of
#                     small probabilities" P value under the non-central hypergeometric
#                     distribution (tolerance 1 + 1e-7 as fisher.test). Found by going out
#                     until P << alpha, scanning log(theta) inward in steps of 0.001 (the TS
#                     code uses 0.01) and bisecting to 1e-15. Cross-checked against
#                     exact2x2(tsmethod = "minlike")'s matching interval at 1e-4.
#                     (contingencytables' Baptista-Pike function is not used: in 3.1.0 its
#                     exact and mid-P versions share one helper and both return the mid-P
#                     interval.) a at the bottom/top of its support -> lower 0 / upper Inf;
#                     a one-point support -> [0, Inf].
#   Sens., spec., PPV, NPV   (Prism's diagnostic layout: row 1 = has the condition, column 1 =
#                     test positive) a/(a+b), d/(c+d), a/(a+c), d/(b+d) with the Wilson/Brown
#                     hybrid (see binomial.R); likelihood ratio = sens / (1 - spec).
# McNemar        mcnemar.test (continuity-corrected; no correction when b = c) and the exact
#                binomial test of b of b + c at 1/2 (binom.test; 1 when b + c = 0).
# params$confLevel (default 0.95).

PACKAGES <- c("PropCIs", "exact2x2", "contingencytables")
suppressPackageStartupMessages({
  library(PropCIs)
  library(exact2x2)
  library(contingencytables)
})

bisect <- function(f, lo, hi) {
  flo <- f(lo)
  if (flo == 0) return(lo)
  for (i in 1:400) {
    mid <- (lo + hi) / 2
    if (mid == lo || mid == hi || hi - lo <= 1e-15 * max(1, abs(mid))) break
    fm <- f(mid)
    if (fm == 0) return(mid)
    if (sign(fm) == sign(flo)) { lo <- mid; flo <- fm } else hi <- mid
  }
  (lo + hi) / 2
}

# Root of a decreasing function, stepping out from `start` with doubling steps.
decreasing_root <- function(G, start) {
  g0 <- G(start)
  if (g0 == 0) return(start)
  dir <- if (g0 > 0) 1 else -1
  inner <- start; step <- 1
  for (i in 1:12) {
    outer <- start + dir * step
    g <- G(outer)
    if (sign(g) != sign(g0)) {
      r <- uniroot(G, sort(c(inner, outer)), tol = 1e-15, maxiter = 1000)$root
      return(r)
    }
    inner <- outer; step <- step * 2
  }
  NaN
}

koopman <- function(x1, n1, x2, n2, z) {
  value <- (x1 / n1) / (x2 / n2)
  if (n1 == 0 || n2 == 0) return(list(value = value, lower = NaN, upper = NaN))
  if (x1 == 0 && x2 == 0) return(list(value = value, lower = 0, upper = Inf))
  N <- n1 + n2; p1h <- x1 / n1; p2h <- x2 / n2
  T <- function(lphi) {
    phi <- exp(lphi)
    A <- phi * (n1 + x2) + x1 + n2
    disc <- max(0, A^2 - 4 * phi * N * (x1 + x2))
    p2 <- 2 * (x1 + x2) / (A + sqrt(disc))
    p1 <- phi * p2
    (p1h - phi * p2h) / sqrt(p1 * (1 - p1) / n1 + phi^2 * p2 * (1 - p2) / n2)
  }
  start <- if (is.finite(value) && value > 0) log(value) else 0
  if (is.nan(T(start))) start <- start + 1e-3
  lower <- if (x1 == 0) 0 else exp(decreasing_root(function(u) T(u) - z, start))
  upper <- if (x2 == 0) Inf else exp(decreasing_root(function(u) T(u) + z, start))
  if (x1 > 0 && x2 > 0 && x1 < n1 && x2 < n2) {
    conf <- 2 * pnorm(z) - 1
    pc <- riskscoreci(x1, n1, x2, n2, conf)$conf.int
    stopifnot(isTRUE(all.equal(c(lower, upper), as.vector(pc), tolerance = 1e-6)))
    ct <- Koopman_asymptotic_score_CI_2x2(matrix(c(x1, x2, n1 - x1, n2 - x2), 2),
                                          alpha = 1 - conf)
    stopifnot(isTRUE(all.equal(c(lower, upper), c(ct$lower, ct$upper), tolerance = 1e-5)))
  }
  list(value = value, lower = lower, upper = upper)
}

wilson_limits <- function(x, n, z, cc) {
  p <- x / n
  if (!cc) {
    center <- (x + z^2 / 2) / (n + z^2)
    half <- z * sqrt(n) / (n + z^2) * sqrt(p * (1 - p) + z^2 / (4 * n))
    return(c(if (x == 0) 0 else center - half, if (x == n) 1 else center + half))
  }
  q <- 1 - p
  den <- 2 * (n + z^2)
  l <- if (x == 0) 0 else (2 * n * p + z^2 - 1 - z * sqrt(z^2 - 2 - 1 / n + 4 * p * (n * q + 1))) / den
  u <- if (x == n) 1 else (2 * n * p + z^2 + 1 + z * sqrt(z^2 + 2 - 1 / n + 4 * p * (n * q - 1))) / den
  c(max(0, l), min(1, u))
}

newcombe <- function(x1, n1, x2, n2, z, cc) {
  p1 <- x1 / n1; p2 <- x2 / n2; d <- p1 - p2
  if (n1 == 0 || n2 == 0) return(list(value = d, lower = NaN, upper = NaN))
  w1 <- wilson_limits(x1, n1, z, cc); w2 <- wilson_limits(x2, n2, z, cc)
  lower <- max(-1, d - sqrt((p1 - w1[1])^2 + (w2[2] - p2)^2))
  upper <- min(1, d + sqrt((w1[2] - p1)^2 + (p2 - w2[1])^2))
  if (!cc) {
    ref <- Newcombe_hybrid_score_CI_2x2(matrix(c(x1, x2, n1 - x1, n2 - x2), 2),
                                        alpha = 2 * pnorm(-z))
    stopifnot(isTRUE(all.equal(c(lower, upper), c(ref$lower, ref$upper), tolerance = 1e-12)))
  }
  list(value = d, lower = lower, upper = upper)
}

baptista_pike <- function(a, b, c, d, z) {
  value <- (a * d) / (b * c)
  alpha <- 2 * pnorm(-z)
  m <- a + c; n <- b + d; k <- a + b
  lo <- max(0, k - n); hi <- min(k, m)
  if (lo == hi) return(list(value = value, lower = 0, upper = Inf))
  xs <- lo:hi
  logc <- dhyper(xs, m, n, k, log = TRUE)
  P <- function(lt) {
    v <- logc + xs * lt
    w <- exp(v - max(v))
    obs <- w[a - lo + 1] * (1 + 1e-7)
    sum(w[w <= obs]) / sum(w)
  }
  center <- log((a + 0.5) * (d + 0.5) / ((b + 0.5) * (c + 0.5)))
  h <- 0.001
  limit <- function(dir) {
    step <- 1; outer <- center + dir * step
    for (i in 1:12) {
      if (P(outer) <= alpha * 1e-3) break
      step <- step * 2; outer <- center + dir * step
    }
    prev <- outer
    for (i in 1:1e7) {
      u <- outer - dir * i * h
      if (P(u) > alpha) {
        return(exp(bisect(function(v) if (P(v) > alpha) 1 else -1, min(prev, u), max(prev, u))))
      }
      prev <- u
    }
    NaN
  }
  lower <- if (a == lo) 0 else limit(-1)
  upper <- if (a == hi) Inf else limit(1)
  ref <- exact2x2(matrix(c(a, c, b, d), 2), tsmethod = "minlike", conf.level = 1 - alpha)$conf.int
  fin <- is.finite(c(lower, upper)) & c(lower, upper) > 0
  stopifnot(isTRUE(all.equal(c(lower, upper)[fin], as.vector(ref)[fin], tolerance = 1e-4)))
  list(value = value, lower = lower, upper = upper)
}

# Wilson/Brown hybrid, as binomial.R.
wilson_brown <- function(x, n, conf) {
  if (n == 0) return(list(value = NaN, lower = NaN, upper = NaN))
  z <- qnorm(1 - (1 - conf) / 2); alpha <- 1 - conf
  lim <- wilson_limits(x, n, z, FALSE)
  xstar <- function(v) v == 1 || v == 2 || (v == 3 && n > 50)
  if (x != n && xstar(x)) lim[1] <- 0.5 * qchisq(alpha, 2 * x) / n
  if (x != 0 && xstar(n - x)) lim[2] <- 1 - 0.5 * qchisq(alpha, 2 * (n - x)) / n
  if (x > 0 && x < n) {
    pt <- suppressWarnings(prop.test(x, n, conf.level = conf, correct = FALSE)$conf.int)
    w <- wilson_limits(x, n, z, FALSE)
    stopifnot(isTRUE(all.equal(w, as.vector(pt), tolerance = 1e-12)))
  }
  list(value = x / n, lower = lim[1], upper = lim[2])
}

chi_prism <- function(tab, yates) {
  rs <- rowSums(tab); cs <- colSums(tab); N <- sum(tab)
  E <- outer(rs, cs) / N
  D <- if (yates) abs(tab - E) - 0.5 else tab - E
  chi <- sum(D^2 / E)
  df <- (nrow(tab) - 1) * (ncol(tab) - 1)
  if (all(E > 0) && (!yates || all(abs(tab - E) >= 0.5))) {
    ref <- suppressWarnings(chisq.test(tab, correct = yates))
    stopifnot(isTRUE(all.equal(unname(ref$statistic), chi, tolerance = 1e-12)))
  }
  list(chiSq = chi, df = df, p = pchisq(chi, df, lower.tail = FALSE), expected = E)
}

oracle <- function(input, params) {
  conf <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  z <- qnorm(1 - (1 - conf) / 2)
  tab <- input$table
  if (!is.matrix(tab)) tab <- do.call(rbind, tab)
  storage.mode(tab) <- "double"
  is2x2 <- nrow(tab) == 2 && ncol(tab) == 2
  out <- list(chiSquare = chi_prism(tab, FALSE))
  fi <- if (sum(tab) == 0) list(p.value = 1) else fisher.test(tab, workspace = 2e7)
  out$fisher <- list(p = fi$p.value)
  if (is2x2) {
    out$chiSquareYates <- chi_prism(tab, TRUE)
    if (sum(tab) == 0) {
      out$fisher$pLess <- 1; out$fisher$pGreater <- 1
    } else {
      out$fisher$pLess <- fisher.test(tab, alternative = "less")$p.value
      out$fisher$pGreater <- fisher.test(tab, alternative = "greater")$p.value
    }
  }
  if (ncol(tab) == 2) {
    x <- tab[, 1]; n <- rowSums(tab); N <- sum(n); R <- sum(x); s <- seq_len(nrow(tab))
    sbar <- sum(n * s) / N; p <- R / N
    chi <- sum(x * (s - sbar))^2 / (p * (1 - p) * sum(n * (s - sbar)^2))
    if (is.finite(chi)) {
      pt <- suppressWarnings(prop.trend.test(x, n))
      stopifnot(isTRUE(all.equal(unname(pt$statistic), chi, tolerance = 1e-10)))
    }
    out$trend <- list(chiSq = chi, df = 1, p = pchisq(chi, 1, lower.tail = FALSE))
  }
  if (is2x2) {
    a <- tab[1, 1]; b <- tab[1, 2]; c <- tab[2, 1]; d <- tab[2, 2]
    rd <- newcombe(a, a + b, c, c + d, z, TRUE)
    nnt <- if (is.nan(rd$value) || rd$value == 0) NULL else
      list(value = 1 / rd$value, lower = 1 / rd$upper, upper = 1 / rd$lower)
    sens <- wilson_brown(a, a + b, conf); spec <- wilson_brown(d, c + d, conf)
    out$twoByTwo <- list(
      relativeRisk = koopman(a, a + b, c, c + d, z),
      riskDifference = rd,
      riskDifferenceNoCC = newcombe(a, a + b, c, c + d, z, FALSE),
      nnt = nnt,
      oddsRatio = baptista_pike(a, b, c, d, z),
      sensitivity = sens, specificity = spec,
      ppv = wilson_brown(a, a + c, conf), npv = wilson_brown(d, b + d, conf),
      likelihoodRatio = sens$value / (1 - spec$value))
    if (b + c > 0) {
      mc <- mcnemar.test(tab)
      out$mcNemar <- list(chiSq = unname(mc$statistic), p = mc$p.value,
                          pExact = binom.test(b, b + c)$p.value)
    } else {
      out$mcNemar <- list(chiSq = NaN, p = NaN, pExact = 1)
    }
  }
  out
}
