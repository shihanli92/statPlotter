# Pearson and Spearman correlation:
#
# pearson   cor.test(method = "pearson"): r, t on n - 2 df, P, Fisher-z CI (SE 1/sqrt(n - 3),
#           only for n > 3; NaN otherwise). params$shift: analyse x - shift (Pearson is
#           shift-invariant; exact for 1e9 + noise).
# spearman  r_s = cor(rank(x), rank(y)) (mid-ranks).
#           P: exact for n <= 17 (all possible permutations of the data; ties are no problem
#           for the exact calculation), otherwise from a t ratio computed from Rs
#           = cor.test(method = "spearman", exact = FALSE).
#             exact, no ties   pspearman::spearman.test(approximation = "exact") (exact null
#                              distribution for n <= 22); for n <= 9 also cor.test(exact = TRUE)
#                              (AS 89 enumerates for n <= 9) and brute force agree.
#             exact, ties      brute force over all n! permutations (n <= 9 only), with integer
#                              statistic sum(2rank(x) * 2rank(y)); two-sided
#                              P(|T - E T| >= |t - E T|).
#           CI: Fisher z with SE sqrt(1.060/(n - 3)) (Fieller, Hartley & Pearson 1957), the
#           approximation in Zar, Biostatistical Analysis (which, according to Zar, should
#           only be used when n > 10; ciValid = n > 10). The variance 1.060/(n - 3) is Zar's.
# params: method, alternative, confLevel, exact ("auto" / true / false; spearman only).

PACKAGES <- c("pspearman")

suppressPackageStartupMessages(library(pspearman))

alt_of <- function(params) if (is.null(params$alternative)) "two.sided" else
  switch(params$alternative, "two-sided" = "two.sided", params$alternative)

all_perms <- function(k) {
  if (k == 1) return(matrix(1L, 1, 1))
  p <- all_perms(k - 1)
  do.call(rbind, lapply(seq_len(k), function(i) cbind(i, ifelse(p >= i, p + 1L, p))))
}

brute_p <- function(x, y, alt) {
  a <- round(2 * rank(x)); b <- round(2 * rank(y)); n <- length(a)
  P <- all_perms(n)
  T <- as.vector(matrix(b[P], ncol = n) %*% a)
  t0 <- sum(a * b)
  E <- sum(a) * sum(b)  # n * E[T]
  switch(alt,
         greater = mean(T >= t0),
         less = mean(T <= t0),
         two.sided = mean(abs(n * T - E) >= abs(n * t0 - E)))
}

fisher_ci <- function(r, se, alt, level) {
  z <- atanh(r)
  ci <- switch(alt,
               less = c(-Inf, z + se * qnorm(level)),
               greater = c(z - se * qnorm(level), Inf),
               two.sided = z + c(-1, 1) * se * qnorm((1 + level) / 2))
  tanh(ci)
}

oracle <- function(input, params) {
  x <- input$x; y <- input$y
  if (!is.null(params$shift)) x <- x - params$shift
  n <- length(x)
  alt <- alt_of(params)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  df <- n - 2
  if (identical(params$method, "pearson")) {
    ct <- suppressWarnings(cor.test(x, y, alternative = alt, conf.level = level))
    r <- unname(ct$estimate)
    ci <- if (n > 3) as.numeric(ct$conf.int) else c(NaN, NaN)
    return(list(r = r, lower = ci[1], upper = ci[2], r2 = r^2, p = ct$p.value, n = n,
                t = unname(ct$statistic), df = df))
  }
  mode <- if (is.null(params$exact)) "auto" else params$exact
  exact <- if (identical(mode, "auto")) n <= 17 else isTRUE(mode)
  ties <- length(unique(x)) < n || length(unique(y)) < n
  r <- suppressWarnings(cor(rank(x), rank(y)))
  if (is.na(r)) {
    return(list(r = NaN, lower = NaN, upper = NaN, r2 = NaN, p = NaN, n = n, t = NaN, df = df,
                exact = exact, ciValid = n > 10))
  }
  t <- if (abs(r) == 1) sign(r) * Inf else sqrt(df) * r / sqrt(1 - r^2)
  if (exact) {
    if (ties) {
      stopifnot(n <= 9)
      p <- brute_p(x, y, alt)
    } else {
      p <- spearman.test(x, y, alternative = alt, approximation = "exact")$p.value
      if (n <= 9) {
        pb <- brute_p(x, y, alt)
        pc <- cor.test(x, y, method = "spearman", alternative = alt, exact = TRUE)$p.value
        stopifnot(abs(p - pb) < 1e-12, abs(p - pc) < 1e-12)
      }
    }
  } else {
    p <- suppressWarnings(cor.test(x, y, method = "spearman", alternative = alt,
                                   exact = FALSE)$p.value)
  }
  ci <- if (n > 3) fisher_ci(r, sqrt(1.06 / (n - 3)), alt, level) else c(NaN, NaN)
  list(r = r, lower = ci[1], upper = ci[2], r2 = r^2, p = p, n = n, t = t, df = df,
       exact = exact, ciValid = n > 10)
}
