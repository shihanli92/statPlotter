# Generates the oracle cases of roadmap item 18 (statistics additions) with fixed seeds,
# separately from the earlier generators so their cases are never rewritten. Each section can be
# run on its own:
#
#   cd tools/oracle && Rscript gen_cases_stats18.R [section ...]

source("lib.R")
unbox <- jsonlite::unbox

write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (inherits(params, "json")) case$params <- params
  else if (!is.null(params))
    case$params <- lapply(params, function(p) if (length(p) == 1) unbox(p) else p)
  if (!is.null(tol)) case$tol <- lapply(tol, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "string",
                    json_verbatim = TRUE),
             file.path(dir, paste0(name, ".json")))
}

sections <- commandArgs(trailingOnly = TRUE)
want <- function(s) length(sections) == 0 || s %in% sections

# ---- contingency_extra ------------------------------------------------------------------------
if (want("contingency_extra")) {
  ce <- function(name, table, params = NULL, note = NULL)
    write_case("contingency_extra", name, list(table = table), params, note = note)
  ce("t2x2", list(c(76, 399), c(129, 332)), note = "The AZT relative-risk example; phi only.")
  ce("t3x2_fisher_bonferroni", list(c(12, 18), c(20, 10), c(28, 4)))
  ce("t3x2_chisq_holm_sidak", list(c(12, 18), c(20, 10), c(28, 4)),
     params = list(test = "chiSquare", method = "holm-sidak"))
  ce("t3x2_chisq_yates", list(c(12, 18), c(20, 10), c(28, 4)),
     params = list(test = "chiSquare", yates = TRUE, method = "sidak"))
  ce("t3x3_fisher", list(c(10, 5, 3), c(4, 12, 6), c(2, 6, 14)),
     params = list(method = "bh"))
  ce("t4x3_control", list(c(15, 10, 5), c(9, 12, 9), c(5, 10, 15), c(12, 12, 6)),
     params = list(compare = "control", control = 0, method = "holm-sidak"))
  ce("t4x3_control_last", list(c(15, 10, 5), c(9, 12, 9), c(5, 10, 15), c(12, 12, 6)),
     params = list(compare = "control", control = 3, test = "chiSquare", method = "none"))
  ce("t3x4_empty_column", list(c(6, 0, 4, 5), c(3, 0, 7, 2), c(4, 5, 1, 6)),
     params = list(test = "chiSquare"),
     note = "Column 2 is empty in rows 1 and 2: dropped from that pair's table (2 x 3).")
  ce("t3x2_same_outcome", list(c(8, 0), c(5, 0), c(3, 4)),
     note = "Rows 1 and 2 put everyone in the first outcome: P = 1 for that pair.")
  ce("t5x2_large", list(c(120, 380), c(150, 350), c(170, 330), c(200, 300), c(230, 270)),
     params = list(test = "chiSquare", method = "bonferroni"))
}

# ---- deming -----------------------------------------------------------------------------------
if (want("deming")) {
  dm <- function(name, x, y, params = NULL, note = NULL, tol = NULL)
    write_case("deming", name, list(x = x, y = y), params, tol = tol, note = note)
  set.seed(20261801)
  truth <- runif(30, 2, 20)
  x1 <- round(truth + rnorm(30, 0, 0.8), 2)
  y1 <- round(1.1 * truth - 0.5 + rnorm(30, 0, 0.8), 2)
  dm("equal_errors", x1, y1, note = "Two assay methods, equal error SDs (orthogonal regression).")
  dm("sd_ratio", x1, y1, params = list(lambda = 0.25, xForY = 10),
     note = "SD of X 0.5, SD of Y 1 (lambda 0.25); Y at X = 10.")
  dm("sd_ratio_large", x1, y1, params = list(lambda = 16, confLevel = 0.9))
  x2 <- round(seq(1, 12, length.out = 12) + rnorm(12, 0, 0.3), 3)
  y2 <- round(40 - 2.5 * x2 + rnorm(12, 0, 0.9), 3)
  dm("negative_slope", x2, y2, params = list(lambda = 0.1, xForY = -3))
  dm("n3", c(1, 2, 3.5), c(2.1, 3.9, 7.2))
  dm("offset_1e6", 1e6 + x1, 1e6 + y1, params = list(lambda = 2), tol = list(rtol = 1e-9),
     note = paste("Large offset: centred sums keep the precision. rtol 1e-9: R's plain sums of",
                  "squares differ in the 12th digit, which the P value (5.6e-21) amplifies."))
  dm("near_linear", x2, 3 * x2 + 1 + c(1e-3, -2e-3, 1e-3, 0, 2e-3, -1e-3, 0, 1e-3, -1e-3, 2e-3, 0,
                                       -2e-3), params = list(lambda = 1))
}

# ---- poisson ----------------------------------------------------------------------------------
if (want("poisson")) {
  po <- function(name, y, X, names, params = NULL, note = NULL)
    write_case("poisson", name, list(y = y, X = X, names = names), params, note = note)
  set.seed(20261802)
  n <- 40
  age <- round(runif(n, 20, 70))
  dose <- sample(0:3, n, replace = TRUE)
  mu <- exp(-1 + 0.03 * age + 0.4 * dose)
  y <- rpois(n, mu)
  po("two_predictors", y, cbind(age, dose), c("Age", "Dose"))
  po("two_predictors_profile_90", y, cbind(age, dose), c("Age", "Dose"),
     params = list(ciMethod = "profile", confLevel = 0.9))
  po("one_predictor", y, cbind(dose), c("Dose"))
  po("no_intercept", y, cbind(age / 10, dose), c("Age10", "Dose"),
     params = list(intercept = FALSE))
  g <- rep(0:1, each = 15)
  yz <- rpois(30, ifelse(g == 1, 0.4, 2.5))
  po("many_zeros", yz, cbind(g), c("Treated"))
  po("overdispersed", rnbinom(n, mu = mu, size = 1.5), cbind(age, dose), c("Age", "Dose"),
     params = list(ciMethod = "profile"))
}

# ---- linear: the line forced through a point ---------------------------------------------------
if (want("linear")) {
  set.seed(20261804)
  xl <- round(seq(0.5, 10, length.out = 14) + runif(14, -0.2, 0.2), 3)
  yl <- round(2 + 1.5 * xl + rnorm(14, 0, 0.8), 3)
  write_case("linear", "through_point", list(x = xl, y = yl, bandX = c(0, 5, 12)),
             params = list(throughPoint = c(4, 8)),
             note = "Forced through (4, 8): slope from lm(y - 8 ~ 0 + (x - 4)).")
  write_case("linear", "through_point_weighted_90",
             list(x = xl, y = yl, weights = 1 / xl, bandX = c(1, 9)),
             params = list(throughPoint = c(-2, 1.5), confLevel = 0.9))
}

# ---- curvefit: two intersecting lines (crossing point shared) ------------------------------------
if (want("curvefit")) {
  set.seed(20261805)
  line2 <- function(x, xc, yc, s) yc + (x - xc) * s + rnorm(length(x), 0, 0.6)
  xa <- seq(0, 10, 1)
  xb <- seq(4, 16, 1.5)
  data <- list(list(x = xa, y = line2(xa, 7, 20, 2.5)), list(x = xb, y = line2(xb, 7, 20, -1.2)))
  pj <- structure(jsonlite::toJSON(list(
    equation = "two-lines-crossing",
    constraints = list(list(kind = "shared"), list(kind = "shared"), list(kind = "fit")),
    start = list(c(7, 20, 2.5), c(7, 20, -1.2))), auto_unbox = TRUE, digits = I(17)),
    class = "json")
  write_case("curvefit", "eq_two_lines_crossing", list(data = data), params = pj,
             note = "Two lines sharing the crossing point (Xcross, Ycross), each its own slope.")
}

# ---- nlweights: weighting choices, weighted Hougaard, weighting test, compare a parameter ------
if (want("nlweights")) {
  set.seed(20261806)
  jparams <- function(p) structure(jsonlite::toJSON(p, auto_unbox = TRUE, digits = I(17)),
                                   class = "json")
  fitc <- function(n) lapply(seq_len(n), function(i) list(kind = "fit"))
  nw <- function(name, data, params, weights = NULL, note = NULL) {
    input <- list(data = data)
    if (!is.null(weights)) input$weights <- weights
    write_case("nlweights", name, input, params = jparams(params), note = note)
  }
  mmf <- function(x, p) p[1] * x / (p[2] + x)
  sub <- c(0.25, 0.5, 1, 2, 3, 5, 8, 12, 20, 30, 50, 80)
  xs <- rep(sub, each = 2)
  ymm <- mmf(xs, c(120, 6)) * exp(rnorm(length(xs), 0, 0.08))
  nw("mm_power_k15", list(list(x = xs, y = ymm)),
     list(equation = "michaelis-menten", constraints = fitc(2), weighting = "power",
          weightPower = 1.5, start = list(c(120, 6))),
     note = "General weighting 1/Y^1.5 (K = 1.5).")
  nw("mm_relative", list(list(x = xs, y = ymm)),
     list(equation = "michaelis-menten", constraints = fitc(2), weighting = "relative",
          start = list(c(120, 6))))
  nw("mm_poisson_n12", list(list(x = sub, y = round(mmf(sub, c(300, 4)) + rnorm(12, 0, 6)))),
     list(equation = "michaelis-menten", constraints = fitc(2), weighting = "poisson",
          start = list(c(300, 4))),
     note = "n = 12: the weighting test's Spearman P is exact.")
  nw("mm_weight_1_over_x", list(list(x = xs, y = ymm)),
     list(equation = "michaelis-menten", constraints = fitc(2), start = list(c(120, 6))),
     weights = list(1 / xs), note = "1/X weighting (fixed point weights).")
  nw("mm_weight_1_over_x2", list(list(x = xs, y = ymm)),
     list(equation = "michaelis-menten", constraints = fitc(2), start = list(c(120, 6))),
     weights = list(1 / xs^2))
  dose <- seq(-9, -4, 0.5)
  r4 <- function(x, p) p[1] + (p[2] - p[1]) / (1 + 10^((p[3] - x) * p[4]))
  ysd <- r4(dose, c(5, 95, -6.5, 1.1))
  sds <- round(1 + 0.05 * ysd, 3)
  nw("agonist_sd_weights", list(list(x = dose, y = ysd + rnorm(length(dose), 0, sds))),
     list(equation = "agonist-response-variable-slope", constraints = fitc(4),
          start = list(c(5, 95, -6.5, 1.1))),
     weights = list(1 / sds^2), note = "1/SD^2 weighting (SDs entered with the means).")
  d3 <- lapply(c(-6.8, -6.5, -6.1), function(l)
    list(x = rep(dose, 2), y = r4(rep(dose, 2), c(4, 96, l, 1.2)) + rnorm(2 * length(dose), 0, 3)))
  nw("compare_logec50_separate", d3,
     list(equation = "agonist-response-variable-slope", constraints = fitc(4),
          compareShared = list("LogEC50"),
          start = lapply(c(-6.8, -6.5, -6.1), function(l) c(4, 96, l, 1.2))),
     note = "Is LogEC50 the same for all three data sets? Separate fits vs. LogEC50 shared.")
  nw("compare_logec50_shared_hill_relative", d3,
     list(equation = "agonist-response-variable-slope",
          constraints = list(list(kind = "fit"), list(kind = "fit"), list(kind = "fit"),
                             list(kind = "shared")),
          weighting = "relative", compareShared = list("LogEC50", "Bottom"),
          start = lapply(c(-6.8, -6.5, -6.1), function(l) c(4, 96, l, 1.2))),
     note = "Hill slope shared (a global fit, weighted 1/Y^2); null model also shares LogEC50 and Bottom.")
}

# ---- qq: normal QQ plot points ---------------------------------------------------------------
if (want("qq")) {
  set.seed(20261807)
  write_case("qq", "normal_n25", list(values = round(rnorm(25, 50, 8), 2)))
  write_case("qq", "small_n5", list(values = c(3.1, 2.4, 5.6, 4.4, 3.9)))
  write_case("qq", "ties_n12", list(values = c(1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8, 12)))
  write_case("qq", "lognormal_n30", list(values = round(rlnorm(30, 1, 0.6), 3)),
             params = list(lognormal = TRUE))
}

# ---- pcr: principal component regression ----------------------------------------------------
if (want("pcr")) {
  set.seed(20261808)
  n <- 40
  f1 <- rnorm(n); f2 <- rnorm(n)
  X <- cbind(A = f1 + rnorm(n, 0, 0.3), B = f1 + rnorm(n, 0, 0.4), C = f2 + rnorm(n, 0, 0.3),
             D = f2 - f1 + rnorm(n, 0, 0.5), E = rnorm(n) * 10 + 100)
  y <- 3 + 2 * f1 - 1.5 * f2 + rnorm(n, 0, 0.8)
  rows <- lapply(seq_len(n), function(i) unname(X[i, ]))
  write_case("pcr", "standardized_k2", list(y = y, X = rows), params = list(k = 2))
  write_case("pcr", "standardized_k3_90", list(y = y, X = rows),
             params = list(k = 3, confLevel = 0.9))
  write_case("pcr", "centered_k2", list(y = y, X = rows), params = list(k = 2, standardize = FALSE))
  write_case("pcr", "all_components", list(y = y, X = rows), params = list(k = 5),
             note = "All components: the back-converted coefficients equal ordinary multiple regression.")
}

# ---- smoothing: LOWESS and splines ------------------------------------------------------------
if (want("smoothing")) {
  set.seed(20261809)
  sm <- function(name, x, y, at, params, note = NULL)
    write_case("smoothing", name, list(x = x, y = y, at = at), params, note = note)
  xs <- sort(round(runif(40, 0, 20), 2))
  ys <- round(10 + 5 * sin(xs / 3) + rnorm(40, 0, 1), 3)
  at <- c(-1, 0.3, 2.5, 7.77, 12, 19.2, 21)
  sm("lowess_default", xs, ys, at, list(method = "lowess"))
  sm("lowess_fine", xs, ys, at, list(method = "lowess", f = 0.1))
  sm("lowess_medium_no_robust", xs, ys, at, list(method = "lowess", f = 1 / 3, iter = 0))
  xt <- rep(1:12, each = 3)
  yt <- round(2 * xt + rnorm(36, 0, 2), 2)
  yt[c(5, 20)] <- yt[c(5, 20)] + 15
  sm("lowess_ties_outliers", xt, yt, at, list(method = "lowess", f = 0.3),
     note = "Tied X (triplicates) and two outliers: the robustness steps down-weight them.")
  xd <- c(0, 1, 2.5, 3, 4.2, 6, 7.5, 9, 10)
  yd <- c(1, 2.2, 2.9, 3.1, 5.8, 6.1, 6.0, 8.8, 9.9)
  atd <- c(-0.5, 0, 0.5, 2.7, 4.2, 5, 8.25, 10, 10.5)
  sm("natural", xd, yd, atd, list(method = "natural"))
  sm("akima", xd, yd, atd, list(method = "akima"))
  sm("akima_flat", c(0, 1, 2, 3, 4, 5), c(0, 0, 0, 1, 1, 1), c(0.5, 1.5, 2.5, 3.5, 4.5),
     list(method = "akima"), note = "Flat stretches: both weights 0 at some points.")
  sm("p2p", xd, yd, atd, list(method = "p2p"))
  sm("regression_k3", xs, ys, at[2:6], list(method = "regression", knots = 3))
  sm("regression_k5", xs, ys, at[2:6], list(method = "regression", knots = 5))
  sm("regression_k7_ties", xt, yt, c(1, 3.3, 6, 9.9, 12), list(method = "regression", knots = 7))
}

# ---- coxcurves: estimated survival curves from a Cox model ------------------------------------
if (want("coxcurves")) {
  set.seed(20261810)
  n <- 50
  age <- round(runif(n, 30, 70))
  trt <- rbinom(n, 1, 0.5)
  tt <- rexp(n, 0.02 * exp(0.03 * (age - 50) - 0.7 * trt))
  cens <- rexp(n, 0.01)
  time <- round(pmin(tt, cens), 1)
  event <- as.integer(tt <= cens)
  rows <- lapply(seq_len(n), function(i) c(age[i], trt[i]))
  nd <- list(c(40, 0), c(40, 1), c(60, 0), c(60, 1))
  write_case("coxcurves", "age_treatment", list(time = time, event = event, X = rows,
             names = c("Age", "Treated"), newdata = nd))
  timei <- round(pmin(tt, cens))
  write_case("coxcurves", "tied_times_efron", list(time = timei, event = event, X = rows,
             names = c("Age", "Treated"), newdata = nd),
             note = "Integer times: tied events, alpha solved numerically.")
  write_case("coxcurves", "tied_times_breslow", list(time = timei, event = event, X = rows,
             names = c("Age", "Treated"), newdata = list(c(50, 1))),
             params = list(ties = "breslow"), tol = list(rtol = 1e-9),
             note = paste("rtol 1e-9: survfit solves a tied Kalbfleisch-Prentice factor",
                          "iteratively (~1e-12), and -ln S near S = 1 magnifies that ~50-fold."))
}

# ---- rmthreeway: three-way ANOVA with repeated measures / mixed model --------------------------
if (want("rmthreeway")) {
  set.seed(20261811)
  # One case: k rows; repeated factors W (0 row, 1 col1, 2 col2); n[g] subjects per between cell.
  sim3 <- function(k, W, n, missing = 0) {
    Bt <- setdiff(0:2, W)
    L <- c(k, 2, 2)
    bcells <- expand.grid(lapply(L[Bt + 1], function(l) 0:(l - 1)))
    if (length(Bt) == 0) bcells <- data.frame(dummy = 0)
    wcells <- expand.grid(lapply(L[W + 1], function(l) 0:(l - 1)))
    out <- list(y = c(), row = c(), col1 = c(), col2 = c(), subject = c())
    sid <- 0
    eff <- function(l) 2 * l[1] + 3 * l[2] - 2 * l[3] + 1.5 * l[1] * l[2] + l[2] * l[3]
    for (g in seq_len(nrow(bcells))) {
      ng <- if (length(n) == 1) n else n[g]
      for (j in seq_len(ng)) {
        u <- rnorm(1, 0, 3)
        uw <- lapply(seq_len(ncol(wcells)), function(c) rnorm(max(1, L[W[c] + 1]), 0, 1))
        for (w in seq_len(nrow(wcells))) {
          l <- integer(3)
          for (b in seq_along(Bt)) l[Bt[b] + 1] <- bcells[g, b]
          for (c in seq_along(W)) l[W[c] + 1] <- wcells[w, c]
          extra <- sum(vapply(seq_along(W), function(c) uw[[c]][l[W[c] + 1] + 1], 0))
          out$y <- c(out$y, round(20 + eff(l) + u + extra + rnorm(1, 0, 1.5), 2))
          out$row <- c(out$row, l[1]); out$col1 <- c(out$col1, l[2]); out$col2 <- c(out$col2, l[3])
          out$subject <- c(out$subject, sid)
        }
        sid <- sid + 1
      }
    }
    if (missing > 0) out$y[sample(length(out$y), missing)] <- NA
    out
  }
  r3 <- function(name, input, repeated, method = "anova", note = NULL)
    write_case("rmthreeway", name, input,
               params = list(repeated = I(repeated), method = method), note = note)
  r3("rows_k3_n4", sim3(3, 0, 4), c(0))
  r3("rows_k3_unequal", sim3(3, 0, c(3, 4, 5, 4)), c(0),
     note = "Unequal numbers of subjects in the four between-subject cells.")
  r3("col1_k3", sim3(3, 1, 3), c(1))
  r3("cols_k2", sim3(2, c(1, 2), 5), c(1, 2))
  r3("all_k3", sim3(3, c(0, 1, 2), 5), c(0, 1, 2))
  r3("rows_col2_k4", sim3(4, c(0, 2), 3), c(0, 2))
  r3("mixed_rows_missing", sim3(3, 0, 4, missing = 3), c(0), "mixed",
     note = "Three values missing: mixed model.")
  r3("mixed_all_missing", sim3(2, c(0, 1, 2), 6, missing = 4), c(0, 1, 2), "mixed")
  r3("mixed_complete_rows", sim3(3, 0, 4), c(0), "mixed",
     note = "Complete data fitted as a mixed model: F equals RM ANOVA when the variances are positive.")
}

# ---- rm_effect_sizes: eta^2, partial eta^2, Cohen's f of RM ANOVA -----------------------------
if (want("rm_effect_sizes")) {
  set.seed(20261812)
  one <- function(k, n) {
    u <- rnorm(n, 0, 3)
    list(y = round(as.vector(t(outer(u, 1:k, function(a, b) 10 + a + 2 * b)) + rnorm(n * k)), 2),
         col = rep(0:(k - 1), n), subject = rep(0:(n - 1), each = k))
  }
  write_case("rm_effect_sizes", "oneway_k4_n6", one(4, 6), params = list(repeated = "one"))
  two <- function(R, C, n, repeated) {
    out <- list(y = c(), row = c(), col = c(), subject = c())
    sid <- 0
    if (repeated == "both") {
      for (j in 1:n) { u <- rnorm(1, 0, 3)
        for (r in 0:(R - 1)) for (c in 0:(C - 1)) {
          out$y <- c(out$y, round(10 + u + r + 2 * c + 0.5 * r * c + rnorm(1), 2))
          out$row <- c(out$row, r); out$col <- c(out$col, c); out$subject <- c(out$subject, sid) }
        sid <- sid + 1 }
    } else {
      between <- if (repeated == "columns") 0:(R - 1) else 0:(C - 1)
      within <- if (repeated == "columns") 0:(C - 1) else 0:(R - 1)
      for (b in between) for (j in 1:n) { u <- rnorm(1, 0, 3)
        for (w in within) {
          r <- if (repeated == "columns") b else w; c <- if (repeated == "columns") w else b
          out$y <- c(out$y, round(10 + u + r + 2 * c + 0.5 * r * c + rnorm(1), 2))
          out$row <- c(out$row, r); out$col <- c(out$col, c); out$subject <- c(out$subject, sid) }
        sid <- sid + 1 }
    }
    out
  }
  write_case("rm_effect_sizes", "twoway_columns_2x3", two(2, 3, 5, "columns"),
             params = list(repeated = "columns"))
  write_case("rm_effect_sizes", "twoway_rows_3x2", two(3, 2, 5, "rows"),
             params = list(repeated = "rows"))
  write_case("rm_effect_sizes", "twoway_both_2x3", two(2, 3, 6, "both"),
             params = list(repeated = "both"))
}

# ---- power: sample size and power ---------------------------------------------------------------
if (want("power")) {
  pw <- function(name, params, note = NULL) write_case("power", name, list(), params, note = note)
  pw("t_unpaired", list(design = "ttest", type = "two.sample", delta = 5, sd = 8, alpha = 0.05,
                        n = 20, target = 0.8, lo = 2))
  pw("t_unpaired_one_tailed", list(design = "ttest", type = "two.sample", delta = 1, sd = 1.5,
                                   alpha = 0.01, tails = 1, n = 12, target = 0.9, lo = 2))
  pw("t_paired", list(design = "ttest", type = "paired", delta = 2.5, sd = 4, alpha = 0.05,
                      n = 15, target = 0.9, lo = 2))
  pw("t_one_sample", list(design = "ttest", type = "one.sample", delta = 0.4, sd = 1,
                          alpha = 0.05, n = 30, target = 0.8, lo = 2))
  pw("anova_k4", list(design = "anova", groups = 4, betweenVar = 1, withinVar = 3, alpha = 0.05,
                      n = 5, target = 0.8, lo = 2))
  pw("anova_k3_large_effect", list(design = "anova", groups = 3, betweenVar = 25, withinVar = 20,
                                   alpha = 0.01, n = 8, target = 0.95, lo = 2))
  pw("prop", list(design = "prop", p1 = 0.5, p2 = 0.75, alpha = 0.05, n = 50, target = 0.9,
                  lo = 2))
  pw("prop_one_tailed", list(design = "prop", p1 = 0.1, p2 = 0.2, alpha = 0.05, tails = 1,
                             n = 150, target = 0.8, lo = 2))
  pw("cor", list(design = "cor", r = 0.3, alpha = 0.05, n = 50, target = 0.8, lo = 4))
  pw("logrank", list(design = "logrank", hr = 0.6, alpha = 0.05, n = 100, target = 0.8, lo = 1))
}

# ---- logistic: one predictor (simple logistic regression on XY tables) ------------------------
if (want("logistic")) {
  set.seed(20261803)
  hours <- round(runif(60, 0, 6), 2)
  pass <- rbinom(60, 1, plogis(-4 + 1.3 * hours))
  write_case("logistic", "simple_one_predictor",
             list(y = pass, X = lapply(hours, function(h) h), names = "Hours"),
             note = "Simple logistic regression (one X), as the XY analysis fits it.")
}
