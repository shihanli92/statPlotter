# Multiple t tests (and nonparametric tests), one per row of a grouped table, then a correction
# for multiple comparisons across the rows. input$rows: [{a, b}] (NA = empty cell; paired tests
# pair a[i] with b[i]). The effect is B - A.
#
# Per row (params$method):
#   welch / unpaired   t.test(b, a, var.equal = FALSE / TRUE); SE = $stderr
#   pooled             one SD pooled across every row with a value in each group: the residual
#                      mean square of lm(y ~ row * group) on those rows (checked against the
#                      explicit sum), each row's contrast from emmeans(~ group | row) with that
#                      pooled error (t, df, P cross-checked with the explicit formulas)
#   paired             t.test(b, a, paired = TRUE) on complete pairs
#   lognormal          the same on log10 values (paired = the ratio t test); geometric means,
#                      ratio = 10^diff
#   mannWhitney / wilcoxon / kolmogorovSmirnov   the mannwhitney, wilcoxon and ks suites' oracles
#                      (exact "auto"); diff = median(b) - median(a) (wilcoxon: median of b - a)
# Lognormal (audit 3, RTA-2): values <= 0 (paired: the pairs holding one) are left out of their
# row, which is tested when at least two values (pairs) per group remain; leftOut counts them.
# Rows that can't be tested (as the TS rules: too few values, SD 0, values <= 0 on a log scale)
# have skip = TRUE and P = NaN.
#
# Family (params$family, P values of the tested rows): bky / bh / by at Q = params$q (a
# fraction): q values = bky_q (ref_padjust.R) / p.adjust("BH" / "BY"); discoveries from the
# procedures run at Q (bky_reject; BH/BY step-up written out). holm-sidak / sidak / bonferroni:
# adjusted P (ref_padjust.R, p.adjust), flagged when < alpha. m0 (bky) = m - r1 at Q / (1 + Q).

source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- c("coin", "emmeans")

suite_env <- function(name) {
  env <- new.env()
  sys.source(file.path(ORACLE_DIR, "r", paste0(name, ".R")), envir = env)
  env
}
MW <- suite_env("mannwhitney")
WX <- suite_env("wilcoxon")
KS <- suite_env("ks")

rows_of <- function(x) {
  if (is.data.frame(x)) lapply(seq_len(nrow(x)), function(i) list(a = unlist(x$a[[i]]),
                                                                  b = unlist(x$b[[i]])))
  else x
}
num <- function(v) as.numeric(v)

skip_row <- function(nA = 0, nB = 0) list(skip = TRUE, nA = nA, nB = nB, centerA = NaN,
                                          centerB = NaN, diff = NaN, se = NaN, stat = NaN,
                                          df = NaN, p = NaN)

step_up <- function(p, level) {
  m <- length(p)
  o <- order(p)
  ok <- which(p[o] <= seq_len(m) * level / m)
  rej <- logical(m)
  if (length(ok)) rej[o[seq_len(max(ok))]] <- TRUE
  rej
}

family <- function(p, params) {
  method <- params$family
  q <- if (is.null(params$q)) 0.01 else params$q
  alpha <- if (is.null(params$alpha)) 0.05 else params$alpha
  ok <- !is.na(p)
  pp <- p[ok]
  m <- length(pp)
  adj <- rep(NaN, length(p)); flag <- rep(FALSE, length(p))
  out <- list(m = m)
  if (m == 0) return(c(out, list(adjusted = adj, flagged = flag)))
  if (method == "none") {
    adj[ok] <- pp; flag[ok] <- pp < alpha
  } else if (method %in% c("bky", "bh", "by")) {
    adj[ok] <- switch(method, bky = bky_q(pp, q), bh = p.adjust(pp, "BH"), by = p.adjust(pp, "BY"))
    flag[ok] <- switch(method, bky = bky_reject(pp, q), bh = step_up(pp, q),
                       by = step_up(pp, q / sum(1 / seq_len(m))))
    if (method %in% c("bh", "bky")) stopifnot(all(flag[ok] == (adj[ok] <= q)))
    if (method == "bky") {
      r1 <- sum(step_up(pp, q / (1 + q)))
      out$m0 <- m - r1
    }
  } else {
    adj[ok] <- switch(method, "holm-sidak" = holm_sidak(pp), sidak = pmin(1, sidak_adj(pp, m)),
                      bonferroni = p.adjust(pp, "bonferroni"))
    flag[ok] <- adj[ok] < alpha
  }
  c(out, list(adjusted = adj, flagged = flag))
}

t_row <- function(a, b, method, lognormal) {
  a <- a[!is.na(a)]; b <- b[!is.na(b)]
  left <- 0
  if (lognormal) {
    left <- sum(c(a, b) <= 0)
    a <- a[a > 0]; b <- b[b > 0]
  }
  nA <- length(a); nB <- length(b)
  if (left > 0 && (nA < 2 || nB < 2)) return(skip_row(nA, nB))
  if (lognormal) { a <- log10(a); b <- log10(b) }
  minN <- if (method == "welch") 2 else 1
  if (nA < minN || nB < minN || nA + nB < 3) return(skip_row(nA, nB))
  # t.test refuses constant data ("essentially constant"): SE 0 is a skipped row.
  tt <- tryCatch(t.test(b, a, var.equal = method == "unpaired"), error = function(e) NULL)
  if (is.null(tt) || !(tt$stderr > 0)) return(skip_row(nA, nB))
  cen <- function(x) if (lognormal) 10^mean(x) else mean(x)
  d <- mean(b) - mean(a)
  out <- list(skip = FALSE, nA = nA, nB = nB, centerA = cen(a), centerB = cen(b), diff = d,
              se = tt$stderr, stat = unname(tt$statistic), df = unname(tt$parameter),
              p = tt$p.value)
  if (lognormal) out$ratio <- 10^d
  if (left > 0) out$leftOut <- left
  out
}

pooled_rows <- function(rows, lognormal) {
  prep <- lapply(rows, function(r) {
    a <- r$a[!is.na(r$a)]; b <- r$b[!is.na(r$b)]
    left <- 0
    if (lognormal) {
      left <- sum(c(a, b) <= 0)
      a <- a[a > 0]; b <- b[b > 0]
      if (left > 0 && (length(a) < 2 || length(b) < 2)) return(NULL)
      a <- log10(a); b <- log10(b)
    }
    list(a = a, b = b, left = left)
  })
  use <- which(vapply(prep, function(r) !is.null(r) && length(r$a) >= 1 && length(r$b) >= 1,
                      TRUE))
  y <- unlist(lapply(prep[use], function(r) c(r$a, r$b)))
  row <- factor(unlist(lapply(use, function(i) rep(i, length(prep[[i]]$a) + length(prep[[i]]$b)))))
  grp <- factor(unlist(lapply(prep[use], function(r) c(rep("a", length(r$a)),
                                                       rep("b", length(r$b))))),
                levels = c("a", "b"))
  fit <- lm(y ~ row * grp)
  df <- fit$df.residual
  s2 <- sum(residuals(fit)^2) / df
  ss <- sum(vapply(prep[use], function(r) sum((r$a - mean(r$a))^2) + sum((r$b - mean(r$b))^2),
                   0))
  stopifnot(isTRUE(all.equal(s2, ss / df, tolerance = 1e-6)))
  s2 <- ss / df
  emm <- suppressMessages(emmeans::emmeans(fit, ~ grp | row))
  pr <- as.data.frame(summary(pairs(emm, reverse = TRUE, adjust = "none")))
  out <- lapply(seq_along(rows), function(i) {
    r <- prep[[i]]
    if (!(i %in% use)) {
      return(if (is.null(r)) skip_row(sum(!is.na(rows[[i]]$a)), sum(!is.na(rows[[i]]$b)))
             else skip_row(length(r$a), length(r$b)))
    }
    nA <- length(r$a); nB <- length(r$b)
    d <- mean(r$b) - mean(r$a)
    se <- sqrt(s2 * (1 / nA + 1 / nB))
    t <- d / se
    p <- 2 * pt(-abs(t), df)
    e <- pr[as.character(pr$row) == as.character(i), ]
    # (emmeans works from lm's fit, a few digits short on the 1e9-offset case: a cross-check)
    stopifnot(nrow(e) == 1, abs(e$t.ratio - t) <= 1e-6 * max(1, abs(t)),
              abs(e$p.value - p) <= 1e-6 * max(1e-3, p), e$df == df)
    cen <- function(x) if (lognormal) 10^mean(x) else mean(x)
    o <- list(skip = FALSE, nA = nA, nB = nB, centerA = cen(r$a), centerB = cen(r$b), diff = d,
              se = se, stat = t, df = df, p = p)
    if (lognormal) o$ratio <- 10^d
    if (r$left > 0) o$leftOut <- r$left
    o
  })
  list(rows = out, pooled = list(sd = sqrt(s2), df = df))
}

paired_row <- function(a, b, lognormal) {
  ok <- !is.na(a) & !is.na(b)
  a <- a[ok]; b <- b[ok]
  n <- length(a)
  if (n < 2) return(skip_row(n, n))
  if (lognormal) {
    keep <- a > 0 & b > 0
    left <- sum(!keep)
    a <- a[keep]; b <- b[keep]
    n <- length(a)
    if (n < 2) return(skip_row(n, n))
    tt <- tryCatch(t.test(log10(b), log10(a), paired = TRUE), error = function(e) NULL)
    if (is.null(tt) || !(tt$stderr > 0)) return(skip_row(n, n))
    d <- unname(tt$estimate)
    out <- list(skip = FALSE, nA = n, nB = n, centerA = 10^mean(log10(a)),
                centerB = 10^mean(log10(b)), diff = d, se = tt$stderr,
                stat = unname(tt$statistic), df = unname(tt$parameter), p = tt$p.value,
                ratio = 10^d)
    if (left > 0) out$leftOut <- left
    return(out)
  }
  tt <- tryCatch(t.test(b, a, paired = TRUE), error = function(e) NULL)
  if (is.null(tt) || !(tt$stderr > 0)) return(skip_row(n, n))
  list(skip = FALSE, nA = n, nB = n, centerA = mean(a), centerB = mean(b),
       diff = unname(tt$estimate), se = tt$stderr, stat = unname(tt$statistic),
       df = unname(tt$parameter), p = tt$p.value)
}

rank_row <- function(a, b, method) {
  if (method == "wilcoxon") {
    ok <- !is.na(a) & !is.na(b)
    a <- a[ok]; b <- b[ok]
    n <- length(a)
    if (n < 1) return(skip_row(n, n))
    w <- WX$oracle(list(a = a, b = b), list(exact = "auto"))
    if (is.nan(w$p)) return(skip_row(n, n))
    return(list(skip = FALSE, nA = n, nB = n, centerA = median(a), centerB = median(b),
                diff = w$medianDiff, se = NaN, stat = w$W, df = NaN, p = w$p,
                exact = w$method == "exact"))
  }
  a <- a[!is.na(a)]; b <- b[!is.na(b)]
  nA <- length(a); nB <- length(b)
  if (nA < 1 || nB < 1 || nA + nB < 3) return(skip_row(nA, nB))
  base <- list(skip = FALSE, nA = nA, nB = nB, centerA = median(a), centerB = median(b),
               diff = median(b) - median(a), se = NaN)
  if (method == "mannWhitney") {
    r <- MW$oracle(list(a = a, b = b), list(exact = "auto"))
    if (is.nan(r$p)) return(skip_row(nA, nB))
    return(c(base, list(stat = r$U, df = NaN, p = r$p, exact = r$method == "exact")))
  }
  r <- KS$oracle(list(a = a, b = b), list(exact = "auto"))
  c(base, list(stat = r$d, df = NaN, p = r$p, exact = r$exact))
}

oracle <- function(input, params) {
  rows <- lapply(rows_of(input$rows), function(r) list(a = num(r$a), b = num(r$b)))
  method <- params$method
  lognormal <- isTRUE(params$lognormal)
  res <- if (method == "pooled") pooled_rows(rows, lognormal) else list(rows = lapply(rows,
    function(r) switch(method,
      welch = , unpaired = t_row(r$a, r$b, method, lognormal),
      paired = paired_row(r$a, r$b, lognormal),
      rank_row(r$a, r$b, method))))
  p <- vapply(res$rows, function(r) r$p, 0)
  res$family <- family(p, params)
  res
}
