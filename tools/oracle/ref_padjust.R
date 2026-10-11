# Multiplicity adjustments not in p.adjust(), written out from their definitions. Sourced by
# the padjust and multcomp suites; not a suite itself.

sidak_adj <- function(p, m) -expm1(m * log1p(-p))

# Holm-Sidak step-down (Holm 1979): adjusted p_(i) = max_{j <= i} 1 - (1 - p_(j))^(m - j + 1).
holm_sidak <- function(p, m = length(p)) {
  o <- order(p)
  a <- cummax(sidak_adj(p[o], m - seq_along(p) + 1))
  out <- numeric(length(p))
  out[o] <- pmin(1, a)
  out
}

# Two-stage linear step-up procedure (Benjamini, Krieger & Yekutieli 2006, Biometrika 93,
# Definition 6) at FDR level Q, for P values p padded with ones up to m hypotheses. Returns the
# rejection indicator of the supplied p.
bky_reject <- function(p, Q, m = length(p)) {
  pp <- c(p, rep(1, m - length(p)))
  step_up <- function(level) {
    o <- order(pp)
    ok <- which(pp[o] <= seq_len(m) * level / m)
    rej <- logical(m)
    if (length(ok)) rej[o[seq_len(max(ok))]] <- TRUE
    rej
  }
  q1 <- Q / (1 + Q)
  r1 <- sum(step_up(q1))
  if (r1 == 0) return(logical(length(p)))
  if (r1 == m) return(rep(TRUE, length(p)))
  m0 <- m - r1
  step_up(q1 * m / m0)[seq_along(p)]
}

# q value at FDR level Q (audit 3, RTA-1; decision 1084): the BH-adjusted
# P value (p.adjust) times (1 + Q) m0 / m, m0 = m - r1 from the first stage at Q / (1 + Q) (taken
# as 1 when the first stage rejects every hypothesis), capped at 1. No R function computes it;
# it reproduces every q value of Tawk et al. 2026's source data, and q <= Q exactly when
# bky_reject(p, Q) rejects (checked in multiple_t.R). (Before audit 3: the smallest Q at which
# the hypothesis is rejected, by bisection.)
bky_q <- function(p, Q, m = length(p)) {
  pp <- c(p, rep(1, m - length(p)))
  ok <- which(sort(pp) <= seq_len(m) * (Q / (1 + Q)) / m)
  r1 <- if (length(ok)) max(ok) else 0
  m0 <- max(1, m - r1)
  pmin(1, p.adjust(pp, "BH") * (1 + Q) * m0 / m)[seq_along(p)]
}
