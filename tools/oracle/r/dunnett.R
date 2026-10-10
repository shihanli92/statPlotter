# Dunnett's many-to-one distribution: P(max_i |T_i| >= t) (two-sided) or P(max_i T_i >= t)
# for k treatments against one control, T_i correlated through the shared control mean
# (rho_ij = lambda_i lambda_j, lambda_i = sqrt(n_i / (n_i + n0))) and the shared SD.
#
# Expected values:
#   p       reference by explicit integration (ref_integrals.R: Dunnett 1955 eq. 2.2 with the
#           chi mixture), upper tail integrated directly;
#   pMvt    mvtnorm::pmvt (Genz-Bretz randomised QMC, abseps 1e-9) or, for df = Inf,
#           pmvnorm(algorithm = Miwa) -- an independent algorithm, with its error estimate
#           pMvtErr (1e-10 for Miwa, which reports none; the TS test allows 5x that, and
#           skips P < 1e-6, which 1 - P(inside) cannot resolve);
#   q95/q99 critical values c with P(max <= c) = 0.95 / 0.99, by uniroot on the reference.

source(file.path(ORACLE_DIR, "ref_integrals.R"))

PACKAGES <- c("mvtnorm")

oracle <- function(input, params) {
  n0 <- input$n0; n <- input$n; df <- as.numeric(input$df); t <- input$t
  two <- isTRUE(params$twoSided)
  k <- length(n)
  lam <- sqrt(n / (n + n0))
  R <- outer(lam, lam); diag(R) <- 1
  p <- vapply(t, function(x) pdunnett_ref(if (two) abs(x) else x, df, n0, n, two), 0)
  mvt <- lapply(t, function(x) {
    lower <- if (two) rep(-abs(x), k) else rep(-Inf, k)
    upper <- rep(if (two) abs(x) else x, k)
    set.seed(1)
    v <- if (is.infinite(df)) {
      if (k == 1) pnorm(upper) - pnorm(lower)
      else mvtnorm::pmvnorm(lower, upper, corr = R, algorithm = mvtnorm::Miwa(steps = 4096))
    } else {
      if (k == 1) pt(upper, df) - pt(lower, df)
      else mvtnorm::pmvt(lower, upper, df = df, corr = R,
                         algorithm = mvtnorm::GenzBretz(maxpts = 2e6, abseps = 1e-9, releps = 0))
    }
    # Miwa reports no error; with 4096 grid steps it is good to ~1e-10 here.
    err <- attr(v, "error")
    list(p = 1 - as.numeric(v), err = if (is.null(err) || is.na(err)) 1e-10 else err)
  })
  pMvt <- vapply(mvt, `[[`, 0, "p")
  pMvtErr <- vapply(mvt, `[[`, 0, "err")
  # mvtnorm computes 1 - P(inside) and cannot resolve P values below ~1e-6.
  ok <- abs(p - pMvt) <= 5 * pMvtErr + 1e-12 | p < 1e-6
  if (!all(ok)) stop("reference disagrees with mvtnorm: ", paste(p[!ok], pMvt[!ok]))
  quant <- function(level) {
    start <- if (df == Inf) qnorm(1 - (1 - level) / (2 * k)) else qt(1 - (1 - level) / (2 * k), df)
    upper_quantile(function(x) pdunnett_ref(x, df, n0, n, two), 1 - level, start)
  }
  list(p = p, pMvt = pMvt, pMvtErr = pMvtErr, q95 = quant(0.95), q99 = quant(0.99))
}
