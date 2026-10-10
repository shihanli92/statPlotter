# Generates the roadmap 38 oracle cases (data manipulation): the formula language's statistics
# (suite `formula`: quantiles of every type, ranks with each tie method, statistics by group as
# ave() gives them, cut() intervals) and Aggregate by group (suite `aggregate`), with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_datamanip.R

source("lib.R")

write_case <- function(suite, name, input, params = list(), tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  js <- function(x, unbox) toJSON(x, auto_unbox = unbox, digits = I(17), na = "null", null = "null")
  if (length(params) == 0) params <- setNames(list(), character(0))
  parts <- c(sprintf('"input": %s', js(input, FALSE)), sprintf('"params": %s', js(params, TRUE)))
  if (!is.null(tol)) parts <- c(parts, sprintf('"tol": %s', js(tol, TRUE)))
  if (!is.null(note)) parts <- c(parts, sprintf('"note": %s', js(note, TRUE)))
  writeLines(prettify(paste0("{", paste(parts, collapse = ","), "}")),
             file.path(dir, paste0(name, ".json")))
}

probs <- c(0, 0.01, 0.1, 0.25, 1 / 3, 0.5, 0.6, 0.75, 0.9, 0.99, 1)

# ---- formula: quantiles ------------------------------------------------------------------------
set.seed(3801)
write_case("formula", "quantile_random_30", list(x = round(rnorm(30, 10, 3), 3), p = probs),
           list(kind = "quantile"))
write_case("formula", "quantile_ties_missing",
           list(x = c(5, 1, 3, 3, NA, 2, 8, 3, NA, 13), p = probs), list(kind = "quantile"))
write_case("formula", "quantile_one_value", list(x = c(4.5), p = probs), list(kind = "quantile"))
write_case("formula", "quantile_two_values", list(x = c(2, -1), p = probs), list(kind = "quantile"))
write_case("formula", "quantile_even_n", list(x = c(1:8) * 1.5, p = probs),
           list(kind = "quantile"))

# ---- formula: ranks ----------------------------------------------------------------------------
write_case("formula", "rank_ties_missing",
           list(x = c(3, 1, 4, 1, 5, NA, 2, 6, 5, 3, 5, NA, 0)), list(kind = "rank"))
set.seed(3802)
write_case("formula", "rank_random_ties", list(x = sample(c(1:6, NA), 40, replace = TRUE)),
           list(kind = "rank"))

# ---- formula: statistics by group (ave) ---------------------------------------------------------
set.seed(3803)
g <- sample(c("S1", "S2", "S3", NA), 60, replace = TRUE, prob = c(0.4, 0.35, 0.2, 0.05))
x <- round(rlnorm(60, 2, 0.8), 3)
x[c(4, 17, 33)] <- NA
write_case("formula", "groups_three_samples", list(x = x, g = g), list(kind = "groups"))
write_case("formula", "groups_single_member",
           list(x = c(1, 2, 3, 10, NA, 7), g = c("A", "A", "B", "C", "C", "A")),
           list(kind = "groups"))

# ---- formula: cut ------------------------------------------------------------------------------
set.seed(3804)
xc <- round(runif(50, -3, 12), 2)
xc[c(5, 9)] <- NA
xc[11] <- 0; xc[12] <- 5; xc[13] <- -3
write_case("formula", "cut_breaks_right", list(x = xc, breaks = c(-3, 0, 2.5, 5, 12)),
           list(kind = "cut", right = TRUE))
write_case("formula", "cut_breaks_left", list(x = xc, breaks = c(-3, 0, 2.5, 5, 12)),
           list(kind = "cut", right = FALSE))
write_case("formula", "cut_width_4", list(x = xc, n = 4), list(kind = "cutwidth", right = TRUE))
write_case("formula", "cut_width_3_left", list(x = xc, n = 3),
           list(kind = "cutwidth", right = FALSE))
write_case("formula", "cut_quantile_4", list(x = xc, n = 4),
           list(kind = "cutquantile", right = TRUE))
write_case("formula", "cut_quantile_5_left", list(x = xc, n = 5),
           list(kind = "cutquantile", right = FALSE))
write_case("formula", "cut_labels_precision",
           list(x = c(0.12341, 0.12349, 0.1236, 1234567, 0.00001234),
                breaks = c(0.00001, 0.12345, 0.12348, 0.5, 2e6)),
           list(kind = "cut", right = TRUE))
# Audit 2: breaks exactly halfway at the third digit, which %g rounds to even (1.125 -> "1.12",
# 0.3125 -> "0.312", 7.875 -> "7.88", 1125 -> "1.12e+03"; -2.675 is not exact, so it rounds as
# its binary value, 2.67499...).
write_case("formula", "cut_labels_binary_ties",
           list(x = c(-2, 0.2, 0.5, 1, 1.2, 3, 7, 100, 2000),
                breaks = c(-2.675, -1.125, 0.3125, 1.125, 2.5, 4.0625, 6.5625, 7.875, 1125,
                           2375)),
           list(kind = "cut", right = TRUE))
write_case("formula", "cut_labels_binary_ties_left",
           list(x = c(0.0002, 0.0005, 0.001, 0.2, 1, 2),
                breaks = c(0.0001220703125, 0.0009765625, 0.0625, 0.15625, 0.21875, 1.375,
                           2.625)),
           list(kind = "cut", right = FALSE))

# ---- aggregate ---------------------------------------------------------------------------------
set.seed(3805)
n <- 80
sample_ <- sample(c("S1", "S2", "S3"), n, replace = TRUE)
cond <- sample(c("ctrl", "stim", NA), n, replace = TRUE, prob = c(0.48, 0.48, 0.04))
cd4 <- round(rexp(n, 0.2), 2)
cd4[sample(n, 20)] <- 0
cd4[c(3, 40)] <- NA
il2 <- round(rnorm(n, 50, 15), 1)
write_case("aggregate", "one_group", list(groups = list(sample = sample_),
                                           values = list(CD4 = cd4, IL2 = il2)),
           list(threshold = 1))
write_case("aggregate", "two_groups", list(groups = list(sample = sample_, condition = cond),
                                            values = list(CD4 = cd4, IL2 = il2)),
           list(threshold = 40))
write_case("aggregate", "tiny_groups",
           list(groups = list(g = c("a", "b", "b", "c", "c", "c")),
                values = list(v = c(1, 2, NA, NA, NA, 5))),
           list(threshold = 0))
