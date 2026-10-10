# Shared helpers for the rmanova and mixed suites (not a suite itself):
#   - multiple-comparison P values and CIs from (diff, SE, df) rows, for every method;
#   - a fast Dunnett reference for product correlation and non-integer df;
#   - a dense REML fitter for independent variance components with Satterthwaite df, used as
#     the high-precision reference for lme4/lmerTest (see mixed.R).

source(file.path(ORACLE_DIR, "ref_padjust.R"))

# params$comparisons arrives as a data.frame (jsonlite simplification): one list per spec,
# without the NA fields of specs that do not set them.
as_specs <- function(x) {
  if (is.null(x) || length(x) == 0) return(list())
  if (!is.data.frame(x)) return(x)
  lapply(seq_len(nrow(x)), function(i) {
    e <- lapply(as.list(x[i, , drop = FALSE]), function(v) if (is.list(v)) v[[1]] else v)
    e[!vapply(e, function(v) length(v) == 1 && is.atomic(v) && is.na(v), TRUE)]
  })
}

# ---- Dunnett's distribution, product correlation lambda_i lambda_j ----------------------------
# P(max_i |T_i| >= t), T_i = Z_i / S, Z_i = lambda_i Z_0 + tau_i E_i, S = chi_df / sqrt(df)
# (Dunnett 1955, product correlation). Double integral over z (the shared normal, z >= 0 by
# symmetry) and u = log S, both by composite 20-point Gauss-Legendre on many short panels:
#   P = int f_U(u) * 2 int_0^inf phi(z) (1 - prod_i P_i(c e^u, z)) dz du,
#   P_i(c, z) = Phi((c - l_i z)/t_i) - Phi((-c - l_i z)/t_i), f_U(u) = 2 df e^{2u} dchisq(df e^{2u}).
# The upper tail is integrated directly (-expm1 of a sum of logs). Checked against a nested
# integrate() version (1e-11) and mvtnorm::pmvt (within its error) when written.
gl_nodes <- function(n) {
  b <- seq_len(n - 1) / sqrt(4 * seq_len(n - 1)^2 - 1)
  e <- eigen(matrix(0, n, n) + diag(0, n) + {m <- matrix(0, n, n); m[cbind(1:(n - 1), 2:n)] <- b;
    m[cbind(2:n, 1:(n - 1))] <- b; m}, symmetric = TRUE)
  list(x = e$values, w = 2 * e$vectors[1, ]^2)
}
GL20 <- gl_nodes(20)
composite <- function(breaks) {
  a <- head(breaks, -1); b <- tail(breaks, -1)
  x <- as.vector(outer(GL20$x, seq_along(a), function(xi, j) (a[j] + b[j]) / 2 + (b[j] - a[j]) / 2 * xi))
  w <- as.vector(outer(GL20$w, seq_along(a), function(wi, j) (b[j] - a[j]) / 2 * wi))
  list(x = x, w = w)
}
ZQ <- composite(seq(0, 13, by = 1))
pdun <- function(t, df, lam) {
  c0 <- abs(t)
  if (length(lam) == 1) return(2 * pt(-c0, df))
  tau <- sqrt(1 - lam^2)
  inner <- function(cs) {  # vector of c values -> P(max |Z_i| > c)
    L <- matrix(0, length(ZQ$x), length(cs))
    for (i in seq_along(lam)) {
      hi <- outer(-lam[i] * ZQ$x, cs, "+") / tau[i]
      lo <- outer(-lam[i] * ZQ$x, -cs, "+") / tau[i]
      L <- L + log(pnorm(hi) - pnorm(lo))
    }
    2 * colSums(ZQ$w * dnorm(ZQ$x) * -expm1(L))
  }
  if (is.infinite(df)) return(inner(c0))
  sdv <- 1 / sqrt(2 * df)
  UQ <- composite(seq(-12 * sdv - 36 / df, 12 * sdv + 0.5, length.out = 81))
  s <- exp(UQ$x)
  fu <- 2 * df * s^2 * dchisq(df * s^2, df)
  sum(UQ$w * fu * inner(c0 * s))
}
MEMO <- new.env()
memo <- function(key, f) {
  if (is.null(MEMO[[key]])) assign(key, f(), envir = MEMO)
  MEMO[[key]]
}
qdun <- function(level, df, lam) memo(paste("qdun", level, df, paste(lam, collapse = ","),
                                            sep = ":"), function() qdun_(level, df, lam))
qdun_ <- function(level, df, lam) {
  # bracket between the Sidak and the single-comparison critical values
  m <- length(lam)
  lo <- qt(1 - (1 - level) / 2, df); hi <- qt(1 - (-expm1(log1p(-(1 - level)) / m)) / 2, df)
  uniroot(function(x) pdun(x, df, lam) - (1 - level), c(lo, hi * 1.0001), tol = 1e-13,
          extendInt = "yes")$root
}

# Tukey critical value: root of the ptk reference (below; R's qtukey is good to only ~1e-4).
qtk <- function(level, k, df) memo(paste("qtk", level, k, df, sep = ":"), function() qtk_(level, k, df))
qtk_ <- function(level, k, df) {
  q0 <- qtukey(level, k, df)  # good to ~1e-4: a tight bracket
  uniroot(function(x) ptk(x, k, df) - (1 - level), q0 * c(0.995, 1.005), tol = 1e-13,
          extendInt = "yes")$root
}

# Absolute tolerance for comparison P values (ptk and pdun agree with the nested integrate()
# references of ref_integrals.R to ~1e-14; the TS distributions are checked to ~1e-11).
tol_p <- function(method, df) 1e-10

# f evaluated once per distinct df (df may be non-integer).
per_df <- function(df, f) {
  u <- unique(df)
  v <- vapply(u, f, 0)
  v[match(df, u)]
}

# P values and CIs for one family. rows: diff, se, df (vectors); method; k = means in the
# family (Tukey); m = family size; lam = Dunnett product-correlation factors.
mc_family <- function(diff, se, df, method, k = NULL, m = length(diff), lam = NULL,
                      level = 0.95) {
  t <- diff / se
  alpha <- 1 - level
  raw <- 2 * pt(-abs(t), df)
  crit <- rep(NaN, length(t))
  stat <- t
  p <- switch(method,
    tukey = {
      stat <- sqrt(2) * t
      crit <- per_df(df, function(d) qtk(level, k, d)) / sqrt(2)
      mapply(function(q, d) ptk(q, k, d), sqrt(2) * abs(t), df)
    },
    dunnett = {
      crit <- per_df(df, function(d) qdun(level, d, lam))
      mapply(function(x, d) pdun(x, d, lam), t, df)
    },
    bonferroni = {
      crit <- qt(1 - alpha / (2 * m), df)
      pmin(1, m * raw)
    },
    sidak = {
      crit <- qt(1 - (-expm1(log1p(-alpha) / m)) / 2, df)
      pmin(1, sidak_adj(raw, m))
    },
    "holm-sidak" = holm_sidak(raw, m),
    fisher = {
      crit <- qt(1 - alpha / 2, df)
      raw
    },
    bky = bky_q(raw, 0.05, m),  # Q = the significance level, 0.05
    stop("unknown method ", method))
  list(diff = diff, se = se, df = df, t = t, stat = stat, p = p, lo = diff - crit * se,
       hi = diff + crit * se)
}

# Product-correlation fit, as the TS code (rmCompare.ts productLambdas): least squares on
# log R_ij = log l_i + log l_j.
product_lambdas <- function(R) {
  k <- nrow(R)
  clamp <- function(l) pmin(pmax(l, 0.01), 0.99)
  if (k == 1) return(sqrt(0.5))
  L <- log(pmax(abs(R), 1e-12))
  if (k == 2) return(clamp(rep(exp(0.5 * L[1, 2]), 2)))
  r <- rowSums(L) - diag(L)
  S <- sum(r) / (2 * k - 2)
  clamp(exp((r - S) / (k - 2)))
}

# ---- Dense REML for variance components --------------------------------------------------------
# y = X b + sum_t Z_t u_t + e, V = s2 (I + sum_t rho_t Z_t Z_t'). Profiled REML criterion
# d(rho) = (N - p) log(y'Py) + log|W| + log|X'W^-1 X| with its analytic gradient and Hessian
# (Harville 1977), minimised by Newton from a start (lme4's estimate) with rho >= 0; components
# whose gradient points outward at 0 stay at 0. Dense N x N algebra: an independent
# implementation of what the TS code does block-wise.
reml_dense <- function(y, X, Zs, start) {
  N <- length(y); p <- ncol(X); m <- length(Zs)
  G <- lapply(Zs, tcrossprod)
  ev <- function(rho) {
    W <- diag(N)
    for (t in seq_len(m)) W <- W + rho[t] * G[[t]]
    Wi <- solve(W)
    M <- crossprod(X, Wi %*% X)
    Mi <- solve(M)
    P <- Wi - Wi %*% X %*% Mi %*% t(X) %*% Wi
    P <- (P + t(P)) / 2
    Py <- drop(P %*% y)
    yPy <- sum(y * Py)
    dev <- (N - p) * log(yPy) + determinant(W)$modulus + determinant(M)$modulus
    a <- vapply(G, function(g) sum(Py * (g %*% Py)), 0)
    PG <- lapply(G, function(g) P %*% g)
    grad <- -(N - p) * a / yPy + vapply(PG, function(x) sum(diag(x)), 0)
    H <- matrix(0, m, m)
    for (i in seq_len(m)) for (j in seq_len(m)) {
      H[i, j] <- (N - p) * (2 * sum(Py * (G[[i]] %*% PG[[j]] %*% Py)) / yPy - a[i] * a[j] / yPy^2) -
        sum(PG[[i]] * t(PG[[j]]))
    }
    list(dev = as.numeric(dev), grad = grad, H = H, P = P, W = W, M = M, Mi = Mi, yPy = yPy)
  }
  rho <- pmax(start, 0)
  for (it in 1:100) {
    e <- ev(rho)
    free <- !(rho == 0 & e$grad >= 0)
    if (!any(free)) break
    step <- rep(0, m)
    step[free] <- -solve(e$H[free, free, drop = FALSE], e$grad[free])
    a <- 1
    repeat {
      trial <- pmax(rho + a * step, 0)
      if (ev(trial)$dev <= e$dev + 1e-14 * abs(e$dev) || a < 1e-10) break
      a <- a / 2
    }
    done <- max(abs(trial - rho) / (1 + rho)) < 1e-15
    rho <- trial
    if (done) break
  }
  e <- ev(rho)
  s2 <- e$yPy / (N - p)
  beta <- drop(e$Mi %*% crossprod(X, solve(e$W, y)))
  list(rho = rho, s2 = s2, beta = beta, cov = s2 * e$Mi, grad = e$grad, e = e, G = G, X = X,
       y = y, N = N, p = p,
       logLik = -0.5 * ((N - p) * (1 + log(2 * pi * s2)) + as.numeric(determinant(e$W)$modulus) +
                          as.numeric(determinant(e$M)$modulus)))
}

# Satterthwaite df for contrasts (rows of L), with the observed REML information in
# theta = (s2 * rho_t for rho_t > 0, s2), V_a = G_t or I, as lmerTest (which differentiates
# numerically in its own parameterisation; equal at an interior optimum).
satt_dense <- function(f, L) {
  L <- rbind(L)
  free <- which(f$rho > 0)
  s2 <- f$s2
  V <- s2 * f$e$W
  Vi <- solve(V)
  X <- f$X
  C <- solve(crossprod(X, Vi %*% X))
  P <- Vi - Vi %*% X %*% C %*% t(X) %*% Vi
  Va <- c(f$G[free], list(diag(f$N)))
  n <- length(Va)
  Py <- drop(P %*% f$y)
  I <- matrix(0, n, n)
  for (a in 1:n) for (b in 1:n) {
    I[a, b] <- sum(Py * (Va[[a]] %*% P %*% Va[[b]] %*% Py)) -
      0.5 * sum((P %*% Va[[a]]) * t(P %*% Va[[b]]))
  }
  A <- solve(I)
  apply(L, 1, function(l) {
    g <- vapply(Va, function(va) drop(t(l) %*% C %*% t(X) %*% Vi %*% va %*% Vi %*% X %*% C %*% l), 0)
    v <- drop(t(l) %*% C %*% l)
    2 * v^2 / drop(t(g) %*% A %*% g)
  })
}

# lmerTest's multi-df F: eigen-decomposition of L C L', nu per eigen-contrast, combined.
satt_F <- function(f, L) {
  VL <- L %*% f$cov %*% t(L)
  e <- eigen(VL, symmetric = TRUE)
  q <- sum(e$values > sqrt(.Machine$double.eps) * e$values[1])
  PtL <- crossprod(e$vectors, L)[1:q, , drop = FALSE]
  Fv <- sum(drop(PtL %*% f$beta)^2 / e$values[1:q]) / q
  nu <- satt_dense(f, PtL)
  ddf <- if (q == 1) nu else if (all(abs(diff(nu)) < 1e-8)) mean(nu) else if (any(nu <= 2)) 2 else {
    E <- sum(nu / (nu - 2)); 2 * E / (E - q)
  }
  list(F = Fv, dfn = q, dfd = ddf)
}

# Containment df (SAS DDFM=CONTAIN): smallest drop in rank([X Z]) when a containing random
# term is removed; residual df N - rank([X Z]) when nothing contains the effect.
containment <- function(X, Zs, containing = integer(0)) {
  rk <- function(M) qr(M, tol = 1e-9)$rank
  full <- rk(do.call(cbind, c(list(X), Zs)))
  if (length(containing) == 0) return(nrow(X) - full)
  min(vapply(containing, function(t) full - rk(do.call(cbind, c(list(X), Zs[-t]))), 0))
}

# ---- Studentized range, by the same composite Gauss-Legendre scheme ---------------------------
# P(Q >= q) = int f_U(u) P_inf(q e^u) du with the known-variance upper tail
# P_inf(w) = k int phi(z) [Phi(z)^(k-1) - (Phi(z) - Phi(z - w))^(k-1)] dz (Hartley 1942), z the
# largest of k standard normals. Replaces R's ptukey, which is good to only ~1e-5 at df < 5.
ZT <- composite(seq(-9, 9, by = 0.5))
ptk_inf <- function(ws, k) {
  Pz <- pnorm(ZT$x)
  M <- Pz - pnorm(outer(ZT$x, ws, "-"))
  M[M < 0] <- 0
  k * colSums(ZT$w * dnorm(ZT$x) * (Pz^(k - 1) - M^(k - 1)))
}
ptk <- function(q, k, df) {
  if (is.infinite(df)) return(ptk_inf(q, k))
  sdv <- 1 / sqrt(2 * df)
  UQ <- composite(seq(-12 * sdv - 36 / df, 12 * sdv + 0.5, length.out = 81))
  s <- exp(UQ$x)
  sum(UQ$w * 2 * df * s^2 * dchisq(df * s^2, df) * ptk_inf(q * s, k))
}
