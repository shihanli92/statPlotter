# Roadmap 51e (curve fitting): oracle cases for the defaults and comparisons it adds — profile-
# likelihood CIs of an IC50 and of a global fit, the F test between models one of which is a
# special case of the other (inhibitor 4PL against 3PL, two-phase against one-phase decay), and
# AICc between models that aren't nested (Gaussian against Lorentzian). Fixed seed; outputs are
# committed.
#
#   cd tools/oracle && Rscript gen_cases_51e.R && Rscript run.R nonlinear

source("lib.R")

write_case <- function(suite, name, input, params, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  pj <- structure(toJSON(params, auto_unbox = TRUE, null = "null", na = "string", digits = I(17)),
                  class = "json")
  case <- list(input = input, params = pj)
  if (!is.null(note)) case$note <- jsonlite::unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, json_verbatim = TRUE),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261013)
logistic4 <- function(x, b, t, l, h) b + (t - b) / (1 + 10^((l - x) * h))
dose <- rep(seq(-9, -4, 0.5), each = 3)

# An IC50 from log(dose), 4PL, profile-likelihood CIs (the new default).
yi <- logistic4(dose, 8, 100, -7.2, -1.1) + rnorm(length(dose), 0, 4)
write_case("nonlinear", "inhibitor_4pl_profile",
           list(data = list(list(x = dose, y = yi))),
           list(equation = "inhibitor-response-variable-slope", start = list(c(8, 100, -7.2, -1.1)),
                profileCI = TRUE),
           note = "Roadmap 51e: profile-likelihood CIs, the default for new fits.")
# The standard slope (HillSlope = -1) is a special case of the variable slope: F test and AICc.
write_case("nonlinear", "inhibitor_4pl_vs_3param",
           list(data = list(list(x = dose, y = yi))),
           list(equation = "inhibitor-response-variable-slope", start = list(c(8, 100, -7.2, -1.1)),
                compare = list(equation = "inhibitor-response")),
           note = "Roadmap 51e: nested (HillSlope = -1); extra-sum-of-squares F test (anova) and AICc.")

# One-phase decay is two-phase decay with one phase: F test and AICc.
tx <- rep(seq(0, 40, 1), each = 2)
yd <- 5 + 95 * (0.6 * exp(-1 * tx) + 0.4 * exp(-0.08 * tx)) + rnorm(length(tx), 0, 1.2)
write_case("nonlinear", "decay_two_vs_one_phase",
           list(data = list(list(x = tx, y = yd))),
           list(equation = "two-phase-decay", start = list(c(100, 5, 1, 0.08, 60)),
                compare = list(equation = "one-phase-decay", start = list(c(100, 5, 0.2)))),
           note = "Roadmap 51e: one-phase decay nested in two-phase decay; F test (anova) and AICc.")

# A Gaussian against a Lorentzian peak: not nested (same number of parameters): AICc only.
gx <- seq(-5, 15, 0.5)
yg <- 50 * exp(-0.5 * ((gx - 5) / 2)^2) + rnorm(length(gx), 0, 1.5)
write_case("nonlinear", "gaussian_vs_lorentzian_aicc",
           list(data = list(list(x = gx, y = yg))),
           list(equation = "gaussian", start = list(c(50, 5, 2)),
                compare = list(equation = "lorentzian", start = list(c(50, 5, 2)), nested = FALSE)),
           note = "Roadmap 51e: models that aren't nested are compared by AICc only.")

# A global fit (HillSlope shared by two data sets) with profile-likelihood CIs: each data set's
# own parameters profiled with every other parameter refitted.
ya <- logistic4(dose, 5, 100, -7, 1.3) + rnorm(length(dose), 0, 4)
yb <- logistic4(dose, 8, 90, -6, 1.3) + rnorm(length(dose), 0, 4)
write_case("nonlinear", "global_shared_hill_profile",
           list(data = list(list(x = dose, y = ya), list(x = dose, y = yb))),
           list(equation = "agonist-response-variable-slope",
                start = list(c(5, 100, -7, 1.3), c(8, 90, -6, 1.3)),
                constraints = list(list(kind = "fit"), list(kind = "fit"), list(kind = "fit"),
                                   list(kind = "shared")),
                profileCI = TRUE),
           note = "Roadmap 51e: profile CIs of a global fit, per data set and of the shared Hill slope.")
