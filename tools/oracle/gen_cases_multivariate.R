# Generates the Phase 6 oracle cases for PCA, ROC curves and Bland-Altman agreement with fixed
# seeds, separately from the earlier generators so their cases are never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_multivariate.R

source("lib.R")

# Params may be nested (pca's select), so scalars are unboxed recursively.
unbox_all <- function(x) {
  if (is.list(x)) return(lapply(x, unbox_all))
  if (length(x) == 1) jsonlite::unbox(x) else x
}

write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (!is.null(params)) case$params <- unbox_all(params)
  if (!is.null(tol)) case$tol <- unbox_all(tol)
  if (!is.null(note)) case$note <- jsonlite::unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "string"),
             file.path(dir, paste0(name, ".json")))
}

# ---- pca -------------------------------------------------------------------------------------
# input$X is a list of rows (n x p).
pc <- function(name, X, params = NULL, note = NULL, tol = NULL) {
  X <- as.matrix(X)
  dimnames(X) <- NULL
  write_case("pca", name, list(X = X), params = params, note = note, tol = tol)
}
set.seed(20261401)
iris30 <- as.matrix(iris[sample(nrow(iris), 30), 1:4])
pc("iris30_standardized_kaiser", iris30, list(standardize = TRUE, select = list(method = "kaiser")))
pc("iris30_centered_variance80", iris30,
   list(standardize = FALSE, select = list(method = "variance", value = 80)))
pc("usarrests_standardized_parallel", USArrests,
   list(standardize = TRUE, select = list(method = "parallel", simulations = 1000, seed = 1)),
   note = "Parallel analysis, 1000 simulations, seed 1 (L'Ecuyer-CMRG, Inversion normals).")
pc("usarrests_centered_parallel_90", USArrests,
   list(standardize = FALSE,
        select = list(method = "parallel", simulations = 400, seed = 20260928, value = 90)),
   note = "Centered data: simulated columns keep the variables' SDs. 90th percentile.")
pc("mtcars7_fixed3", mtcars[, c("mpg", "disp", "hp", "drat", "wt", "qsec", "carb")],
   list(standardize = TRUE, select = list(method = "fixed", value = 3)))
pc("mtcars7_parallel_seed_negative", mtcars[, c("mpg", "disp", "hp", "drat", "wt", "qsec", "carb")],
   list(standardize = TRUE, select = list(method = "parallel", simulations = 300, seed = -12345)))
pc("n_less_than_p", matrix(round(rnorm(24, 10, 3), 2), 4, 6),
   list(standardize = TRUE, select = list(method = "all")),
   note = "n = 4 < p = 6: rank 3; eigenvalues 4-6 are 0 and their eigenvectors are arbitrary.")
x1 <- round(rnorm(15), 3)
pc("two_variables", cbind(x1, round(0.6 * x1 + rnorm(15, sd = 0.8), 3)),
   list(standardize = TRUE, select = list(method = "kaiser")),
   note = "p = 2 standardized: eigenvectors (1, 1)/sqrt 2 and (1, -1)/sqrt 2 (sign tie rule).")
pc("offset_1e9", 1e9 + matrix(round(rnorm(40), 4), 10, 4) %*% diag(c(1, 2, 0.5, 1)) +
     cbind(0, 0, 0, seq(0, 0.9, by = 0.1)),
   list(standardize = TRUE, select = list(method = "kaiser")),
   note = "Large offset, small spread.")
a <- round(rnorm(12, 5, 2), 2); b <- round(rnorm(12, 3, 1), 2)
pc("collinear", cbind(a, b, a + b, round(rnorm(12), 2)),
   list(standardize = FALSE, select = list(method = "kaiser", value = 0.5)),
   note = "Column 3 = column 1 + column 2: rank 3, smallest eigenvalue 0.")
pc("one_variable", matrix(c(3, 1, 4, 1, 5, 9, 2, 6), ncol = 1),
   list(standardize = TRUE, select = list(method = "kaiser")))

# ---- roc -------------------------------------------------------------------------------------
rc <- function(name, controls, patients, params = NULL, note = NULL) {
  write_case("roc", name, list(controls = controls, patients = patients), params = params,
             note = note)
}
set.seed(20261402)
rc("normal_20_15", round(rnorm(20, 50, 10), 1), round(rnorm(15, 62, 12), 1))
rc("hanley_mcneil_ratings", rep(1:5, c(33, 6, 6, 11, 2)), rep(1:5, c(3, 2, 2, 11, 33)),
   note = paste("Hanley & McNeil (1982) Table 1 CT ratings (58 normal, 51 abnormal); the paper",
                "reports area 0.893 and SE 0.032. Heavy ties."))
rc("patients_lower_auto", round(rnorm(18, 5, 1), 2), round(rnorm(12, 4, 1), 2),
   note = "Patients lower: direction 'auto' picks 'lower'.")
rc("forced_higher_below_half", round(rnorm(18, 5, 1), 2), round(rnorm(12, 4, 1), 2),
   params = list(direction = "higher"), note = "Area below 0.5 kept as is.")
rc("perfect_separation", c(1, 2, 3, 4, 5), c(6, 7, 8.5, 9))
rc("ties_between_groups", c(1, 2, 2, 3, 3, 3, 4, 5), c(2, 3, 3, 4, 4, 5, 6, 6, 7))
rc("one_each", 3, 4)
rc("identical_groups", c(2, 2, 2), c(2, 2), note = "One distinct value: area 0.5, P 1, no rows.")
rc("conf90", round(rnorm(25, 10, 2), 1), round(rnorm(20, 11.5, 2), 1),
   params = list(confLevel = 0.9))
rc("wilson_brown", round(rnorm(25, 10, 2), 1), round(rnorm(20, 11.5, 2), 1),
   params = list(ciMethod = "wilsonBrown"))
rc("larger_60_45", round(rexp(60, 1 / 20), 1), round(rexp(45, 1 / 35), 1))

# ---- blandaltman -----------------------------------------------------------------------------
ba <- function(name, a, b, params = NULL, note = NULL) {
  write_case("blandaltman", name, list(a = a, b = b), params = params, note = note)
}
set.seed(20261403)
truth <- runif(20, 20, 120)
A <- round(truth + rnorm(20, 1, 4), 1)
B <- round(truth * 1.03 + rnorm(20, 0, 4), 1)
ba("difference", A, B)
ba("difference_b_minus_a", A, B, list(order = "bMinusA"))
ba("ratio", A, B, list(measure = "ratio"))
ba("ratio_b_over_a", A, B, list(measure = "ratio", order = "bMinusA"))
ba("percent", A, B, list(measure = "percent"))
ba("percent_b_minus_a", A, B, list(measure = "percent", order = "bMinusA"))
ba("difference_conf90", A, B, list(confLevel = 0.9),
   note = "Limits bias +- qnorm(0.95) SD when the level is not 0.95.")
ba("n2", c(10, 12), c(11, 15))
ba("offset_1e9", 1e9 + c(0.1, 0.25, 0.3, 0.52, 0.61), 1e9 + c(0.12, 0.2, 0.33, 0.5, 0.6))
