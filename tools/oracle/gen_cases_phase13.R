# Generates the Phase 13 oracle cases (data processing, frequency distribution, area under the
# curve, outliers, nested t test / one-way ANOVA) with fixed seeds, separately from the earlier
# generators so their cases are never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_phase13.R

source("lib.R")

write_case <- function(suite, name, input, params = list(), tol = NULL, note = NULL,
                       pretty = TRUE) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  js <- function(x, unbox) toJSON(x, auto_unbox = unbox, digits = I(17), na = "null", null = "null")
  if (length(params) == 0) params <- setNames(list(), character(0))
  parts <- c(sprintf('"input": %s', js(input, FALSE)), sprintf('"params": %s', js(params, TRUE)))
  if (!is.null(tol)) parts <- c(parts, sprintf('"tol": %s', js(tol, TRUE)))
  if (!is.null(note)) parts <- c(parts, sprintf('"note": %s', js(note, TRUE)))
  text <- paste0("{", paste(parts, collapse = ","), "}")
  writeLines(if (pretty) prettify(text) else text, file.path(dir, paste0(name, ".json")))
}
na_at <- function(m, idx) { m[idx] <- NA; m }

# ---- processing ------------------------------------------------------------------------------
set.seed(1301)
rows <- round(matrix(runif(15, 0.02, 0.98), 5, 3), 4)
rows[2, 3] <- NA; rows[4, 1] <- 0.5
xs <- c(0.5, 1, 2, 4, 8)
write_case("processing", "transform_every_function", list(rows = rows, x = xs),
           list(kind = "transformAll", k = 2.5))
rows2 <- matrix(c(-2, 0, 0.001, 1, 10, 150, 3.25, NA, 7, -0.5, 1e6, 2.5), 6, 2)
write_case("processing", "transform_log10_invalid", list(rows = rows2),
           list(kind = "transform", y = "log10", k = 1))
write_case("processing", "transform_x_ln_y_reciprocal",
           list(rows = rows2, x = c(1, 2, 3, 0, -1, 5)),
           list(kind = "transform", y = "reciprocal", k = 1, x = "ln", kx = 1))
write_case("processing", "transform_rank_ties", list(rows = matrix(c(3, 1, 3, NA, 2, 1, 5, 3), 4, 2)),
           list(kind = "transform", y = "rank", k = 1))
write_case("processing", "transform_round_negative_k",
           list(rows = matrix(c(1234.5, -1250, 17.49, 0.1), 4, 1)),
           list(kind = "transform", y = "round", k = -2))
set.seed(1302)
nr <- na_at(round(matrix(rnorm(18, 50, 15), 6, 3), 2), c(4, 11))
for (cfg in list(
  list(name = "normalize_smallest_largest_percent", zero = "smallest", hundred = "largest", display = "percent"),
  list(name = "normalize_first_last_fraction", zero = "first", hundred = "last", display = "fraction"),
  list(name = "normalize_values", zero = "value", zeroValue = 10, hundred = "value", hundredValue = 90, display = "percent"),
  list(name = "normalize_sum", zero = "value", zeroValue = 0, hundred = "sum", display = "percent"),
  list(name = "normalize_mean", zero = "smallest", hundred = "mean", display = "fraction"))) {
  p <- modifyList(list(kind = "normalize", zeroValue = 0, hundredValue = 100), cfg[-1])
  write_case("processing", cfg$name, list(rows = nr), p)
}
set.seed(1303)
dsets <- lapply(1:3, function(i) na_at(round(matrix(rnorm(10, 20 + 5 * i, 3), 5, 2), 2), if (i == 2) 7 else integer(0)))
bl <- function(name, ...) write_case("processing", name, list(dataSets = dsets),
                                    modifyList(list(kind = "baseline", baselineIndex = 0, rowsAt = "first",
                                                    rowCount = 1, match = "mean"), list(...)))
bl("baseline_dataset_difference", mode = "dataSet", operation = "difference")
bl("baseline_dataset_ratio_replicate", mode = "dataSet", operation = "ratio", match = "replicate", baselineIndex = 1)
bl("baseline_rows_first2_percent", mode = "rows", operation = "percentDifference", rowCount = 2)
bl("baseline_rows_last_replicate", mode = "rows", operation = "difference", rowsAt = "last", match = "replicate")
bl("pairs_sum", mode = "pairs", operation = "sum")
bl("pairs_ratio_replicate", mode = "pairs", operation = "ratio", match = "replicate")
set.seed(1304)
pr <- na_at(round(matrix(rnorm(14, 5, 2), 7, 2), 3), c(3, 12))
px <- c(0, 1.5, 3, 4.5, 6, 7.5, 9)
write_case("processing", "prune_every_3", list(rows = pr, x = px), list(kind = "prune", mode = "everyK", k = 3))
write_case("processing", "prune_x_range", list(rows = pr, x = px), list(kind = "prune", mode = "xRange", xMin = 1.5, xMax = 6))
write_case("processing", "prune_average_2", list(rows = pr, x = px), list(kind = "prune", mode = "average", k = 2))

# ---- frequency -------------------------------------------------------------------------------
set.seed(1310)
write_case("frequency", "auto_two_gaussian", list(dataSets = list(round(rnorm(40, 100, 15), 2), round(rnorm(25, 110, 10), 2))))
write_case("frequency", "auto_integers", list(dataSets = list(sample(0:30, 50, TRUE), sample(5:12, 20, TRUE))))
write_case("frequency", "auto_small_values", list(dataSets = list(round(rexp(30, 40), 5))))
write_case("frequency", "set_width_center_edges", list(dataSets = list(c(0, 5, 10, 10, 15, 19.999, 20, 25, 30))),
           list(binWidth = 10, firstCenter = 5))
write_case("frequency", "below_first_and_upper_limit", list(dataSets = list(c(-3, 1, 2.5, 4, 6, 8, 12, 40), c(3, 3, 7, 9.5))),
           list(binWidth = 2, firstCenter = 1, upperLimit = 10))
write_case("frequency", "decimal_width", list(dataSets = list(c(0.1, 0.2, 0.3, 0.35, 0.7, 0.9, 1.1))),
           list(binWidth = 0.1))
# Histograms of column data (the graphs' bin stat, roadmap 33d): automatic and set widths,
# values on the bins' edges.
write_case("frequency", "hist_two_groups_auto",
           list(dataSets = list(c(4.1, 5, 5.5, 6, 6, 7.2, 7.5, 8, 9.9, 10, 12.25), c(3, 5, 5, 6.5, 8, 8.5))))
write_case("frequency", "hist_set_width_edges",
           list(dataSets = list(c(0, 0.5, 1, 1, 1.5, 2, 2.5, 2.5, 3, 4), c(-1, 0.25, 0.5, 3.5))),
           list(binWidth = 1))

# ---- auc -------------------------------------------------------------------------------------
set.seed(1320)
ax <- c(0, 0.5, 1, 2, 3, 4, 6, 8)
cur <- c(0, 4, 9, 12, 8, 5, 2, 0.5)
reps <- round(sapply(1:3, function(i) cur + rnorm(8, 0, 0.8)), 3)
write_case("auc", "replicates_se", list(x = ax, rows = reps), list(baseline = 0, minHeight = 0.1, minPoints = 1, direction = "above"))
wave <- round(3 * sin(seq(0, 4 * pi, length.out = 17)) + 0.5, 4)
write_case("auc", "crossing_above_only", list(x = 0:16, rows = matrix(wave, ncol = 1)),
           list(baseline = 0, minHeight = 0.1, minPoints = 1, direction = "above"))
write_case("auc", "crossing_both_directions", list(x = 0:16, rows = matrix(wave, ncol = 1)),
           list(baseline = 0.25, minHeight = 0.1, minPoints = 1, direction = "both"))
write_case("auc", "small_peak_filtered", list(x = 1:12, rows = matrix(c(0, 5, 10, 5, 0, 0.3, 0.8, 0.2, 0, 2, 6, 1), ncol = 1)),
           list(baseline = 0, minHeight = 0.1, minPoints = 1, direction = "above"))
write_case("auc", "min_points_2", list(x = 1:9, rows = matrix(c(0, 3, 0, 1, 2, 1, 0, 4, 0), ncol = 1)),
           list(baseline = 0, minHeight = 0, minPoints = 2, direction = "above"))
write_case("auc", "summary_mean_sem_unsorted", list(x = c(4, 0, 2, 1, 3), mean = c(3, 1, 6, 4, 5), sem = c(0.4, 0.2, 0.5, 0.3, 0.6)),
           list(baseline = 0.5, minHeight = 0.1, minPoints = 1, direction = "above"))
write_case("auc", "touches_baseline_missing",
           list(x = c(0, 1, 2, 3, 4, 5, NA), rows = cbind(c(1, 3, 2, 2, 4, 1, 9), c(1.2, 2.8, NA, 2, 4.4, 0.8, 9))),
           list(baseline = 2, minHeight = 0.05, minPoints = 1, direction = "both"))

# ---- outliers --------------------------------------------------------------------------------
set.seed(1330)
g1 <- round(c(rnorm(14, 50, 5), 80), 2)
write_case("outliers", "grubbs_one", list(values = g1), list(method = "grubbs", alpha = 0.05))
write_case("outliers", "grubbs_none", list(values = round(rnorm(12, 10, 2), 3)), list(method = "grubbs", alpha = 0.05))
g2 <- round(c(rnorm(18, 20, 2), 35, 38, 5), 2)
write_case("outliers", "grubbs_iterative", list(values = c(g2[1:5], NA, g2[6:21])), list(method = "grubbsIterative", alpha = 0.05))
two <- c(50.1, 49.2, 50.8, 49.7, 50.3, 51.1, 48.9, 50.5, 49.9, 50.2, 49.4, 50.7, 49.8, 50.0, 58.9, 54.2)
write_case("outliers", "grubbs_iterative_two", list(values = two), list(method = "grubbsIterative", alpha = 0.05),
           note = "The second outlier is found after removing the first.")
write_case("outliers", "rout_two", list(values = two), list(method = "rout", q = 0.01), tol = list(rtol = 1e-9))
masked <- c(10.2, 9.8, 10.1, 9.9, 10.4, 9.7, 10, 10.3, 16, 16.2)
write_case("outliers", "grubbs_masking_n10", list(values = masked), list(method = "grubbsIterative", alpha = 0.05),
           note = "Two outliers mask each other for Grubbs' test.")
write_case("outliers", "rout_masking_n10", list(values = masked), list(method = "rout", q = 0.01),
           tol = list(rtol = 1e-9), note = "ROUT finds both values that mask each other for Grubbs' test.")
write_case("outliers", "rout_none", list(values = round(rnorm(20, 100, 10), 2)), list(method = "rout", q = 0.01), tol = list(rtol = 1e-9))
write_case("outliers", "rout_one_q5", list(values = c(round(rnorm(11, 3, 0.4), 3), NA, 6.1)), list(method = "rout", q = 0.05), tol = list(rtol = 1e-9))
write_case("outliers", "rout_ties", list(values = c(5, 5, 5, 6, 6, 7, 5, 6, 30, 4)), list(method = "rout", q = 0.01), tol = list(rtol = 1e-9))

# ---- nested ----------------------------------------------------------------------------------
nested_data <- function(k, subs, reps, effects, sdSub, sdRes, drop = 0) {
  y <- c(); g <- c(); s <- c(); id <- 0
  for (i in seq_len(k)) for (j in seq_len(subs[i])) {
    id <- id + 1
    b <- rnorm(1, 0, sdSub)
    v <- round(20 + effects[i] + b + rnorm(reps, 0, sdRes), 3)
    y <- c(y, v); g <- c(g, rep(i - 1, reps)); s <- c(s, rep(id, reps))
  }
  if (drop > 0) y[sample(length(y), drop)] <- NA
  list(y = y, group = g, subject = s)
}
set.seed(1340)
write_case("nested", "t_balanced", nested_data(2, c(4, 4), 3, c(0, 2), 1.5, 1))
write_case("nested", "t_unbalanced_missing", nested_data(2, c(3, 5), 4, c(0, 1.5), 1, 1, drop = 5))
write_case("nested", "t_no_subject_effect", nested_data(2, c(3, 3), 4, c(0, 1), 0, 2),
           note = "No subject variation simulated: the REML subject variance may sit on the boundary 0.")
write_case("nested", "oneway_balanced", nested_data(3, c(3, 3, 3), 4, c(0, 1, 3), 1, 1),
           list(comparisons = list(list(method = "tukey"), list(method = "dunnett"), list(method = "sidak"),
                                   list(method = "fisher"), list(method = "holm-sidak"), list(method = "bonferroni"))))
write_case("nested", "oneway_unbalanced_k4", nested_data(4, c(3, 4, 2, 5), 3, c(0, 0.5, 2, -1), 1.2, 0.8, drop = 4),
           list(comparisons = list(list(method = "tukey"), list(method = "dunnett"), list(method = "bky"))))

# Audit 3 (S1, S8): nested designs at the sizes the block-wise fit is built for: ~500 replicates
# per subcolumn and an intraclass correlation near 1, balanced and ragged (subcolumns of
# different lengths, missing values). Whole numbers (thousandths) keep the case files small.
nested_ragged <- function(k, subs, reps, effects, sdSub, sdRes, drop = 0) {
  y <- c(); g <- c(); s <- c(); id <- 0
  for (i in seq_len(k)) for (j in seq_len(subs[i])) {
    id <- id + 1
    n <- reps[id]
    b <- rnorm(1, 0, sdSub)
    v <- round(1000 * (20 + effects[i] + b + rnorm(n, 0, sdRes)))
    y <- c(y, v); g <- c(g, rep(i - 1, n)); s <- c(s, rep(id, n))
  }
  if (drop > 0) y[sample(length(y), drop)] <- NA
  list(y = y, group = g, subject = s)
}
set.seed(1341)
write_case("nested", "t_large_high_icc", nested_ragged(2, c(3, 3), rep(500, 6), c(0, 2), 3, 0.05),
           pretty = FALSE, note = "500 replicates per subcolumn, ICC 0.999 (audit 3, S1).")
write_case("nested", "oneway_large_ragged",
           nested_ragged(3, c(2, 3, 2), c(480, 350, 500, 220, 410, 300, 460), c(0, 1, -2), 2, 0.1,
                         drop = 40),
           list(comparisons = list(list(method = "tukey"), list(method = "dunnett"))), pretty = FALSE,
           note = "Subcolumns of 220 to 500 replicates, 40 values missing, ICC 0.999 (audit 3, S1).")
