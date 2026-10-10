# Contingency-table additions (roadmap 18): effect sizes and comparisons of pairs of rows.
#
# Phi        2 x 2 only: |ad - bc| / sqrt(r1 r2 c1 c2) (Prism: "ranges from 0 to 1", computed
#            from the cell counts whatever the test), cross-checked as sqrt(X^2 / N) with the
#            uncorrected chisq.test statistic.
# Cramer's V sqrt(X^2 / (N (min(r, c) - 1))), X^2 = chisq.test(correct = FALSE).
# Pairwise   every pair of rows (or each row vs. the control row) tested on its own 2 x c
#            sub-table: fisher.test, or chisq.test (Yates only on a 2 x 2 pair when asked, R's
#            capped form -- the cases avoid |O - E| < 1/2). Outcome columns empty in both rows
#            are dropped; fewer than two left -> P = 1. P values corrected as one family:
#            p.adjust ("bonferroni", "BH"), Sidak and Holm-Sidak from ref_padjust.R.
# params: test ("fisher" | "chiSquare"), yates, compare ("all" | "control"), control (0-based),
#         method ("bonferroni" | "sidak" | "holm-sidak" | "bh" | "none").

source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- character(0)

oracle <- function(input, params) {
  tab <- input$table
  if (!is.matrix(tab)) tab <- do.call(rbind, tab)
  storage.mode(tab) <- "double"
  N <- sum(tab)
  chi <- unname(suppressWarnings(chisq.test(tab, correct = FALSE))$statistic)
  out <- list(cramersV = sqrt(chi / (N * (min(dim(tab)) - 1))))
  if (all(dim(tab) == 2)) {
    phi <- abs(tab[1, 1] * tab[2, 2] - tab[1, 2] * tab[2, 1]) /
      sqrt(prod(rowSums(tab)) * prod(colSums(tab)))
    stopifnot(isTRUE(all.equal(phi, sqrt(chi / N), tolerance = 1e-12)))
    out$phi <- phi
  }
  test <- if (is.null(params$test)) "fisher" else params$test
  yates <- isTRUE(params$yates)
  compare <- if (is.null(params$compare)) "all" else params$compare
  control <- if (is.null(params$control)) 0 else params$control
  method <- if (is.null(params$method)) "bonferroni" else params$method
  r <- nrow(tab)
  pairs <- if (compare == "control") {
    lapply(setdiff(seq_len(r) - 1, control), function(i) c(control, i))
  } else {
    unlist(lapply(seq_len(r - 1) - 1, function(i) lapply(seq(i + 1, r - 1), function(j) c(i, j))),
           recursive = FALSE)
  }
  rows <- lapply(pairs, function(pr) {
    sub <- tab[pr + 1, , drop = FALSE]
    sub <- sub[, colSums(sub) > 0, drop = FALSE]
    if (ncol(sub) < 2) return(list(rowA = pr[1], rowB = pr[2], chiSq = 0, df = 0, p = 1))
    ch <- suppressWarnings(chisq.test(sub, correct = yates && ncol(sub) == 2))
    p <- if (test == "fisher") fisher.test(sub)$p.value else ch$p.value
    list(rowA = pr[1], rowB = pr[2], chiSq = unname(ch$statistic), df = unname(ch$parameter),
         columns = ncol(sub), p = p)
  })
  p <- vapply(rows, function(x) x$p, 0)
  adj <- switch(method,
                bonferroni = p.adjust(p, "bonferroni"),
                sidak = pmin(1, sidak_adj(p, length(p))),
                "holm-sidak" = holm_sidak(p),
                bh = p.adjust(p, "BH"),
                none = p)
  for (i in seq_along(rows)) rows[[i]]$adjusted <- adj[i]
  out$pairwise <- rows
  out
}
