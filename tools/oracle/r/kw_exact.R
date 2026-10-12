# The exact P value of the Kruskal-Wallis test (roadmap 51c, S11): every way of dealing the
# observed (mid-)ranks into groups of the observed sizes is equally likely under H0; P is the
# share of arrangements whose statistic is at least the observed one.
#
# Statistic: sum over groups of R_j^2 / n_j (R_j the rank sum), which orders arrangements as the
# tie-corrected H does for fixed N, sizes and ties. Computed exactly: ranks doubled (integers)
# and weights L / n_j, L the least common multiple of the sizes.
#
# Enumeration: every subset of the pooled positions for group 1 (combn), then for group 2 from
# the rest, ...; the last group's rank sum is the remainder. Independent of the TS code (which
# walks the combinations in its own order).
#
# Cross-check: coin::kruskal_test(distribution = approximate(nresample = 2e5)), seeded; its
# Monte Carlo estimate must be within 5 standard errors of the exact P. (coin has no exact
# k-sample distribution; the Monte Carlo is a second, independent check of the enumeration.)
# Also reported: kruskal.test's chi-square P (the approximation the analysis falls back to).

PACKAGES <- c("coin")

suppressPackageStartupMessages(library(coin))

gcd <- function(a, b) if (b == 0) a else gcd(b, a %% b)

oracle <- function(input, params) {
  groups <- input$groups
  if (is.matrix(groups)) groups <- lapply(seq_len(nrow(groups)), function(i) groups[i, ])
  groups <- lapply(groups, function(g) g[!is.na(g)])
  n <- vapply(groups, length, 0L)
  k <- length(groups)
  y <- unlist(groups)
  r <- as.integer(round(2 * rank(y)))
  L <- Reduce(function(a, b) a * b / gcd(a, b), n)
  w <- L / n
  start <- cumsum(c(0, n))[seq_len(k)]
  sums <- vapply(seq_len(k), function(j) sum(r[start[j] + seq_len(n[j])]), 0)
  t_obs <- sum(w * sums^2)
  total <- sum(r)
  hits <- 0
  leaves <- 0
  # Deal group g from the pool (the positions still free), the earlier groups adding `acc`.
  deal <- function(g, pool, acc, left) {
    if (g == k - 1) {
      cm <- combn(length(pool), n[g])
      s <- colSums(matrix(r[pool[cm]], nrow = n[g]))
      rest <- left - s
      tt <- acc + w[g] * s^2 + w[k] * rest^2
      hits <<- hits + sum(tt >= t_obs)
      leaves <<- leaves + length(s)
      return(invisible())
    }
    cm <- combn(length(pool), n[g])
    for (c in seq_len(ncol(cm))) {
      pick <- pool[cm[, c]]
      s <- sum(r[pick])
      deal(g + 1, setdiff(pool, pick), acc + w[g] * s^2, left - s)
    }
  }
  deal(1, seq_along(y), 0, total)
  arrangements <- factorial(sum(n)) / prod(factorial(n))
  stopifnot(leaves == round(arrangements))
  p <- hits / leaves
  g <- factor(rep(seq_len(k), n))
  set.seed(51)
  mc <- pvalue(kruskal_test(y ~ g, distribution = approximate(nresample = 2e5)))
  se <- sqrt(p * (1 - p) / 2e5)
  stopifnot(abs(as.numeric(mc) - p) <= 5 * se + 1e-12)
  kw <- kruskal.test(groups)
  list(p = p, arrangements = leaves, pApprox = kw$p.value, H = unname(kw$statistic))
}
