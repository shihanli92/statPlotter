# Generates the Phase 6 oracle cases for repeated-measures ANOVA (suite rmanova: complete data)
# and mixed-effects models (suite mixed: missing values), with fixed seeds, separately from the
# other generators so their cases are never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_rm.R
#
# One-way input: { rows: subjects x treatments, null = missing }.
# Two-way input: { y, row, col, subject } (long; 0-based levels; null = missing).
# params$design: "oneway" | "twoway"; params$repeated: "rows" | "columns" | "both";
# params$sphericity, params$interaction; params$comparisons: list of comparison specs.

source("lib.R")
unbox <- jsonlite::unbox

write_case <- function(suite, name, input, params, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input, params = params)
  if (!is.null(tol)) case$tol <- lapply(tol, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "null",
                    json_verbatim = TRUE),
             file.path(dir, paste0(name, ".json")))
}

# rows as a JSON array of arrays (NA -> null), kept 2-D even for one row / column.
rows_json <- function(m) {
  structure(paste0("[", paste(apply(m, 1, function(r)
    paste0("[", paste(ifelse(is.na(r), "null", formatC(r, digits = 17, format = "g")),
                      collapse = ", "), "]")), collapse = ",\n"), "]"), class = "json")
}

long_json <- function(d) {
  num <- function(x) paste0("[", paste(ifelse(is.na(x), "null", formatC(x, digits = 17,
                                                                      format = "g")),
                                       collapse = ", "), "]")
  structure(sprintf('{"y": %s, "row": %s, "col": %s, "subject": %s}', num(d$y), num(d$row),
                    num(d$col), num(d$subject)), class = "json")
}

ow <- function(suite, name, m, sphericity = "assumed", comparisons = list(), tol = NULL,
               note = NULL, shift = NULL) {
  params <- list(design = unbox("oneway"), sphericity = unbox(sphericity),
                 comparisons = comparisons)
  if (!is.null(shift)) params$shift <- unbox(shift)
  write_case(suite, name, list(rows = rows_json(m)), params, tol = tol, note = note)
}

tw <- function(suite, name, d, repeated, sphericity = "assumed", interaction = TRUE,
               comparisons = list(), tol = NULL, note = NULL) {
  params <- list(design = unbox("twoway"), repeated = unbox(repeated),
                 sphericity = unbox(sphericity), interaction = unbox(interaction),
                 comparisons = comparisons)
  write_case(suite, name, long_json(d), params, tol = tol, note = note)
}

cmp1 <- function(method, pairs = NULL, control = NULL) {
  out <- list(method = unbox(method))
  if (!is.null(pairs)) out$pairs <- pairs
  if (!is.null(control)) out$control <- unbox(control)
  out
}
cmp2 <- function(family, kind, method, control = NULL, singleFamily = NULL) {
  out <- list(family = unbox(family), kind = unbox(kind), method = unbox(method))
  if (!is.null(control)) out$control <- unbox(control)
  if (!is.null(singleFamily)) out$singleFamily <- unbox(singleFamily)
  out
}

# Subjects x treatments with a random subject effect and optional heterogeneous errors.
gen_rows <- function(n, mu, sd_subj, sd_err, digits = NULL) {
  k <- length(mu)
  m <- t(vapply(seq_len(n), function(i) mu + rnorm(1, 0, sd_subj) + rnorm(k, 0, sd_err),
                numeric(k)))
  if (!is.null(digits)) m <- round(m, digits)
  m
}

# Two-way long data. repeated = "columns": subjects nested in rows (ns[r] subjects per row);
# "rows": nested in columns (ns[c] per column); "both": ns subjects with every cell.
gen_two <- function(R, C, ns, repeated, mu, sd_subj, sd_err, sd_sr = 0, sd_sc = 0) {
  out <- data.frame(y = numeric(0), row = integer(0), col = integer(0), subject = integer(0))
  sid <- 0
  add <- function(r, c, v) out[nrow(out) + 1, ] <<- list(v, r, c, sid)
  if (repeated == "both") {
    for (s in seq_len(ns)) {
      b <- rnorm(1, 0, sd_subj); br <- rnorm(R, 0, sd_sr); bc <- rnorm(C, 0, sd_sc)
      for (r in 1:R) for (c in 1:C) add(r - 1, c - 1, mu[r, c] + b + br[r] + bc[c] + rnorm(1, 0, sd_err))
      sid <- sid + 1
    }
  } else {
    G <- if (repeated == "columns") R else C
    for (g in 1:G) for (s in seq_len(ns[g])) {
      b <- rnorm(1, 0, sd_subj)
      if (repeated == "columns") for (c in 1:C) add(g - 1, c - 1, mu[g, c] + b + rnorm(1, 0, sd_err))
      else for (r in 1:R) add(r - 1, g - 1, mu[r, g] + b + rnorm(1, 0, sd_err))
      sid <- sid + 1
    }
  }
  out
}

all_pairs <- function(k) {
  out <- list()
  for (i in 0:(k - 2)) for (j in (i + 1):(k - 1)) out[[length(out) + 1]] <- c(i, j)
  out
}

# ---- rmanova: complete data --------------------------------------------------------------------
set.seed(20261201)
std_cmp <- list(cmp1("tukey"), cmp1("sidak"), cmp1("holm-sidak"), cmp1("fisher"),
                cmp1("dunnett", control = 0))
m <- gen_rows(6, c(10, 12, 13, 15), 2, 1.2)
m[, 4] <- m[, 4] + rnorm(6, 0, 2)  # heterogeneous variance: epsilon < 1
ow("rmanova", "ow_k4_n6", m, "gg", std_cmp)
ow("rmanova", "ow_k3_n12_ties", gen_rows(12, c(5, 6, 6.5), 1.5, 1, digits = 0), "gg", std_cmp,
   note = "Integer data with ties.")
ow("rmanova", "ow_k6_n3", gen_rows(3, c(1, 2, 2.5, 3, 3.2, 4), 0.8, 0.6), "gg",
   list(cmp1("tukey"), cmp1("bonferroni"), cmp1("dunnett", control = 2)),
   note = "n = 3 < k = 6: the sample covariance is singular, epsilon still defined.")
ow("rmanova", "ow_k5_n5_negvar", gen_rows(5, c(3, 4, 4, 5, 6), 0, 1.5), "gg", std_cmp,
   note = paste("No subject effect: MS_individual < MS_residual is likely (negative variance",
                "component estimate); RM ANOVA is unaffected."))
ow("rmanova", "ow_k2_n8", gen_rows(8, c(4, 5), 1, 0.7), "gg", list(cmp1("tukey")),
   note = "k = 2: epsilon = 1 and F = paired t^2.")
off <- 1e9 + gen_rows(5, c(0, 1e-3, 3e-3), 1e-3, 5e-4)
ow("rmanova", "ow_offset_1e9", off, "gg", list(cmp1("sidak")), shift = 1e9,
   note = "1e9 + small effects: the oracle analyses the data minus params$shift (exact).")

cmp_tw <- function(fam_within, fam_between) list(
  cmp2(fam_within, "allPairs", "tukey"),
  cmp2(fam_within, "allPairs", "sidak", singleFamily = TRUE),
  cmp2(fam_within, "vsControl", "dunnett"),
  cmp2(fam_between, "allPairs", "sidak"),
  cmp2(fam_between, "vsControl", "dunnett", control = 1),
  cmp2("mainRows", "allPairs", "tukey"),
  cmp2("mainColumns", "allPairs", "sidak"))
mu23 <- matrix(c(10, 12, 14, 11, 14, 18), 2, byrow = TRUE)
tw("rmanova", "tw_cols_2x3_unequal", gen_two(2, 3, c(5, 4), "columns", mu23, 2, 1), "columns",
   "gg", comparisons = cmp_tw("withinRows", "withinColumns"),
   note = "Rows = groups (between), columns = repeated; 5 and 4 subjects.")
mu43 <- matrix(c(5, 6, 5.5, 6, 7, 7, 8, 7, 7.5, 8.5, 9, 9), 3, byrow = TRUE)
tw("rmanova", "tw_rows_3x4_unequal", gen_two(3, 4, c(3, 4, 3, 5), "rows", mu43, 1.5, 0.8), "rows",
   "gg", comparisons = cmp_tw("withinColumns", "withinRows"),
   note = "Columns = groups (between), rows = repeated; 3, 4, 3 and 5 subjects.")
mu33 <- matrix(c(10, 11, 13, 12, 12, 15, 11, 14, 17), 3, byrow = TRUE)
tw("rmanova", "tw_both_3x3_n5", gen_two(3, 3, 5, "both", mu33, 2, 0.8, 0.7, 0.5), "both", "gg",
   comparisons = cmp_tw("withinRows", "withinColumns"))
mu24 <- matrix(c(3, 4, 6, 7, 4, 4, 5, 9), 2, byrow = TRUE)
tw("rmanova", "tw_both_2x4_n6", gen_two(2, 4, 6, "both", mu24, 1, 1, 0.4, 0.9), "both", "gg",
   comparisons = cmp_tw("withinColumns", "withinRows"))

# ---- mixed: missing values ---------------------------------------------------------------------
set.seed(20261202)
mix_cmp <- list(cmp1("tukey"), cmp1("sidak"), cmp1("fisher"))
m <- gen_rows(6, c(10, 12, 13, 15), 2, 1.2)
m[2, 3] <- NA
ow("mixed", "ow_k4_n6_one_missing", m, comparisons = mix_cmp)
m <- gen_rows(8, c(20, 22, 21, 25), 3, 1.5)
m[1, 2] <- NA; m[3, c(1, 4)] <- NA; m[6, 3] <- NA; m[8, c(1, 2, 3)] <- NA
ow("mixed", "ow_k4_n8_several", m, comparisons = mix_cmp,
   note = "Several missing values; subject 8 has a single value.")
m <- gen_rows(10, c(1, 1.5, 2, 2.2, 3), 0.7, 0.5, digits = 1)
m[cbind(c(1, 2, 4, 5, 7, 9, 10), c(5, 1, 3, 2, 4, 5, 2))] <- NA
ow("mixed", "ow_k5_n10_ties", m, comparisons = mix_cmp, note = "Rounded data (ties).")
m <- gen_rows(5, c(3, 4, 5), 0, 1.5)
m[2, 1] <- NA
ow("mixed", "ow_k3_n5_boundary", m, comparisons = mix_cmp,
   note = paste("No subject effect: the REML subject variance sits on the boundary 0 (checked",
                "in the oracle); results differ from RM ANOVA, as Prism warns."))
m <- gen_rows(12, c(5, 7, 6), 1, 1)
m[cbind(c(2, 5, 9, 11), c(3, 1, 2, 3))] <- NA
ow("mixed", "ow_k3_n12", m, comparisons = list(cmp1("tukey"), cmp1("dunnett", control = 0)),
   note = "Dunnett P from pdun with the product-correlation fit of the TS code.")

d <- gen_two(2, 3, c(5, 4), "columns", mu23, 2, 1)
d$y[c(2, 9, 20)] <- NA
tw("mixed", "tw_cols_2x3_missing", d, "columns",
   comparisons = cmp_tw("withinRows", "withinColumns")[c(1, 2, 4, 6, 7)])
d <- gen_two(3, 4, c(3, 4, 3, 5), "rows", mu43, 1.5, 0.8)
d$y[c(1, 11, 12, 30, 44)] <- NA
tw("mixed", "tw_rows_3x4_missing", d, "rows",
   comparisons = cmp_tw("withinColumns", "withinRows")[c(1, 4, 6, 7)])
d <- gen_two(3, 3, 6, "both", mu33, 2, 0.8, 0.9, 0.6)
d$y[c(3, 14, 22, 40)] <- NA
tw("mixed", "tw_both_3x3_missing", d, "both",
   comparisons = cmp_tw("withinRows", "withinColumns")[c(1, 4, 6, 7)],
   note = "Three variance components (subject, subject x row, subject x column).")
d <- gen_two(2, 3, c(4, 4), "columns", mu23, 2, 1)
tw("mixed", "tw_cols_additive", d, "columns", interaction = FALSE,
   comparisons = list(cmp2("mainColumns", "allPairs", "tukey"),
                      cmp2("withinRows", "allPairs", "sidak")),
   note = "Complete data, main-effects model: fitted as a mixed model.")
