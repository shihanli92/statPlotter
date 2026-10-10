# Nonlinear regression additions of roadmap 18: more weighting choices, Hougaard's skewness of
# weighted fits, Prism's test for appropriate weighting, and "is parameter P the same for every
# data set?" (extra sum-of-squares F test and AICc).
#
# Fits reuse nonlinear.R (nls with exact deriv() gradients, polished). params as nonlinear.R plus
#   weightPower   K of weighting "power" (1/Y^K)
#   compareShared parameter names shared by every data set in the null model; the alternative is
#                 the fit with the case's own constraints (compareFits(simpler = shared)).
# input: data = [{x, y}], weights = per data set fixed weights (1/X, 1/X^2, 1/SD^2), or absent.
#
# Hougaard (SAS PROC NLIN's formula as curvefit.R) for data set 1's block with the weights held
# at the solution: J~ = sqrt(w) J, H~ = sqrt(w) H, L = (J~'J~)^-1, mse = weighted SS / df,
# w = w(yhat) * fixed weight.
# Weighting test (Prism's Curve Fitting Guide, "Test for appropriate weighting/homoscedasticity"):
# per data set, Spearman r between |(y - yhat) sqrt(w)| and yhat; P as Prism's Spearman (exact
# for n <= 17 via pspearman, no ties in these cases; t approximation above, cor.test(exact =
# FALSE)).

PACKAGES <- c("pspearman")
suppressPackageStartupMessages(library(pspearman))

sys.source(file.path("r", "nonlinear.R"), envir = environment())

spearman_p <- function(a, b) {
  n <- length(a)
  if (n <= 17) {
    stopifnot(length(unique(a)) == n, length(unique(b)) == n)
    spearman.test(a, b, approximation = "exact")$p.value
  } else {
    suppressWarnings(cor.test(a, b, method = "spearman", exact = FALSE)$p.value)
  }
}

oracle <- function(input, params) {
  m <- fit_model(input, params$equation, params$constraints, params)
  out <- m$out
  eq <- m$eq
  # Hougaard, data set 1's block.
  b <- m$fits[[1]]
  sets <- m$blocks[[1]]$sets
  free <- names(coef(b$fit))
  q <- length(free)
  Js <- list(); Hs <- list()
  for (local in seq_along(sets)) {
    k <- sets[local]
    d <- m$dsets[[k]]
    v <- block_values(b, eq, b$cons, local)
    fk <- dataset_expr(b, eq, b$cons, local)
    # Free parameters of this data set as they are named in the block (Bottom2 ...).
    loc <- setdiff(intersect(eq$params, c(b$free)), names(b$fixed))
    env <- as.list(setNames(v, eq$params)); env$x <- d$x
    d3 <- eval(deriv3(parse(text = fk)[[1]], loc), with_ind(env, eq$ind))
    yhat <- as.vector(d3)
    sw <- sqrt_w(yhat, m$weighting, m$power) * (if (is.null(d$w)) 1 else sqrt(d$w))
    J <- matrix(0, length(d$x), q); H <- array(0, c(length(d$x), q, q))
    for (a in seq_along(loc)) {
      ca <- match(coef_name(b, loc[a], local), free)
      J[, ca] <- sw * attr(d3, "gradient")[, a]
      for (c2 in seq_along(loc)) {
        cb <- match(coef_name(b, loc[c2], local), free)
        H[, ca, cb] <- sw * attr(d3, "hessian")[, a, c2]
      }
    }
    Js[[local]] <- J; Hs[[local]] <- H
  }
  J <- do.call(rbind, Js)
  L <- solve(crossprod(J))
  mse <- deviance(b$fit) / df.residual(b$fit)
  W <- array(0, c(q, q, q))
  for (local in seq_along(Js)) for (j in 1:q) for (kk in 1:q) for (l in 1:q)
    W[j, kk, l] <- W[j, kk, l] + sum(Js[[local]][, j] * Hs[[local]][, kk, l])
  g1 <- vapply(1:q, function(i) {
    s <- 0
    for (j in 1:q) for (kk in 1:q) for (l in 1:q)
      s <- s + L[i, j] * L[i, kk] * L[i, l] * (W[j, kk, l] + W[kk, j, l] + W[l, kk, j])
    -mse^2 * s / (mse * L[i, i])^1.5
  }, 1)
  out$hougaard <- list(free = free, g1 = unname(g1))
  # Weighting test per data set.
  out$weightingTest <- lapply(seq_along(m$dsets), function(k) {
    d <- m$dsets[[k]]
    v <- out$value[k, ]
    env <- as.list(setNames(v, eq$params)); env$x <- d$x
    yhat <- eval(parse(text = eq$f)[[1]], with_ind(env, eq$ind))
    sw <- sqrt_w(yhat, m$weighting, m$power) * (if (is.null(d$w)) 1 else sqrt(d$w))
    a <- abs((d$y - yhat) * sw)
    list(r = cor(rank(a), rank(yhat)), p = spearman_p(a, yhat), n = length(a))
  })
  if (!is.null(params$compareShared)) {
    cons0 <- params$constraints
    for (nm in params$compareShared) cons0$kind[match(nm, eq$params)] <- "shared"
    s <- fit_model(input, params$equation, cons0, params)$out
    dfn <- s$df - out$df
    F <- ((s$ss - out$ss) / dfn) / (out$ss / out$df)
    out$compare <- list(F = F, dfn = dfn, dfd = out$df,
                        p = pf(F, dfn, out$df, lower.tail = FALSE),
                        aiccSimpler = s$aicc, aiccComplex = out$aicc,
                        probSimpler = 1 / (1 + exp((s$aicc - out$aicc) / 2)))
  }
  out
}
