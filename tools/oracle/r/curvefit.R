# Phase 14 curve fitting for lab assays: the new built-in equations, user-defined equations,
# interpolation from a standard curve, fit diagnostics and ROUT for curves.
#
# Fits reuse nonlinear.R (nls with exact deriv() gradients, polished to machine precision);
# see that file for the fitting conventions. params:
#   task       "fit" (default) | "rout" | "linear"
#   equation   an id in EQ below (same parameterisation as packages/stats), or "user" with
#              `formula` (R syntax) and `params`
#   constraints, bounds, weighting, confLevel, start  as in nonlinear.R
#   diagnostics  TRUE: residuals, runs test, replicates test, parameter correlation matrix,
#              dependency and Hougaard's skewness (data set 1's block)
#   q          ROUT's Q as a fraction (task "rout")
# input: data = [{x, y}], interpolate = {y: [...], x: [...]} (unknowns for data set 1).
#
# Interpolation (Prism's rules, see packages/stats/src/regression/interpolate.ts): X from Y is
# the first crossing of the curve from the smallest to the largest X of the standards, else
# below the smallest, else above the largest, within half the X range beyond each end; its CI
# is where the confidence band crosses the line Y. Here crossings are located on a grid of
# 20001 points (ours: 1000) and refined with uniroot to 1e-15 relative.
#
# Runs test: exact P of <= the observed runs, by enumerating all arrangements of the signs when
# there are at most 2e5 (else the Swed-Eisenhart formula). Replicates test: pure error from
# lm(y ~ factor(x)). Hougaard's skewness (SAS PROC NLIN's formula, from Hougaard 1985):
# g1_i = -mse^2 sum_jkl L_ij L_ik L_il (W_jkl + W_kjl + W_lkj) / (mse L_ii)^(3/2), with
# L = (J'J)^-1 and W_jkl = sum_m J_mj H_m,kl, J and H from deriv3().
#
# ROUT (Motulsky & Brown 2006): robust fit by iteratively reweighted nls (weights
# 1/(1 + (r/RSDR)^2), RSDR = type-6 68.27th percentile of |r| x N/(N - K)) from the
# least-squares fit until the parameters and RSDR stop changing; t = |r|/RSDR, P from t(N - K);
# the floor(0.3 N) (>= 1) largest residuals are tested against Q j / N (j from the largest);
# then an ordinary fit without the outliers.

PACKAGES <- character(0)

sys.source(file.path("r", "nonlinear.R"), envir = environment())

EQ14 <- list(
  "agonist-response-find-ecanything" = list(
    params = c("Bottom", "Top", "LogECF", "HillSlope", "F"),
    f = "Bottom + (Top - Bottom)/(1 + 10^(((LogECF - (1/HillSlope)*log10(F/(100 - F))) - x)*HillSlope))"),
  "biphasic-dose-response" = list(
    params = c("Bottom", "Top", "Frac", "LogEC50_1", "nH1", "LogEC50_2", "nH2"),
    f = paste("Bottom + (Top - Bottom)*Frac/(1 + 10^((LogEC50_1 - x)*nH1)) +",
              "(Top - Bottom)*(1 - Frac)/(1 + 10^((LogEC50_2 - x)*nH2))")),
  "bell-shaped-dose-response" = list(
    params = c("Dip", "Plateau1", "Plateau2", "LogEC50_1", "LogEC50_2", "nH1", "nH2"),
    f = paste("Dip + (Plateau1 - Dip)/(1 + 10^((LogEC50_1 - x)*nH1)) +",
              "(Plateau2 - Dip)/(1 + 10^((x - LogEC50_2)*nH2))")),
  "one-site-specific-hill" = list(params = c("Bmax", "Kd", "h"), f = "Bmax*x^h/(Kd^h + x^h)"),
  "two-sites-specific" = list(
    params = c("BmaxHi", "KdHi", "BmaxLo", "KdLo"),
    f = "BmaxHi*x/(KdHi + x) + BmaxLo*x/(KdLo + x)"),
  "one-site-fit-logki" = list(
    params = c("Top", "Bottom", "logKi", "HotNM", "HotKdNM"),
    f = "(Top - Bottom)/(1 + 10^(x - log10(10^logKi*(1 + HotNM/HotKdNM)))) + Bottom"),
  "two-sites-fit-logic50" = list(
    params = c("Top", "Bottom", "FractionHi", "LogIC50Hi", "LogIC50Lo"),
    f = paste("Bottom + (Top - Bottom)*FractionHi/(1 + 10^(x - LogIC50Hi)) +",
              "(Top - Bottom)*(1 - FractionHi)/(1 + 10^(x - LogIC50Lo))")),
  "dissociation-one-phase" = list(params = c("Y0", "NS", "K"), f = "(Y0 - NS)*exp(-K*x) + NS"),
  "association-one-conc" = list(
    params = c("Kon", "HotNM", "Koff", "Bmax"),
    f = "(HotNM*1e-9/(HotNM*1e-9 + Koff/Kon))*Bmax*(1 - exp(-(Kon*HotNM*1e-9 + Koff)*x))"),
  "allosteric-sigmoidal" = list(params = c("Vmax", "h", "Khalf"), f = "Vmax*x^h/(Khalf^h + x^h)"),
  "kcat" = list(params = c("Et", "kcat", "Km"), f = "Et*kcat*x/(Km + x)"),
  "competitive-inhibition" = list(
    params = c("Vmax", "Km", "Ki", "I"), f = "Vmax*x/(Km*(1 + I/Ki) + x)"),
  "noncompetitive-inhibition" = list(
    params = c("Vmax", "Km", "Ki", "I"), f = "Vmax/(1 + I/Ki)*x/(Km + x)"),
  "uncompetitive-inhibition" = list(
    params = c("Vmax", "Km", "AlphaKi", "I"),
    f = "(Vmax/(1 + I/AlphaKi))*x/(Km/(1 + I/AlphaKi) + x)"),
  "mixed-inhibition" = list(
    params = c("Vmax", "Km", "Ki", "Alpha", "I"),
    f = "(Vmax/(1 + I/(Alpha*Ki)))*x/(Km*(1 + I/Ki)/(1 + I/(Alpha*Ki)) + x)"),
  "plateau-one-phase-decay" = list(
    params = c("X0", "Y0", "Plateau", "K"), ind = "x < X0",
    f = "ind*Y0 + (1 - ind)*(Plateau + (Y0 - Plateau)*exp(-K*(x - X0)))"),
  "two-phase-association" = list(
    params = c("Y0", "Plateau", "PercentFast", "KFast", "KSlow"),
    f = paste("Y0 + (Plateau - Y0)*PercentFast*0.01*(1 - exp(-KFast*x)) +",
              "(Plateau - Y0)*(100 - PercentFast)*0.01*(1 - exp(-KSlow*x))")),
  "exponential-plateau" = list(params = c("Y0", "YM", "k"), f = "YM - (YM - Y0)*exp(-k*x)"),
  "beta-growth-decline" = list(
    params = c("YM", "Te", "Tm"), f = "YM*(1 + (Te - x)/(Te - Tm))*(x/Te)^(Te/(Te - Tm))"),
  "segmental-linear" = list(
    params = c("Intercept1", "Slope1", "X0", "Slope2"), ind = "x < X0",
    f = "ind*(Intercept1 + Slope1*x) + (1 - ind)*(Slope1*X0 + Intercept1 + Slope2*(x - X0))"),
  "two-lines-crossing" = list(
    params = c("Xcross", "Ycross", "Slope"), f = "Ycross + (x - Xcross)*Slope"),
  "sine-wave" = list(
    params = c("Amplitude", "Wavelength", "PhaseShift"),
    f = "Amplitude*sin(2*pi*x/Wavelength + PhaseShift)"),
  "sine-wave-baseline" = list(
    params = c("Amplitude", "Wavelength", "PhaseShift", "Baseline"),
    f = "Amplitude*sin(2*pi*x/Wavelength + PhaseShift) + Baseline"),
  "lorentzian" = list(
    params = c("Amplitude", "Center", "Width"), f = "Amplitude/(1 + ((x - Center)/Width)^2)")
)
EQ <- c(EQ, EQ14)

# ---- interpolation -----------------------------------------------------------------------------

GRID_R <- 20001

first_root <- function(g, from, to) {
  xs <- seq(from, to, length.out = GRID_R)
  v <- vapply(xs, g, 1)
  if (v[1] == 0) return(from)
  for (i in 2:GRID_R) {
    if (!is.finite(v[i]) || !is.finite(v[i - 1])) next
    if (v[i] == 0) return(xs[i])
    if (sign(v[i]) != sign(v[i - 1])) {
      r <- uniroot(g, sort(c(xs[i - 1], xs[i])), tol = 1e-15 * max(1, abs(xs[i])), maxiter = 1000)
      # A sign change across a pole is not a crossing.
      if (abs(g(r$root)) <= 1e-6 * max(abs(v[i]), abs(v[i - 1]))) return(r$root)
    }
  }
  NaN
}

# Curve and confidence band of data set 1 of a fitted model (a function of x).
curve_fns <- function(m) {
  b <- m$fits[[1]]
  eq <- m$eq
  v <- block_values(b, eq, b$cons, 1)
  f1 <- dataset_expr(b, eq, b$cons, 1)
  free <- intersect(eq$params[!(m$cons$kinds %in% c("constant", "dataSetConstant"))], b$free)
  free <- setdiff(free, names(b$fixed))
  D <- deriv(parse(text = f1)[[1]], free)
  names_cov <- vapply(free, function(nm) coef_name(b, nm, 1), "")
  V <- vcov(b$fit)[names_cov, names_cov, drop = FALSE]
  t <- qt(1 - (1 - m$level) / 2, df.residual(b$fit))
  at <- function(x) {
    env <- as.list(setNames(v, eq$params)); env$x <- x
    d <- eval(D, with_ind(env, eq$ind))
    G <- attr(d, "gradient")
    list(y = as.vector(d), h = t * sqrt(rowSums((G %*% V) * G)))
  }
  list(f = function(x) at(x)$y,
       lo = function(x) { a <- at(x); a$y - a$h },
       hi = function(x) { a <- at(x); a$y + a$h })
}

interp <- function(fns, xmin, xmax, ys, xs) {
  w <- xmax - xmin
  lo <- xmin - w / 2; hi <- xmax + w / 2
  outX <- lapply(ys, function(y) {
    g <- function(x) fns$f(x) - y
    x <- first_root(g, xmin, xmax); ex <- FALSE
    if (is.nan(x)) { x <- first_root(g, xmin, lo); if (is.nan(x)) x <- first_root(g, xmax, hi); ex <- !is.nan(x) }
    if (is.nan(x)) return(list(x = NaN, lo = NaN, hi = NaN, extrapolated = FALSE))
    out <- function(t) max(fns$lo(t) - y, y - fns$hi(t))
    list(x = x, lo = first_root(out, x, lo), hi = first_root(out, x, hi), extrapolated = ex)
  })
  outY <- lapply(xs, function(x) {
    if (x < lo || x > hi) return(list(y = NaN, lo = NaN, hi = NaN))
    list(y = fns$f(x), lo = fns$lo(x), hi = fns$hi(x))
  })
  list(x = outX, y = outY)
}

# ---- diagnostics -------------------------------------------------------------------------------

runs_p <- function(s) {
  n1 <- sum(s > 0); n2 <- sum(s < 0); n <- n1 + n2
  runs <- 1 + sum(diff(s) != 0)
  if (n1 == 0 || n2 == 0) return(list(runs = runs, nAbove = n1, nBelow = n2, p = NaN))
  if (choose(n, n1) <= 2e5) {
    cmb <- combn(n, n1)
    r <- apply(cmb, 2, function(pos) { v <- rep(-1, n); v[pos] <- 1; 1 + sum(diff(v) != 0) })
    p <- mean(r <= runs)
  } else {
    pr <- function(r) {
      if (r %% 2 == 0) { k <- r / 2; 2 * choose(n1 - 1, k - 1) * choose(n2 - 1, k - 1) }
      else { k <- (r - 1) / 2; choose(n1 - 1, k) * choose(n2 - 1, k - 1) + choose(n1 - 1, k - 1) * choose(n2 - 1, k) }
    }
    p <- sum(vapply(2:runs, pr, 1)) / choose(n, n1)
  }
  list(runs = runs, nAbove = n1, nBelow = n2, p = p)
}

diagnostics <- function(m) {
  eq <- m$eq
  res <- list(); runs <- list(); reps <- list(); hou <- list()
  for (bi in seq_along(m$blocks)) {
    b <- m$fits[[bi]]
    sets <- m$blocks[[bi]]$sets
    for (local in seq_along(sets)) {
      k <- sets[local]
      d <- m$dsets[[k]]
      v <- m$out$value[k, ]
      env <- as.list(setNames(v, eq$params)); env$x <- d$x
      yhat <- eval(parse(text = eq$f)[[1]], with_ind(env, eq$ind))
      r <- d$y - yhat
      res[[k]] <- r
      if (anyDuplicated(d$x) == 0) {
        o <- order(d$x)
        s <- sign(r[o]); s <- s[s != 0]
        runs[[k]] <- runs_p(s)
      } else runs[[k]] <- NULL
      if (anyDuplicated(d$x) > 0 && m$weighting == "none" && !m$shared) {
        pure <- lm(d$y ~ factor(d$x))
        ssp <- deviance(pure); dfp <- df.residual(pure)
        ssr <- m$out$perDataSet$ss[k]; dfr <- m$out$perDataSet$df[k]
        dfl <- dfr - dfp
        F <- ((ssr - ssp) / dfl) / (ssp / dfp)
        reps[[k]] <- list(sdReplicates = sqrt(ssp / dfp), dfReplicates = dfp,
                          sdLackOfFit = sqrt((ssr - ssp) / dfl), dfLackOfFit = dfl, F = F,
                          p = pf(F, dfl, dfp, lower.tail = FALSE))
      }
    }
  }
  # Correlation, dependency and Hougaard for data set 1's block (a single data set).
  b <- m$fits[[1]]
  V <- vcov(b$fit)
  R <- cov2cor(V)
  dep <- if (ncol(R) == 1) 0 else 1 - 1 / diag(solve(R))
  f1 <- dataset_expr(b, eq, b$cons, 1)
  free <- names(coef(b$fit))
  v <- block_values(b, eq, b$cons, 1)
  env <- as.list(setNames(v, eq$params)); env$x <- m$dsets[[1]]$x
  d3 <- eval(deriv3(parse(text = f1)[[1]], free), with_ind(env, eq$ind))
  J <- attr(d3, "gradient"); H <- attr(d3, "hessian")
  q <- length(free)
  L <- solve(crossprod(J))
  mse <- deviance(b$fit) / df.residual(b$fit)
  W <- array(0, c(q, q, q))
  for (j in 1:q) for (kk in 1:q) for (l in 1:q) W[j, kk, l] <- sum(J[, j] * H[, kk, l])
  g1 <- vapply(1:q, function(i) {
    s <- 0
    for (j in 1:q) for (kk in 1:q) for (l in 1:q)
      s <- s + L[i, j] * L[i, kk] * L[i, l] * (W[j, kk, l] + W[kk, j, l] + W[l, kk, j])
    -mse^2 * s / (mse * L[i, i])^1.5
  }, 1)
  list(residuals = res, runs = runs, replicates = if (length(reps)) reps[[1]] else NULL,
       free = free, correlation = unname(R), dependency = unname(dep), hougaard = unname(g1))
}

# ---- ROUT --------------------------------------------------------------------------------------

rsdr <- function(r, K) unname(quantile(abs(r), 0.6827, type = 6)) * length(r) / (length(r) - K)

rout_case <- function(input, params) {
  eq <- EQ[[params$equation]]
  P <- length(eq$params)
  d <- list(x = input$data$x[[1]], y = input$data$y[[1]])
  cons <- constraint_list(params$constraints, P)
  bnds <- bounds_list(NULL, P)
  start <- matrix(as.numeric(params$start), nrow = 1)
  b <- fit_block(eq, cons, bnds, list(d), start, "none")
  fit <- b$fit
  K <- length(coef(fit))
  yhat <- function(fit) { v <- block_values(list(fit = fit, fixed = list(), vec = character(0)), eq, cons, 1)
    env <- as.list(setNames(v, eq$params)); env$x <- d$x
    eval(parse(text = eq$f)[[1]], with_ind(env, eq$ind)) }
  r <- d$y - yhat(fit)
  s <- rsdr(r, K)
  data <- b$data
  for (it in 1:2000) {
    w <- 1 / (1 + (r / s)^2)
    old <- coef(fit)
    data$.w <- w
    fit <- NULL
    for (tol in c(1e-8, 1e-6)) {
      fit <- tryCatch(nls(b$form, data = data, start = as.list(old), weights = .w,
                          control = CTRL(tol)), error = function(e) NULL)
      if (!is.null(fit)) break
    }
    fit <- polish(fit)
    r <- d$y - yhat(fit)
    s2 <- rsdr(r, K)
    done <- max(abs(coef(fit) - old) / pmax(abs(coef(fit)), 1e-300)) < 1e-14 && abs(s2 - s) < 1e-14 * s
    s <- s2
    if (done) break
  }
  n <- length(r)
  tt <- abs(r) / s
  p <- 2 * pt(tt, n - K, lower.tail = FALSE)
  o <- order(-abs(r))
  m <- max(1, floor(0.3 * n))
  last <- 0
  for (j in 1:m) if (p[o[j]] < params$q * j / n) last <- j
  outl <- if (last > 0) sort(o[1:last]) - 1 else integer(0)
  keep <- setdiff(seq_len(n), outl + 1)
  robust <- block_values(list(fit = fit, fixed = list(), vec = character(0)), eq, cons, 1)
  inp2 <- input
  inp2$data <- data.frame(x = I(list(d$x[keep])), y = I(list(d$y[keep])))
  final <- fit_model(inp2, params$equation, params$constraints,
                     modifyList(params, list(weighting = params$finalWeighting)))$out
  list(robust = robust, rsdr = s, t = tt, p = p, outliers = I(outl), iterations = it,
       final = final)
}

# ---- linear -----------------------------------------------------------------------------------

linear_case <- function(input, params) {
  d <- list(x = input$data$x[[1]], y = input$data$y[[1]])
  fit <- lm(y ~ x, data = d)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  pr <- function(x) predict(fit, newdata = data.frame(x = x), interval = "confidence", level = level)
  fns <- list(f = function(x) pr(x)[1, "fit"], lo = function(x) pr(x)[1, "lwr"],
              hi = function(x) pr(x)[1, "upr"])
  out <- interp(fns, min(d$x), max(d$x), input$interpolate$y, input$interpolate$x)
  # The closed form of the line's X from Y, checked against the root finder.
  a <- coef(fit)[[1]]; b <- coef(fit)[[2]]
  for (i in seq_along(input$interpolate$y)) {
    xi <- out$x[[i]]$x
    if (!is.nan(xi)) stopifnot(isTRUE(all.equal(xi, (input$interpolate$y[i] - a) / b, tolerance = 1e-12)))
  }
  list(slope = b, intercept = a, interp = out)
}

# ---- entry -------------------------------------------------------------------------------------

oracle <- function(input, params) {
  task <- if (is.null(params$task)) "fit" else params$task
  if (task == "rout") return(rout_case(input, params))
  if (task == "linear") return(linear_case(input, params))
  if (identical(params$equation, "user")) EQ[["user"]] <<- list(params = params$params, f = params$formula)
  m <- fit_model(input, params$equation, params$constraints, params)
  out <- m$out
  if (!is.null(input$bandX)) out$band <- band(m, input$bandX)
  if (isTRUE(params$diagnostics)) out$diagnostics <- diagnostics(m)
  if (!is.null(input$interpolate)) {
    d <- m$dsets[[1]]
    out$interp <- interp(curve_fns(m), min(d$x), max(d$x), input$interpolate$y, input$interpolate$x)
  }
  out
}
