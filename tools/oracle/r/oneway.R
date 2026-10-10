# One-way ANOVA and companions, from raw data:
#   ordinary ANOVA      anova(lm(y ~ g)) (cross-checked with aov); r2 = SS_between / SS_total
#   Welch               oneway.test(var.equal = FALSE)
#   Brown-Forsythe      ANOVA of means for unequal variances (Brown & Forsythe 1974, original
#                       numerator df k - 1), computed explicitly
#   Bartlett            bartlett.test; null unless every group has n >= 2 and SD > 0
#   Brown-Forsythe SD   car::leveneTest(center = median), i.e. ANOVA of |x - median|; when the
#                       deviations have zero within-group SS (n = 2 per group) the F is Inf,
#                       taken from the explicit formula (lm's residuals are then only ~1e-16)
#   Kruskal-Wallis      kruskal.test (tie-corrected H, chi-square P) and mean ranks
# params$shift: the data minus shift are analysed (exact), means shifted back; see gen_cases.
# params$summary only changes the TS side (mean/SD/N input).

PACKAGES <- c("car")

# fromJSON simplifies equal-length groups to a matrix (one row per group).
as_groups <- function(x) if (is.matrix(x)) lapply(seq_len(nrow(x)), function(i) x[i, ]) else x

oracle <- function(input, params) {
  shift <- if (is.null(params$shift)) 0 else params$shift
  # Missing values (null in a case; audit 3, S8) are left out of their group, as the app does
  # (checked through the analysis: analyses/test/oracleMissing.test.ts).
  groups <- lapply(as_groups(input$groups), function(v) v[!is.na(v)] - shift)
  k <- length(groups)
  n <- vapply(groups, length, 0L)
  y <- unlist(groups)
  g <- factor(rep(seq_len(k), n))
  a <- anova(lm(y ~ g))
  av <- summary(aov(y ~ g))[[1]]
  stopifnot(isTRUE(all.equal(a[["Sum Sq"]], av[["Sum Sq"]], tolerance = 1e-12)))
  means <- vapply(groups, mean, 0)
  sds <- vapply(groups, sd, 0)
  ssb <- a[["Sum Sq"]][1]; ssw <- a[["Sum Sq"]][2]
  if (k == 2) {
    tt <- t.test(groups[[2]], groups[[1]], var.equal = TRUE)
    stopifnot(isTRUE(all.equal(unname(tt$statistic)^2, a[["F value"]][1], tolerance = 1e-10)))
  }

  bart <- if (all(n >= 2) && all(sds > 0)) {
    b <- bartlett.test(groups)
    list(chi2 = unname(b$statistic), df = unname(b$parameter), p = b$p.value)
  } else NULL

  z <- unlist(lapply(groups, function(v) abs(v - median(v))))
  zm <- tapply(z, g, mean)
  zssw <- sum((z - zm[g])^2)
  zssb <- sum(n * (zm - mean(z))^2)
  lev <- if (zssw == 0) {
    list(F = Inf, dfn = k - 1, dfd = length(y) - k, p = 0)
  } else {
    L <- car::leveneTest(y ~ g, center = median)
    stopifnot(isTRUE(all.equal(L[["F value"]][1], (zssb / (k - 1)) / (zssw / (length(y) - k)),
                               tolerance = 1e-10)))
    list(F = L[["F value"]][1], dfn = L$Df[1], dfd = L$Df[2], p = L[["Pr(>F)"]][1])
  }

  welch <- if (all(n >= 2) && all(sds > 0)) {
    w <- oneway.test(y ~ g, var.equal = FALSE)
    list(F = unname(w$statistic), dfn = unname(w$parameter[1]), dfd = unname(w$parameter[2]),
         p = w$p.value)
  } else list(F = NaN, dfn = k - 1, dfd = NaN, p = NaN)

  N <- length(y)
  gm <- sum(n * means) / N
  den <- sum((1 - n / N) * sds^2)
  cc <- (1 - n / N) * sds^2 / den
  bfF <- sum(n * (means - gm)^2) / den
  bfd <- 1 / sum(cc^2 / (n - 1))
  bf <- list(F = bfF, dfn = k - 1, dfd = bfd, p = pf(bfF, k - 1, bfd, lower.tail = FALSE))

  kw <- kruskal.test(groups)
  r <- rank(y)
  list(
    groups = lapply(seq_len(k), function(i) list(n = n[i], mean = means[i] + shift, sd = sds[i],
                                                 sem = sds[i] / sqrt(n[i]))),
    ssBetween = ssb, ssWithin = ssw, ssTotal = ssb + ssw,
    dfBetween = a$Df[1], dfWithin = a$Df[2],
    msBetween = a[["Mean Sq"]][1], msWithin = a[["Mean Sq"]][2],
    F = a[["F value"]][1], p = a[["Pr(>F)"]][1], r2 = ssb / (ssb + ssw),
    bartlett = bart, brownForsythe = lev,
    welch = welch, brownForsytheAnova = bf,
    kruskalWallis = list(H = unname(kw$statistic), df = unname(kw$parameter), p = kw$p.value,
                         meanRanks = as.vector(tapply(r, g, mean)), n = n)
  )
}
