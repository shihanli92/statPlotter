# Cases for Phase 14 (curve fitting for lab assays): suite "curvefit". Rerun only when adding
# cases; outputs are committed.
#
#   cd tools/oracle && Rscript gen_cases_phase14.R

source("lib.R")

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
write_case_p <- function(suite, name, input, params, tol = NULL, note = NULL) {
  pj <- structure(toJSON(params, auto_unbox = TRUE, null = "null", na = "string", digits = I(17)),
                  class = "json")
  write_case(suite, name, input, params = pj, tol = tol, note = note)
}

S <- "curvefit"
fit_c <- function() list(kind = "fit")
const_c <- function(v) list(kind = "constant", value = v)
shared_c <- function() list(kind = "shared")

sim <- function(f, x, p, sd, reps = 1) {
  xs <- rep(x, each = reps)
  list(x = xs, y = f(xs, p) + rnorm(length(xs), 0, sd))
}
r4 <- function(x, p) p[1] + (p[2] - p[1]) / (1 + 10^((p[3] - x) * p[4]))

set.seed(20261101)
dose <- seq(-10, -3, 0.5)

# ---- new built-in equations --------------------------------------------------------------------
eqcase <- function(name, eq, f, x, p, sd, reps = 1, constraints = NULL, bandX = NULL, note = NULL,
                   tol = NULL) {
  d <- sim(f, x, p, sd, reps)
  input <- list(data = list(d))
  if (!is.null(bandX)) input$bandX <- bandX
  params <- list(equation = eq, start = list(p))
  if (!is.null(constraints)) params$constraints <- constraints
  write_case_p(S, name, input, params, tol = tol, note = note)
}

eqcase("eq_ecanything_f80", "agonist-response-find-ecanything",
       function(x, p) { l50 <- p[3] - log10(p[5] / (100 - p[5])) / p[4]; r4(x, c(p[1:2], l50, p[4])) },
       dose, c(5, 95, -6, 1.2, 80), 3, 2,
       constraints = list(fit_c(), fit_c(), fit_c(), fit_c(), const_c(80)), bandX = c(-9, -6, -4))
eqcase("eq_biphasic", "biphasic-dose-response",
       function(x, p) p[1] + (p[2] - p[1]) * p[3] / (1 + 10^((p[4] - x) * p[5])) +
         (p[2] - p[1]) * (1 - p[3]) / (1 + 10^((p[6] - x) * p[7])),
       seq(-11, -3, 0.25), c(0, 100, 0.4, -9, 1.2, -5.5, 1), 1.5, 2)
eqcase("eq_bell", "bell-shaped-dose-response",
       function(x, p) p[1] + (p[2] - p[1]) / (1 + 10^((p[4] - x) * p[6])) +
         (p[3] - p[1]) / (1 + 10^((x - p[5]) * p[7])),
       seq(-11, -1, 0.25), c(-85, 10, 5, -8, -4, 1.3, 1.1), 1, 2,
       note = "Bell shape with a clear middle plateau (Plateau1 + Plateau2 - Dip = 100).")
conc <- 0.25 * 1.6^(0:13)
eqcase("eq_hill_binding", "one-site-specific-hill", function(x, p) p[1] * x^p[3] / (p[2]^p[3] + x^p[3]),
       conc, c(1000, 5, 1.6), 15, 2, bandX = c(1, 5, 50))
eqcase("eq_two_sites", "two-sites-specific",
       function(x, p) p[1] * x / (p[2] + x) + p[3] * x / (p[4] + x),
       0.02 * 2^(0:15), c(400, 0.3, 800, 30), 8, 3)
eqcase("eq_fit_ki", "one-site-fit-logki",
       function(x, p) (p[1] - p[2]) / (1 + 10^(x - log10(10^p[3] * (1 + p[4] / p[5])))) + p[2],
       dose, c(2000, 100, -8, 2, 0.5), 40, 3,
       constraints = list(fit_c(), fit_c(), fit_c(), const_c(2), const_c(0.5)))
eqcase("eq_two_sites_ic50", "two-sites-fit-logic50",
       function(x, p) p[2] + (p[1] - p[2]) * p[3] / (1 + 10^(x - p[4])) +
         (p[1] - p[2]) * (1 - p[3]) / (1 + 10^(x - p[5])),
       seq(-11, -3, 0.25), c(2000, 100, 0.4, -9, -6), 25, 2)
tm <- seq(0, 60, 3)
eqcase("eq_dissociation", "dissociation-one-phase", function(x, p) (p[1] - p[2]) * exp(-p[3] * x) + p[2],
       tm, c(1000, 100, 0.08), 20, 2)
eqcase("eq_association", "association-one-conc",
       function(x, p) (p[2] * 1e-9 / (p[2] * 1e-9 + p[3] / p[1])) * p[4] *
         (1 - exp(-(p[1] * p[2] * 1e-9 + p[3]) * x)),
       tm, c(1e8, 2, 0.05, 2000), 20, 2,
       constraints = list(fit_c(), const_c(2), const_c(0.05), fit_c()))
eqcase("eq_allosteric", "allosteric-sigmoidal", function(x, p) p[1] * x^p[2] / (p[3]^p[2] + x^p[2]),
       0.5 * 1.5^(0:13), c(100, 2.2, 8), 2, 2)
eqcase("eq_kcat", "kcat", function(x, p) p[1] * p[2] * x / (p[3] + x), 0.5 * 2^(0:7),
       c(0.02, 2500, 4), 1, 2, constraints = list(const_c(0.02), fit_c(), fit_c()))
t40 <- seq(0, 40, 1)
eqcase("eq_plateau_decay", "plateau-one-phase-decay",
       function(x, p) ifelse(x < p[1], p[2], p[3] + (p[2] - p[3]) * exp(-p[4] * (x - p[1]))),
       t40, c(8.5, 100, 10, 0.2), 2,
       note = "X0 falls between data X values, where SS is smooth in X0 (the IF has a kink at each X).")
eqcase("eq_two_phase_association", "two-phase-association",
       function(x, p) p[1] + (p[2] - p[1]) * p[3] * 0.01 * (1 - exp(-p[4] * x)) +
         (p[2] - p[1]) * (100 - p[3]) * 0.01 * (1 - exp(-p[5] * x)),
       t40, c(5, 100, 60, 1, 0.08), 0.8, 2)
eqcase("eq_exponential_plateau", "exponential-plateau", function(x, p) p[2] - (p[2] - p[1]) * exp(-p[3] * x),
       seq(0, 20, 1), c(5, 80, 0.25), 1.5, 2)
eqcase("eq_beta_growth", "beta-growth-decline",
       function(x, p) p[1] * (1 + (p[2] - x) / (p[2] - p[3])) * (x / p[2])^(p[2] / (p[2] - p[3])),
       seq(1, 40, 1.5), c(50, 20, 10), 1, 2)
eqcase("eq_segmental", "segmental-linear",
       function(x, p) ifelse(x < p[3], p[1] + p[2] * x, p[2] * p[3] + p[1] + p[4] * (x - p[3])),
       seq(0, 20, 1), c(2, 3, 8.5, 0.5), 0.6, 2)
eqcase("eq_sine", "sine-wave", function(x, p) p[1] * sin(2 * pi * x / p[2] + p[3]),
       seq(0, 30, 0.5), c(10, 8, 0.7), 1)
eqcase("eq_sine_baseline", "sine-wave-baseline", function(x, p) p[1] * sin(2 * pi * x / p[2] + p[3]) + p[4],
       seq(0, 30, 0.5), c(10, 8, 0.7, 50), 1)
eqcase("eq_lorentzian", "lorentzian", function(x, p) p[1] / (1 + ((x - p[2]) / p[3])^2),
       seq(-10, 20, 0.5), c(50, 5, 2), 1)

# Enzyme inhibition: a global fit of four inhibitor concentrations (data set constants).
inh <- c(0, 2, 5, 10)
sub <- 0.5 * 2^(0:8)
inhcase <- function(name, eq, f, p, sd) {
  data <- lapply(inh, function(i) sim(function(x, q) f(x, q, i), sub, p, sd))
  cons <- c(lapply(seq_along(p), function(j) shared_c()), list(list(kind = "dataSetConstant", values = inh)))
  write_case_p(S, name, list(data = data),
               list(equation = eq, start = lapply(inh, function(i) c(p, i)), constraints = cons))
}
inhcase("eq_competitive", "competitive-inhibition", function(x, p, i) p[1] * x / (p[2] * (1 + i / p[3]) + x),
        c(100, 4, 2), 2)
inhcase("eq_noncompetitive", "noncompetitive-inhibition", function(x, p, i) p[1] / (1 + i / p[3]) * x / (p[2] + x),
        c(100, 4, 3), 2)
inhcase("eq_uncompetitive", "uncompetitive-inhibition",
        function(x, p, i) (p[1] / (1 + i / p[3])) * x / (p[2] / (1 + i / p[3]) + x), c(100, 4, 3), 1.5)
inhcase("eq_mixed", "mixed-inhibition",
        function(x, p, i) (p[1] / (1 + i / (p[4] * p[3]))) * x / (p[2] * (1 + i / p[3]) / (1 + i / (p[4] * p[3])) + x),
        c(100, 4, 2, 3), 1)

# ---- user-defined equations ------------------------------------------------------------------
ud <- sim(function(x, p) p[1] + (p[2] - p[1]) / (1 + 10^((p[3] - x) * p[4])), dose, c(3, 97, -6.2, 1.3), 3, 3)
write_case_p(S, "user_4pl_multiline", list(data = list(ud), bandX = c(-9, -6, -3)),
             list(equation = "user", params = c("Bottom", "Top", "LogEC50", "HillSlope"),
                  text = "; four-parameter logistic\nSpan = Top - Bottom\nY = Bottom + Span/(1 + 10^((LogEC50 - X)*HillSlope))",
                  formula = "Bottom + (Top - Bottom)/(1 + 10^((LogEC50 - x)*HillSlope))",
                  start = list(c(3, 97, -6.2, 1.3)), initial = c(0, 100, -6, 1)))
ug <- sim(function(x, p) p[1] * exp(-((x - p[2]) / p[3])^2) + p[4] * x, seq(0, 20, 0.5), c(40, 8, 3, 0.5), 1)
write_case_p(S, "user_gaussian_plus_line", list(data = list(ug)),
             list(equation = "user", params = c("A", "Center", "W", "Slope"),
                  text = "Y = A*exp(-sqr((X - Center)/W)) + Slope*X",
                  formula = "A*exp(-((x - Center)/W)^2) + Slope*x",
                  start = list(c(40, 8, 3, 0.5)), initial = c(30, 7, 2, 0)))

# ---- interpolation -------------------------------------------------------------------------------
std <- sim(r4, dose, c(2, 98, -6.5, 1.1), 2.5, 2)
write_case_p(S, "interp_4pl", list(data = list(std),
             interpolate = list(y = c(10, 50, 50.5, 95, 99.5, 120, -5, 1), x = c(-7, -6.25, -11, -12, -14, -1))),
             list(equation = "agonist-response-variable-slope", start = list(c(2, 98, -6.5, 1.1))),
             note = paste("Y inside the curve, near the plateaus, beyond Top / Bottom (blank);",
                          "X inside, extrapolated and beyond the extended range (blank)."))
bl <- sim(function(x, p) p[1] + (p[2] - p[1]) / (1 + 10^((p[4] - x) * p[6])) +
            (p[3] - p[1]) / (1 + 10^((x - p[5]) * p[7])),
          seq(-10, -2, 0.5), c(-80, 10, 5, -8, -4, 1.3, 1.1), 1, 2)
write_case_p(S, "interp_bell_nonmonotonic", list(data = list(bl), interpolate = list(y = c(20, 60, 95), x = c(-6))),
             list(equation = "bell-shaped-dose-response", start = list(c(-80, 10, 5, -8, -4, 1.3, 1.1))),
             note = "A bell-shaped curve reaches each Y twice: the lower X is reported.")
mm <- sim(function(x, p) p[1] * x / (p[2] + x), c(0.5, 1, 2, 4, 8, 16), c(50, 4), 1, 2)
write_case_p(S, "interp_mm_extrapolate", list(data = list(mm), interpolate = list(y = c(20, 42, 44, 48), x = c(3, 20))),
             list(equation = "michaelis-menten", start = list(c(50, 4)), confLevel = 0.9),
             note = "Ys above the highest standard, extrapolated up to half the X range beyond it.")
lin <- sim(function(x, p) p[1] + p[2] * x, c(0, 5, 10, 20, 40, 80), c(0.05, 0.02), 0.03, 3)
write_case_p(S, "linear_interp", list(data = list(lin), interpolate = list(y = c(0.1, 0.5, 1.2, 2.5, 3), x = c(15, 100, 125))),
             list(task = "linear"))

# ---- diagnostics ---------------------------------------------------------------------------------
write_case_p(S, "diag_4pl_replicates", list(data = list(std)),
             list(equation = "agonist-response-variable-slope", start = list(c(2, 98, -6.5, 1.1)), diagnostics = TRUE))
dd <- sim(function(x, p) (p[1] - p[2]) * exp(-p[3] * x) + p[2], seq(0, 30, 1.5), c(100, 10, 0.2), 2)
write_case_p(S, "diag_decay_single", list(data = list(dd)),
             list(equation = "one-phase-decay", start = list(c(100, 10, 0.2)), diagnostics = TRUE))
dm <- sim(function(x, p) p[1] * x / (p[2] + x), c(0.5, 1, 2, 4, 8, 16, 32, 64), c(50, 4), 3)
write_case_p(S, "diag_mm_skewed", list(data = list(dm)),
             list(equation = "michaelis-menten", start = list(c(50, 4)), diagnostics = TRUE),
             note = "Few, noisy points: Km's estimate is noticeably skewed.")

# ---- ROUT --------------------------------------------------------------------------------------
ro <- sim(r4, dose, c(0, 100, -6.5, 1), 3, 2)
ro$y[c(7, 20)] <- ro$y[c(7, 20)] + c(40, -35)
write_case_p(S, "rout_4pl_two_outliers", list(data = list(ro)),
             list(task = "rout", equation = "agonist-response-variable-slope", start = list(c(0, 100, -6.5, 1)),
                  q = 0.01, finalWeighting = "none"),
             tol = list(rtol = 1e-8),
             note = paste("The robust fit is a fixed point of iterative reweighting, which both sides",
                          "stop at a relative change of ~1e-11 (R: 1e-14); the final least-squares fit",
                          "matches as tightly as other fits."))
rn <- sim(function(x, p) (p[1] - p[2]) * exp(-p[3] * x) + p[2], seq(0, 30, 1), c(100, 10, 0.2), 2)
write_case_p(S, "rout_decay_none", list(data = list(rn)),
             list(task = "rout", equation = "one-phase-decay", start = list(c(100, 10, 0.2)), q = 0.01,
                  finalWeighting = "none"),
             tol = list(rtol = 1e-8), note = "Gaussian scatter: no outliers.")
rm1 <- sim(function(x, p) p[1] * x / (p[2] + x), 0.5 * 2^(0:9), c(50, 4), 1, 3)
rm1$y[c(10, 25)] <- rm1$y[c(10, 25)] * c(1.5, 0.6)
write_case_p(S, "rout_mm_q5", list(data = list(rm1)),
             list(task = "rout", equation = "michaelis-menten", start = list(c(50, 4)), q = 0.05,
                  finalWeighting = "none"),
             tol = list(rtol = 1e-8))
