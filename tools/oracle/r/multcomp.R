# Multiple comparisons after one-way ANOVA. input$groups: raw data; params$method selects
# the procedure; pairs are (i, j), 0-based, diff = mean_i - mean_j (default: all i < j; for
# Dunnett (control, j)).
#
# Pooled-variance methods use MSE and df from the one-way ANOVA:
#   tukey       q = sqrt(2) diff / SE; P = P(Q_{k,df} >= |q|) from the integrate() reference
#               (ref_integrals.R; cross-checked with TukeyHSD at 1e-8); simultaneous CI with the
#               critical value as the root of that reference (R's qtukey is good to only ~1e-4;
#               cross-checked with TukeyHSD's interval at 1e-3)
#   dunnett     P and critical value from the integrate() reference (Dunnett 1955), cross-checked
#               with multcomp::glht(mcp(g = "Dunnett")) single-step P values at 1e-4 (QMC)
#   bonferroni, sidak, holm, holm-sidak, fisher, bh, bky
#               per-comparison t = diff / SE (P cross-checked with pairwise.t.test(pool.sd =
#               TRUE)), adjusted with p.adjust(n = family size) / ref_padjust.R; CIs for
#               bonferroni (t at alpha/(2m)), sidak (t at (1 - (1 - alpha)^(1/m))/2) and fisher
#               (t at alpha/2); NaN otherwise.
# Unequal-variance methods (Welch SE and Welch-Satterthwaite df per pair):
#   games-howell  P from q = sqrt(2) |t| and the studentized range with k means (reference
#                 integral); stat is t, as reported for all three methods
#   dunnett-t3    |t| referred to the studentized maximum modulus with m comparisons
#                 (psmm_ref), critical value by uniroot
#   tamhane-t2    Sidak-adjusted Welch t tests
# dunn: Dunn's test on mean ranks from all groups with the tie-corrected variance, two-sided
#   normal P, Bonferroni (m P) or Sidak adjusted; cross-checked with dunn.test(altp = TRUE).

source(file.path(ORACLE_DIR, "ref_integrals.R"))
source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- c("multcomp", "dunn.test")

as_groups <- function(x) if (is.matrix(x)) lapply(seq_len(nrow(x)), function(i) x[i, ]) else x
as_pairs <- function(x) if (is.matrix(x)) lapply(seq_len(nrow(x)), function(i) x[i, ]) else x

# Critical value q_{level; k, df} / sqrt(2), as the root of the reference upper tail (R's
# qtukey is good to ~1e-4 and a root of R's ptukey only to ~1e-10).
tukey_crit <- function(level, k, df) {
  upper_quantile(function(x) ptukey_ref(x, k, df, lower = FALSE), 1 - level,
                 qtukey(level, k, df)) / sqrt(2)
}

oracle <- function(input, params) {
  groups <- as_groups(input$groups)
  k <- length(groups)
  n <- vapply(groups, length, 0L)
  means <- vapply(groups, mean, 0)
  sds <- vapply(groups, sd, 0)
  y <- unlist(groups)
  g <- factor(rep(seq_len(k), n))
  N <- length(y)
  df <- N - k
  mse <- sum((n - 1) * sds^2) / df
  method <- params$method
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  alpha <- 1 - level
  control <- params$control
  pairs <- if (!is.null(params$pairs)) as_pairs(params$pairs)
           else if (method == "dunnett") lapply(setdiff(seq_len(k) - 1, control), function(j) c(control, j))
           else unlist(lapply(0:(k - 2), function(i) lapply((i + 1):(k - 1), function(j) c(i, j))),
                       recursive = FALSE)
  i <- vapply(pairs, `[`, 0, 1); j <- vapply(pairs, `[`, 0, 2)
  all_pairs <- is.null(params$pairs)
  m <- if (is.null(params$familySize)) length(pairs) else params$familySize
  kk <- if (is.null(params$nMeans)) length(unique(c(i, j))) else params$nMeans
  ni <- n[i + 1]; nj <- n[j + 1]
  diff <- means[i + 1] - means[j + 1]

  if (method == "dunn") {
    r <- rank(y)
    mr <- as.vector(tapply(r, g, mean))
    ties <- table(y)
    S <- N * (N + 1) / 12 - sum(ties^3 - ties) / (12 * (N - 1))
    d <- mr[i + 1] - mr[j + 1]
    z <- d / sqrt(S * (1 / ni + 1 / nj))
    raw <- 2 * pnorm(-abs(z))
    p <- switch(params$adjust, bonferroni = pmin(1, m * raw), sidak = pmin(1, sidak_adj(raw, m)),
                none = raw)
    if (all_pairs) {
      invisible(capture.output(
        dt <- dunn.test::dunn.test(y, g, method = params$adjust, altp = TRUE, kw = FALSE,
                                   table = FALSE, list = FALSE)))
      # dunn.test orders comparisons as 1-2, 1-3, 2-3, 1-4, ... (column-major lower triangle)
      lab <- paste(i + 1, j + 1, sep = " - ")
      idx <- match(lab, dt$comparisons)
      stopifnot(all(abs(abs(dt$Z[idx]) - abs(z)) < 1e-10), all(abs(dt$altP.adjusted[idx] - p) < 1e-10))
    }
    return(list(i = i, j = j, meanRankDiff = d, z = z, p = p, significant = p < 0.05))
  }

  if (method %in% c("games-howell", "dunnett-t3", "tamhane-t2")) {
    vi <- sds[i + 1]^2 / ni; vj <- sds[j + 1]^2 / nj
    se <- sqrt(vi + vj)
    dfw <- (vi + vj)^2 / (vi^2 / (ni - 1) + vj^2 / (nj - 1))
    t <- diff / se
    if (method == "games-howell") {
      stat <- t  # t is reported for all three (P from q = sqrt(2) |t|)
      q <- sqrt(2) * abs(t)
      p <- mapply(function(q, d) ptukey_ref(q, kk, d, lower = FALSE), q, dfw)
      stopifnot(all(abs(p - ptukey(q, kk, dfw, lower.tail = FALSE)) < 1e-9))
      # k = 2: the Welch t test
      if (kk == 2) stopifnot(all(abs(p - 2 * pt(-abs(t), dfw)) < 1e-12))
      crit <- vapply(dfw, function(d) tukey_crit(level, kk, d), 0)
    } else if (method == "dunnett-t3") {
      stat <- t
      p <- mapply(function(x, d) psmm_ref(abs(x), m, d), t, dfw)
      crit <- vapply(dfw, function(d) upper_quantile(function(x) psmm_ref(x, m, d), alpha,
                                                    qt(1 - alpha / (2 * m), d)), 0)
    } else {
      stat <- t
      p <- pmin(1, sidak_adj(2 * pt(-abs(t), dfw), m))
      crit <- qt(1 - (-expm1(log1p(-alpha) / m)) / 2, dfw)
    }
    return(list(i = i, j = j, diff = diff, se = se, lo = diff - crit * se, hi = diff + crit * se,
                stat = stat, df = dfw, p = p, significant = p < 0.05))
  }

  se <- sqrt(mse * (1 / ni + 1 / nj))
  t <- diff / se
  raw <- 2 * pt(-abs(t), df)
  if (k > 1) {
    pw <- pairwise.t.test(y, g, p.adjust.method = "none", pool.sd = TRUE)$p.value
    stopifnot(all(abs(pw[cbind(pmax(i, j), pmin(i, j) + 1)] - raw) < 1e-12 * pmax(raw, 1e-300) +
                    1e-15))
  }
  stat <- t
  crit <- NaN
  p <- switch(method,
    tukey = {
      stat <- sqrt(2) * t
      crit <- tukey_crit(level, kk, df)
      pr <- vapply(abs(stat), ptukey_ref, 0, k = kk, df = df, lower = FALSE)
      if (all_pairs) {
        th <- TukeyHSD(aov(y ~ g), conf.level = level)$g
        row <- paste(j + 1, i + 1, sep = "-")
        stopifnot(all(abs(th[row, "p adj"] - pr) < 1e-8),
                  all(abs(-th[row, "upr"] - (diff - crit * se)) < 1e-3))
      }
      pr
    },
    dunnett = {
      nt <- n[setdiff(unique(c(i, j)), control) + 1]
      crit <- upper_quantile(function(x) pdunnett_ref(x, df, n[control + 1], nt), alpha,
                             qt(1 - alpha / (2 * length(nt)), df))
      pr <- vapply(abs(t), pdunnett_ref, 0, df = df, n0 = n[control + 1], n = nt)
      gg <- relevel(g, ref = as.character(control + 1))
      gl <- multcomp::glht(aov(y ~ gg), linfct = multcomp::mcp(gg = "Dunnett"))
      set.seed(1)
      sm <- summary(gl, test = multcomp::adjusted("single-step", abseps = 1e-7, maxpts = 2e6))
      stopifnot(all(abs(sort(sm$test$pvalues) - sort(pr)) < 1e-4))
      pr
    },
    bonferroni = {
      crit <- qt(1 - alpha / (2 * m), df)
      p.adjust(raw, "bonferroni", n = m)
    },
    sidak = {
      crit <- qt(1 - (-expm1(log1p(-alpha) / m)) / 2, df)
      pmin(1, sidak_adj(raw, m))
    },
    holm = p.adjust(raw, "holm", n = m),
    "holm-sidak" = holm_sidak(raw, m),
    fisher = {
      crit <- qt(1 - alpha / 2, df)
      raw
    },
    bh = p.adjust(raw, "BH", n = m),
    bky = bky_q(raw, 0.05, m),  # Q = the significance level, 0.05
    stop("unknown method ", method)
  )
  list(i = i, j = j, diff = diff, se = se, lo = diff - crit * se, hi = diff + crit * se,
       stat = stat, df = rep(df, length(i)), p = p, significant = p < 0.05)
}
