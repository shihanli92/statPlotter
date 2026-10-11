# Generates the Phase 3 oracle cases (ANOVA, multiple comparisons and their distributions) with
# fixed seeds, separately from gen_cases.R so earlier suites' cases are never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_anova.R

source("lib.R")
unbox <- jsonlite::unbox

write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (!is.null(params)) case$params <- params
  if (!is.null(tol)) case$tol <- lapply(tol, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, json_verbatim = TRUE,
                    na = "string"),
             file.path(dir, paste0(name, ".json")))
}

# ---- studentized range ------------------------------------------------------------------------
sr_grid <- function(name, fn, cols, keep = function(g) rep(TRUE, nrow(g)), tol = NULL,
                    note = NULL) {
  g <- do.call(expand.grid, c(cols, list(KEEP.OUT.ATTRS = FALSE)))
  g <- g[keep(g) %in% TRUE, , drop = FALSE]  # NA (e.g. ptukey needs df >= 2) drops the point
  # Inf is written as the string "Inf" (as fixtures encode it); the oracle uses as.numeric().
  inp <- structure(toJSON(as.list(g), digits = I(17), na = "string"), class = "json")
  write_case("studentized_range", name, inp, params = list(fn = unbox(fn)), tol = tol, note = note)
}
sr_keep <- function(g) suppressWarnings(ptukey(g$q, g$k, g$df, lower.tail = FALSE) > 1e-4 &
                                         ptukey(g$q, g$k, g$df) > 1e-4)
sr_grid("ptukey_r_grid", "ptukey_r",
  list(q = c(0.5, 1, 2, 3, 3.5, 4, 5, 6, 8), k = c(2, 3, 4, 5, 8, 10, 20),
       df = c(5, 10, 20, 60, 120, 1000, Inf)),
  keep = sr_keep, tol = list(rtol = 0, atol = 2e-7),
  note = paste("R's ptukey (fixed 16-point Gauss-Legendre panels) is itself off by up to ~1e-7",
               "here (e.g. 7.6e-8 at q = 8, k = 3, df = 5; checked against the integrate()",
               "references and brute-force quadrature); points with a tail below 1e-4 are",
               "dropped. The ptukey_ref cases hold the TS code to 1e-11."))
sr_grid("ptukey_r_grid_wide", "ptukey_r",
  list(q = c(1, 3, 4, 6, 8), k = c(2, 4, 50, 100), df = c(2, 3, 5, 120, Inf)),
  keep = function(g) sr_keep(g) & !(g$k == 2 & g$df < 5), tol = list(rtol = 0, atol = 1e-5),
  note = paste("Where R's ptukey is least accurate: df = 2-3 and k = 50-100 (errors up to",
               "5e-6, e.g. q = 8, k = 4, df = 2; for k = 2, df = 2 the exact value is",
               "x/sqrt(2 + x^2) with x = q/sqrt(2), which R misses by 1e-4, so k = 2 is",
               "excluded at df < 5). The references in ptukey_ref cover this region tightly."))
sr_grid("ptukey_ref", "ptukey_ref",
  list(q = c(0.8, 3.5, 12), k = c(3, 10, 50), df = c(2, 10, 60, Inf)),
  tol = list(rtol = 1e-11),
  note = "Nested integrate() references (ref_integrals.R); both tails integrated directly.")
sr_grid("ptukey_ref_tails", "ptukey_ref",
  list(q = c(15, 25, 40), k = c(3, 10), df = c(5, 30, 1000, Inf)),
  keep = function(g) !(g$q == 40 & is.infinite(g$df)),
  tol = list(rtol = 1e-10),
  note = paste("Far upper tails (down to ~1e-200), where 1 - ptukey() is useless; the TS code",
               "integrates the upper tail directly. rtol 1e-10: the references' own",
               "integrate() tolerance in these tails."))
sr_grid("qtukey_uniroot", "qtukey",
  list(p = c(0.5, 0.9, 0.95, 0.99, 0.999), k = c(3, 5, 10, 20), df = c(30, 120, Inf)),
  tol = list(rtol = 1e-7),
  note = paste("Roots of R's ptukey by uniroot. Only df >= 30: with R's ptukey off by ~1e-7",
               "and worse at small df, these roots are wrong by 8e-6 relative at df = 10, 0.3%",
               "at df = 5 and 80% at df = 2 (p = 0.99, k = 3). qtukey_ref covers small df.",
               "qR (R's qtukey, documented to ~4 decimals) is compared only at 1e-4."))
sr_grid("qtukey_ref", "qtukey_ref",
  list(p = c(0.95, 0.99), k = c(3, 6), df = c(4, Inf)),
  tol = list(rtol = 1e-11),
  note = "Roots of the integrate() reference upper tail by uniroot(tol = 1e-14) on log q.")

# ---- Dunnett's distribution ------------------------------------------------------------------
dn <- function(name, n0, n, df, t, twoSided = TRUE, tol = NULL, note = NULL) {
  write_case("dunnett", name,
             structure(toJSON(list(n0 = unbox(n0), n = n, df = unbox(df), t = t), digits = I(17),
                              na = "string"), class = "json"),
             params = list(twoSided = unbox(twoSided)), tol = tol, note = note)
}
dn_note <- paste("p and quantiles from the integrate() reference (ref_integrals.R); pMvt is",
                 "mvtnorm's randomised QMC value, checked within 5x its error estimate.")
dn("equal_n_k3", 5, c(5, 5, 5), 16, c(0.5, 1.5, 2.5, 3.5, 5), note = dn_note)
dn("unequal_n_k4", 4, c(3, 6, 10, 2), 20, c(0.8, 2, 2.7, 3.4, 6), note = dn_note)
dn("large_control_k5", 20, c(5, 5, 8, 5, 5), 43, c(1, 2.2, 2.8, 4), note = dn_note)
dn("df_inf_k5", 6, c(6, 6, 6, 6, 6), Inf, c(1, 2, 2.6, 3.5), note = dn_note)
dn("small_df_k3", 2, c(2, 3, 2), 5, c(1, 3, 5, 9), note = dn_note)
dn("one_sided_k3", 8, c(8, 8, 8), 28, c(-1, 0.5, 1.8, 2.5, 4), twoSided = FALSE, note = dn_note)
dn("one_treatment", 5, 7, 10, c(0.3, 2.2, 4.5),
   note = "One treatment: Dunnett's P is the t test's P exactly.")
dn("far_tail_k4", 10, c(10, 10, 10, 10), 36, c(7, 10, 15), tol = list(rtol = 1e-9),
   note = paste("P down to ~1e-15; direct upper-tail integration. mvtnorm cannot resolve these",
                "(its absolute error is ~1e-9)."))

# ---- P value adjustment ----------------------------------------------------------------------
set.seed(20261101)
pv <- function(name, p, n = NULL, note = NULL) {
  params <- if (is.null(n)) NULL else list(n = unbox(n))
  write_case("padjust", name, list(p = p), params = params, note = note)
}
pv("mixed_12", c(runif(4, 0, 0.005), runif(4, 0.005, 0.1), runif(4, 0.1, 1)))
pv("mixed_12_family20", c(runif(4, 0, 0.005), runif(4, 0.005, 0.1), runif(4, 0.1, 1)), n = 20,
   note = "Family of 20 with only 12 P values supplied: the rest count as P = 1 (p.adjust(n =)).")
pv("ties", c(0.01, 0.01, 0.02, 0.02, 0.02, 0.5, 0.5, 0.001))
pv("single", 0.03)
pv("all_small", c(1e-10, 2e-8, 3e-6, 1e-4, 4e-4))
pv("none_small", c(0.2, 0.5, 0.9, 0.35, 0.66, 0.08))
pv("many_40", sort(c(rbeta(15, 0.2, 5), runif(25))))

# ---- one-way ANOVA ---------------------------------------------------------------------------
set.seed(20261102)
ow <- function(name, groups, params = NULL, tol = NULL, note = NULL) {
  write_case("oneway", name, list(groups = groups), params = params, tol = tol, note = note)
}
ow("gen_k3_n10", list(rnorm(10, 10, 2), rnorm(10, 11, 2), rnorm(10, 12.5, 2)))
g4 <- list(rnorm(6, 20, 1.5), rnorm(11, 22, 3), rnorm(8, 19, 2), rnorm(15, 23, 5))
ow("gen_k4_unequal", g4)
ow("gen_k4_unequal_summary", g4, params = list(summary = unbox(TRUE)),
   note = "Same data entered as mean/SD/N (converted in the TS test): identical results.")
ow("n2_per_group", list(c(3, 7), c(4, 10), c(1, 3), c(8, 12)),
   note = paste("n = 2 per group: |x - median| is the same for both values of a group, so the",
                "Brown-Forsythe (Levene-median) F is Inf (within-group SS of the deviations = 0)."))
ow("sd0_group", list(c(5, 5, 5, 5), c(4.1, 6.3, 5.2, 7.7, 5.5), c(8.2, 6.9, 7.4)),
   note = paste("A group with SD = 0: Bartlett's test is not computable (null) and Welch's",
                "ANOVA is NaN (weight n/0); ordinary and Brown-Forsythe ANOVA are fine."))
ow("two_groups", list(rnorm(9, 5, 1), rnorm(12, 6, 1.4)), note = "Two groups: F = t^2.")
ow("offset_1e9", list(1e9 + rnorm(8, 0, 1e-3), 1e9 + rnorm(8, 1e-3, 1e-3), 1e9 + rnorm(8, 0, 1e-3)),
   params = list(shift = unbox(1e9)),
   note = paste("Large offset: the oracle analyses the data minus params$shift (exact) because",
                "aov on the raw values loses ~7 digits; means are shifted back."))
ow("ties_kw", list(round(rnorm(12, 5, 2)), round(rnorm(9, 6, 2)), round(rnorm(14, 7, 2)),
                   round(rnorm(7, 5, 2))),
   note = "Integer data with many ties (Kruskal-Wallis tie correction).")
ow("gen_k6_n5", lapply(1:6, function(i) rnorm(5, 10 + i / 2, 1.5)))

# ---- multiple comparisons ----------------------------------------------------------------------
set.seed(20261103)
mc <- function(name, groups, params, tol = NULL, note = NULL) {
  write_case("multcomp", name, list(groups = groups), params = params, tol = tol, note = note)
}
gu <- list(rnorm(8, 10, 2), rnorm(6, 12, 2), rnorm(10, 11, 2), rnorm(7, 14, 2))
for (m in c("tukey", "bonferroni", "sidak", "holm", "holm-sidak", "fisher", "bh", "bky")) {
  mc(paste0("unequal_", gsub("-", "_", m)), gu, list(method = unbox(m)))
}
mc("unequal_tukey_90", gu, list(method = unbox("tukey"), confLevel = unbox(0.9)))
mc("unequal_dunnett", gu, list(method = unbox("dunnett"), control = unbox(0)),
   note = "Pairs (control, j): diff = mean(control) - mean(j), as the results list 'Control vs. j'.")
mc("unequal_dunnett_99", gu, list(method = unbox("dunnett"), control = unbox(2),
                                   confLevel = unbox(0.99)))
mc("selected_sidak_family6", gu,
   list(method = unbox("sidak"), pairs = list(c(0, 1), c(2, 3)), familySize = unbox(6)),
   note = "Two selected comparisons counted in a family of six.")
mc("selected_holm_sidak", gu, list(method = unbox("holm-sidak"), pairs = list(c(0, 3), c(1, 2), c(0, 2))))
gb <- lapply(1:5, function(i) rnorm(6, 20 + i, 3))
mc("balanced_k5_tukey", gb, list(method = unbox("tukey")))
mc("two_groups_tukey", list(rnorm(7, 3, 1), rnorm(9, 4, 1)), list(method = unbox("tukey")),
   note = "k = 2: Tukey's P and CI are the pooled t test's.")
gh <- list(rnorm(8, 10, 1), rnorm(12, 12, 4), rnorm(6, 11, 0.7), rnorm(15, 13, 2.5))
for (m in c("games-howell", "dunnett-t3", "tamhane-t2")) {
  mc(paste0("hetero_", gsub("-", "_", m)), gh, list(method = unbox(m)))
}
gt <- list(round(rnorm(10, 5, 2)), round(rnorm(8, 7, 2)), round(rnorm(12, 5.5, 2)),
           round(rnorm(9, 8, 2)))
mc("ties_dunn_bonferroni", gt, list(method = unbox("dunn"), adjust = unbox("bonferroni")))
mc("ties_dunn_sidak", gt, list(method = unbox("dunn"), adjust = unbox("sidak")))
mc("dunn_vs_control", gt, list(method = unbox("dunn"), adjust = unbox("bonferroni"),
                               pairs = list(c(0, 1), c(0, 2), c(0, 3))))

# ---- two-way ANOVA ---------------------------------------------------------------------------
set.seed(20261104)
tw_cells <- function(R, C, n, mu) {
  out <- list()
  for (r in 0:(R - 1)) for (c in 0:(C - 1)) {
    k <- n[r + 1, c + 1]
    if (k > 0) out[[length(out) + 1]] <- list(row = unbox(r), col = unbox(c),
                                              values = rnorm(k, mu[r + 1, c + 1], 2))
  }
  out
}
tw <- function(name, cells, params = NULL, tol = NULL, note = NULL) {
  write_case("twoway", name, list(cells = cells), params = params, tol = tol, note = note)
}
mu23 <- matrix(c(10, 12, 15, 11, 14, 14), 2, byrow = TRUE)
tw("balanced_2x3", tw_cells(2, 3, matrix(4, 2, 3), mu23))
mu33 <- matrix(c(10, 12, 13, 11, 11, 16, 9, 13, 12), 3, byrow = TRUE)
nu33 <- matrix(c(3, 5, 4, 6, 2, 5, 4, 4, 7), 3, byrow = TRUE)
c33 <- tw_cells(3, 3, nu33, mu33)
tw("unbalanced_3x3", c33)
tw("unbalanced_3x3_summary", c33, params = list(summary = unbox(TRUE)),
   note = "Same cells entered as mean/SD/N (converted in the TS test).")
tw("unbalanced_3x3_additive", c33, params = list(interaction = unbox(FALSE)))
mu24 <- matrix(c(5, 7, 8, 6, 9, 10, 12, 9), 2, byrow = TRUE)
tw("unbalanced_2x4", tw_cells(2, 4, matrix(c(3, 4, 2, 5, 4, 3, 5, 2), 2, byrow = TRUE), mu24))
tw("one_per_cell_3x4_additive",
   tw_cells(3, 4, matrix(1, 3, 4), matrix(c(1, 2, 3, 4, 2, 3, 5, 5, 4, 4, 6, 7), 3, byrow = TRUE)),
   params = list(interaction = unbox(FALSE)),
   note = "One value per cell: only the additive model has residual df.")
tw("empty_cell_additive",
   tw_cells(3, 3, matrix(c(3, 3, 0, 3, 3, 3, 3, 3, 3), 3, byrow = TRUE), mu33),
   params = list(interaction = unbox(FALSE)),
   note = "Cell (0, 2) empty: the additive model is still estimable.")
off <- tw_cells(2, 3, matrix(c(3, 4, 3, 4, 3, 4), 2, byrow = TRUE), mu23)
off <- lapply(off, function(c) { c$values <- 1e9 + c$values * 1e-3; c })
tw("offset_1e9_2x3", off, params = list(shift = unbox(1e9)),
   note = paste("1e9 + small values: the oracle analyses the data minus params$shift (exact);",
                "the TS code fits on data shifted by a common constant too."))
# Audit 3 (S2): perfectly additive cell means with the same deviations in every cell, so the
# interaction is exactly zero (the app zeroes an effect SS within ε · SS_total of 0).
add_dev <- c(-1.2, 0.5, 0.7)
add_cells <- list()
for (r in 0:2) for (c in 0:2) {
  add_cells[[length(add_cells) + 1]] <- list(row = unbox(r), col = unbox(c),
    values = c(10.1, 12.3, 11.7)[r + 1] + c(0, 3.3, -1.7)[c + 1] + add_dev)
}
tw("additive_exact_3x3", add_cells,
   note = paste("Exactly additive cell means (same deviations in every cell): R's and the app's",
                "interaction SS are both exactly 0, so F = 0 and P = 1."))
