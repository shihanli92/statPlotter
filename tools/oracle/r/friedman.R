# Friedman test and Dunn's post test, as Prism documents them:
#   https://www.graphpad.com/guides/prism/latest/statistics/how_the_friedman_test_works.htm
#   https://www.graphpad.com/guides/prism/latest/statistics/stat_how_the_dunn_method_for_nonpar.htm
#
# input$rows: subjects x treatments (complete rows only).
#
#   stat, df, p   friedman.test (chi-square corrected for ties within rows; P from chi^2(k-1)).
#                 Whether Prism applies the ties correction is undocumented.
#   pExact        Prism: exact P when (k!)^n <= 1e9 ("When that value exceeds 10^9, Prism uses
#                 the approximate method"), "examining all possible rearrangements of the
#                 values, keeping each value in the same row", ties included (Prism 6+).
#                 P = P(stat >= observed) over all (k!)^n rearrangements. Computed here by brute
#                 force when (k!)^n <= 2e6, otherwise by a DP over (sorted) column-sum vectors
#                 that is itself checked against brute force on every case small enough.
#                 null when the rule says approximate. Exact comparisons (integer 2x ranks).
#   dunn          Prism's Dunn test after Friedman: z = (mean rank_i - mean rank_j) /
#                 sqrt(k(k+1)/(6n)), no tie correction, P = 2(1 - Phi(|z|)), times the number
#                 of comparisons (bonferroni) / Sidak / none, for every pair i < j (0-based).
#                 Hand-coded: the same statistic as PMCMRplus::frdAllPairsSiegelTest (Siegel &
#                 Castellan 1988), which could not be installed here (Rmpfr needs MPFR headers).
# params$exact: "auto" (default) / true / false.

PACKAGES <- character(0)

as_rows <- function(x) if (is.matrix(x)) x else do.call(rbind, x)

all_perms <- function(k) {
  if (k == 1) return(matrix(1L, 1, 1))
  p <- all_perms(k - 1)
  do.call(rbind, lapply(seq_len(k), function(i) cbind(i, ifelse(p >= i, p + 1L, p))))
}

# Brute force: every combination of one permutation per row.
exact_brute <- function(sc) {
  n <- nrow(sc); k <- ncol(sc)
  P <- all_perms(k)
  obs <- sum(colSums(sc)^2)
  idx <- as.matrix(expand.grid(rep(list(seq_len(nrow(P))), n)))
  sums <- matrix(0, nrow(idx), k)
  for (r in seq_len(n)) {
    perm_rows <- matrix(sc[r, ][t(P)], ncol = k, byrow = TRUE)  # each row: sc[r, P[m, ]]
    sums <- sums + perm_rows[idx[, r], , drop = FALSE]
  }
  mean(rowSums(sums^2) >= obs)
}

# DP over multisets of column sums (every permutation of each row, with multiplicity).
exact_dp <- function(sc) {
  n <- nrow(sc); k <- ncol(sc)
  P <- all_perms(k)
  obs <- sum(colSums(sc)^2)
  states <- list(); w <- numeric(0)
  key0 <- paste(sort(sc[1, ]), collapse = ",")
  states[[key0]] <- sort(sc[1, ]); w[key0] <- factorial(k)
  for (r in seq_len(n)[-1]) {
    rowp <- matrix(sc[r, ][t(P)], ncol = k, byrow = TRUE)
    nw <- numeric(0); ns <- list()
    for (key in names(states)) {
      s <- states[[key]]
      cand <- sweep(rowp, 2, s, "+")
      cand <- t(apply(cand, 1, sort))
      keys <- apply(cand, 1, paste, collapse = ",")
      agg <- tapply(rep(w[[key]], length(keys)), keys, sum)
      for (kk in names(agg)) {
        if (is.null(ns[[kk]])) { ns[[kk]] <- as.numeric(strsplit(kk, ",")[[1]]); nw[kk] <- 0 }
        nw[kk] <- nw[kk] + agg[[kk]]
      }
    }
    states <- ns; w <- nw
  }
  q <- vapply(states, function(s) sum(s^2), 0)
  sum(w[names(states)][q >= obs]) / sum(w)
}

oracle <- function(input, params) {
  y <- as_rows(input$rows)
  n <- nrow(y); k <- ncol(y)
  f <- friedman.test(y)
  r <- t(apply(y, 1, rank))
  R <- colSums(r)
  sc <- round(2 * r)
  mode <- if (is.null(params$exact)) "auto" else params$exact
  exact <- if (identical(mode, "auto")) factorial(k)^n <= 1e9 else isTRUE(mode)
  pExact <- NULL
  if (exact) {
    total <- factorial(k)^n
    pExact <- if (total <= 2e6) exact_brute(sc) else exact_dp(sc)
    if (total <= 2e6 && n > 1) stopifnot(abs(exact_dp(sc) - pExact) < 1e-14)
  }
  se <- sqrt(n * k * (k + 1) / 6)
  pairs <- t(combn(k, 2))
  m <- nrow(pairs)
  dunn <- lapply(c(none = "none", bonferroni = "bonferroni", sidak = "sidak"), function(method) {
    lapply(seq_len(m), function(q) {
      i <- pairs[q, 1]; j <- pairs[q, 2]
      z <- (R[i] - R[j]) / se
      p <- 2 * pnorm(abs(z), lower.tail = FALSE)
      pAdj <- switch(method, none = p, bonferroni = min(1, m * p), sidak = -expm1(m * log1p(-p)))
      list(i = i - 1, j = j - 1, rankSumDiff = unname(R[i] - R[j]),
           meanRankDiff = unname((R[i] - R[j]) / n), z = unname(z), p = unname(p),
           pAdj = unname(pAdj))
    })
  })
  list(
    stat = unname(f$statistic), df = unname(f$parameter), p = f$p.value,
    pExact = pExact,
    rankSums = unname(R), meanRanks = unname(R / n), n = n, k = k,
    dunn = dunn
  )
}
