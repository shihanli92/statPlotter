# Generates the Phase 4 oracle cases for normality tests, one-sample t, Friedman, two-sample KS
# and correlation, with fixed seeds, separately from the other generators so their cases are
# never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_normality.R

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

# ---- normality -------------------------------------------------------------------------------
set.seed(20261201)
nm <- function(name, x, params = NULL, tol = NULL, note = NULL)
  write_case("normality", name, list(x = x), params = params, tol = tol, note = note)
nm("n3", c(2.1, 3.7, 3.0), note = "Only Shapiro-Wilk is defined (exact P for n = 3).")
nm("n3_near_equal_spacing", c(1, 2, 3.0001))
nm("n4", c(10.2, 11.9, 9.4, 15.3))
nm("n5", rnorm(5, 10, 2), note = "Shapiro-Wilk and KS only.")
nm("n7", rnorm(7, 0, 1), note = "One below the D'Agostino / Anderson-Darling minimum.")
nm("n8", rnorm(8, 50, 5))
nm("n11", rexp(11), note = "Largest n on the small-sample Shapiro-Wilk branch.")
nm("n12", rexp(12), note = "Smallest n on the large-sample Shapiro-Wilk branch.")
nm("n20", rnorm(20, 100, 15))
nm("n200", rnorm(200, 0, 1), note = "KS rescales D for n > 100 (Dallal-Wilkinson).")
nm("n200_skewed", rgamma(200, 2, 1), note = "Small P values: KS on the Dallal-Wilkinson branch.")
nm("n2000", rnorm(2000, 5, 3))
nm("n5000", rt(5000, 10), note = "Largest n Shapiro-Wilk accepts.")
nm("n5001", rnorm(5001), note = "Shapiro-Wilk is NaN above 5000 (R refuses); others defined.")
nm("ties_n30", round(rnorm(30, 10, 2)))
nm("heavy_ties_n15", c(rep(1, 5), rep(2, 6), rep(3, 4)))
nm("lognormal_n50", rlnorm(50, 1, 0.9), note = "Strongly skewed: all tests reject.")
nm("lognormal_n40_log", rlnorm(40, 2, 0.6), params = list(log = TRUE),
   note = "Lognormality test: the TS side tests log(x).")
nm("outlier_n25", c(rnorm(24), 12), note = "Far-tail P values (K2 large; AD above 10 -> 3.7e-24).")
nm("platykurtic_n8", c(0, 0, 0, 0, 1, 1, 1, 1),
   note = paste("b2 = 1: the Anscombe-Glynn cube-root base is negative; moments::anscombe.test",
                "gives NaN, we use the real cube root."))
nm("uniform_n30", runif(30), note = "Light tails: Anderson-Darling P on the 0.34 <= A2* < 0.6 or lower branches.")
nm("offset_1e9_n25", 1e9 + rnorm(25, 0, 1e-3), params = list(shift = 1e9),
   note = "1e9 + noise: the oracle analyses x - 1e9 (exact); every test is location-invariant.")
nm("constant_n10", rep(4.2, 10), note = "Zero spread: every result is NaN.")

# ---- one-sample t ----------------------------------------------------------------------------
set.seed(20261202)
os <- function(name, x, mu, params = NULL, tol = NULL, note = NULL)
  write_case("onesample", name, list(x = x, mu = unbox(mu)), params = params, tol = tol,
             note = note)
ox <- rnorm(15, 10.5, 2)
os("n15_mu10", ox, 10)
os("n15_mu10_greater_90", ox, 10, params = list(alternative = "greater", confLevel = 0.9))
os("n15_mu10_less_99", ox, 10, params = list(alternative = "less", confLevel = 0.99))
os("n15_mu12_less", ox, 12, params = list(alternative = "less"))
os("n15_mu0_far_tail", ox, 0, note = "P ~ 1e-11.")
os("n2", c(3.1, 4.4), 0)
os("n40_mu_neg", rnorm(40, -2, 5), -1.5)
xo <- 1e9 + rnorm(12, 3e-4, 1e-3)
os("offset_1e9", xo, 1e9, params = list(shift = 1e9),
   note = "The oracle analyses x - 1e9 and mu - 1e9 (exact) and adds the shift back to mean/CI.")
os("offset_1e9_mu_offset", xo, 1e9 + 5e-4, params = list(shift = 1e9))

# ---- Friedman --------------------------------------------------------------------------------
set.seed(20261203)
fr <- function(name, rows, params = NULL, tol = NULL, note = NULL)
  write_case("friedman", name, list(rows = rows), params = params, tol = tol, note = note)
block <- function(n, k, eff = seq(0, by = 0.6, length.out = k), dig = NULL) {
  y <- outer(rnorm(n, 10, 3), eff, "+") + matrix(rnorm(n * k), n, k)
  if (!is.null(dig)) y <- round(y, dig)
  y
}
fr("k2_n10", block(10, 2), note = "2^10 rearrangements: exact P.")
fr("k2_n29", block(29, 2), note = "2^29 = 5.4e8 <= 1e9: exact P.")
fr("k2_n30", block(30, 2), note = "2^30 > 1e9: chi-square only (pExact null).")
fr("k3_n5", block(5, 3))
fr("k3_n8_ties", block(8, 3, dig = 0), note = "Ties within rows (mid-ranks).")
fr("k3_n11", block(11, 3), note = "6^11 = 3.6e8: exact P by the DP.")
fr("k3_n12", block(12, 3), note = "6^12 > 1e9: pExact null.")
fr("k4_n6", block(6, 4), note = "24^6 = 1.9e8: exact P.")
fr("k4_n6_ties", block(6, 4, dig = 0))
fr("k5_n4", block(4, 5), note = "120^4 = 2.1e8: exact P.")
fr("k5_n5", block(5, 5), note = "120^5 > 1e9: pExact null.")
fr("k5_n20", block(20, 5, eff = c(0, 0.2, 1, 1.5, 0.4)))
fr("k3_n6_exact_forced_off", block(6, 3), params = list(exact = FALSE))
fr("k7_n2", block(2, 7), note = "5040^2 = 2.5e7: exact P.")
fr("tied_rows", rbind(c(1, 1, 1), c(2, 3, 1), c(5, 5, 5), c(4, 6, 5)),
   note = "Two rows tied throughout: they carry no information (tie term 2(3^3 - 3)).")
fr("all_tied", rbind(c(1, 1, 1), c(2, 2, 2), c(3, 3, 3)),
   note = "Every row tied: statistic 0/0 = NaN (R), exact P = 1.")
fr("perfect_order_k4_n5", t(replicate(5, 1:4 + rnorm(1))),
   note = "Same order in every row: the smallest exact P, 24/24^5 = 1/24^4.")

# ---- two-sample KS ---------------------------------------------------------------------------
set.seed(20261204)
ks <- function(name, a, b, params = NULL, tol = NULL, note = NULL)
  write_case("ks", name, list(a = a, b = b), params = params, tol = tol, note = note)
ks("n5_n6", rnorm(5), rnorm(6, 1))
ks("n9_n9", rnorm(9), rnorm(9, 1.2), note = "choose(18, 9) = 48620 < 60000: exact.")
ks("n9_n10", rnorm(9), rnorm(10, 1.2), note = "choose(19, 9) = 92378: asymptotic.")
ks("n8_n10_ties", round(rnorm(8, 5, 2)), round(rnorm(10, 6, 2)),
   note = "Exact with ties (conditional on the tie pattern, as psmirnov(z =) in R >= 4.3).")
ks("n7_n12_heavy_ties", sample(1:3, 7, TRUE), sample(2:4, 12, TRUE))
ks("n2_n344", c(0.5, 2.5), rnorm(344), note = "choose(346, 2) = 59685 < 60000: exact.")
ks("n2_n345", c(0.5, 2.5), rnorm(345), note = "choose(347, 2) = 60031: asymptotic.")
ks("n3_n3_separated", c(1, 2, 3), c(4, 5, 6), note = "D = 1; exact P = 2/choose(6, 3).")
ks("n40_n50", rnorm(40), rnorm(50, 0.5, 1.5))
ks("n40_n50_exact", rnorm(40), rnorm(50, 0.5, 1.5), params = list(exact = TRUE))
ks("n30_n30_ties_asymptotic", round(rnorm(30), 1), round(rnorm(30, 0.8), 1))
ks("n100_n120_far", rnorm(100), rnorm(120, 1.5), note = "Asymptotic far tail (P ~ 1e-20).")
ks("identical", c(1, 2, 3, 4), c(1, 2, 3, 4), note = "D = 0: P = 1.")
ks("n6_n4_exact_false", rnorm(6), rnorm(4, 2), params = list(exact = FALSE))

# ---- correlation -----------------------------------------------------------------------------
set.seed(20261205)
cr <- function(name, x, y, params, tol = NULL, note = NULL)
  write_case("correlation", name, list(x = x, y = y), params = params, tol = tol, note = note)
cx <- rnorm(20); cy <- 0.6 * cx + rnorm(20, 0, 0.8)
for (m in c("pearson", "spearman")) {
  cr(paste0(m, "_n20"), cx, cy, list(method = m))
  cr(paste0(m, "_n20_greater_90"), cx, cy, list(method = m, alternative = "greater",
                                                confLevel = 0.9))
  cr(paste0(m, "_n20_less_99"), cx, cy, list(method = m, alternative = "less",
                                             confLevel = 0.99))
  cr(paste0(m, "_n3"), c(1, 2, 4), c(2.2, 1.9, 5.1), list(method = m),
     note = "n = 3: no CI (NaN).")
  cr(paste0(m, "_perfect_pos"), 1:8, if (m == "pearson") 2 * (1:8) + 1 else exp(1:8),
     list(method = m), note = "r = 1: t = Inf, P from the exact distribution / 0, CI [1, 1].")
  cr(paste0(m, "_perfect_neg"), 1:6, if (m == "pearson") 2 - 3 * (1:6) else -(1:6)^2,
     list(method = m), note = "r = -1.")
  cr(paste0(m, "_constant_y"), 1:6, rep(3, 6), list(method = m),
     note = "SD(y) = 0: r and P are NaN.")
}
cr("pearson_n50", rnorm(50), rnorm(50), list(method = "pearson"))
px <- rnorm(15, 0, 1e-3)
cr("pearson_offset_1e9", 1e9 + px, px * 3 + rnorm(15, 0, 1e-3),
   list(method = "pearson", shift = 1e9),
   note = "The oracle analyses x - 1e9 (exact); r is shift-invariant.")
sx <- rnorm(9); sy <- sx + rnorm(9)
cr("spearman_n9_exact", sx, sy, list(method = "spearman"),
   note = "pspearman, cor.test(exact = TRUE) and brute force agree.")
cr("spearman_n9_exact_greater", sx, sy, list(method = "spearman", alternative = "greater"))
cr("spearman_n9_exact_less", sx, sy, list(method = "spearman", alternative = "less"))
cr("spearman_n9_ties", round(sx), round(sy), list(method = "spearman"),
   note = "Exact P with ties: brute force over all 9! permutations of the mid-ranks.")
cr("spearman_n9_ties_greater", round(sx), round(sy),
   list(method = "spearman", alternative = "greater"))
cr("spearman_n8_heavy_ties", c(1, 1, 1, 2, 2, 3, 3, 3), c(2, 1, 2, 2, 3, 3, 1, 3),
   list(method = "spearman"))
tx <- rnorm(17); ty <- -0.4 * tx + rnorm(17)
cr("spearman_n17_exact", tx, ty, list(method = "spearman"),
   note = "Largest n with an exact P; pspearman's exact distribution.")
cr("spearman_n17_exact_less", tx, ty, list(method = "spearman", alternative = "less"))
ux <- rnorm(18); uy <- 0.5 * ux + rnorm(18)
cr("spearman_n18_auto", ux, uy, list(method = "spearman"),
   note = "n = 18: t approximation (cor.test(exact = FALSE)).")
cr("spearman_n18_forced_exact", ux, uy, list(method = "spearman", exact = TRUE))
vx <- rnorm(10)
cr("spearman_n10_forced_t", vx, vx + rnorm(10), list(method = "spearman", exact = FALSE))
cr("spearman_n40_ties", round(rnorm(40, 0, 2)), round(rnorm(40, 0, 2)),
   list(method = "spearman"))
