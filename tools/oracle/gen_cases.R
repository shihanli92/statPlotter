# Generates random oracle cases with fixed seeds. Hand-written cases live alongside them.
# Rerun only when adding generated cases; outputs are committed.
#
#   cd tools/oracle && Rscript gen_cases.R

source("lib.R")

# tol/note: use when R itself is the limiting factor (document why in note).
write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (!is.null(params)) case$params <- params
  if (!is.null(tol)) case$tol <- lapply(tol, jsonlite::unbox)
  if (!is.null(note)) case$note <- jsonlite::unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, json_verbatim = TRUE),
             file.path(dir, paste0(name, ".json")))
}

# Like write_case, but params may hold NULL (-> null) and +-Inf (-> "Inf"), and length-1
# vectors are unboxed; nested lists keep their shape.
write_case_p <- function(suite, name, input, params, tol = NULL, note = NULL) {
  pj <- structure(toJSON(params, auto_unbox = TRUE, null = "null", na = "string", digits = I(17)),
                  class = "json")
  write_case(suite, name, input, params = pj, tol = tol, note = note)
}

set.seed(20260928)
write_case("descriptive", "gen_normal_n50", list(values = rnorm(50, 10, 2)))
write_case("descriptive", "gen_lognormal_n200", list(values = rlnorm(200, 0, 1.5)))
write_case("descriptive", "gen_offset_1e9", list(values = 1e9 + rnorm(30, 0, 1e-3)),
           tol = list(rtol = 1e-9),
           note = paste("R's two-pass var() loses ~3e-10 relative here on platforms without long",
                        "double (arm64). Exact rational SD is asserted separately in the TS tests."))
write_case("descriptive", "gen_mixed_magnitude", list(values = c(rnorm(20, 0, 1e-6), rnorm(20, 0, 1e6))))

# ---- distributions: deterministic grids (no RNG) ------------------------------------------
# Points whose smaller tail is below 1e-300 are dropped (denormal / underflow territory).
grid_case <- function(name, fn, cols, keep, tol = NULL, note = NULL) {
  g <- do.call(expand.grid, c(cols, list(KEEP.OUT.ATTRS = FALSE)))
  g <- g[keep(g), , drop = FALSE]
  write_case("distributions", name, as.list(g), params = list(fn = unbox(fn)), tol = tol,
             note = note)
}
unbox <- jsonlite::unbox

grid_case("normal_cdf", "normal",
  list(z = c(-37.5, -30, -20, -10, -8, -5, -3, -2.5, -2, -1.99, -1.5, -1, -0.5, -1e-10, 0,
             1e-10, 0.3, 0.67, 1, 1.5, 1.96, 1.99, 2, 2.01, 2.5, 3, 4, 5, 8, 10, 20, 30, 37.5)),
  function(g) rep(TRUE, nrow(g)))
grid_case("normal_quantile", "normal_quantile",
  list(p = c(1e-300, 1e-100, 1e-20, 1e-10, 1e-5, 0.001, 0.02425, 0.025, 0.05, 0.075, 0.1, 0.3,
             0.45, 0.5, 0.55, 0.7, 0.9, 0.975, 0.99, 0.999999)),
  function(g) rep(TRUE, nrow(g)))
t_dfs <- c(1, 2, 3, 4.5, 5, 10, 29, 30, 100, 1000, 1e5)
t_ts <- c(-1e6, -100, -10, -3, -1, -0.1, 0, 1e-8, 0.1, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 40, 100,
          1e3, 1e6, 1e60)
grid_case("t_cdf", "t", list(t = t_ts, df = t_dfs),
  function(g) pt(-abs(g$t), g$df) > 1e-300)
grid_case("t_quantile", "t_quantile",
  list(p = c(1e-100, 1e-20, 1e-10, 1e-5, 0.001, 0.005, 0.025, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6,
             0.9, 0.95, 0.975, 0.995, 0.999999),
       df = c(1, 2, 3, 4.5, 7, 10, 30, 100, 1000, 1e5)),
  function(g) !(g$p <= 1e-20 & g$df >= 4.5 & g$df <= 10),
  tol = list(rtol = 1e-12))
grid_case("t_quantile_extreme", "t_quantile",
  list(p = c(1e-300, 1e-100, 1e-20), df = c(4.5, 7, 10)),
  function(g) rep(TRUE, nrow(g)),
  tol = list(rtol = 1e-7),
  note = paste("R's qt() is only ~1e-8 accurate this deep in the tail for small non-integer",
               "and moderate df (e.g. qt(1e-300, 4.5) is off by 2.5e-9 relative). The TS",
               "tests check these points against 50-digit mpmath values at 1e-13."))
grid_case("f_cdf", "f",
  list(x = c(1e-6, 0.01, 0.5, 0.9, 1, 1.1, 2, 5, 10, 100, 1e4, 1e8),
       df1 = c(1, 2, 3, 5, 10, 30, 100, 1000, 1e4), df2 = c(1, 2, 5, 10, 30, 100, 1e4)),
  function(g) pmin(pf(g$x, g$df1, g$df2), pf(g$x, g$df1, g$df2, lower.tail = FALSE)) > 1e-300)
grid_case("chisq_cdf", "chisq",
  list(x = c(1e-8, 0.1, 0.5, 1, 2, 3.84, 5, 10, 50, 100, 500, 1000, 1500),
       df = c(0.5, 1, 2, 3, 5, 10, 50, 100, 1000)),
  function(g) pmin(pchisq(g$x, g$df), pchisq(g$x, g$df, lower.tail = FALSE)) > 1e-300)
grid_case("beta_inc", "beta",
  list(x = c(1e-10, 1e-3, 0.1, 0.3, 0.5, 0.7, 0.9, 0.999, 1 - 1e-10),
       a = c(0.5, 1, 2.5, 10, 100, 1e4), b = c(0.5, 1, 3, 50, 1e4)),
  function(g) pmin(pbeta(g$x, g$a, g$b), pbeta(g$x, g$a, g$b, lower.tail = FALSE)) > 1e-300)
grid_case("lgamma", "lgamma",
  list(x = c(1e-300, 1e-10, 0.1, 0.5, 0.9, 1, 1.5, 2, 2.5, 3, 3.7, 5.5, 9.99, 10, 10.01, 25.3,
             100, 171.5, 1e5, 1e10, 1e15, 1e300)),
  function(g) rep(TRUE, nrow(g)))
grid_case("lgamma_near_roots", "lgamma",
  list(x = c(0.99999, 1.0000001, 1.001, 1.999, 1.9999, 2.0000001, 2.001)),
  function(g) rep(TRUE, nrow(g)),
  tol = list(rtol = 1e-7),
  note = paste("R computes lgamma(x) for x < 10 as log(gamma(x)), whose absolute error",
               "(~1e-16) is a large relative error next to the zeros at 1 and 2 (e.g. 2e-10 at",
               "1 + 1e-7). Our series keeps relative accuracy; the TS tests also check these",
               "points against the Taylor series of lgamma to full precision."))

# ---- t tests / F test ------------------------------------------------------------------------
set.seed(20260929)
ta <- rnorm(30, 10, 2); tb <- rnorm(25, 11.5, 3.5)
write_case("ttest", "gen_n30_n25", list(a = ta, b = tb))
write_case("ttest", "gen_n30_n25_welch_99", list(a = ta, b = tb),
           params = list(equalVariance = unbox(FALSE), confLevel = unbox(0.99)))
write_case("ttest", "gen_separated", list(a = rnorm(20, 0, 1), b = rnorm(20, 10, 1)),
           note = unbox("Far-tail P value (~1e-25) from the t distribution."))
oa <- 1e9 + rnorm(12, 0, 1e-3); ob <- 1e9 + rnorm(15, 5e-4, 1e-3)
offset_note <- paste("Large offset: R's means are only good to ~1 ulp of 1e9, so the oracle",
                     "analyses the data minus params$shift (exact); see r/ttest.R.")
write_case("ttest", "gen_offset_1e9", list(a = oa, b = ob),
           params = list(shift = unbox(1e9)), note = offset_note)
write_case("ttest", "gen_offset_1e9_welch", list(a = oa, b = ob),
           params = list(shift = unbox(1e9), equalVariance = unbox(FALSE)), note = offset_note)
pa <- rnorm(25, 50, 8); pb <- pa + rnorm(25, 1.5, 3)
write_case("ttest", "gen_paired_n25", list(a = pa, b = pb), params = list(test = unbox("paired")))
qa <- 1e9 + rnorm(10, 0, 1e-3); qb <- qa + rnorm(10, 2e-4, 3e-4)
write_case("ttest", "gen_paired_offset_1e9", list(a = qa, b = qb),
           params = list(test = unbox("paired")),
           note = paste("Differences b - a are exact (Sterbenz). Only the pairing r depends on",
                        "the offset; both sides centre by the mean before multiplying."))
ra <- rlnorm(12, 1, 0.8); rb <- ra * rlnorm(12, 0.3, 0.4)
write_case("ttest", "gen_ratio_n12", list(a = ra, b = rb), params = list(test = unbox("ratio")))

fa <- rnorm(15, 0, 1); fb <- rnorm(22, 0, 2.2)
write_case("ftest", "gen_n15_n22", list(a = fa, b = fb))
write_case("ftest", "gen_offset_1e9", list(a = oa, b = ob), tol = list(rtol = 1e-9),
           note = paste("R's var() loses ~3e-10 relative for 1e9 + noise on arm64 (see",
                        "descriptive/gen_offset_1e9); F is a ratio of two such variances."))

# ---- Mann-Whitney ----------------------------------------------------------------------------
set.seed(20260930)
ma <- rnorm(12, 0, 1); mb <- rnorm(20, 0.8, 1.3)
write_case("mannwhitney", "gen_n12_n20_exact", list(a = ma, b = mb),
           params = list(exact = unbox(TRUE)))
write_case("mannwhitney", "gen_n12_n20_exact_greater_90", list(a = ma, b = mb),
           params = list(exact = unbox(TRUE), alternative = unbox("greater"),
                         confLevel = unbox(0.9)))
write_case("mannwhitney", "gen_n12_n20_normal_99", list(a = ma, b = mb),
           params = list(exact = unbox(FALSE), confLevel = unbox(0.99)))
ta <- round(rnorm(30, 10, 3)); tb <- round(rnorm(25, 12, 3))
write_case("mannwhitney", "gen_ties_n30_n25_exact", list(a = ta, b = tb),
           params = list(exact = unbox(TRUE)))
write_case("mannwhitney", "gen_ties_n30_n25_exact_less", list(a = ta, b = tb),
           params = list(exact = unbox(TRUE), alternative = unbox("less")))
write_case("mannwhitney", "gen_ties_n30_n25_normal", list(a = ta, b = tb),
           params = list(exact = unbox(FALSE)))
write_case("mannwhitney", "gen_ties_n40_n45_exact", list(a = round(rnorm(40, 5, 2)),
           b = round(rnorm(45, 5.6, 2))), params = list(exact = unbox("auto")))
la <- rnorm(60, 0, 1); lb <- rnorm(70, 0.3, 1)
write_case("mannwhitney", "gen_n60_n70_auto", list(a = la, b = lb),
           params = list(exact = unbox("auto")),
           note = unbox("nA + nB = 130 > 100: 'auto' uses the normal approximation."))
write_case("mannwhitney", "gen_n60_n70_exact", list(a = la, b = lb),
           params = list(exact = unbox(TRUE)))
write_case("mannwhitney", "gen_offset_1e9", list(a = 1e9 + rnorm(10, 0, 1e-3),
           b = 1e9 + rnorm(12, 1e-3, 1e-3)), params = list(exact = unbox(TRUE)))
write_case("mannwhitney", "gen_offset_1e9_normal", list(a = 1e9 + rnorm(10, 0, 1e-3),
           b = 1e9 + rnorm(12, 1e-3, 1e-3)), params = list(exact = unbox(FALSE)))

# ---- Wilcoxon signed rank ----------------------------------------------------------------------
set.seed(20261001)
wa <- rnorm(20, 20, 4); wb <- wa + rnorm(20, 0.8, 2)
write_case("wilcoxon", "gen_n20_exact", list(a = wa, b = wb), params = list(exact = unbox(TRUE)))
write_case("wilcoxon", "gen_n20_normal_90", list(a = wa, b = wb),
           params = list(exact = unbox(FALSE), confLevel = unbox(0.9)))
ra <- round(rnorm(40, 20, 4)); rb <- ra + round(rnorm(40, 0.7, 2))
write_case("wilcoxon", "gen_ties_zeros_n40_auto", list(a = ra, b = rb),
           params = list(exact = unbox("auto")))
write_case("wilcoxon", "gen_ties_zeros_n40_pratt", list(a = ra, b = rb),
           params = list(exact = unbox(TRUE), zeroMethod = unbox("pratt")))
write_case("wilcoxon", "gen_ties_zeros_n40_normal", list(a = ra, b = rb),
           params = list(exact = unbox(FALSE)))
la <- rnorm(120, 0, 1); lb <- la + rnorm(120, 0.15, 1)
write_case("wilcoxon", "gen_n120_auto", list(a = la, b = lb), params = list(exact = unbox("auto")),
           note = unbox("120 non-zero differences > 100: 'auto' uses the normal approximation."))
oa <- 1e9 + rnorm(12, 0, 1e-3); ob <- oa + rnorm(12, 3e-4, 5e-4)
write_case("wilcoxon", "gen_offset_1e9", list(a = oa, b = ob), params = list(exact = unbox(TRUE)))
write_case("wilcoxon", "gen_offset_1e9_normal", list(a = oa, b = ob),
           params = list(exact = unbox(FALSE)))

# ---- linear regression ---------------------------------------------------------------------
set.seed(20261010)
lx <- 1:20
ly <- 2.5 + 0.8 * lx + rnorm(20, 0, 1.2)
bx <- c(-5, 0, 5.5, 10, 20, 30)
write_case("linear", "gen_n20", list(x = lx, y = ly, bandX = bx))
write_case("linear", "gen_n20_origin", list(x = lx, y = ly, bandX = bx),
           params = list(throughOrigin = unbox(TRUE)))
lw <- 1 / (0.5 + lx / 10)^2
write_case("linear", "gen_n20_weighted", list(x = lx, y = ly, weights = lw, bandX = bx))
write_case("linear", "gen_n20_origin_weighted_99", list(x = lx, y = ly, weights = lw, bandX = bx),
           params = list(throughOrigin = unbox(TRUE), confLevel = unbox(0.99)))
nx <- runif(15, 0, 10)
write_case("linear", "gen_negative_slope_90", list(x = nx, y = 20 - 1.5 * nx + rnorm(15, 0, 2),
           bandX = c(0, 5, 13.3)), params = list(confLevel = unbox(0.9)))
fx <- runif(12, 0, 10)
write_case("linear", "gen_flat", list(x = fx, y = 5 + 0.02 * fx + rnorm(12, 0, 1), bandX = c(1, 9)),
           note = unbox("Slope not significant: the Fieller X-intercept interval is unbounded (NaN)."))
ox <- 1e6 + seq(0, 24)
write_case("linear", "gen_offset_1e6", list(x = ox, y = 3 + 2e-3 * (ox - 1e6) + rnorm(25, 0, 1e-3),
           bandX = c(1e6, 1e6 + 12)), tol = list(rtol = 1e-8),
           note = paste("x = 1e6 + small: R's lm() works on the raw (uncentred) design, so SS, SEs",
                        "and F agree only to ~1e-10, and the far-tail P value amplifies that",
                        "to ~1e-9."))
write_case("linear", "n3", list(x = c(1, 2, 4), y = c(1.1, 1.9, 4.2), bandX = c(0, 3)))

# ---- comparing linear regressions -------------------------------------------------------------
set.seed(20261011)
cx1 <- seq(0, 10, 1); cx2 <- seq(0.5, 9.5, 1)
write_case("compare_linear", "gen_parallel",
           list(datasets = list(list(x = cx1, y = 1 + 0.8 * cx1 + rnorm(11, 0, 0.6)),
                                list(x = cx2, y = 2.5 + 0.8 * cx2 + rnorm(10, 0, 0.6)))),
           note = unbox("Same slope, different intercepts: the intercept test runs."))
write_case("compare_linear", "gen_different_slopes",
           list(datasets = list(list(x = cx1, y = 1 + 0.5 * cx1 + rnorm(11, 0, 0.5)),
                                list(x = cx2, y = 1 + 1.2 * cx2 + rnorm(10, 0, 0.5)))),
           note = unbox("Slopes differ (P < 0.05): intercepts is null."))
write_case("compare_linear", "gen_three_identical",
           list(datasets = lapply(1:3, function(k) {
             x <- sort(runif(8, 0, 20)); list(x = x, y = 4 - 0.3 * x + rnorm(8, 0, 1))
           })))

# ---- polynomial regression ------------------------------------------------------------------
set.seed(20261012)
px <- seq(-3, 4, 0.5)
write_case("polynomial", "gen_quadratic", list(x = px, y = 1 - 2 * px + 0.5 * px^2 +
           rnorm(length(px), 0, 0.4), degree = unbox(2)))
write_case("polynomial", "gen_cubic_weighted_90",
           list(x = px, y = 2 + px - 0.3 * px^3 + rnorm(length(px), 0, 0.5), degree = unbox(3),
                weights = 1 / (1 + abs(px))), params = list(confLevel = unbox(0.9)))
qx <- 100 + seq(0, 10, 0.5)
write_case("polynomial", "gen_quartic_offset",
           list(x = qx, y = 3 + 0.2 * (qx - 100) - 0.05 * (qx - 100)^2 + 0.002 * (qx - 100)^4 +
                rnorm(length(qx), 0, 0.05), degree = unbox(4)), tol = list(rtol = 1e-8),
           note = paste("x = 100..110: converting centred-basis coefficients to powers of x",
                        "cancels ~5 digits (c^4 ~ 1e8), in the oracle and in our code alike;",
                        "SS, R^2 and Sy.x agree to ~1e-13."))
write_case("polynomial", "gen_line", list(x = px, y = 3 + 2 * px + rnorm(length(px)), degree = unbox(1)))

# ---- nonlinear regression ---------------------------------------------------------------------
set.seed(20261013)
logistic4 <- function(x, b, t, l, h) b + (t - b) / (1 + 10^((l - x) * h))
dose <- rep(seq(-9, -4, 0.5), each = 3)
p4 <- c(5, 95, -6.5, 1.2)
y4 <- logistic4(dose, p4[1], p4[2], p4[3], p4[4]) + rnorm(length(dose), 0, 4)
band_dose <- c(-10, -8, -6.5, -5, -3)
write_case_p("nonlinear", "agonist_4pl",
             list(data = list(list(x = dose, y = y4)), bandX = band_dose),
             list(equation = "agonist-response-variable-slope", start = list(p4)))
write_case_p("nonlinear", "agonist_4pl_profile_90",
             list(data = list(list(x = dose, y = y4))),
             list(equation = "agonist-response-variable-slope", start = list(p4),
                  profileCI = TRUE, confLevel = 0.9))
write_case_p("nonlinear", "agonist_4pl_vs_3param",
             list(data = list(list(x = dose, y = y4))),
             list(equation = "agonist-response-variable-slope", start = list(p4),
                  compare = list(equation = "agonist-response")),
             note = "Extra-sum-of-squares F test and AICc: Hill slope fixed at 1 vs variable.")
y3 <- logistic4(dose, 10, 90, -7, 1) + rnorm(length(dose), 0, 5)
write_case_p("nonlinear", "agonist_3param",
             list(data = list(list(x = dose, y = y3)), bandX = band_dose),
             list(equation = "agonist-response", start = list(c(10, 90, -7))))
yi <- 10 + 90 / (1 + 10^((dose + 7) * 0.9)) + rnorm(length(dose), 0, 4)
write_case_p("nonlinear", "inhibitor_4pl_constant_bottom_99",
             list(data = list(list(x = dose, y = yi)), bandX = band_dose),
             list(equation = "inhibitor-response-variable-slope", start = list(c(0, 100, -7, -0.9)),
                  constraints = list(list(kind = "constant", value = 0), list(kind = "fit"),
                                     list(kind = "fit"), list(kind = "fit")),
                  confLevel = 0.99))
yb <- logistic4(dose, -4, 80, -6, 1) + rnorm(length(dose), 0, 3)
write_case_p("nonlinear", "agonist_4pl_bounded_bottom",
             list(data = list(list(x = dose, y = yb)), bandX = band_dose),
             list(equation = "agonist-response-variable-slope", start = list(c(0, 80, -6, 1)),
                  bounds = list(c(0, Inf), NULL, NULL, NULL)),
             note = paste("The unconstrained Bottom is negative; with Bottom >= 0 it ends on the",
                          "bound and is then treated as fixed (no SE; not counted in df)."))
tx <- rep(seq(0, 30, 2), each = 2)
yd <- (100 - 10) * exp(-0.2 * tx) + 10 + rnorm(length(tx), 0, 2)
write_case_p("nonlinear", "one_phase_decay",
             list(data = list(list(x = tx, y = yd)), bandX = c(0, 3.5, 10, 40)),
             list(equation = "one-phase-decay", start = list(c(100, 10, 0.2))))
sx <- rep(c(0.5, 1, 2, 4, 8, 16, 32, 64), each = 2)
ym <- 50 * sx / (4 + sx) + rnorm(length(sx), 0, 1.2)
write_case_p("nonlinear", "michaelis_menten",
             list(data = list(list(x = sx, y = ym)), bandX = c(0.1, 4, 50, 200)),
             list(equation = "michaelis-menten", start = list(c(50, 4))))
write_case_p("nonlinear", "michaelis_menten_profile",
             list(data = list(list(x = sx, y = ym))),
             list(equation = "michaelis-menten", start = list(c(50, 4)), profileCI = TRUE))
yr <- 50 * sx / (4 + sx) * exp(rnorm(length(sx), 0, 0.08))
write_case_p("nonlinear", "michaelis_menten_relative_weights",
             list(data = list(list(x = sx, y = yr)), bandX = c(0.1, 4, 50)),
             list(equation = "michaelis-menten", start = list(c(50, 4)), weighting = "relative"))
yc <- rpois(length(tx), (400 - 20) * exp(-0.15 * tx) + 20)
write_case_p("nonlinear", "decay_poisson_weights",
             list(data = list(list(x = tx, y = yc)), bandX = c(0, 10, 30)),
             list(equation = "one-phase-decay", start = list(c(400, 20, 0.15)),
                  weighting = "poisson"))
gx <- rep(seq(0, 10, 0.5), each = 2)
yg <- 10 * exp(0.3 * gx) + rnorm(length(gx), 0, 1)
write_case_p("nonlinear", "exponential_growth_99",
             list(data = list(list(x = gx, y = yg)), bandX = c(0, 5, 12)),
             list(equation = "exponential-growth", start = list(c(10, 0.3)), confLevel = 0.99))
bx2 <- rep(c(0.5, 1, 2, 4, 8, 16, 32, 64, 128), each = 3)
yt <- 1200 * bx2 / (5 + bx2) + 10 * bx2 + rnorm(length(bx2), 0, 20)
write_case_p("nonlinear", "one_site_total",
             list(data = list(list(x = bx2, y = yt)), bandX = c(1, 10, 100)),
             list(equation = "one-site-total", start = list(c(1200, 5, 10, 0)),
                  constraints = list(list(kind = "fit"), list(kind = "fit"), list(kind = "fit"),
                                     list(kind = "constant", value = 0))))
# Global fit: two agonist curves with a shared Hill slope.
d1 <- logistic4(dose, 5, 100, -7, 1.3) + rnorm(length(dose), 0, 4)
d2 <- logistic4(dose, 8, 90, -6, 1.3) + rnorm(length(dose), 0, 4)
two <- list(data = list(list(x = dose, y = d1), list(x = dose, y = d2)), bandX = band_dose)
shared_hill <- list(list(kind = "fit"), list(kind = "fit"), list(kind = "fit"),
                    list(kind = "shared"))
all_fit <- list(list(kind = "fit"), list(kind = "fit"), list(kind = "fit"), list(kind = "fit"))
starts2 <- list(c(5, 100, -7, 1.3), c(8, 90, -6, 1.3))
write_case_p("nonlinear", "global_shared_hill", two,
             list(equation = "agonist-response-variable-slope", start = starts2,
                  constraints = shared_hill))
write_case_p("nonlinear", "global_separate_vs_shared_hill", two,
             list(equation = "agonist-response-variable-slope", start = starts2,
                  constraints = all_fit,
                  compare = list(equation = "agonist-response-variable-slope",
                                 constraints = shared_hill)),
             note = paste("Separate fits (each with its own s^2) vs a global fit sharing HillSlope:",
                          "F test on the summed SS and df, and AICc."))
write_case_p("nonlinear", "global_shared_bottom_top", two,
             list(equation = "agonist-response-variable-slope", start = starts2,
                  constraints = list(list(kind = "shared"), list(kind = "shared"),
                                     list(kind = "fit"), list(kind = "fit"))))

# Phase 3 (ANOVA and multiple comparisons) cases are generated by gen_cases_anova.R.
