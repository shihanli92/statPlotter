# Generates the Phase 6 oracle cases for multiple linear (multreg), logistic and Cox regression,
# with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_regression.R
#
# Input shape (all suites): X is an array of rows (n × p), names the p predictor names.
# params: intercept, confLevel, interactions ([[i, j], ...], 0-based predictor indices),
# ciMethod ('profile' | 'wald'), cutoff (logistic), ties ('efron' | 'breslow', Cox).

source("lib.R")

write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  unbox_scalar <- function(v) if (is.atomic(v) && length(v) == 1 && is.null(dim(v))) unbox(v) else v
  if (!is.null(params)) case$params <- lapply(params, unbox_scalar)
  if (!is.null(tol)) case$tol <- lapply(tol, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "string"),
             file.path(dir, paste0(name, ".json")))
}
pairs <- function(...) matrix(c(...), ncol = 2, byrow = TRUE)
r4 <- function(x) round(x, 4)

# ---- multiple linear regression ---------------------------------------------------------------
mr <- function(name, y, X, params = NULL, tol = NULL, note = NULL) {
  write_case("multreg", name, list(y = y, X = unname(X), names = colnames(X)), params, tol, note)
}
set.seed(20260601)
n <- 30
X <- cbind(Age = r4(runif(n, 20, 70)), Weight = r4(rnorm(n, 75, 12)), Dose = r4(runif(n, 0, 5)))
y <- r4(10 + 0.3 * X[, "Age"] + 0.2 * X[, "Weight"] - 1.5 * X[, "Dose"] + rnorm(n, 0, 3))
mr("three_predictors", y, X)
mr("three_predictors_99", y, X, params = list(confLevel = 0.99))
mr("no_intercept", y, X, params = list(intercept = FALSE),
   note = "R² stays centred (Prism); the F test is against Y = 0 (R's summary.lm).")
mr("interaction", y, X, params = list(interactions = pairs(0, 2)),
   note = "Age:Dose product appended after the main effects.")
mr("two_interactions", y, X, params = list(interactions = pairs(0, 1, 1, 2)))
Xc <- cbind(X, Total = X[, "Age"] + X[, "Weight"])
mr("collinear", y, Xc, note = "Total = Age + Weight exactly: aliased like lm (last column NA).")
Xn <- cbind(A = X[, "Age"], B = r4(X[, "Age"] + rnorm(n, 0, 0.5)), C = X[, "Dose"])
mr("near_collinear", r4(2 + 0.5 * Xn[, 1] + 0.5 * Xn[, 2] + rnorm(n)), Xn,
   note = "A and B nearly collinear: VIF in the hundreds.")
g <- rep(0:1, length.out = n)
Xd <- cbind(Male = g, Height = r4(rnorm(n, 170, 10) + 10 * g))
mr("dummy", r4(50 + 5 * g + 0.4 * Xd[, 2] + rnorm(n, 0, 4)), Xd)
Xo <- cbind(T = 1e6 + 0:(n - 1), U = r4(rnorm(n)))
mr("offset_1e6", r4(3 + 2e-3 * (Xo[, 1] - 1e6) + Xo[, 2] + rnorm(n, 0, 0.1)), Xo,
   note = "A predictor with a large offset.")
Xs <- cbind(P = c(1, 2, 3, 4, 5), Q = c(2, 1, 4, 3, 6))
mr("minimal", c(1.2, 1.9, 3.4, 3.8, 5.6), Xs, note = "n = 5, three coefficients, df = 2.")
mr("one_predictor", y, X[, "Age", drop = FALSE], note = "Same as simple linear regression.")

# ---- logistic regression ----------------------------------------------------------------------
lg <- function(name, y, X, params = NULL, tol = NULL, note = NULL) {
  write_case("logistic", name, list(y = as.integer(y), X = unname(X), names = colnames(X)),
             params, tol, note)
}
set.seed(20260602)
n <- 80
X <- cbind(Age = r4(runif(n, 20, 70)), BMI = r4(rnorm(n, 26, 4)), Smoker = rbinom(n, 1, 0.4))
eta <- -8 + 0.08 * X[, "Age"] + 0.15 * X[, "BMI"] + 0.9 * X[, "Smoker"]
y <- rbinom(n, 1, plogis(eta))
lg("three_predictors", y, X)
lg("three_predictors_wald_90", y, X, params = list(ciMethod = "wald", confLevel = 0.9))
lg("interaction", y, X, params = list(interactions = pairs(0, 2)))
lg("cutoff_03", y, X, params = list(cutoff = 0.3))
Xz <- cbind(Age = r4(X[, "Age"] - 45), Smoker = X[, "Smoker"])
lg("no_intercept", y, Xz, params = list(intercept = FALSE),
   note = "Null model p = 1/2 (glm's null deviance without an intercept).")
lg("collinear", y, cbind(X, Twice = 2 * X[, "Age"]), note = "Twice = 2·Age: aliased (NA).")
set.seed(20260603)
n <- 250
Xr <- cbind(Dose = r4(rnorm(n)), Sex = rbinom(n, 1, 0.5))
yr <- rbinom(n, 1, plogis(-4 + 0.9 * Xr[, 1] + 0.5 * Xr[, 2]))
lg("rare_events", yr, Xr, note = paste("About 5% events."))
Xb <- cbind(A = rep(c(0, 1, 0, 1), each = 10), B = rep(c(0, 0, 1, 1), each = 10))
yb <- c(rep(c(1, 0), c(2, 8)), rep(c(1, 0), c(5, 5)), rep(c(1, 0), c(4, 6)),
        rep(c(1, 0), c(8, 2)))
lg("binary_ties", yb, Xb,
   note = "Four distinct fitted probabilities: HL groups split tied rows by row order; AUC ties.")
xs <- c(-3.1, -2.2, -1.7, -1.1, -0.4, 0.3, 0.9, 1.5, 2.4, 3.3)
lg("separation", c(0, 0, 0, 0, 0, 1, 1, 1, 1, 1), cbind(X = xs),
   tol = list(rtol = 1e-8, atol = 1e-6),
   note = "Complete separation: status only (logLik -> 0, compared loosely).")
lg("small_n12", c(0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1),
   cbind(X = c(1.2, 2.3, 0.7, 1.9, 3.1, 2.8, 1.1, 2.2, 3.5, 2.6, 2.0, 1.5)),
   note = "n = 12: Hosmer-Lemeshow groups of 1 or 2.")

# ---- Cox regression ---------------------------------------------------------------------------
cx <- function(name, time, event, X, params = NULL, tol = NULL, note = NULL) {
  write_case("cox", name, list(time = time, event = as.integer(event), X = unname(X),
                               names = colnames(X)), params, tol, note)
}
set.seed(20260604)
n <- 60
X <- cbind(Age = r4(runif(n, 40, 80)), Treated = rbinom(n, 1, 0.5), Marker = r4(rnorm(n)))
lp <- 0.04 * (X[, "Age"] - 60) - 0.7 * X[, "Treated"] + 0.5 * X[, "Marker"]
tt <- rexp(n, 0.1 * exp(lp)); cc <- rexp(n, 0.03)
time <- r4(pmin(tt, cc)); event <- tt <= cc
cx("three_covariates", time, event, X)
cx("three_covariates_breslow", time, event, X, params = list(ties = "breslow"),
   note = "No tied times, so Breslow = Efron here.")
cx("wald_90", time, event, X, params = list(ciMethod = "wald", confLevel = 0.9))
cx("interaction", time, event, X, params = list(interactions = pairs(1, 2)))
ti <- ceiling(pmin(tt, cc) / 3)
cx("ties_efron", ti, event, X, note = "Times grouped into intervals of 3: many ties.")
cx("ties_breslow", ti, event, X, params = list(ties = "breslow"))
cx("one_covariate", ti, event, X[, "Treated", drop = FALSE])
cx("collinear", time, event, cbind(X, Twice = 2 * X[, "Marker"]),
   note = "Twice = 2·Marker: aliased (NA).")
cx("constant_covariate", time, event, cbind(X[, 1:2], One = rep(1, n)),
   note = "A constant covariate is aliased with the baseline hazard.")
set.seed(20260605)
n <- 200
Xr <- cbind(Dose = r4(rnorm(n)), Sex = rbinom(n, 1, 0.5))
tr <- rexp(n, 0.01 * exp(0.6 * Xr[, 1])); cr <- runif(n, 0, 10)
cx("rare_events", r4(pmin(tr, cr)), tr <= cr, Xr, note = "About 5% events.")
cx("no_events", c(1, 2, 2, 3, 4, 5, 5, 6), rep(0, 8), cbind(X = c(1, 0, 1, 0, 1, 1, 0, 0)),
   note = "No events: nothing to estimate.")
cx("infinite", c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), c(1, 1, 1, 0, 1, 1, 1, 0, 1, 1),
   cbind(G = c(1, 1, 1, 1, 0, 0, 0, 0, 0, 0), Z = c(0.3, -0.2, 0.5, 0.1, -0.4, 0.8, -0.1, 0.2,
                                                      0.6, -0.7)),
   tol = list(rtol = 1e-8, atol = 1e-5),
   note = paste("Monotone likelihood: every G = 1 subject fails before any G = 0 subject is",
                "at risk alone, so beta_G -> +Inf. Only the score test and nulls are exact."))
