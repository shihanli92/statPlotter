# Identify outliers (Prism: "How to: Identify outliers"). input$values (null = empty);
# params$method: grubbs, grubbsIterative (alpha) or rout (q, a fraction).
#
# Grubbs (two-sided; Grubbs 1969): G = max|x - mean|/sd; critical value
# (n-1)/sqrt(n) * sqrt(t^2/(n-2+t^2)) with t = qt(alpha/(2n), n-2, upper); P = min(1, 2n
# pt(tG, n-2, upper)), tG = sqrt(n(n-2)G^2/((n-1)^2 - nG^2)). Iterative: remove and repeat.
# The same statistic as outliers::grubbs.test(type = 10, two.sided = TRUE), whose P uses the
# same Bonferroni bound.
#
# ROUT (Motulsky & Brown 2006) with a constant model (K = 1): no standard R implementation
# exists (OptimModel::rout_fitter fits a Cauchy likelihood with its own scale instead of the
# paper's RSDR-scaled Lorentzian and tests every point), so this is a reference
# implementation of the procedure described in stats/src/outliers/outliers.ts, written
# separately: the Lorentzian location for a fixed RSDR is found with optimize() on a small
# bracket around the reweighted-means solution and must agree with it; the fixed point
# (location, RSDR) is iterated to convergence; the FDR test uses p.adjust("BH")-style
# thresholds over the top 30% of |residuals|. Tolerance 1e-9 (iterative solutions).

PACKAGES <- character(0)

grubbs_step <- function(v, alpha) {
  n <- length(v)
  m <- mean(v); s <- sd(v)
  i <- which.max(abs(v - m))
  G <- abs(v[i] - m) / s
  tc <- qt(alpha / (2 * n), n - 2, lower.tail = FALSE)
  crit <- (n - 1) / sqrt(n) * sqrt(tc^2 / (n - 2 + tc^2))
  den <- (n - 1)^2 - n * G^2
  tG <- if (den > 0) sqrt(n * (n - 2) * G^2 / den) else Inf
  p <- min(1, 2 * n * pt(tG, n - 2, lower.tail = FALSE))
  list(i = i, n = n, mean = m, sd = s, G = G, critical = crit, p = p, outlier = G > crit)
}

q6 <- function(v, p) unname(quantile(v, p, type = 6))

rsdr <- function(y, mu) q6(abs(y - mu), 0.6827) * length(y) / (length(y) - 1)

loc_irls <- function(y, s, mu) {
  for (it in 1:10000) {
    w <- 1 / (1 + ((y - mu) / s)^2)
    nx <- mu + sum(w * (y - mu)) / sum(w)
    if (abs(nx - mu) <= 1e-15 * (abs(mu) + s) || nx == mu) return(nx)
    mu <- nx
  }
  mu
}

rout_ref <- function(y, q) {
  n <- length(y)
  mu <- median(y)
  s <- rsdr(y, mu)
  for (it in 1:1000) {
    if (!(s > 0)) break
    nx <- loc_irls(y, s, mu)
    # cross-check: a local minimum of the merit function near nx
    f <- function(m) sum(log1p(((y - m) / s)^2))
    opt <- optimize(f, nx + c(-1, 1) * 1e-3 * s, tol = 1e-12)
    stopifnot(abs(opt$minimum - nx) < 1e-6 * s)
    sn <- rsdr(y, nx)
    done <- abs(nx - mu) <= 1e-14 * (abs(mu) + s) && abs(sn - s) <= 1e-14 * s
    mu <- nx; s <- sn
    if (done) break
  }
  r <- y - mu
  t <- abs(r) / s
  p <- 2 * pt(t, n - 1, lower.tail = FALSE)
  o <- order(-abs(r), seq_along(r))
  m <- max(1, floor(0.3 * n))
  last <- 0
  for (j in seq_len(m)) if (p[o[j]] < q * j / n) last <- j
  list(center = mu, rsdr = s, p = p, outliers = if (last) o[seq_len(last)] - 1 else integer(0),
       candidates = m)
}

oracle <- function(input, params) {
  v0 <- as.numeric(input$values)
  idx <- which(!is.na(v0))
  if (params$method == "rout") {
    r <- rout_ref(v0[idx], params$q)
    r$outliers <- idx[r$outliers + 1] - 1
    return(r)
  }
  steps <- list(); out <- integer(0)
  cur <- idx
  repeat {
    if (length(cur) < 3) break
    st <- grubbs_step(v0[cur], params$alpha)
    st$index <- cur[st$i] - 1
    st$i <- NULL
    steps[[length(steps) + 1]] <- st
    if (!st$outlier) break
    out <- c(out, st$index)
    cur <- setdiff(cur, st$index + 1)
    if (params$method == "grubbs") break
  }
  list(outliers = out,
       G = vapply(steps, `[[`, 0, "G"), critical = vapply(steps, `[[`, 0, "critical"),
       p = vapply(steps, `[[`, 0, "p"), mean = vapply(steps, `[[`, 0, "mean"),
       sd = vapply(steps, `[[`, 0, "sd"), index = vapply(steps, `[[`, 0, "index"))
}
