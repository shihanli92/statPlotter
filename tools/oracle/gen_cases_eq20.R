# Cases for roadmap 20 (equations and simulation): suite "equations20". Rerun only when adding
# cases; outputs are committed.
#
#   cd tools/oracle && Rscript gen_cases_eq20.R

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

S <- "equations20"
fit_c <- function() list(kind = "fit")
const_c <- function(v) list(kind = "constant", value = v)
shared_c <- function() list(kind = "shared")
dsc_c <- function(v) list(kind = "dataSetConstant", values = v)

sim <- function(f, x, p, sd, reps = 1) {
  xs <- rep(x, each = reps)
  list(x = xs, y = f(xs, p) + rnorm(length(xs), 0, sd))
}

# ---- special functions ---------------------------------------------------------------------------

call_ <- function(fn, ..., tail = NULL) {
  out <- list(fn = jsonlite::unbox(fn), args = c(...))
  if (!is.null(tail)) out$tail <- jsonlite::unbox(tail)
  out
}
special_case <- function(name, calls, tol = NULL, note = NULL)
  write_case_p(S, name, list(calls = calls), list(task = "special"), tol = tol, note = note)

special_case("special_gamma", list(
  call_("gamma", 0.3), call_("gamma", 5.5), call_("gamma", 17.25), call_("gamma", -1.5),
  call_("gamma", -0.25), call_("gamma", 120.5), call_("gammaln", 0.001), call_("gammaln", 7.3),
  call_("gammaln", 1500), call_("beta", 2.5, 3.5), call_("beta", 0.2, 40), call_("psi", 0.1),
  call_("psi", 1.4616321449683622), call_("psi", 3.7), call_("psi", 250), call_("psi", -2.5),
  call_("fact", 0), call_("fact", 12), call_("fact", 25)),
  note = "psi at its root 1.46163… is absolute-accuracy only (tol atol)", tol = list(rtol = 1e-10, atol = 1e-15))
special_case("special_incomplete", list(
  call_("ibeta", 2, 3, 0.4), call_("ibeta", 0.5, 7, 0.01), call_("ibeta", 30, 40, 0.45),
  call_("igamma", 2.5, 1.2), call_("igamma", 0.3, 4), call_("igammac", 10, 25),
  call_("igammac", 0.7, 0.05), call_("erf", 0.001), call_("erf", 0.3), call_("erf", -1.7),
  call_("erfc", 0.2), call_("erfc", 3.5), call_("erfc", -2)))
special_case("special_bessel", list(
  call_("besselj", 0, 1), call_("besselj", 1, 10), call_("besselj", 5, 1), call_("besselj", 30, 10),
  call_("besselj", 2, 57.3), call_("besselj", -3, 4.1), call_("bessely", 0, 1), call_("bessely", 1, 0.1),
  call_("bessely", 3, 50.7), call_("bessely", 7, 2.2), call_("besseli", 0, 0.5), call_("besseli", 2, 3),
  call_("besseli", 10, 40), call_("besselk", 0, 0.5), call_("besselk", 3, 2), call_("besselk", 1, 30),
  call_("besselk", 6, 0.3)),
  note = "Arguments away from the zeros of J and Y, where only absolute accuracy is meaningful.")
special_case("special_hypergeometric", list(
  call_("hypgeometricm", 0.5, 1.5, -2), call_("hypgeometricm", 1.2, 3.1, 4.5),
  call_("hypgeometricm", 2, 5, -10), call_("hypgeometricu", 1, 1, 1), call_("hypgeometricu", 0.7, 2.4, 3.2),
  call_("hypgeometricu", 2.5, 0.5, 0.8), call_("hypgeometricf", 1, 1, 2, 0.5),
  call_("hypgeometricf", 0.4, 1.3, 2.9, -3), call_("hypgeometricf", 2, 0.5, 1.5, 0.8)),
  tol = list(rtol = 1e-9),
  note = "R has no hypergeometric functions: the reference comes from their integral representations by integrate() at rel.tol 1e-13.")
special_case("special_normal", list(
  call_("zdist", 1.96), call_("zdist", -3.2), call_("zdist", 1.96, tail = "two"),
  call_("zdist", 0.5, tail = "right"), call_("zinv", 0.975), call_("zinv", 1e-10),
  call_("zinv", 0.05, tail = "two"), call_("zinv", 0.01, tail = "right"), call_("zpdf", 0.7),
  call_("normdist", 12, 10, 2), call_("normdist", 12, 10, 2, tail = "right"),
  call_("norminv", 0.3, 10, 2), call_("normpdf", 9, 10, 2)))
special_case("special_t_f_chi", list(
  call_("tdist", 2.086, 20), call_("tdist", -1.3, 4.5), call_("tdist", 2.5, 7, tail = "two"),
  call_("tinv", 0.05, 20), call_("tinv", 0.001, 3), call_("tpdf", 1.1, 6), call_("fdist", 4, 5, 10),
  call_("fdist", 0.3, 2.5, 40), call_("finv", 0.05, 5, 10), call_("finv", 0.9, 1, 20),
  call_("fpdf", 1.7, 3, 12), call_("chidist", 3.841458820694124, 1), call_("chidist", 30, 12),
  call_("chiinv", 0.05, 5), call_("chiinv", 1e-6, 2.5), call_("chisqc", 0.4, 3)))
special_case("special_misc", list(
  call_("binomial", 3, 10, 0.5), call_("binomial", 7, 40, 0.1), call_("binomial", 0, 5, 0.3),
  call_("perc", 12.5), call_("logit", 0.75), call_("logit", 1e-4), call_("probit", 0.975),
  call_("probit", 0.2)))

# ---- user equations with special functions, implicit and differential equations ----------------

set.seed(20260929)

ucase <- function(name, text, formula, params, ours, f, x, p, sd, reps = 1, initial = p,
                  constraints = NULL, data = NULL, tol = NULL, note = NULL, ind = NULL) {
  d <- if (is.null(data)) list(sim(f, x, p, sd, reps)) else data
  pr <- list(equation = "user", params = params, ours = ours, text = text, formula = formula,
             start = lapply(d, function(.) p), initial = initial)
  if (!is.null(constraints)) pr$constraints <- constraints
  if (!is.null(ind)) pr$ind <- ind
  write_case_p(S, name, list(data = d), pr, tol = tol, note = note)
}

ucase("user_cumulative_gaussian_zdist", "Y = 100*zdist((X - Mean)/SD)",
      "100*pnorm((x - Mean)/SD)", c("Mean", "SD"), c("Mean", "SD"),
      function(x, p) 100 * pnorm((x - p[1]) / p[2]), seq(0, 20, 1), c(9, 3.5), 2, 2, initial = c(10, 2))
ucase("user_gamma_variate", "Y = A*X^(B - 1)*exp(-X/C)/(gamma(B)*C^B)",
      "A*x^(B - 1)*exp(-x/C)/(gamma(B)*C^B)", c("A", "B", "C"), c("A", "B", "C"),
      function(x, p) p[1] * x^(p[2] - 1) * exp(-x / p[3]) / (gamma(p[2]) * p[3]^p[2]),
      seq(0.5, 30, 0.5), c(500, 3.2, 2.5), 0.8, initial = c(400, 3, 2))
bind_f <- function(x, p) {  # free ligand F solves (1+NS)F^2 - bq F - x Kd = 0
  NS <- p[1]; Bmax <- p[2]; Kd <- p[3]
  bq <- x - (1 + NS) * Kd - Bmax
  fr <- (bq + sqrt(bq^2 + 4 * (1 + NS) * x * Kd)) / (2 * (1 + NS))
  x - fr
}
ucase("implicit_binding_depletion", "Free = X - Y\nY = NS*Free + Bmax*Free/(Kd + Free)",
      paste("x - ((x - (1 + NS)*Kd - Bmax) + sqrt((x - (1 + NS)*Kd - Bmax)^2 + 4*(1 + NS)*x*Kd))",
            "/(2*(1 + NS))"),
      c("NS", "Bmax", "Kd"), c("NS", "Bmax", "Kd"), bind_f, c(50, 100, 200, 400, 800, 1600, 3200, 6400),
      c(0.05, 800, 300), 10, 3, initial = c(0.1, 1000, 200),
      note = "Prism's implicit-equation example (bound on both sides, X and Y in the same units); R fits the explicit root of the quadratic.")
ucase("ode_decay_to_plateau", "Y' = -K*(Y - Plateau)", "(Y0 - Plateau)*exp(-K*x) + Plateau",
      c("Y0", "K", "Plateau"), c("Y[0]", "K", "Plateau"),
      function(x, p) (p[1] - p[3]) * exp(-p[2] * x) + p[3], seq(0, 30, 2), c(100, 0.2, 10), 1.5, 2,
      initial = c(90, 0.1, 5), tol = list(rtol = 1e-8),
      note = "Differential equation vs. its closed form: the ODE solution is good to ~1e-11 (rtol 1e-12), so the fit agrees to ~1e-9.")
ucase("ode_logistic", "Y' = K*Y*(1 - Y/YM)", "YM*Y0/(Y0 + (YM - Y0)*exp(-K*x))",
      c("Y0", "K", "YM"), c("Y[0]", "K", "YM"),
      function(x, p) p[3] * p[1] / (p[1] + (p[3] - p[1]) * exp(-p[2] * x)), seq(0, 20, 1),
      c(3, 0.5, 100), 2, 2, initial = c(5, 0.3, 90), tol = list(rtol = 1e-8))
ucase("ode_logistic_x0", "X[0] = 2\nY' = K*Y*(1 - Y/YM)",
      "YM*Y0/(Y0 + (YM - Y0)*exp(-K*(x - 2)))", c("Y0", "K", "YM"), c("Y[0]", "K", "YM"),
      function(x, p) p[3] * p[1] / (p[1] + (p[3] - p[1]) * exp(-p[2] * (x - 2))), seq(0, 20, 1),
      c(8, 0.4, 100), 2, 1, initial = c(5, 0.3, 90), tol = list(rtol = 1e-8),
      note = "X[0] = 2: data on both sides of the start (integrated backward and forward).")
mm_true <- function(t, p) vapply(t, function(ti) {
  if (ti == 0) return(p[1])
  uniroot(function(s) p[3] * log(p[1] / s) + p[1] - s - p[2] * ti, c(1e-300, p[1]),
          tol = 1e-15 * p[1], maxiter = 2000)$root
}, 1)
mm <- sim(mm_true, seq(0, 60, 4), c(100, 3, 20), 1)
write_case_p(S, "ode_mm_substrate_depletion", list(data = list(mm)),
             list(task = "mmdepletion", text = "Y' = -Vmax*Y/(Km + Y)", params = c("S0", "Vmax", "Km"),
                  ours = c("Y[0]", "Vmax", "Km"), start = list(c(100, 3, 20)), initial = c(90, 2, 10)),
             tol = list(rtol = 1e-8),
             note = "No closed form in elementary functions: R solves Km ln(S0/S) + S0 - S = Vmax t by uniroot, with gradients by implicit differentiation.")

# ---- lines for particular data sets --------------------------------------------------------------

tot <- sim(function(x, p) p[1] * x / (x + p[2]) + p[3] * x + p[4], c(0.5, 1, 2, 4, 8, 16, 32), c(1500, 4, 20, 30), 30, 2)
ns <- sim(function(x, p) p[3] * x + p[4], c(0.5, 1, 2, 4, 8, 16, 32), c(1500, 4, 20, 30), 30, 2)
ucase("perdataset_total_and_nonspecific",
      "specific=Bmax*X/(X+Kd)\nnonspecific=NS*X + Background\n<A>Y=specific+nonspecific\n<B>Y=nonspecific",
      "ind*(Bmax*x/(x + Kd)) + NS*x + Background", c("Bmax", "Kd", "NS", "Background"),
      c("Bmax", "Kd", "NS", "Background"), NULL, NULL, c(1500, 4, 20, 30), 0, data = list(tot, ns),
      initial = c(1000, 2, 10, 10), constraints = list(shared_c(), shared_c(), shared_c(), shared_c()),
      ind = "g == 1",
      note = "Prism's 'One site -- Fit total and nonspecific binding' as a user equation: data set A total, B nonspecific.")

# ---- built-in equations added in roadmap 20 ------------------------------------------------------
# One simulated case per equation (designs as DESIGNS20 in packages/stats/test/equationDesigns.ts).
# R fits from the true parameters; our fit starts from the automatic initial values. Equations with
# lines for particular data sets use two data sets with every parameter shared (a parameter
# only one data set uses is then that data set's own), so R's global model stays identifiable.

sys.source(file.path("r", "equations20.R"), envir = (EQENV <- new.env()))
EQ_ALL <- EQENV$EQ

eval_eq <- function(id, p, x, g = 1) {
  eq <- EQ_ALL[[id]]
  env <- as.list(setNames(p, eq$params)); env$x <- x; env$g <- g
  if (!is.null(eq$ind)) env$ind <- as.numeric(eval(parse(text = eq$ind)[[1]], env))
  eval(parse(text = eq$f)[[1]], env)
}

geo <- function(from, ratio, n) from * ratio^(0:(n - 1))
CONC <- geo(1e-10, sqrt(10), 15)

# kinds: per parameter "f" fit, "s" shared, "c" constant (at the truth), "d" data set constant
libcase <- function(id, x, truth, sd, reps = 1, kinds = NULL, tol = NULL, note = NULL) {
  K <- length(truth)
  P <- length(EQ_ALL[[id]]$params)
  if (is.null(kinds)) kinds <- strrep("f", P)
  kinds <- strsplit(kinds, "")[[1]]
  data <- lapply(seq_len(K), function(k) {
    xs <- rep(x, each = reps)
    list(x = xs, y = eval_eq(id, truth[[k]], xs, k) + rnorm(length(xs), 0, sd))
  })
  cons <- lapply(seq_len(P), function(j) switch(kinds[j],
    f = fit_c(), s = shared_c(), c = const_c(truth[[1]][j]),
    d = dsc_c(vapply(truth, function(p) p[j], 1))))
  write_case_p(S, paste0("lib_", gsub("-", "_", id)), list(data = data),
               list(equation = id, start = truth, constraints = cons), tol = tol, note = note)
}
one <- function(p) list(p)
NEAR0 <- "Values near zero (a Bottom or Basal of ~0.1 on a 0-100 scale, a CI end near 0) agree to 1e-9 absolute."

set.seed(20260930)
libcase("agonist-conc-response", CONC, one(c(5, 95, 3e-7)), 3, 3)
libcase("agonist-conc-response-variable-slope", CONC, one(c(5, 95, 3e-7, 1.4)), 3, 3)
libcase("agonist-conc-normalized-response", CONC, one(3e-7), 3, 2)
libcase("agonist-conc-normalized-response-variable-slope", CONC, one(c(3e-7, 0.8)), 3, 2)
libcase("inhibitor-conc-response", CONC, one(c(10, 100, 1e-7)), 3, 3)
libcase("inhibitor-conc-response-variable-slope", CONC, one(c(10, 100, 1e-7, -1.2)), 3, 3)
libcase("inhibitor-conc-normalized-response", CONC, one(1e-7), 3, 2)
libcase("inhibitor-conc-normalized-response-variable-slope", CONC, one(c(1e-7, -0.9)), 3, 2)
libcase("asymmetric-5pl-conc", geo(1e-10, sqrt(10), 17), one(c(5, 100, 1e-6, 1.2, 1.8)), 1, 3)
libcase("biphasic-dose-response-conc", geo(1e-11, 10^0.25, 33), one(c(0, 100, 0.4, 1e-9, 1.2, 3e-6, 1)), 1.5, 2)
libcase("bell-shaped-dose-response-conc", geo(1e-11, 10^0.25, 41), one(c(-85, 10, 5, 1e-8, 1e-4, 1.3, 1.1)), 1, 2,
        tol = list(rtol = 1e-7),
        note = "The middle plateau sits in a long shallow valley: fits agree to ~1e-8 in Dip.")
taus <- c(10, 3, 1, 0.3)
libcase("operational-depletion-conc", geo(1e-10, sqrt(10), 15), lapply(taus, function(t) c(100, 0, 1e-6, t, 1)), 2,
        kinds = "sssfs")
libcase("operational-depletion", seq(-10, -3, 0.5), lapply(taus, function(t) c(100, 0, -6, log10(t), 1)), 2,
        kinds = "sssfs")
libcase("operational-partial-agonist-conc", geo(1e-10, sqrt(10), 15),
        list(c(100, 0, 1, 1e-7, 1e-6, 0.5), c(100, 0, 1, 1e-7, 1e-6, 0.5)), 2, kinds = "ssssss")
libcase("operational-partial-agonist", seq(-10, -3, 0.5),
        list(c(100, 0, 1, -7, -6, log10(0.5)), c(100, 0, 1, -7, -6, log10(0.5))), 2, kinds = "ssssss",
        tol = list(rtol = 1e-10, atol = 1e-9), note = NEAR0)
Bs <- c(0, 1e-8, 1e-7, 1e-6)
libcase("gaddum-schild-conc", geo(1e-11, sqrt(10), 17), lapply(Bs, function(b) c(0, 100, 1e-8, 1, 8, 1, b)), 3,
        kinds = "ssssssd", tol = list(rtol = 1e-10, atol = 1e-9), note = NEAR0)
libcase("gaddum-schild-slope1-conc", geo(1e-11, sqrt(10), 17), lapply(Bs, function(b) c(0, 100, 1e-8, 1, 8, b)), 3,
        kinds = "sssssd")
libcase("gaddum-schild", seq(-11, -3, 0.5), lapply(Bs, function(b) c(0, 100, -8, 1, 8, 1, b)), 3, kinds = "ssssssd",
        tol = list(rtol = 1e-10, atol = 1e-9), note = NEAR0)
libcase("gaddum-schild-slope1", seq(-11, -3, 0.5), lapply(Bs, function(b) c(0, 100, -8, 1, 8, b)), 3,
        kinds = "sssssd")
libcase("ec50-shift-conc", geo(1e-11, sqrt(10), 15), list(c(0, 100, 1e-8, 5, 1), c(0, 100, 1e-8, 5, 1)), 3,
        kinds = "sssss")
libcase("ec50-shift", seq(-11, -4, 0.5), list(c(0, 100, -8, 5, 1), c(0, 100, -8, 5, 1)), 3, kinds = "sssss")
Ms <- c(0, 1e-7, 1e-6, 1e-5)
libcase("allosteric-ec50-shift-conc", geo(1e-11, sqrt(10), 15),
        lapply(Ms, function(b) c(0, 100, 1e-8, 1, 1e-6, 0.1, b)), 2, kinds = "ssssssd")
libcase("allosteric-ec50-shift", seq(-11, -4, 0.5), lapply(Ms, function(b) c(0, 100, -8, 1, -6, -1, b)), 2,
        kinds = "ssssssd")
libcase("agonist-conc-response-find-ecanything", CONC, one(c(5, 95, 4e-7, 1.2, 80)), 3, 3, kinds = "ffffc")
libcase("absolute-ic50-conc", CONC, one(c(100, 10, -1, 1e-7, 0)), 2, 2, kinds = "ffffc")
libcase("absolute-ic50", seq(-10, -3, 0.5), one(c(100, 10, -1, -7, 0)), 2, 2, kinds = "ffffc")
libcase("one-site-total-and-nonspecific", geo(0.5, 2, 8), list(c(1500, 4, 20, 30), c(1500, 4, 20, 30)), 30, 2,
        kinds = "ssss")
libcase("one-site-total-depletion", geo(1000, 1.6, 12), one(c(20000, 1, 0.02, 0.1, 100)), 200, 2, kinds = "fffcc")
libcase("two-sites-total-and-nonspecific", geo(0.02, 2, 16),
        list(c(400, 0.3, 800, 30, 5, 30), c(400, 0.3, 800, 30, 5, 30)), 8, 3, kinds = "ssssss")
libcase("one-site-allosteric-modulator", geo(0.1, 2, 10), lapply(Ms, function(a) c(1000, 2, -6, -1, a)), 15,
        kinds = "ssssd")
libcase("two-sites-fit-ki", seq(-11, -3, 0.25), one(c(2000, 100, 0.4, -9, -6, 1, 1, 1)), 25, 2, kinds = "fffffccc")
libcase("one-site-competitive-depletion", seq(-11, -4, 0.5), one(c(-8, 20000, 0.01, 50000, 1, 100, 0.1)), 100, 2,
        kinds = "fffcccc")
libcase("homologous-one-site", seq(-12, -5, 0.5), list(c(-9, 1000, 50, 1), c(-9, 1000, 50, 5)), 10, 2,
        kinds = "sssd")
libcase("allosteric-modulator-competitive", seq(-10, -3, 0.5), one(c(-6, -1, 1000, 1, 1)), 10, 2, kinds = "fffcc")
libcase("association-two-conc", seq(0, 60, 3), lapply(c(1, 3, 10), function(h) c(1e8, 0.05, 2000, h)), 20,
        kinds = "sssd")
libcase("association-then-dissociation", seq(0, 60, 2), one(c(0.05, 1e8, 2000, 0, 1, 10)), 20, 2, kinds = "fffccc",
        note = "Time0 falls between X values (the IF has a kink there).")
libcase("kinetics-competitive-binding", seq(0, 120, 4), lapply(c(10, 30, 100), function(i) c(2e7, 0.02, 2000, 1e8, 0.1, 1, i)),
        10, kinds = "ssscccd")
libcase("morrison-ki", geo(0.1, 2, 12), one(c(100, 0.5, 1, 1, 1)), 1.5, 2, kinds = "ffccc")
libcase("three-phase-decay", c(0, geo(0.05, 1.25, 36)), one(c(100, 5, 40, 2, 30, 0.02, 0.2)), 0.3, 2)
libcase("plateau-one-phase-association", seq(0, 40, 1), one(c(8.5, 10, 100, 0.2)), 2,
        note = "X0 falls between data X values, where SS is smooth in X0.")
libcase("horizontal-line", 0:10, one(5), 1)
libcase("line-through-origin", 1:10, one(2), 0.5)
libcase("hinge", seq(0, 20, 0.5), one(c(10, 1, 3, 10, 0.8)), 0.3)
libcase("semilog-x-log", geo(0.1, 2, 12), one(c(2, 3)), 0.3)
libcase("semilog-y-log", 0:20, one(c(0.1, 1)), 5)
libcase("log-log-line", geo(1, 1.5, 12), one(c(1.5, 0.5)), 1)
libcase("polynomial-1", seq(-5, 5, 0.5), one(c(1, -2)), 0.3)
libcase("polynomial-4", seq(-5, 5, 0.25), one(c(1, -2, 0.5, 0.1, -0.05)), 0.3)
libcase("polynomial-5", seq(-5, 5, 0.25), one(c(1, -2, 0.5, 0.1, -0.05, 0.01)), 0.3)
libcase("polynomial-6", seq(-5, 5, 0.25), one(c(1, -2, 0.5, 0.1, -0.05, 0.01, 0.002)), 0.3)
cx <- seq(10, 20, 0.25)
libcase("centered-polynomial-1", cx, one(c(3, 2, mean(cx))), 0.3, kinds = "ffd")
libcase("centered-polynomial-2", cx, one(c(3, 2, -0.5, mean(cx))), 0.3, kinds = "fffd")
libcase("centered-polynomial-3", cx, one(c(3, 2, -0.5, 0.1, mean(cx))), 0.3, kinds = "ffffd")
libcase("centered-polynomial-4", cx, one(c(3, 2, -0.5, 0.1, 0.02, mean(cx))), 0.3, kinds = "fffffd")
libcase("centered-polynomial-5", cx, one(c(3, 2, -0.5, 0.1, 0.02, -0.005, mean(cx))), 0.3, kinds = "ffffffd")
libcase("centered-polynomial-6", cx, one(c(3, 2, -0.5, 0.1, 0.02, -0.005, 0.001, mean(cx))), 0.3, kinds = "fffffffd")
libcase("gaussian-sum-two", seq(-2, 20, 0.25), one(c(50, 5, 1.5, 30, 12, 2)), 1)
libcase("lognormal", geo(0.5, 1.15, 30), one(c(200, 5, 1.8)), 0.5)
libcase("cumulative-gaussian-percent", 0:20, one(c(10, 3)), 2)
libcase("cumulative-gaussian-fraction", 0:20, one(c(10, 3)), 0.02)
libcase("cumulative-gaussian-counts", 0:20, one(c(10, 3, 100)), 2, kinds = "ffc")
libcase("lorentzian-sum-two", seq(-2, 20, 0.25), one(c(50, 5, 1, 30, 12, 1.5)), 1)
libcase("damped-sine-wave", seq(0, 60, 0.5), one(c(10, 8, 0.7, 0.05)), 0.5)
libcase("sinc-wave", seq(-12, 12, 0.25), one(c(10, 4)), 0.3)
libcase("log-exponential-growth", seq(0, 10, 0.5), one(c(2, 0.3)), 0.1)
libcase("linear-quadratic-fs", 0:10, one(c(0.2, 0.03)), 0.005, 2)
libcase("linear-quadratic-ps", 0:10, one(c(0.2, 0.03)), 0.5, 2)
libcase("linear-quadratic-fd", 0:10, one(c(0.2, 0.03)), 0.005, 2)
libcase("linear-quadratic-pd", 0:10, one(c(0.2, 0.03)), 0.5, 2)
libcase("linear-quadratic-ns", 0:10, one(c(1000, 0.2, 0.03)), 5, 2)
libcase("linear-quadratic-nd", 0:10, one(c(1000, 0.2, 0.03)), 5, 2)
libcase("classic-one-phase-decay", seq(0, 30, 2), one(c(90, 0.2, 10)), 2, 2)
libcase("classic-two-phase-decay", 0:40, one(c(60, 1, 40, 0.08, 5)), 0.8, 2)
libcase("classic-one-phase-association", 0:20, one(c(80, 0.3)), 2, 2)
libcase("classic-two-phase-association", 0:40, one(c(40, 1, 60, 0.08)), 0.8, 2)
libcase("classic-power-series", geo(0.5, 1.2, 20), one(c(2, 1.5, 0.5, -1)), 0.2, tol = list(rtol = 1e-10, atol = 1e-9), note = NEAR0)
libcase("classic-sine-wave", seq(0, 30, 0.25), one(c(50, 10, 0.8, 0.7)), 1)
