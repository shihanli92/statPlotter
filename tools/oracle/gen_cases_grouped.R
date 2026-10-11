# Generates the Phase 11 oracle cases (grouped-table statistics: multiple t tests, multiple
# one-way ANOVAs, three-way ANOVA, effect sizes, Newman-Keuls, test for trend, row statistics,
# fraction of total, stacks of P values) with fixed seeds, separately from the earlier
# generators so their cases are never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_grouped.R

source("lib.R")
unbox <- jsonlite::unbox

write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (!is.null(params)) case$params <- lapply(params, unbox)
  if (!is.null(tol)) case$tol <- lapply(tol, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, json_verbatim = TRUE,
                    na = "string"),
             file.path(dir, paste0(name, ".json")))
}

# Rows of a grouped table with two data sets: list(a = values, b = values), NA = empty cell.
rows_json <- function(rows) {
  structure(toJSON(lapply(rows, function(r) list(a = r$a, b = r$b)), digits = I(17),
                   na = "string", auto_unbox = FALSE), class = "json")
}
two_group_rows <- function(k, reps, effects, sd = 1, mean = 10, na = 0, round_to = NULL) {
  lapply(seq_len(k), function(i) {
    a <- rnorm(reps, mean, sd)
    b <- rnorm(reps, mean + effects[(i - 1) %% length(effects) + 1], sd)
    if (!is.null(round_to)) { a <- round(a, round_to); b <- round(b, round_to) }
    if (na > 0) {
      a[sample(reps, sample(0:na, 1))] <- NA
      b[sample(reps, sample(0:na, 1))] <- NA
    }
    list(a = a, b = b)
  })
}

# ---- multiple t tests ---------------------------------------------------------------------------
set.seed(1101)
r <- two_group_rows(12, 4, c(0, 0, 3, 0, 1.5, 0, 4, 0.5), na = 1)
r[[5]] <- list(a = c(9.1, NA, NA, NA), b = c(10.2, 11.0, NA, 12.5))   # Welch: too few in A
r[[9]] <- list(a = c(NA, NA, NA, NA), b = c(1, 2, 3, NA))             # empty group
write_case("multiple_t", "welch_bky", list(rows = rows_json(r)),
           params = list(method = "welch", family = "bky", q = 0.01),
           note = "Welch (the default) with two-stage step-up FDR at Q = 1%; rows 5 and 9 can't be tested.")
write_case("multiple_t", "unpaired_bh", list(rows = rows_json(r)),
           params = list(method = "unpaired", family = "bh", q = 0.05))
write_case("multiple_t", "pooled_holm", list(rows = rows_json(r)),
           params = list(method = "pooled", family = "holm-sidak", alpha = 0.05),
           note = "Consistent SD across rows: row 5 (1 value vs 3) is tested with the pooled SD.")

# Audit 3 (RTA-2): lognormal tests leave values <= 0 out of their row (paired: the pairs holding
# one) and test it when two values (pairs) per group remain (as R's t.test of the positive
# values' log10).
zr <- list(
  list(a = c(0, 2.1, 3.3, 4.2), b = c(5.5, 6.1, 7.9, NA)),   # a zero: 3 vs 3 (paired: 2 pairs)
  list(a = c(1.2, 1.9, 2.4, 1.1), b = c(0, 0, 3.1, 4.4)),    # two zeros: 4 vs 2
  list(a = c(0, 0, 0, 2.2), b = c(1, 2, 3, 4)),              # one value > 0 left in A: skipped
  list(a = c(2.2, 3.1, 2.8, 3.9), b = c(4.1, 5.2, 6.3, 4.4)), # none
  list(a = c(1.5, -0.5, 2.5, 3.5), b = c(2, 2.6, 0, 4.1)))   # a negative value and a zero
write_case("multiple_t", "lognormal_zeros_welch", list(rows = rows_json(zr)),
           params = list(method = "welch", lognormal = TRUE, family = "bky", q = 0.01),
           note = "Values <= 0 left out of their row; row 3 keeps one value in A (skipped).")
write_case("multiple_t", "lognormal_zeros_pooled", list(rows = rows_json(zr)),
           params = list(method = "pooled", lognormal = TRUE, family = "bh", q = 0.05),
           note = "The pooled SD over the rows tested, their values <= 0 left out.")
write_case("multiple_t", "ratio_paired_zeros", list(rows = rows_json(zr)),
           params = list(method = "paired", lognormal = TRUE, family = "bonferroni",
                         alpha = 0.05),
           note = "Pairs holding a value <= 0 left out; row 3 keeps one pair (skipped).")

set.seed(1102)
r <- two_group_rows(8, 5, c(0, 2, -2.5, 0.3), sd = 1.5, mean = 50)
r[[3]] <- list(a = c(1, 1, NA, NA, NA), b = c(NA, 7, NA, NA, NA))     # 1 vs 1: pooled only
write_case("multiple_t", "pooled_summary_sidak", list(rows = rows_json(r)),
           params = list(method = "pooled", family = "sidak", alpha = 0.05, summary = TRUE),
           note = "TS side analyses mean/SD/N of each cell (summary data); row 3 (1 vs 1) is tested with the pooled SD.")
write_case("multiple_t", "welch_summary_bonferroni", list(rows = rows_json(r)),
           params = list(method = "welch", family = "bonferroni", alpha = 0.05, summary = TRUE))

set.seed(1103)
r <- lapply(1:10, function(i) {
  a <- rnorm(6, 20, 3)
  b <- a + rnorm(6, c(0, 1.5, 0, 3, 0)[(i - 1) %% 5 + 1], 1)
  if (i %% 3 == 0) b[2] <- NA
  if (i == 7) a[5] <- NA
  list(a = a, b = b)
})
r[[4]] <- list(a = c(1, 2, 3, NA, NA, NA), b = c(2, 3, 4, NA, NA, NA))  # constant differences
write_case("multiple_t", "paired_by", list(rows = rows_json(r)),
           params = list(method = "paired", family = "by", q = 0.05),
           note = "Paired by subcolumn; incomplete pairs dropped; row 4's differences are all 1 (skipped).")
write_case("multiple_t", "wilcoxon_none", list(rows = rows_json(r)),
           params = list(method = "wilcoxon", family = "none", alpha = 0.05),
           note = "Row 4: all differences equal (exact P over the sign flips).")

set.seed(1104)
r <- lapply(1:9, function(i) {
  list(a = exp(rnorm(5, 1, 0.4)), b = exp(rnorm(5, 1 + c(0, 0.8, 0)[(i - 1) %% 3 + 1], 0.4)))
})
r[[6]]$a[2] <- -1   # not positive: left out of the log scale (audit 3: the row was skipped)
write_case("multiple_t", "lognormal_welch_sidak", list(rows = rows_json(r)),
           params = list(method = "welch", lognormal = TRUE, family = "sidak", alpha = 0.05))
write_case("multiple_t", "lognormal_pooled_bky", list(rows = rows_json(r)),
           params = list(method = "pooled", lognormal = TRUE, family = "bky", q = 0.05))
r2 <- lapply(r, function(x) list(a = x$a, b = abs(x$a) * exp(rnorm(5, 0.3, 0.2))))
r2[[6]]$a[2] <- 2
write_case("multiple_t", "ratio_paired_bonferroni", list(rows = rows_json(r2)),
           params = list(method = "paired", lognormal = TRUE, family = "bonferroni", alpha = 0.05))

set.seed(1105)
r <- two_group_rows(10, 5, c(0, 3, 0, 1), sd = 2, round_to = 0)
write_case("multiple_t", "mann_whitney_ties_bky", list(rows = rows_json(r)),
           params = list(method = "mannWhitney", family = "bky", q = 0.05),
           note = "Integer data with ties: exact P conditional on the ties (coin).")
write_case("multiple_t", "ks_bh", list(rows = rows_json(r)),
           params = list(method = "kolmogorovSmirnov", family = "bh", q = 0.05))
set.seed(1106)
r <- two_group_rows(10, 4, c(0, 3, 0, 1), sd = 2)
write_case("multiple_t", "mann_whitney_bonferroni", list(rows = rows_json(r)),
           params = list(method = "mannWhitney", family = "bonferroni", alpha = 0.05))

set.seed(1107)
r <- two_group_rows(60, 3, c(rep(0, 7), 2.5, 4, 1.5), sd = 1)
write_case("multiple_t", "many_rows_welch_bky5", list(rows = rows_json(r)),
           params = list(method = "welch", family = "bky", q = 0.05),
           note = "60 rows: the two-stage procedure's second stage changes the discoveries.")
write_case("multiple_t", "many_rows_unpaired_bky1", list(rows = rows_json(r)),
           params = list(method = "unpaired", family = "bky", q = 0.01))

r <- list(list(a = c(5, 5, 5), b = c(5, 5, 5)), list(a = c(1, 2, 3), b = c(4, 5, 7)),
          list(a = c(2, 2, 2), b = c(3, 3, 3)), list(a = c(1e9 + 0.1, 1e9 + 0.3, 1e9 + 0.2),
                                                    b = c(1e9 + 0.5, 1e9 + 0.4, 1e9 + 0.9)))
write_case("multiple_t", "degenerate_unpaired", list(rows = rows_json(r)),
           params = list(method = "unpaired", family = "holm-sidak"),
           tol = list(rtol = 1e-8),
           note = "Rows 1 and 3 have no variation (skipped); row 4 sits on a 1e9 offset (rtol 1e-8: R's t.test loses digits there).")
write_case("multiple_t", "degenerate_pooled", list(rows = rows_json(r)),
           params = list(method = "pooled", family = "bky"), tol = list(rtol = 1e-8),
           note = "Pooled SD: rows without variation are still tested (their SD is 0 but the pooled SD isn't).")

# ---- multiple one-way ANOVAs ---------------------------------------------------------------------
# rows: one list of k groups per row (unequal n allowed).
mow_rows <- function(R, k, n, shifts, sd = 1) {
  lapply(seq_len(R), function(r) lapply(seq_len(k), function(j) {
    nn <- if (length(n) > 1) n[(r + j) %% length(n) + 1] else n
    rnorm(nn, 10 + shifts[[r]][j], sd)
  }))
}
set.seed(1111)
rows <- mow_rows(4, 3, c(4, 5, 3), list(c(0, 0, 0), c(0, 1.5, 3), c(0, 0.5, 0), c(2, 0, -1)))
write_case("multiple_oneway", "ordinary_tukey", list(rows = rows),
           params = list(test = "ordinary", method = "tukey"))
write_case("multiple_oneway", "ordinary_holm_sidak", list(rows = rows),
           params = list(test = "ordinary", method = "holm-sidak"))
write_case("multiple_oneway", "welch_t3", list(rows = rows),
           params = list(test = "welch", method = "dunnett-t3"))
write_case("multiple_oneway", "brown_forsythe_tamhane", list(rows = rows),
           params = list(test = "brownForsythe", method = "tamhane-t2"))
set.seed(1113)
write_case("multiple_oneway", "welch_games_howell",
           list(rows = mow_rows(3, 3, c(9, 12, 10), list(c(0, 1, 2), c(0, 0, 0), c(1, 0, 0)))),
           params = list(test = "welch", method = "games-howell"),
           note = "Games-Howell with larger groups (the multcomp oracle cross-checks R's ptukey at fractional df).")
set.seed(1112)
rows <- mow_rows(3, 4, 5, list(c(0, 0, 1, 2), c(0, 0, 0, 0), c(3, 0, 0, 0)), sd = 1.2)
write_case("multiple_oneway", "k4_sidak_vs_control", list(rows = rows),
           params = list(test = "ordinary", method = "sidak", control = 1),
           note = "Each column vs the second data set (control).")
rows <- lapply(rows, function(r) lapply(r, round))
write_case("multiple_oneway", "kruskal_wallis_dunn", list(rows = rows),
           params = list(test = "kruskalWallis", method = "dunn"),
           note = "Rounded data (ties); Dunn's test with Bonferroni correction per row.")

# ---- three-way ANOVA (2 x 2 x k: rows = factor A with k levels; data sets A-D = B x C) ----------
tw_cells <- function(k, n, eff, sd = 1, mean = 20) {
  out <- list()
  for (a in 0:(k - 1)) for (b in 0:1) for (c in 0:1) {
    nn <- if (length(n) > 1) n[(a * 4 + b * 2 + c) %% length(n) + 1] else n
    mu <- mean + eff(a, b, c)
    out[[length(out) + 1]] <- list(levels = c(a, b, c), values = rnorm(nn, mu, sd))
  }
  out
}
set.seed(1121)
write_case("threeway", "balanced_3x2x2",
           list(cells = tw_cells(3, 4, function(a, b, c) a + 2 * b + 0.5 * c + 1.5 * b * c)),
           note = "Balanced, n = 4 per cell; B x C interaction.")
set.seed(1122)
write_case("threeway", "unbalanced_2x2x2",
           list(cells = tw_cells(2, c(3, 5, 4, 2, 6), function(a, b, c) 1.2 * a * b * c - b)),
           note = "Unequal n: Type III sums of squares.")
set.seed(1123)
cl <- tw_cells(4, c(2, 3, 4), function(a, b, c) 0.3 * a + c - a * c * 0.4, sd = 2)
write_case("threeway", "unbalanced_4x2x2", list(cells = cl))
write_case("threeway", "unbalanced_4x2x2_summary", list(cells = cl),
           params = list(summary = TRUE), note = "TS side: mean/SD/N of each cell.")
set.seed(1124)
cl <- tw_cells(2, c(3, 4), function(a, b, c) 1e-3 * (a + b + c), sd = 1e-3, mean = 0)
cl <- lapply(cl, function(x) { x$values <- 1e9 + x$values; x })
write_case("threeway", "offset_1e9", list(cells = cl), params = list(shift = 1e9),
           tol = list(rtol = 1e-8),
           note = "Values near 1e9: the reference fits the data minus 1e9 (exact); rtol 1e-8 because the inputs keep only ~7 significant digits of their spread.")

# ---- test for linear trend -----------------------------------------------------------------------
grp <- function(ns, means, sd = 1) lapply(seq_along(ns), function(i) rnorm(ns[i], means[i], sd))
set.seed(1131)
write_case("trend", "k3_balanced", list(groups = grp(c(5, 5, 5), c(1, 2, 3.2))))
write_case("trend", "k5_unequal", list(groups = grp(c(4, 6, 3, 7, 5), c(10, 10.5, 12, 11, 13), 1.5)),
           note = "Unequal n: slope unweighted, SS_linear weighted by n.")
g <- grp(c(3, 8, 5, 4), c(2, 1, 3, 5))
write_case("trend", "k4_nonlinear", list(groups = g))
write_case("trend", "k4_nonlinear_summary", list(groups = g), params = list(summary = TRUE))
write_case("trend", "k2", list(groups = grp(c(4, 5), c(0, 1))))

# ---- Newman-Keuls --------------------------------------------------------------------------------
set.seed(1141)
write_case("newman_keuls", "k4_unequal", list(groups = grp(c(5, 7, 4, 6), c(10, 11.5, 10.2, 13))))
write_case("newman_keuls", "k5_balanced", list(groups = grp(rep(6, 5), c(3, 3.4, 4.8, 5, 6.1))))
write_case("newman_keuls", "k6_close", list(groups = grp(c(4, 4, 5, 5, 6, 6), c(1, 1.2, 1.1, 2.4, 2.5, 3.6), 0.6)),
           note = "Several ranges near the critical values.")

# ---- effect sizes --------------------------------------------------------------------------------
set.seed(1151)
write_case("effect_sizes", "oneway_k4", list(groups = grp(c(5, 6, 4, 7), c(1, 2, 1.5, 3))))
write_case("effect_sizes", "oneway_null", list(groups = grp(c(5, 5, 5), c(0, 0, 0))),
           note = "Small effect: omega squared can be negative.")
tw <- list()
for (r in 0:2) for (c in 0:1) tw[[length(tw) + 1]] <- list(row = unbox(r), col = unbox(c),
  values = rnorm(3 + (r + c) %% 3, r + 2 * c + r * c, 1))
write_case("effect_sizes", "twoway_unbalanced", list(cells = tw))
write_case("effect_sizes", "ttest_unpaired", list(a = rnorm(7, 10, 2), b = rnorm(9, 12, 2.5)))
write_case("effect_sizes", "ttest_small", list(a = c(3.1, 4.4, 2.9), b = c(5.2, 6.8)))
write_case("effect_sizes", "ttest_paired", list(a = c(10, 12, 9.5, 11, 13.2, 8.8),
                                                b = c(11.4, 12.9, 10.1, 13, 14.5, 9.2)),
           params = list(paired = TRUE))

# ---- row statistics ------------------------------------------------------------------------------
set.seed(1161)
rs <- lapply(1:4, function(r) lapply(1:3, function(d) {
  v <- round(rnorm(4, 10 * r + d, 2), 2)
  v[sample(4, (r + d) %% 3)] <- NA
  v
}))
rs[[4]][[2]] <- c(7.5, NA, NA, NA)   # one value: no SD / CI
write_case("row_stats", "per_data_set", list(rows = rs), params = list(scope = "perDataSet"))
write_case("row_stats", "all_data_sets", list(rows = rs), params = list(scope = "allDataSets"))
write_case("row_stats", "all_data_sets_99", list(rows = rs),
           params = list(scope = "allDataSets", confLevel = 0.99))
rs2 <- lapply(1:3, function(r) lapply(1:3, function(d) rnorm(3 + d, 5 * r, 1 + d)))
write_case("row_stats", "all_data_sets_summary", list(rows = rs2),
           params = list(scope = "allDataSets", summary = TRUE),
           note = "TS side from mean/SD/N per cell: the combined N, mean, SD, SEM and CI equal those of the pooled values.")

# ---- fraction of total -----------------------------------------------------------------------
set.seed(1171)
grid <- matrix(round(runif(20, 0, 50)), 5, 4)
grid[2, 3] <- NA; grid[5, 1] <- NA
for (d in c("column", "row", "grand"))
  write_case("fraction_total", paste0("divide_by_", d), list(grid = grid),
             params = list(divideBy = d))
grid2 <- rbind(c(0, 0, NA), c(1, 3, 4))
write_case("fraction_total", "zero_row_total", list(grid = grid2), params = list(divideBy = "row"),
           note = "A row totalling 0 gives empty (NaN) fractions.")

# ---- stack of P values -------------------------------------------------------------------------
set.seed(1181)
ps <- c(runif(30), rbeta(12, 0.2, 8))
ps <- signif(ps, 4)
for (m in list(list("bky", 0.01), list("bky", 0.05), list("bh", 0.05), list("by", 0.1)))
  write_case("pstack", paste0(m[[1]], "_q", m[[2]] * 100), list(p = ps),
             params = list(family = m[[1]], q = m[[2]]))
for (m in c("holm-sidak", "sidak", "bonferroni", "none"))
  write_case("pstack", gsub("-", "_", m), list(p = ps), params = list(family = m, alpha = 0.05))
write_case("pstack", "ties_and_ones", list(p = c(0.01, 0.01, 0.02, 1, 1, 0.0001, 0.04, 0.04)),
           params = list(family = "bky", q = 0.05))
