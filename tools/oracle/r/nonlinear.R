# Nonlinear regression ("Nonlinear regression (curve fit)") from nls().
#
# input:  data = [{x, y}, ...] (one entry per data set), bandX (points for dataset 1's bands)
# params: equation (id in EQ below; same parameterisation as packages/stats equations.ts),
#         constraints = per parameter {kind: fit | constant | shared, value},
#         bounds = per parameter null | [lo, hi], weighting = none | relative | poisson,
#         confLevel, profileCI, start = per data set starting values for R (the true
#         parameters of the simulation; our code starts from its automatic initial values),
#         compare = {equation, constraints, start?} of a simpler nested model for compareFits
#         (Roadmap 51e: nested = false for two models that aren't nested: AICc only).
#
# Conventions (see nonlinear.ts):
# - Global fits: nls on the stacked data with per-data-set parameters indexed by g
#   (Bottom[g]) and shared ones scalar. With no shared parameter each data set is fitted on
#   its own; global SS / df / nParams are then sums.
# - Weighting uses the curve's Y: SS = sum(((y - f)/f)^2) (relative) or sum((y - f)^2/f)
#   (poisson; f > 0 in these cases), fitted as a one-sided nls formula so the Jacobian includes
#   the weight's derivative.
# - Gradients: nls gets exact derivatives from deriv() (as a "gradient" attribute). Its default
#   numericDeriv() Jacobian is only ~1e-8 accurate, which with large residuals moves the
#   Gauss-Newton fixed point itself by ~1e-7 relative.
# - Bounds: nls(algorithm = "port") finds the optimum; a parameter that ends on its bound is
#   then held constant there and the model refitted by Gauss-Newton for inference (SEs, df).
# - CIs: estimate +- qt(1 - alpha/2, df) * SE (the asymptotic interval; confint.default
#   would use the normal quantile). Profile CIs: exact roots of
#   SSprofile(theta_j) = SS * (1 + qt(1 - alpha/2, df)^2 / df) by uniroot on constrained nls
#   refits, cross-checked loosely against confint() (profile + spline interpolation). Roadmap 51e: in a
#   global fit each data set's value of a per-data-set parameter is profiled too (that value
#   held, every other parameter refitted).
# - Bands: delta method, gradient from deriv(); prediction adds s^2 / w(yhat).
# - AICc = N log(SS/N) + 2K + 2K(K+1)/(N-K-1), K = fitted parameters + 1.
# - Weighted R^2 = 1 - SS_w / sum(w (y - ybar_w)^2), w at the fitted curve.
# - Piecewise models (Phase 14, e.g. IF(X < X0, ...)): EQ entries may carry `ind`, a condition
#   evaluated to 0/1 at every evaluation and used in `f` as the variable `ind`. deriv() then
#   treats it as a constant, which is its derivative almost everywhere.
# - Data set constants (Phase 14, e.g. an inhibitor concentration per data set): constraint
#   {kind: "dataSetConstant", values: [...]}; the parameter becomes a data column.
# - Roadmap 20: `ind` may use the data set index g (1, 2, … within a block) for equations with
#   lines for particular data sets (<A>, <~A>).
# - Roadmap 18: weighting "power" = 1/Y^K (params$weightPower, default 2; f > 0 in the cases),
#   residual (y - f)/f^(K/2); fixed point weights (1/X, 1/X^2, 1/SD^2) as input$weights
#   (one vector per data set) through nls(weights =), with weighting "none".

PACKAGES <- character(0)

EQ <- list(
  "agonist-response" = list(
    params = c("Bottom", "Top", "LogEC50"),
    f = "Bottom + (Top - Bottom)/(1 + 10^(LogEC50 - x))"),
  "agonist-response-variable-slope" = list(
    params = c("Bottom", "Top", "LogEC50", "HillSlope"),
    f = "Bottom + (Top - Bottom)/(1 + 10^((LogEC50 - x)*HillSlope))"),
  "inhibitor-response-variable-slope" = list(
    params = c("Bottom", "Top", "LogIC50", "HillSlope"),
    f = "Bottom + (Top - Bottom)/(1 + 10^((LogIC50 - x)*HillSlope))"),
  # Roadmap 51e: the models nested in or compared with the ones above.
  "inhibitor-response" = list(
    params = c("Bottom", "Top", "LogIC50"),
    f = "Bottom + (Top - Bottom)/(1 + 10^(x - LogIC50))"),
  "two-phase-decay" = list(
    params = c("Y0", "Plateau", "KFast", "KSlow", "PercentFast"),
    f = paste("Plateau + (Y0 - Plateau)*PercentFast*0.01*exp(-KFast*x) +",
              "(Y0 - Plateau)*(100 - PercentFast)*0.01*exp(-KSlow*x)")),
  "gaussian" = list(
    params = c("Amplitude", "Mean", "SD"),
    f = "Amplitude*exp(-0.5*((x - Mean)/SD)^2)"),
  "lorentzian" = list(
    params = c("Amplitude", "Center", "Width"),
    f = "Amplitude/(1 + ((x - Center)/Width)^2)"),
  "one-phase-decay" = list(
    params = c("Y0", "Plateau", "K"),
    f = "(Y0 - Plateau)*exp(-K*x) + Plateau"),
  "michaelis-menten" = list(
    params = c("Vmax", "Km"),
    f = "Vmax*x/(Km + x)"),
  "exponential-growth" = list(
    params = c("Y0", "K"),
    f = "Y0*exp(K*x)"),
  "one-site-total" = list(
    params = c("Bmax", "Kd", "NS", "Background"),
    f = "Bmax*x/(Kd + x) + NS*x + Background")
)

num <- function(v) as.numeric(v)
lit <- function(v) sprintf("(%.17g)", v)

subst <- function(f, map) {
  for (nm in names(map)) f <- gsub(paste0("\\b", nm, "\\b"), map[[nm]], f, perl = TRUE)
  f
}

# Per-parameter constraint kinds and constant values.
constraint_list <- function(cons, P) {
  kinds <- rep("fit", P); values <- rep(NA_real_, P); dsc <- vector("list", P)
  if (!is.null(cons)) {
    kinds <- cons$kind
    if (!is.null(cons[["value"]])) values <- num(cons[["value"]])
    if (!is.null(cons[["values"]])) for (j in seq_len(P)) if (!is.null(cons[["values"]][[j]]))
      dsc[[j]] <- num(cons[["values"]][[j]])
  }
  list(kinds = kinds, values = values, dsc = dsc)
}

# The constraints of a block of data sets (data set constants restricted to those sets).
block_cons <- function(cons, sets) {
  cons$dsc <- lapply(cons$dsc, function(v) if (is.null(v)) NULL else v[sets])
  cons
}

# Adds the 0/1 indicator of a piecewise model to an evaluation environment.
with_ind <- function(env, ind) {
  if (!is.null(ind)) env$ind <- as.numeric(eval(parse(text = ind)[[1]], env))
  env
}

bounds_list <- function(bounds, P) {
  lo <- rep(-Inf, P); hi <- rep(Inf, P)
  if (!is.null(bounds)) {
    for (j in seq_len(P)) {
      b <- bounds[[j]]
      if (!is.null(b) && length(b) == 2) { lo[j] <- num(b[1]); hi[j] <- num(b[2]) }
    }
  }
  list(lo = lo, hi = hi)
}

# Residual expression: the model (two-sided formula) or the weighted residual (one-sided).
resid_text <- function(f, weighting, K = 2) switch(weighting, none = f,
  relative = sprintf("(y - (%s))/(%s)", f, f), poisson = sprintf("(y - (%s))/sqrt(%s)", f, f),
  power = sprintf("(y - (%s))/(%s)^%s", f, f, lit(K / 2)))

# A function of the free parameters returning expr with an exact "gradient" attribute from
# deriv(). Per-data-set (vector) parameters are indexed by g; their gradient columns are split
# by data set, in the order nls flattens the start list.
grad_fn <- function(expr, free, vec, K, ind = NULL, extra = character(0), el = NULL) {
  D <- deriv(parse(text = expr)[[1]], free)
  function(..., x, y, g) {
    args <- list(...)
    env <- list(x = x, y = y, g = g)
    nf <- length(free)
    for (i in seq_along(free)) {
      a <- args[[i]]
      # Roadmap 51e: one data set's value of a per-data-set parameter held (profiling it).
      if (!is.null(el) && free[i] == el$name) a <- append(a, el$value, after = el$k - 1)
      env[[free[i]]] <- if (free[i] %in% vec) a[g] else a
    }
    for (i in seq_along(extra)) env[[extra[i]]] <- args[[nf + i]]
    env <- with_ind(env, ind)
    val <- eval(D, env)
    G <- attr(val, "gradient")
    cols <- list()
    for (i in seq_along(free)) {
      if (free[i] %in% vec) {
        for (k in seq_len(K)) {
          if (!is.null(el) && free[i] == el$name && k == el$k) next
          cols[[length(cols) + 1]] <- G[, i] * (g == k)
        }
      } else cols[[length(cols) + 1]] <- G[, i]
    }
    out <- as.vector(val)
    attr(out, "gradient") <- do.call(cbind, cols)
    out
  }
}

model_formula <- function(f, weighting, free, vec, K, ind = NULL, extra = character(0),
                          power = 2, el = NULL) {
  call <- sprintf(".fn(%s, x = x, y = y, g = g)", paste(c(free, extra), collapse = ", "))
  form <- as.formula(if (weighting == "none") paste("y ~", call) else paste("~", call))
  e <- new.env(parent = globalenv())
  e$.fn <- grad_fn(resid_text(f, weighting, power), free, vec, K, ind, extra, el)
  environment(form) <- e
  form
}

sqrt_w <- function(f, weighting, K = 2) switch(weighting, none = rep(1, length(f)),
  relative = 1 / abs(f), poisson = 1 / sqrt(abs(f)), power = abs(f)^(-K / 2))

CTRL <- function(tol) nls.control(maxiter = 200, tol = tol, minFactor = 1e-14)

# Gauss-Newton polish of a converged nls fit (in place: the nls model object is a closure):
# nls stops at a relative-offset tolerance, which on noisy data cannot go much below 1e-8, while
# the minimum itself is determined to near machine precision. Steps are taken while the
# deviance does not rise beyond rounding.
polish <- function(fit) {
  m <- fit$m
  for (i in 1:20) {
    old <- m$getPars(); dev <- m$deviance()
    step <- m$incr()
    if (isTRUE(m$setPars(old + step))) { m$setPars(old); break }
    if (!(m$deviance() <= dev * (1 + 1e-12))) { m$setPars(old); break }
    if (max(abs(step) / pmax(abs(old), 1e-300)) < 1e-15) break
  }
  fit
}

# nls with the tightest relative-offset tolerance that converges, then polished.
nls_tight <- function(form, data, start) {
  for (tol in c(1e-8, 1e-6)) {
    fit <- tryCatch(if (is.null(data$.w)) nls(form, data = data, start = start, control = CTRL(tol))
                    else nls(form, data = data, start = start, control = CTRL(tol), weights = .w),
                    error = function(e) NULL)
    if (!is.null(fit)) return(polish(fit))
  }
  # Audit 4 S9: an ill-conditioned refit (a profile far from the optimum) that Gauss-Newton
  # can't take: the PORT routines, then polished as above.
  fit <- tryCatch(if (is.null(data$.w)) nls(form, data = data, start = start, control = CTRL(1e-8),
                                            algorithm = "port")
                  else nls(form, data = data, start = start, control = CTRL(1e-8),
                           algorithm = "port", weights = .w),
                  error = function(e) NULL)
  if (!is.null(fit) && isTRUE(fit$convInfo$isConv)) return(polish(fit))
  stop("nls did not converge")
}

# Fits one "block": either all data sets together (global, with shared params) or one data
# set. fixed: named scalar values held constant (bounds hit, profiling).
fit_block <- function(eq, cons, bnds, dsets, start, weighting, fixed = list(), power = 2,
                      el = NULL) {
  K <- length(dsets)
  P <- length(eq$params)
  map <- list(); free <- character(0); vec <- character(0)
  for (j in seq_len(P)) {
    nm <- eq$params[j]
    if (!is.null(fixed[[nm]])) { map[[nm]] <- lit(fixed[[nm]]); next }
    kind <- cons$kinds[j]
    if (kind == "constant") map[[nm]] <- lit(cons$values[j])
    else if (kind == "dataSetConstant") map[[nm]] <- nm
    else if (kind == "shared" || K == 1) { map[[nm]] <- nm; free <- c(free, nm) }
    else { map[[nm]] <- nm; free <- c(free, nm); vec <- c(vec, nm) }
  }
  f <- subst(eq$f, map)
  ind <- if (is.null(eq$ind)) NULL else subst(eq$ind, map)
  data <- data.frame(x = unlist(lapply(dsets, `[[`, "x")), y = unlist(lapply(dsets, `[[`, "y")),
                     g = rep(seq_len(K), times = vapply(dsets, function(d) length(d$x), 1L)))
  if (!is.null(dsets[[1]]$w)) data$.w <- unlist(lapply(dsets, `[[`, "w"))
  extra <- character(0)
  for (j in seq_len(P)) if (cons$kinds[j] == "dataSetConstant" && is.null(fixed[[eq$params[j]]])) {
    extra <- c(extra, eq$params[j])
    data[[eq$params[j]]] <- cons$dsc[[j]][data$g]
  }
  st <- list()
  for (nm in free) {
    j <- match(nm, eq$params)
    st[[nm]] <- if (nm %in% vec) start[, j] else mean(start[, j])
    if (!is.null(el) && nm == el$name) st[[nm]] <- st[[nm]][-el$k]
  }
  form <- model_formula(f, weighting, free, vec, K, ind, extra, power, el)
  lo <- bnds$lo[match(free, eq$params)]; hi <- bnds$hi[match(free, eq$params)]
  if (length(free) > 0 && (any(is.finite(lo)) || any(is.finite(hi)))) {
    # Find the optimum under the box, then refit with parameters on a bound held there.
    lov <- unlist(lapply(free, function(nm) rep(lo[match(nm, free)], length(st[[nm]]))))
    hiv <- unlist(lapply(free, function(nm) rep(hi[match(nm, free)], length(st[[nm]]))))
    pf <- nls(form, data = data, start = st, algorithm = "port", lower = lov, upper = hiv,
              control = list(maxiter = 1000))
    est <- coef(pf)
    hit <- list()
    for (nm in free) {
      if (nm %in% vec) next
      v <- est[[nm]]; j <- match(nm, eq$params)
      for (b in c(bnds$lo[j], bnds$hi[j])) {
        if (is.finite(b) && abs(v - b) <= 1e-7 * max(1, abs(b))) hit[[nm]] <- b
      }
    }
    start2 <- start
    for (nm in free) start2[, match(nm, eq$params)] <- est[[nm]]
    res <- fit_block(eq, cons, list(lo = rep(-Inf, P), hi = rep(Inf, P)), dsets, start2,
                     weighting, c(fixed, hit), power)
    res$atBound <- names(hit)
    return(res)
  }
  fit <- nls_tight(form, data, st)
  list(fit = fit, f = f, map = map, free = free, vec = vec, fixed = fixed, data = data,
       form = form, atBound = character(0), K = K)
}

# Value / SE of parameter nm in data set k of a block.
coef_name <- function(b, nm, k) if (nm %in% b$vec) paste0(nm, k) else nm

block_values <- function(b, eq, cons, k) {
  est <- coef(b$fit)
  vapply(seq_along(eq$params), function(j) {
    nm <- eq$params[j]
    if (!is.null(b$fixed[[nm]])) return(b$fixed[[nm]])
    if (cons$kinds[j] == "constant") return(cons$values[j])
    if (cons$kinds[j] == "dataSetConstant") return(cons$dsc[[j]][k])
    est[[coef_name(b, nm, k)]]
  }, 1)
}

# Parameter expression for data set k with numbers substituted for everything except the free
# parameters of that data set (named as plain symbols).
dataset_expr <- function(b, eq, cons, k) {
  map <- list()
  for (j in seq_along(eq$params)) {
    nm <- eq$params[j]
    if (!is.null(b$fixed[[nm]])) map[[nm]] <- lit(b$fixed[[nm]])
    else if (cons$kinds[j] == "constant") map[[nm]] <- lit(cons$values[j])
    else if (cons$kinds[j] == "dataSetConstant") map[[nm]] <- lit(cons$dsc[[j]][k])
  }
  subst(eq$f, map)
}

profile_ci <- function(b, eq, cons, bnds, dsets, start, weighting, level) {
  fit <- b$fit
  ss <- deviance(fit); df <- df.residual(fit)
  t <- qt(1 - (1 - level) / 2, df)
  target <- ss * (1 + t^2 / df)
  se <- sqrt(diag(vcov(fit)))
  est <- coef(fit)
  out <- list()
  K <- length(dsets)
  # Starting values at the best fit (per data set for per-data-set parameters).
  st <- start
  for (q in b$free) {
    j <- match(q, eq$params)
    st[, j] <- if (q %in% b$vec) unname(est[paste0(q, seq_len(K))]) else est[[q]]
  }
  for (nm in names(est)) {
    # Roadmap 51e: a coefficient of a per-data-set parameter (LogEC501...) in a global fit is that
    # data set's value; it is profiled holding it, every other parameter refitted.
    el <- NULL
    for (q in b$vec) {
      k <- suppressWarnings(as.integer(substring(nm, nchar(q) + 1)))
      if (startsWith(nm, q) && !is.na(k) && k >= 1 && k <= K) el <- list(name = q, k = k)
    }
    prof <- function(v) {
      pb <- if (is.null(el)) {
        fx <- b$fixed; fx[[nm]] <- v
        fit_block(eq, cons, bnds, dsets, st, weighting, fx)
      } else fit_block(eq, cons, bnds, dsets, st, weighting, b$fixed, el = c(el, value = v))
      deviance(pb$fit) - target
    }
    ends <- c()
    for (dir in c(-1, 1)) {
      step <- t * se[[nm]]
      inner <- est[[nm]]
      outer <- inner + dir * step
      # Audit 4 S9: a profile that never reaches the target (60 doublings, as nonlinear.ts) or
      # whose refits fail is not determined on that side: an infinite limit, where R's own
      # profile (confint) gives NA (checked below).
      # A refit that fails is retried closer in (half the step, up to 10 times, as nonlinear.ts).
      g <- function(v) tryCatch(prof(v), error = function(e) NA_real_)
      go <- g(outer)
      n <- 0
      repeat {
        h <- 0
        while (is.na(go) && h < 10) {
          step <- step / 2; outer <- inner + dir * step; go <- g(outer); h <- h + 1
        }
        if (is.na(go) || go >= 0 || n >= 60) break
        inner <- outer; step <- 2 * step; outer <- inner + dir * step; go <- g(outer); n <- n + 1
      }
      if (is.na(go) || go < 0) { ends <- c(ends, dir * Inf); next }
      r <- uniroot(prof, sort(c(inner, outer)), tol = 1e-14 * max(1, abs(est[[nm]])),
                   maxiter = 200)
      ends <- c(ends, r$root)
    }
    # Loose cross-check against R's own profile interval (spline interpolated, too coarse to
    # check a limit when the other is missing); an infinite limit only where R's profile finds
    # none either (NA).
    ci <- tryCatch(suppressWarnings(suppressMessages(confint(fit, parm = nm, level = level))),
                   error = function(e) NULL)
    if (!is.null(ci)) {
      ci <- unname(as.vector(ci))
      if (all(is.finite(ci))) stopifnot(isTRUE(all.equal(ci, ends, tolerance = 1e-2)))
      stopifnot(all(is.na(ci[!is.finite(ends)])))
    }
    out[[nm]] <- ends
  }
  out
}

fit_model <- function(input, eq_id, cons_raw, params, profile = FALSE) {
  eq <- EQ[[eq_id]]
  P <- length(eq$params)
  dsets <- lapply(seq_len(nrow(input$data)), function(k) {
    d <- list(x = input$data$x[[k]], y = input$data$y[[k]])
    if (!is.null(input$weights))
      d$w <- num(if (is.matrix(input$weights)) input$weights[k, ] else input$weights[[k]])
    d
  })
  power <- if (is.null(params$weightPower)) 2 else params$weightPower
  K <- length(dsets)
  cons <- constraint_list(cons_raw, P)
  bnds <- bounds_list(params$bounds, P)
  weighting <- if (is.null(params$weighting)) "none" else params$weighting
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  # start: K x P (jsonlite simplifies [[...], [...]] to a matrix, or a list for ragged input)
  start <- params$start
  if (is.list(start)) start <- do.call(rbind, lapply(start, num))
  start <- matrix(as.numeric(start), nrow = K)
  shared <- any(cons$kinds == "shared")
  blocks <- if (shared || K == 1) list(list(sets = seq_len(K))) else
    lapply(seq_len(K), function(k) list(sets = k))
  value <- se <- lo <- hi <- matrix(NaN, K, P)
  atBound <- matrix(FALSE, K, P)
  pd <- list(n = numeric(K), ss = numeric(K), df = numeric(K), syx = numeric(K), r2 = numeric(K))
  ss <- 0; df <- 0; n <- 0; nParams <- 0
  fits <- list()
  for (bi in seq_along(blocks)) {
    sets <- blocks[[bi]]$sets
    bc <- block_cons(cons, sets)
    b <- fit_block(eq, bc, bnds, dsets[sets], start[sets, , drop = FALSE], weighting, list(), power)
    b$cons <- bc
    fits[[bi]] <- b
    fit <- b$fit
    V <- vcov(fit)
    bdf <- df.residual(fit)
    t <- qt(1 - (1 - level) / 2, bdf)
    prof <- if (profile) profile_ci(b, eq, bc, bnds, dsets[sets], start[sets, , drop = FALSE],
                                    weighting, level) else NULL
    ss <- ss + deviance(fit); df <- df + bdf; n <- n + nrow(b$data)
    nParams <- nParams + length(coef(fit))
    for (local in seq_along(sets)) {
      k <- sets[local]
      v <- block_values(b, eq, bc, local)
      value[k, ] <- v
      used <- 0
      for (j in seq_len(P)) {
        nm <- eq$params[j]
        if (nm %in% b$atBound) atBound[k, j] <- TRUE
        if (cons$kinds[j] %in% c("constant", "dataSetConstant") || !is.null(b$fixed[[nm]])) next
        cn <- coef_name(b, nm, local)
        used <- used + 1
        se[k, j] <- sqrt(V[cn, cn])
        if (!is.null(prof)) { lo[k, j] <- prof[[cn]][1]; hi[k, j] <- prof[[cn]][2] }
        else { lo[k, j] <- v[j] - t * se[k, j]; hi[k, j] <- v[j] + t * se[k, j] }
      }
      d <- dsets[[k]]
      env <- as.list(setNames(v, eq$params)); env$x <- d$x; env$g <- local
      yhat <- eval(parse(text = eq$f)[[1]], with_ind(env, eq$ind))
      w <- sqrt_w(yhat, weighting, power)^2 * (if (is.null(d$w)) 1 else d$w)
      ssk <- sum(w * (d$y - yhat)^2)
      ybar <- sum(w * d$y) / sum(w)
      pd$n[k] <- length(d$x); pd$ss[k] <- ssk; pd$df[k] <- length(d$x) - used
      pd$syx[k] <- sqrt(ssk / pd$df[k]); pd$r2[k] <- 1 - ssk / sum(w * (d$y - ybar)^2)
    }
  }
  Kp <- nParams + 1
  list(eq = eq, cons = cons, blocks = blocks, fits = fits, shared = shared, weighting = weighting,
       level = level, dsets = dsets, power = power,
       out = list(status = "converged", value = value, se = se, lo = lo, hi = hi,
                  atBound = atBound, ss = ss, df = df, n = n, nParams = nParams,
                  aicc = n * log(ss / n) + 2 * Kp + 2 * Kp * (Kp + 1) / (n - Kp - 1),
                  perDataSet = pd))
}

band <- function(m, xs) {
  b <- m$fits[[1]]
  eq <- m$eq
  local <- 1
  v <- block_values(b, eq, b$cons, local)
  f1 <- dataset_expr(b, eq, b$cons, local)
  free <- intersect(eq$params[!(m$cons$kinds %in% c("constant", "dataSetConstant"))], b$free)
  free <- setdiff(free, names(b$fixed))
  env <- as.list(setNames(v, eq$params)); env$x <- xs; env$g <- 1
  d <- eval(deriv(parse(text = f1)[[1]], free), with_ind(env, eq$ind))
  G <- attr(d, "gradient")
  names_cov <- vapply(free, function(nm) coef_name(b, nm, local), "")
  V <- vcov(b$fit)[names_cov, names_cov, drop = FALSE]
  vy <- rowSums((G %*% V) * G)
  yhat <- as.vector(d)
  s2 <- deviance(b$fit) / df.residual(b$fit)
  t <- qt(1 - (1 - m$level) / 2, df.residual(b$fit))
  vp <- vy + s2 / sqrt_w(yhat, m$weighting)^2
  list(y = yhat, confLo = yhat - t * sqrt(vy), confHi = yhat + t * sqrt(vy),
       predLo = yhat - t * sqrt(vp), predHi = yhat + t * sqrt(vp))
}

oracle <- function(input, params) {
  m <- fit_model(input, params$equation, params$constraints, params, isTRUE(params$profileCI))
  out <- m$out
  if (!is.null(input$bandX)) out$band <- band(m, input$bandX)
  if (!is.null(params$compare) && isFALSE(params$compare$nested)) {
    # Roadmap 51e: models that aren't nested are compared by AICc only (no F test).
    cp <- params
    cp$bounds <- params$compare$bounds
    if (!is.null(params$compare$start)) cp$start <- params$compare$start
    s <- fit_model(input, params$compare$equation, params$compare$constraints, cp)$out
    out$compare <- list(aiccSimpler = s$aicc, aiccComplex = out$aicc,
                        probSimpler = 1 / (1 + exp((s$aicc - out$aicc) / 2)))
  } else if (!is.null(params$compare)) {
    cp <- params
    cp$bounds <- params$compare$bounds
    if (!is.null(params$compare$start)) cp$start <- params$compare$start
    s <- fit_model(input, params$compare$equation, params$compare$constraints, cp)$out
    dfn <- s$df - out$df
    F <- ((s$ss - out$ss) / dfn) / (out$ss / out$df)
    p <- pf(F, dfn, out$df, lower.tail = FALSE)
    if (length(m$fits) == 1) {
      sm <- fit_model(input, params$compare$equation, params$compare$constraints, cp)
      if (length(sm$fits) == 1) {
        a <- anova(sm$fits[[1]]$fit, m$fits[[1]]$fit)
        stopifnot(isTRUE(all.equal(a$`F value`[2], F, tolerance = 1e-8)),
                  isTRUE(all.equal(a$`Pr(>F)`[2], p, tolerance = 1e-8)))
      }
    }
    out$compare <- list(F = F, dfn = dfn, dfd = out$df, p = p, aiccSimpler = s$aicc,
                        aiccComplex = out$aicc,
                        probSimpler = 1 / (1 + exp((s$aicc - out$aicc) / 2)))
  }
  out
}
