# Roadmap 20: equations and simulation. Suite "equations20".
#
# task "special": the special and distribution functions of the user-equation language
#   (input$calls = [{fn, args}]), from R's own functions: gamma, lgamma, beta, pbeta, pgamma,
#   digamma, besselJ/Y/I/K, pnorm/qnorm/dnorm, pt/qt/dt, pf/qf/df, pchisq/qchisq, pbinom,
#   factorial; erf from integrate() of exp(-t^2) (R has no erf; 2*pnorm(x*sqrt(2)) - 1 loses
#   relative accuracy near 0), and the hypergeometric functions from their Euler / Laplace
#   integrals by integrate() at rel.tol 1e-13 (so those cases carry tol 1e-9).
# task "fit" (default): nls as in nonlinear.R / curvefit.R — a built-in equation id of EQ (with
#   the equations added in roadmap 20 in EQ20 below) or "user" with an R `formula`. Differential
#   and implicit user equations are checked against the nls fit of their closed-form solution
#   (the case's `formula`); per-data-set lines (`<A>`, `<~A>`) are fit globally with an
#   indicator `ind` of the data set (see nonlinear.R's piecewise models).
# task "mmdepletion": Michaelis-Menten substrate depletion S' = -Vmax*S/(Km + S), S(0) = S0,
#   whose solution solves Km*ln(S0/S) + S0 - S = Vmax*t (a Lambert-W form): S by uniroot to
#   1e-15, the exact gradient by implicit differentiation, nls with that gradient.

PACKAGES <- character(0)

sys.source(file.path("r", "curvefit.R"), envir = environment())

# ---- equations added in roadmap 20 (same parameterisation as packages/stats equationsMore.ts) ----
# Formulas in R syntax (log10 for log, pnorm for zdist). Lines for particular data sets
# use the indicator `ind` of data set A (g == 1); IF(...) models use `ind` of their condition.

# (B/10^-pA2)^SchildSlope written with ind = (B > 0) so that B = 0 (the control) has a finite
# derivative in SchildSlope (R's deriv() gives 0*log(0) = NaN).
gad <- function(slope) if (slope) "(1 + ind*((B + (1 - ind))*10^pA2)^SchildSlope)" else "(1 + B/(10^(-pA2)))"
poly_f <- function(d, centered) {
  xv <- if (centered) "(x - XMean)" else "x"
  paste(c("B0", sprintf("B%d*%s^%d", seq_len(d), xv, seq_len(d))), collapse = " + ")
}
poly_p <- function(d, centered) c(paste0("B", 0:d), if (centered) "XMean")

EQ20 <- list(
  "agonist-conc-response" = list(params = c("Bottom", "Top", "EC50"),
    f = "Bottom + x*(Top - Bottom)/(EC50 + x)"),
  "agonist-conc-response-variable-slope" = list(params = c("Bottom", "Top", "EC50", "HillSlope"),
    f = "Bottom + (x^HillSlope)*(Top - Bottom)/(x^HillSlope + EC50^HillSlope)"),
  "agonist-conc-normalized-response" = list(params = "EC50", f = "100*x/(EC50 + x)"),
  "agonist-conc-normalized-response-variable-slope" = list(params = c("EC50", "HillSlope"),
    f = "100*(x^HillSlope)/(EC50^HillSlope + x^HillSlope)"),
  "inhibitor-conc-response" = list(params = c("Bottom", "Top", "IC50"),
    f = "Bottom + (Top - Bottom)/(1 + x/IC50)"),
  "inhibitor-conc-response-variable-slope" = list(params = c("Bottom", "Top", "IC50", "HillSlope"),
    f = "Bottom + (Top - Bottom)/(1 + (IC50/x)^HillSlope)"),
  "inhibitor-conc-normalized-response" = list(params = "IC50", f = "100/(1 + x/IC50)"),
  "inhibitor-conc-normalized-response-variable-slope" = list(params = c("IC50", "HillSlope"),
    f = "100/(1 + (IC50/x)^HillSlope)"),
  "asymmetric-5pl-conc" = list(params = c("Bottom", "Top", "EC50", "HillSlope", "S"),
    f = "Bottom + (Top - Bottom)/(1 + (2^(1/S) - 1)*((EC50/x)^HillSlope))^S"),
  "biphasic-dose-response-conc" = list(
    params = c("Bottom", "Top", "Frac", "EC50_1", "nH1", "EC50_2", "nH2"),
    f = paste("Bottom + (Top - Bottom)*Frac/(1 + (EC50_1/x)^nH1) +",
              "(Top - Bottom)*(1 - Frac)/(1 + (EC50_2/x)^nH2)")),
  "bell-shaped-dose-response-conc" = list(
    params = c("Dip", "Plateau1", "Plateau2", "EC50_1", "EC50_2", "nH1", "nH2"),
    f = "Dip + (Plateau1 - Dip)/(1 + (EC50_1/x)^nH1) + (Plateau2 - Dip)/(1 + (x/EC50_2)^nH2)"),
  "operational-depletion-conc" = list(params = c("Effectmax", "Basal", "KA", "tau", "n"),
    f = "Basal + (Effectmax - Basal)/(1 + ((KA + x)/(tau*x))^n)"),
  "operational-depletion" = list(params = c("Effectmax", "Basal", "logKA", "logtau", "n"),
    f = "Basal + (Effectmax - Basal)/(1 + ((10^logKA + 10^x)/(10^(logtau + x)))^n)"),
  "operational-partial-agonist-conc" = list(
    params = c("Effectmax", "Basal", "n", "EC50", "KA", "tau"), ind = "g == 1",
    f = paste("ind*(Basal + (Effectmax - Basal)/(1 + (EC50/x)^n)) +",
              "(1 - ind)*(Basal + (Effectmax - Basal)/(1 + ((KA + x)/(tau*x))^n))")),
  "operational-partial-agonist" = list(
    params = c("Effectmax", "Basal", "n", "LogEC50", "logKA", "logtau"), ind = "g == 1",
    f = paste("ind*(Basal + (Effectmax - Basal)/(1 + 10^((LogEC50 - x)*n))) +",
              "(1 - ind)*(Basal + (Effectmax - Basal)/(1 + ((10^logKA + 10^x)/(10^(logtau + x)))^n))")),
  "gaddum-schild-conc" = list( ind = "B > 0",
    params = c("Bottom", "Top", "EC50", "HillSlope", "pA2", "SchildSlope", "B"),
    f = sprintf("Bottom + (Top - Bottom)/(1 + (EC50*%s/x)^HillSlope)", gad(TRUE))),
  "gaddum-schild-slope1-conc" = list(params = c("Bottom", "Top", "EC50", "HillSlope", "pA2", "B"),
    f = sprintf("Bottom + (Top - Bottom)/(1 + (EC50*%s/x)^HillSlope)", gad(FALSE))),
  "gaddum-schild" = list( ind = "B > 0",
    params = c("Bottom", "Top", "LogEC50", "HillSlope", "pA2", "SchildSlope", "B"),
    f = sprintf("Bottom + (Top - Bottom)/(1 + 10^((log10(10^LogEC50*%s) - x)*HillSlope))", gad(TRUE))),
  "gaddum-schild-slope1" = list(params = c("Bottom", "Top", "LogEC50", "HillSlope", "pA2", "B"),
    f = sprintf("Bottom + (Top - Bottom)/(1 + 10^((log10(10^LogEC50*%s) - x)*HillSlope))", gad(FALSE))),
  "ec50-shift-conc" = list(params = c("Bottom", "Top", "EC50Control", "EC50Ratio", "HillSlope"),
    ind = "g == 1",
    f = paste("ind*(Bottom + (Top - Bottom)/(1 + (EC50Control/x)^HillSlope)) +",
              "(1 - ind)*(Bottom + (Top - Bottom)/(1 + (EC50Control*EC50Ratio/x)^HillSlope))")),
  "ec50-shift" = list(params = c("Bottom", "Top", "LogEC50Control", "EC50Ratio", "HillSlope"),
    ind = "g == 1",
    f = paste("ind*(Bottom + (Top - Bottom)/(1 + 10^((LogEC50Control - x)*HillSlope))) +",
              "(1 - ind)*(Bottom + (Top - Bottom)/(1 + 10^((LogEC50Control + log10(EC50Ratio) - x)*HillSlope)))")),
  "allosteric-ec50-shift-conc" = list(
    params = c("Bottom", "Top", "EC50", "HillSlope", "KB", "alpha", "B"),
    f = "Bottom + (Top - Bottom)/(1 + (EC50*((1 + B/KB)/(1 + alpha*B/KB))/x)^HillSlope)"),
  "allosteric-ec50-shift" = list(
    params = c("Bottom", "Top", "LogEC50", "HillSlope", "LogKB", "Logalpha", "B"),
    f = paste("Bottom + (Top - Bottom)/(1 + 10^((log10(10^LogEC50*((1 + B/10^LogKB)/",
              "(1 + 10^Logalpha*B/10^LogKB))) - x)*HillSlope))")),
  "agonist-conc-response-find-ecanything" = list(params = c("Bottom", "Top", "ECF", "HillSlope", "F"),
    f = "Bottom + (Top - Bottom)/(1 + ((ECF/(F/(100 - F))^(1/HillSlope))/x)^HillSlope)"),
  "absolute-ic50-conc" = list(params = c("Top", "Bottom", "HillSlope", "AbsoluteIC50", "Baseline"),
    f = paste("Bottom + (Top - Bottom)/(1 + ((Top - Bottom)/((Top + Baseline)/2 - Bottom) - 1)*",
              "(AbsoluteIC50/x)^HillSlope)")),
  "absolute-ic50" = list(params = c("Top", "Bottom", "HillSlope", "LogAbsoluteIC50", "Baseline"),
    f = paste("Bottom + (Top - Bottom)/(1 + 10^((LogAbsoluteIC50 - x)*HillSlope +",
              "log10((Top - Bottom)/((Top + Baseline)/2 - Bottom) - 1)))")),
  "one-site-total-and-nonspecific" = list(params = c("Bmax", "Kd", "NS", "Background"),
    ind = "g == 1", f = "ind*(Bmax*x/(x + Kd)) + NS*x + Background"),
  "one-site-total-depletion" = list(params = c("Bmax", "KdnM", "NS", "Vol", "SpecAct"),
    f = paste("(-(KdnM*Vol*1000*SpecAct + NS*KdnM*Vol*1000*SpecAct + x + 2*x*NS + Bmax) +",
              "sqrt((KdnM*Vol*1000*SpecAct + NS*KdnM*Vol*1000*SpecAct + x + 2*x*NS + Bmax)^2 -",
              "4*(-1 - NS)*(-x*(NS*KdnM*Vol*1000*SpecAct + x*NS + Bmax))))/(2*(-1 - NS))")),
  "two-sites-total-and-nonspecific" = list(
    params = c("BmaxHi", "KdHi", "BmaxLo", "KdLo", "NS", "Background"), ind = "g == 1",
    f = "ind*(BmaxHi*x/(x + KdHi) + BmaxLo*x/(x + KdLo)) + NS*x + Background"),
  "one-site-allosteric-modulator" = list(params = c("Bmax", "KDHot", "logKB", "logalpha", "Allo"),
    f = "Bmax*x/(x + KDHot*((1 + Allo/10^logKB)/(1 + 10^logalpha*Allo/10^logKB)))"),
  "two-sites-fit-ki" = list(
    params = c("Top", "Bottom", "FractionHi", "logKiHi", "logKiLo", "HotNM", "HotKdNMHi", "HotKdNMLo"),
    f = paste("Bottom + FractionHi*(Top - Bottom)/(1 + 10^(x - log10(10^logKiHi*(1 + HotNM/HotKdNMHi)))) +",
              "(1 - FractionHi)*(Top - Bottom)/(1 + 10^(x - log10(10^logKiLo*(1 + HotNM/HotKdNMLo))))")),
  "one-site-competitive-depletion" = list(
    params = c("LogKi", "Bmax", "NS", "Hot", "KdnM", "SpAct", "Vol"),
    f = local({
      S <- "((1 + 10^(x - LogKi))*KdnM*SpAct*Vol*1000 + Hot)"
      b <- sprintf("((NS + 1)*%s + NS*Hot + Bmax)", S)
      c <- sprintf("(-Hot*(%s*NS + Bmax))", S)
      sprintf("(-%s + sqrt(%s^2 - 4*(-(NS + 1))*%s))/(2*(-(NS + 1)))", b, b, c)
    })),
  "homologous-one-site" = list(params = c("logKD", "Bmax", "Bottom", "HotnM"),
    f = "(Bmax*HotnM)/(HotnM + 10^(x + 9) + 10^(logKD + 9)) + Bottom"),
  "allosteric-modulator-competitive" = list(
    params = c("logKb", "logAlpha", "Y0", "RadioligandNM", "HotKDnm"),
    f = paste("(Y0/(RadioligandNM/(RadioligandNM + HotKDnm)))*(RadioligandNM/(RadioligandNM +",
              "HotKDnm*((1 + 10^(x + 9)/10^(logKb + 9))/(1 + 10^logAlpha*10^(x + 9)/10^(logKb + 9)))))")),
  "association-two-conc" = list(params = c("Kon", "Koff", "Bmax", "Hotnm"),
    f = paste("(Hotnm*1e-9/(Hotnm*1e-9 + Koff/Kon))*Bmax*(1 - exp(-(Kon*Hotnm*1e-9 + Koff)*x))")),
  "association-then-dissociation" = list(params = c("Koff", "Kon", "Bmax", "NS", "HotNM", "Time0"),
    ind = "x < Time0",
    f = local({
      eq <- "(Bmax*HotNM*1e-9/(HotNM*1e-9 + Koff/Kon))"
      kob <- "(HotNM*1e-9*Kon + Koff)"
      sprintf("ind*%s*(1 - exp(-%s*x)) + (1 - ind)*%s*(1 - exp(-%s*Time0))*exp(-Koff*(x - Time0)) + NS",
              eq, kob, eq, kob)
    })),
  "kinetics-competitive-binding" = list(params = c("K3", "K4", "Bmax", "K1", "K2", "L", "I"),
    f = local({
      KA <- "(K1*L*1e-9 + K2)"
      KB <- "(K3*I*1e-9 + K4)"
      S <- sprintf("sqrt((%s - %s)^2 + 4*K1*K3*L*I*1e-18)", KA, KB)
      KF <- sprintf("(0.5*(%s + %s + %s))", KA, KB, S)
      KS <- sprintf("(0.5*(%s + %s - %s))", KA, KB, S)
      sprintf("(Bmax*K1*L*1e-9/(%s - %s))*(K4*(%s - %s)/(%s*%s) + ((K4 - %s)/%s)*exp(-%s*x) - ((K4 - %s)/%s)*exp(-%s*x))",
              KF, KS, KF, KS, KF, KS, KF, KF, KF, KS, KS, KS)
    })),
  "morrison-ki" = list(params = c("Vo", "Ki", "Et", "S", "Km"),
    f = "Vo*(1 - ((Et + x + Ki*(1 + S/Km)) - sqrt((Et + x + Ki*(1 + S/Km))^2 - 4*Et*x))/(2*Et))"),
  "three-phase-decay" = list(
    params = c("Y0", "Plateau", "PercentFast", "KFast", "PercentSlow", "KSlow", "KMedium"),
    f = paste("Plateau + (Y0 - Plateau)*PercentFast*0.01*exp(-KFast*x) +",
              "(Y0 - Plateau)*PercentSlow*0.01*exp(-KSlow*x) +",
              "(Y0 - Plateau)*(100 - PercentFast - PercentSlow)*0.01*exp(-KMedium*x)")),
  "plateau-one-phase-association" = list(params = c("X0", "Y0", "Plateau", "K"), ind = "x < X0",
    f = "ind*Y0 + (1 - ind)*(Y0 + (Plateau - Y0)*(1 - exp(-K*(x - X0))))"),
  "horizontal-line" = list(params = "Mean", f = "Mean + 0*x"),
  "line-through-origin" = list(params = "Slope", f = "Slope*x"),
  "hinge" = list(params = c("Intercept", "Slope1", "Slope2", "X0", "Delta"),
    f = "Intercept + Slope1*(x - X0) + (Slope2 - Slope1)*Delta*log(1 + exp((x - X0)/Delta))"),
  "semilog-x-log" = list(params = c("Yintercept", "Slope"), f = "Yintercept + Slope*log10(x)"),
  "semilog-y-log" = list(params = c("Slope", "Yintercept"), f = "10^(Slope*x + Yintercept)"),
  "log-log-line" = list(params = c("slope", "Yintercept"), f = "10^(slope*log10(x) + Yintercept)"),
  "gaussian-sum-two" = list(params = c("Amplitude1", "Mean1", "SD1", "Amplitude2", "Mean2", "SD2"),
    f = "Amplitude1*exp(-0.5*((x - Mean1)/SD1)^2) + Amplitude2*exp(-0.5*((x - Mean2)/SD2)^2)"),
  "lognormal" = list(params = c("A", "GeoMean", "GeoSD"),
    f = "(A/x)*exp(-0.5*(log(x/GeoMean)/log(GeoSD))^2)"),
  "cumulative-gaussian-percent" = list(params = c("Mean", "SD"), f = "100*pnorm((x - Mean)/SD)"),
  "cumulative-gaussian-fraction" = list(params = c("Mean", "SD"), f = "pnorm((x - Mean)/SD)"),
  "cumulative-gaussian-counts" = list(params = c("Mean", "SD", "N"), f = "N*pnorm((x - Mean)/SD)"),
  "lorentzian-sum-two" = list(
    params = c("Amplitude1", "Center1", "Width1", "Amplitude2", "Center2", "Width2"),
    f = "Amplitude1/(1 + ((x - Center1)/Width1)^2) + Amplitude2/(1 + ((x - Center2)/Width2)^2)"),
  "damped-sine-wave" = list(params = c("Amplitude", "Wavelength", "PhaseShift", "K"),
    f = "Amplitude*exp(-K*x)*sin(2*pi*x/Wavelength + PhaseShift)"),
  "sinc-wave" = list(params = c("Amplitude", "Wavelength"), ind = "x == 0",
    f = "ind*Amplitude + (1 - ind)*Amplitude*sin(2*pi*(x + ind)/Wavelength)/(2*pi*(x + ind)/Wavelength)"),
  "log-exponential-growth" = list(params = c("logY0", "k"), f = "logY0 + k*x"),
  "linear-quadratic-fs" = list(params = c("A", "B"), f = "exp(-(A*x + B*x^2))"),
  "linear-quadratic-ps" = list(params = c("A", "B"), f = "100*exp(-(A*x + B*x^2))"),
  "linear-quadratic-fd" = list(params = c("A", "B"), f = "1 - exp(-(A*x + B*x^2))"),
  "linear-quadratic-pd" = list(params = c("A", "B"), f = "100*(1 - exp(-(A*x + B*x^2)))"),
  "linear-quadratic-ns" = list(params = c("Y0", "A", "B"), f = "Y0*exp(-(A*x + B*x^2))"),
  "linear-quadratic-nd" = list(params = c("Y0", "A", "B"), f = "Y0*(1 - exp(-(A*x + B*x^2)))"),
  "classic-one-phase-decay" = list(params = c("Span", "K", "Plateau"), f = "Span*exp(-K*x) + Plateau"),
  "classic-two-phase-decay" = list(params = c("Span1", "K1", "Span2", "K2", "Plateau"),
    f = "Span1*exp(-K1*x) + Span2*exp(-K2*x) + Plateau"),
  "classic-one-phase-association" = list(params = c("Ymax", "K"), f = "Ymax*(1 - exp(-K*x))"),
  "classic-two-phase-association" = list(params = c("Ymax1", "K1", "Ymax2", "K2"),
    f = "Ymax1*(1 - exp(-K1*x)) + Ymax2*(1 - exp(-K2*x))"),
  "classic-power-series" = list(params = c("A", "B", "C", "D"), f = "A*x^B + C*x^D"),
  "classic-sine-wave" = list(params = c("Baseline", "Amplitude", "Frequency", "Offset"),
    f = "Baseline + Amplitude*sin(Frequency*x + Offset)")
)
for (d in c(1, 4, 5, 6)) EQ20[[paste0("polynomial-", d)]] <- list(params = poly_p(d, FALSE), f = poly_f(d, FALSE))
for (d in 1:6) EQ20[[paste0("centered-polynomial-", d)]] <- list(params = poly_p(d, TRUE), f = poly_f(d, TRUE))
EQ <- c(EQ, EQ20)

# ---- special functions --------------------------------------------------------------------------

erf_r <- function(x) {
  if (x == 0) return(0)
  s <- sign(x)
  s * 2 / sqrt(pi) * integrate(function(t) exp(-t^2), 0, abs(x), rel.tol = 1.2e-14,
                                 abs.tol = 0, subdivisions = 1000L)$value
}
int_r <- function(f, lo, hi) integrate(f, lo, hi, rel.tol = 1e-13, abs.tol = 0,
                                        subdivisions = 2000L)$value
hyper_m <- function(a, b, x)  # b > a > 0
  gamma(b) / (gamma(a) * gamma(b - a)) *
    int_r(function(t) exp(x * t) * t^(a - 1) * (1 - t)^(b - a - 1), 0, 1)
hyper_u <- function(a, b, x)  # a > 0, x > 0
  int_r(function(t) exp(-x * t) * t^(a - 1) * (1 + t)^(b - a - 1), 0, Inf) / gamma(a)
hyper_f <- function(a, b, c, x)  # c > b > 0, x < 1
  gamma(c) / (gamma(b) * gamma(c - b)) *
    int_r(function(t) t^(b - 1) * (1 - t)^(c - b - 1) * (1 - x * t)^(-a), 0, 1)

sym_tail <- function(cdf, z, tail) switch(tail, left = cdf(z), right = cdf(-z),
                                          two = min(1, 2 * cdf(-abs(z))))
q_tail <- function(p, tail) switch(tail, left = qnorm(p), right = qnorm(p, lower.tail = FALSE),
                                   two = qnorm(p / 2, lower.tail = FALSE))

special <- function(fn, a, tail = NA) {
  n <- function(i) as.numeric(a[[i]])
  tl <- function(default) if (is.na(tail)) default else tail
  switch(fn,
    gamma = gamma(n(1)), gammaln = lgamma(n(1)), beta = beta(n(1), n(2)),
    ibeta = pbeta(n(3), n(1), n(2)), igamma = pgamma(n(2), n(1)),
    igammac = pgamma(n(2), n(1), lower.tail = FALSE),
    erf = erf_r(n(1)), erfc = 2 * pnorm(-n(1) * sqrt(2)), psi = digamma(n(1)),
    besselj = besselJ(n(2), n(1)), bessely = besselY(n(2), n(1)),
    besseli = besselI(n(2), n(1)), besselk = besselK(n(2), n(1)),
    hypgeometricm = hyper_m(n(1), n(2), n(3)), hypgeometricu = hyper_u(n(1), n(2), n(3)),
    hypgeometricf = hyper_f(n(1), n(2), n(3), n(4)),
    zdist = sym_tail(pnorm, n(1), tl("left")),
    zinv = q_tail(n(1), tl("left")), zpdf = dnorm(n(1)),
    normdist = sym_tail(pnorm, (n(1) - n(2)) / n(3), tl("left")),
    norminv = n(2) + n(3) * q_tail(n(1), tl("left")),
    normpdf = dnorm(n(1), n(2), n(3)),
    tdist = sym_tail(function(t) pt(t, n(2)), n(1), tl("right")),
    tinv = qt(n(1) / 2, n(2), lower.tail = FALSE), tpdf = dt(n(1), n(2)),
    fdist = pf(n(1), n(2), n(3), lower.tail = FALSE),
    finv = qf(n(1), n(2), n(3), lower.tail = FALSE), fpdf = df(n(1), n(2), n(3)),
    chidist = pchisq(n(1), n(2), lower.tail = FALSE),
    chiinv = qchisq(n(1), n(2), lower.tail = FALSE), chisqc = pchisq(n(1), n(2)),
    binomial = pbinom(n(1) - 1, n(2), n(3), lower.tail = FALSE),
    fact = factorial(n(1)), perc = n(1) / 100, logit = log(n(1) / (1 - n(1))),
    probit = 5 + qnorm(n(1)),
    stop(paste("unknown function", fn)))
}

# ---- MM substrate depletion ----------------------------------------------------------------------

mm_depletion <- function(S0, Vmax, Km, t) {
  S <- vapply(t, function(ti) {
    if (ti == 0) return(S0)
    g <- function(s) Km * log(S0 / s) + S0 - s - Vmax * ti
    uniroot(g, c(1e-300, S0), tol = 1e-15 * S0, maxiter = 2000)$root
  }, 1)
  # Implicit differentiation of Km*ln(S0/S) + S0 - S = Vmax*t.
  d <- S + Km
  grad <- cbind(S0 = S * (S0 + Km) / (S0 * d), Vmax = -t * S / d, Km = log(S0 / S) * S / d)
  attr(S, "gradient") <- grad
  S
}

mm_case <- function(input, params) {
  d <- data.frame(x = input$data$x[[1]], y = input$data$y[[1]])
  st <- as.list(setNames(as.numeric(params$start), c("S0", "Vmax", "Km")))
  fit <- polish(nls(y ~ mm_depletion(S0, Vmax, Km, x), data = d, start = st, control = CTRL(1e-8)))
  V <- vcov(fit)
  dfr <- df.residual(fit)
  t <- qt(0.975, dfr)
  est <- coef(fit)
  se <- sqrt(diag(V))
  ss <- deviance(fit)
  n <- nrow(d)
  Kp <- length(est) + 1
  list(status = "converged", value = list(unname(est)), se = list(unname(se)),
       lo = list(unname(est - t * se)), hi = list(unname(est + t * se)),
       atBound = list(rep(FALSE, 3)), ss = ss, df = dfr, n = n, nParams = length(est),
       aicc = n * log(ss / n) + 2 * Kp + 2 * Kp * (Kp + 1) / (n - Kp - 1),
       perDataSet = list(n = n, ss = ss, df = dfr, syx = sqrt(ss / dfr),
                         r2 = 1 - ss / sum((d$y - mean(d$y))^2)))
}

# ---- entry -----------------------------------------------------------------------------------------

oracle <- function(input, params) {
  task <- if (is.null(params$task)) "fit" else params$task
  if (task == "special") {
    calls <- input$calls
    tails <- if (is.null(calls$tail)) rep(NA, nrow(calls)) else calls$tail
    return(list(values = vapply(seq_len(nrow(calls)), function(i)
      special(calls$fn[i], calls$args[[i]], tails[i]), 1)))
  }
  if (task == "mmdepletion") return(mm_case(input, params))
  if (identical(params$equation, "user"))
    EQ[["user"]] <<- list(params = params$params, f = params$formula, ind = params$ind)
  fit_model(input, params$equation, params$constraints, params)$out
}
