# Reference values for the studentized range, Dunnett and studentized maximum modulus
# distributions by explicit numerical integration with R's integrate() (QUADPACK QAGS) at tight
# tolerances, over short pieces so no peak is missed. Sourced by the studentized_range, dunnett
# and multcomp suites; not a suite itself.
#
# Why: R's ptukey() is accurate to ~1e-8 at best (Copenhaver & Holland with fixed 16-point
# Gauss-Legendre panels), qtukey() only to ~1e-4 (documented), and mvtnorm's pmvt() is a
# randomised quasi-Monte Carlo method. These references are formulated independently of the
# TypeScript code's tabulation / quadrature and in R's own pnorm(), and are themselves
# cross-checked against ptukey() / mvtnorm in the suites.
#
# Formulas (sigma known): P(range <= w) = k int phi(z) (Phi(z) - Phi(z - w))^(k-1) dz
# (Hartley 1942); Dunnett (1955, eq. 2.2) with product correlation lambda_i lambda_j:
# P(max |Z_i| <= c) = int phi(z) prod_i [Phi((c - l_i z)/t_i) - Phi((-c - l_i z)/t_i)] dz,
# t_i = sqrt(1 - l_i^2). Studentized: E over S = chi_nu / sqrt(nu), integrated in u = log(S)
# with the analytically normalised density. Upper tails are integrated directly (positive
# integrands), not as 1 - lower.

REL <- 1e-13

# Sum of integrate() over consecutive pieces. A rough first pass sets an absolute tolerance
# of 1e-16 times the total, so pieces that contribute nothing are not refined forever.
pieces <- function(f, breaks) {
  run <- function(rel, abs) {
    s <- 0
    for (i in seq_len(length(breaks) - 1)) {
      # stop.on.error = FALSE: QAGS flags "roundoff error" when a piece is already at rounding
      # level; its value is still the best available.
      s <- s + integrate(f, breaks[i], breaks[i + 1], rel.tol = rel, abs.tol = abs,
                         subdivisions = 1000L, stop.on.error = FALSE)$value
    }
    s
  }
  rough <- run(1e-6, 0)
  run(REL, 1e-16 * abs(rough) / (length(breaks) - 1))
}

# P(a < Z < b), a <= b, taken in whichever tail avoids cancellation. Short intervals
# (half-width h < 0.25) use the Taylor series about the midpoint c,
#   P = phi(c) sum_{m >= 0} 2 He_{2m}(c) h^(2m+1) / (2m+1)!
# (He = probabilists' Hermite polynomials), since Phi(b) - Phi(a) cancels there.
band <- function(a, b) {
  c <- (a + b) / 2; h <- (b - a) / 2
  out <- ifelse(a >= 0, pnorm(a, lower.tail = FALSE) - pnorm(b, lower.tail = FALSE),
                ifelse(b <= 0, pnorm(b) - pnorm(a), 1 - pnorm(a) - pnorm(b, lower.tail = FALSE)))
  short <- h < 0.25
  if (any(short)) {
    cs <- c[short]; hs <- h[short]
    he0 <- rep(1, length(cs)); he1 <- cs         # He_0, He_1
    pw <- hs                                      # h^(m+1) / (m+1)! for m = 0
    total <- 2 * pw
    for (m in 1:60) {
      pw <- pw * hs / (m + 1)                     # h^(m+1) / (m+1)!
      if (m %% 2 == 0) total <- total + 2 * he1 * pw   # he1 holds He_m here
      he2 <- cs * he1 - m * he0                   # He_{m+1}
      he0 <- he1; he1 <- he2
    }
    out[short] <- dnorm(cs) * total
  }
  out
}

range_inf <- function(w, k, lower) {
  if (w <= 0) return(if (lower) 0 else 1)
  # P(range > w) < k^2 exp(-w^2 / 4) underflows beyond w = 60
  if (w > 60) return(if (lower) 1 else 0)
  m <- k - 1
  f <- if (lower) {
    function(z) {
      d <- band(z - w, z)
      ifelse(d > 0, k * dnorm(z) * exp(m * log(d)), 0)
    }
  } else {
    function(z) {
      lc <- pnorm(z, log.p = TRUE)
      r <- exp(pnorm(z - w, log.p = TRUE) - lc)
      l1 <- ifelse(r < 0.5, log1p(-r), log(band(z - w, z)) - lc)
      out <- k * dnorm(z) * exp(m * lc) * -expm1(m * l1)
      ifelse(is.finite(out), out, 0)
    }
  }
  pieces(f, seq(-12, w + 12, length.out = max(2, ceiling((w + 24) / 1.5)) + 1))
}

# E[g(S)], S = chi_nu / sqrt(nu), g vectorised over s. For a lower-tail g (increasing in s,
# vanishing like s^m at 0) the far left tail of log S contributes nothing and is not integrated
# (QAGS would otherwise chase rounding noise at the 1e-90 level there).
chi_mix <- function(g, nu, increasing = FALSE) {
  lc <- log(2) + (nu / 2) * log(nu / 2) - lgamma(nu / 2)
  f <- function(u) {
    s <- exp(u)
    d <- exp(lc + nu * u - nu * s^2 / 2)
    ifelse(d > 0, d * g(s), 0)
  }
  sd <- 1 / sqrt(2 * nu)
  lo <- if (increasing) -12 * sd - 10 / nu else min(-12 * sd, -70 / nu - 0.5)
  hi <- 12 * sd
  br <- sort(unique(c(seq(lo, -12 * sd, length.out = 12), seq(-12 * sd, hi, length.out = 25))))
  pieces(f, br)
}

ptukey_ref <- function(q, k, df, lower = TRUE) {
  if (is.infinite(df)) return(range_inf(q, k, lower))
  chi_mix(function(s) vapply(q * s, range_inf, 0, k = k, lower = lower), df, lower)
}

# lambda_i = sqrt(n_i / (n_i + n0)); `two` = two-sided.
dunnett_inf <- function(c, lam, two, lower) {
  tau <- sqrt(1 - lam^2)
  loginside <- function(z) {
    s <- 0
    for (i in seq_along(lam)) {
      hi <- (c - lam[i] * z) / tau[i]
      if (two) {
        lo <- (-c - lam[i] * z) / tau[i]
        out <- pnorm(hi, lower.tail = FALSE) + pnorm(lo)
        s <- s + ifelse(out < 0.5, log1p(-out), log(band(lo, hi)))
      } else {
        s <- s + pnorm(hi, log.p = TRUE)
      }
    }
    s
  }
  f <- if (lower) function(z) dnorm(z) * exp(loginside(z))
       else function(z) dnorm(z) * -expm1(loginside(z))
  pieces(f, seq(-12, 12 + c, length.out = 49))
}

pdunnett_ref <- function(t, df, n0, n, two = TRUE, lower = FALSE) {
  lam <- sqrt(n / (n + n0))
  if (is.infinite(df)) return(dunnett_inf(t, lam, two, lower))
  chi_mix(function(s) vapply(t * s, dunnett_inf, 0, lam = lam, two = two, lower = lower), df,
          lower && t > 0)
}

# Studentized maximum modulus: P(max_{i<=k} |Z_i| / S >= m).
psmm_ref <- function(m, k, df) {
  g <- function(s) -expm1(k * log1p(-2 * pnorm(m * s, lower.tail = FALSE)))
  if (is.infinite(df)) return(g(1))
  chi_mix(g, df)
}

# Quantile of an upper-tail function by uniroot on the log scale.
upper_quantile <- function(upper, alpha, start) {
  f <- function(x) log(upper(exp(x))) - log(alpha)
  uniroot(f, c(log(start) - 2, log(start) + 2), tol = 1e-14, extendInt = "downX")$root |> exp()
}
