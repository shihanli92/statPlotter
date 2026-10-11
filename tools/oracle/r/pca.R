# Principal component analysis:
#
# - standardize = TRUE: prcomp(scale. = TRUE) ("PCA on standardized data", the recommended
#   default; SD with n - 1). FALSE: prcomp(scale. = FALSE) ("centered data"). Cross-checked
#   against eigen(cor(X)) / eigen(cov(X)).
# - eigenvalues = sdev^2 (covariance / correlation matrix, divisor n - 1), padded with 0 to p.
#   Values with sdev <= sdev[1] * max(n, p) * 2^-52 are set to exactly 0 (rank deficiency), as
#   in the TS code; rank = number of non-zero eigenvalues.
# - loadings = eigenvector * sqrt(eigenvalue) ("Loadings = Eigenvector * sqrt(Eigenvalue)").
# - scores = standardized / centered data %*% eigenvectors (prcomp's x).
# - Sign convention (ours): each eigenvector is flipped so that its
#   elements sum to a positive number; if |sum| <= 1e-8, its first element with |v| > 1e-8 is
#   made positive.
# - Selection: kaiser: eigenvalues > value (default 1); variance: smallest k with cumulative
#   proportion >= value / 100 (default 75); fixed: value (default 2); all: rank; parallel:
#   leading components whose eigenvalue exceeds the simulated upper percentile. Always <= rank.
# - Parallel analysis (Horn): `simulations` data sets (default 1000) of
#   n x p normals with mean 0 and each variable's SD, analysed as the data; per component the
#   mean, the upper percentile (value, default 95) and the lower percentile (100 - value) of
#   the simulated eigenvalues. Percentiles by quantile(type = 6), as our other percentiles
#   (a choice). Deterministic: the normals are R's own
#   set.seed(seed, kind = "L'Ecuyer-CMRG", normal.kind = "Inversion"); rnorm(n * p) filling a
#   matrix column by column; the TS code reproduces that generator bit for bit
#   (packages/stats/src/gpl/rngLecuyer.ts). Default seed 1.
# Eigenvectors, loadings and scores are compared only for the first `vectorsK` components (the
# ones with distinct, non-zero eigenvalues); the rest are arbitrary.

PACKAGES <- character(0)

fix_sign <- function(v) {
  s <- sum(v)
  if (abs(s) > 1e-8) return(sign(s))
  sign(v[which(abs(v) > 1e-8)[1]])
}

pca_eigen <- function(X, standardize) {
  n <- nrow(X); p <- ncol(X)
  pr <- prcomp(X, center = TRUE, scale. = standardize)
  d <- pr$sdev * sqrt(n - 1)
  k <- length(d)
  cutoff <- d[1] * max(n, p) * 2^-52
  ev <- c(ifelse(d <= cutoff, 0, pr$sdev^2), rep(0, p - k))
  list(values = ev, rotation = pr$rotation, x = pr$x, center = pr$center)
}

oracle <- function(input, params) {
  X <- input$X
  storage.mode(X) <- "double"
  n <- nrow(X); p <- ncol(X)
  # Shift each column by its first value (exact for clustered data such as 1e9 + noise; PCA is
  # shift-invariant), so centering does not lose digits to the rounding of the mean.
  X0 <- sweep(X, 2, X[1, ])
  std <- if (is.null(params$standardize)) TRUE else isTRUE(params$standardize)
  sel <- params$select
  e <- pca_eigen(X0, std)
  ev <- e$values
  ref <- eigen(if (std) cor(X0) else cov(X0), symmetric = TRUE)$values
  stopifnot(all(abs(ev - pmax(ref, 0)) <= 1e-9 * max(ref)))
  rank <- sum(ev > 0)
  prop <- ev / sum(ev)
  cum <- cumsum(prop)
  # Components with a non-zero eigenvalue distinct from its neighbours.
  gaps <- sapply(seq_len(rank), function(i) {
    others <- ev[-i]
    length(others) == 0 || min(abs(others - ev[i])) > 1e-6 * ev[1]
  })
  vk <- if (rank == 0) 0 else { w <- which(!gaps); if (length(w)) w[1] - 1 else rank }
  vk <- min(vk, ncol(e$rotation))
  V <- e$rotation[, seq_len(vk), drop = FALSE]
  S <- e$x[, seq_len(vk), drop = FALSE]
  for (k in seq_len(vk)) {
    s <- fix_sign(V[, k]); V[, k] <- s * V[, k]; S[, k] <- s * S[, k]
  }
  L <- sweep(V, 2, sqrt(ev[seq_len(vk)]), "*")
  Z <- scale(X0, center = TRUE, scale = std)
  stopifnot(max(abs(Z %*% V - S)) < 1e-9 * max(1, abs(S)))
  if (std) stopifnot(max(abs(L - cor(X0, S))) < 1e-9)

  method <- sel$method
  value <- sel$value
  parallel <- NULL
  selected <- switch(method,
    kaiser = sum(ev > (if (is.null(value)) 1 else value)),
    variance = {
      target <- (if (is.null(value)) 75 else value) / 100
      w <- which(cum >= target * (1 - 1e-12)); if (length(w)) w[1] else p
    },
    fixed = floor(if (is.null(value)) 2 else value),
    all = rank,
    parallel = {
      sims <- if (is.null(sel$simulations)) 1000 else sel$simulations
      seed <- if (is.null(sel$seed)) 1 else sel$seed
      level <- if (is.null(value)) 95 else value
      sds <- apply(X0, 2, sd)
      set.seed(seed, kind = "L'Ecuyer-CMRG", normal.kind = "Inversion")
      E <- matrix(0, sims, p)
      for (s in seq_len(sims)) {
        Y <- sweep(matrix(rnorm(n * p), n, p), 2, sds, "*")
        E[s, ] <- pca_eigen(Y, std)$values
      }
      RNGkind("default", "default", "default")
      parallel <- list(
        mean = I(colMeans(E)),
        percentile = I(apply(E, 2, quantile, probs = level / 100, type = 6, names = FALSE)),
        lower = I(apply(E, 2, quantile, probs = 1 - level / 100, type = 6, names = FALSE)),
        level = level, simulations = sims, seed = seed)
      k <- 0
      while (k < p && ev[k + 1] > parallel$percentile[k + 1]) k <- k + 1
      k
    })
  selected <- min(selected, rank)
  unname_m <- function(M) { dimnames(M) <- NULL; M }
  out <- list(
    eigenvalues = I(ev), proportion = I(prop), cumulative = I(cum),
    eigenvectors = unname_m(V), loadings = unname_m(L), scores = unname_m(S),
    selected = selected, rank = rank,
    means = I(unname(colMeans(X))), sds = I(unname(apply(X0, 2, sd))), n = n,
    standardized = std, vectorsK = vk)
  if (!is.null(parallel)) out$parallel <- parallel
  out
}
