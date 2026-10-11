# Two-sample Kolmogorov-Smirnov test:
#
#   d       max |F_a - F_b| (ks.test's D).
#   exact   exact when the number of permutations of n1 values from n1+n2 values is less
#           than 60,000, i.e. choose(n1 + n2, n1) < 60000 (params$exact = "auto", the default).
#           A published list of such sizes agrees except for its first line, "(2, 2) ... (2, 346)",
#           where choose(348, 2) = 60378; the formula gives (2, 344). We follow the formula.
#   p       exact: the fraction of the reshuffled data sets where the D is greater than or
#           equal to the D computed from the actual data, ties included
#           = ks.test(exact = TRUE), which since R 4.3 conditions on the tie pattern
#           (psmirnov(z = pooled data)).
#           asymptotic: Numerical Recipes (3rd ed.), whose two-sample test uses
#           Q_KS((sqrt(Ne) + 0.12 + 0.11/sqrt(Ne)) D), Ne = n1 n2/(n1 + n2) (Stephens 1970).
#           Hand-coded here with Q_KS summed to convergence. Without the correction term it is
#           R's asymptotic P, which is checked against R's C routine at tol 1e-12 (ks.test
#           itself evaluates Q_KS only to about 1e-5).
#           Other large-sample formulas exist; this is the one implemented.
#           Exact P is also computed by brute force -- every split of the pooled data into
#           samples of sizes n1 and n2, D compared as the integer n1 n2 D -- whenever
#           choose(n1 + n2, n1) * (n1 + n2) <= 5e6, and that value is used: ks.test(exact = TRUE)
#           is wrong on some tied data (e.g. case ks_ties_psmirnov: R gives 0, the true P is
#           1/78).

PACKAGES <- character(0)

qks <- function(l) {
  if (l <= 0) return(1)
  if (l < 1.18) {
    j <- 1:100
    return(1 - sqrt(2 * pi) / l * sum(exp(-(2 * j - 1)^2 * pi^2 / (8 * l^2))))
  }
  j <- 1:100
  min(1, 2 * sum((-1)^(j - 1) * exp(-2 * j^2 * l^2)))
}

# Exact P(D >= d) by enumerating all choose(m + n, m) splits of the pooled data (ties kept
# together: the ECDFs are compared only at the ends of runs of equal pooled values).
ks_enumerate <- function(a, b, d) {
  m <- length(a); n <- length(b); N <- m + n
  zs <- sort(c(a, b))
  ends <- c(which(diff(zs) != 0), N)
  combos <- combn(N, m)
  K <- ncol(combos)
  ind <- matrix(0L, N, K)
  ind[cbind(as.vector(combos), rep(seq_len(K), each = m))] <- 1L
  ca <- apply(ind, 2, cumsum)
  ca <- ca[ends, , drop = FALSE]
  # n m |F_a - F_b| at each run end, as integers.
  Dint <- apply(abs(ca * n - (ends - ca) * m), 2, max)
  sum(Dint >= round(d * m * n)) / K
}

oracle <- function(input, params) {
  a <- input$a; b <- input$b
  m <- length(a); n <- length(b)
  mode <- if (is.null(params$exact)) "auto" else params$exact
  exact <- if (identical(mode, "auto")) choose(m + n, m) < 60000 else isTRUE(mode)
  k <- suppressWarnings(ks.test(a, b, exact = exact))
  d <- unname(k$statistic)
  en <- sqrt(m * n / (m + n))
  if (exact) {
    p <- k$p.value
    if (choose(m + n, m) * (m + n) <= 5e6) {
      pe <- ks_enumerate(a, b, d)
      if (abs(pe - p) > 1e-12 * max(pe, 1e-300))
        message(sprintf("ks: ks.test exact P %.17g differs from enumeration %.17g; using the latter",
                        p, pe))
      p <- pe
    }
  } else {
    p <- qks((en + 0.12 + 0.11 / en) * d)
    # R's ks.test evaluates Q_KS with tol = 1e-6 (errors up to ~2e-5 seen); its C routine at
    # tol = 1e-12 agrees with qks to ~1e-11.
    r12 <- .Call(stats:::C_pkolmogorov_two_limit, en * d, FALSE, 1e-12)
    stopifnot(abs(qks(en * d) - r12) <= 1e-11 * r12, abs(qks(en * d) - k$p.value) < 1e-4)
  }
  list(d = d, p = p, exact = exact, nA = m, nB = n)
}
