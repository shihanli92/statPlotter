# Empirical ROC curve, as GraphPad Prism documents it
# (https://www.graphpad.com/guides/prism/latest/statistics/stat_calcualtion_details_for_roc_cu.htm,
#  https://www.graphpad.com/support/faq/details-of-calculations-for-roc-curves/,
#  https://www.graphpad.com/guides/prism/latest/statistics/sensitivity_and_specificity.htm,
#  https://www.graphpad.com/guides/prism/latest/statistics/stat_howto_roc.htm):
#
# - Thresholds: pooled values sorted, adjacent values averaged. We merge ties first (so every
#   threshold lies strictly between two distinct values), ascending. Cross-checked with
#   pROC::coords(roc, "all") (pROC uses the same midpoints, plus -Inf / Inf, which we drop).
# - Sensitivity: patients above the threshold / n patients; specificity: controls below /
#   n controls (direction "higher"; mirrored for "lower"). CIs: Clopper-Pearson (Prism: "the
#   Clopper method") = binom.test()$conf.int, or params$ciMethod = "wilsonBrown" (Prism's
#   hybrid Wilson / Poisson interval, as proportionCI; code copied from contingency.R).
#   Likelihood ratio = sens / (1 - spec) (Inf at spec = 1, NaN if sens is also 0).
# - Direction: "auto" (Prism: "it figures out automatically whether the patients tend to have
#   higher or lower test results"; "If the area is first calculated as less than 0.50, Prism
#   will reverse the definition of abnormal") = "higher" unless its area < 0.5.
# - Area: Mann-Whitney P(patient > control) + P(tie)/2 = pROC::auc (checked) = wilcox W/(n n).
# - SE: Hanley & McNeil (1982) with Q1, Q2 estimated from the data. Prism: "Prism actually
#   computes Q1 and Q2 using a more complicated equation", linking to IBM SPSS's ROC algorithm
#   ("SE of the area under the ROC curve statistic, nonparametric assumption", SPSS Statistics
#   Algorithms, ROC Algorithms):
#     Q1 = sum_x n-(=x) [n+(>x)^2 + n+(>x) n+(=x) + n+(=x)^2 / 3] / (n- n+^2)
#     Q2 = sum_x n+(=x) [n-(<x)^2 + n-(<x) n-(=x) + n-(=x)^2 / 3] / (n-^2 n+)
#   (SPSS's printed SE formula has a "-" before (n- - 1)(Q2 - W^2); Hanley & McNeil's has "+",
#   used here.) Checked against a brute-force definition: Q1 = mean over controls c and ordered
#   pairs of patients (a1, a2) (with replacement) of P(c lowest), ties broken at random.
#   Direction "lower": SE(1 - W) = SE(W).
# - CI: A +- qnorm((1 + level)/2) SE (SPSS's asymptotic interval; Prism: "computed by a
#   nonparametric method"), truncated to [0, 1] (to verify against Prism output).
# - P: z = (A - 0.5) / SE0, SE0 = sqrt((n+ + n- + 1) / (12 n+ n-)) (Prism FAQ: sqrt((0.25 +
#   (na + nn - 2) 0.083333) / (na nn)); we use 1/12 exactly); two-tailed normal.
# params: direction ("auto" / "higher" / "lower"), confLevel, ciMethod.

PACKAGES <- c("pROC")

suppressPackageStartupMessages(library(pROC))

wilson_limits <- function(x, n, z) {
  p <- x / n
  center <- (x + z^2 / 2) / (n + z^2)
  half <- z * sqrt(n) / (n + z^2) * sqrt(p * (1 - p) + z^2 / (4 * n))
  c(if (x == 0) 0 else center - half, if (x == n) 1 else center + half)
}

wilson_brown <- function(x, n, conf) {
  z <- qnorm(1 - (1 - conf) / 2); alpha <- 1 - conf
  lim <- wilson_limits(x, n, z)
  xstar <- function(v) v == 1 || v == 2 || (v == 3 && n > 50)
  if (x != n && xstar(x)) lim[1] <- 0.5 * qchisq(alpha, 2 * x) / n
  if (x != 0 && xstar(n - x)) lim[2] <- 1 - 0.5 * qchisq(alpha, 2 * (n - x)) / n
  lim
}

prop_ci <- function(x, n, conf, method) {
  if (method == "wilsonBrown") return(wilson_brown(x, n, conf))
  as.numeric(binom.test(x, n, conf.level = conf)$conf.int)
}

brute_q <- function(controls, patients) {
  # P(c lowest of (c, a1, a2)) with random tie breaking: 1 if both above, 1/2 if one above and
  # one tied, 1/3 if both tied.
  w3 <- function(c, a1, a2) {
    g <- (a1 > c) + (a2 > c); e <- (a1 == c) + (a2 == c)
    ifelse(g == 2, 1, ifelse(g == 1 & e == 1, 1 / 2, ifelse(e == 2, 1 / 3, 0)))
  }
  g1 <- expand.grid(c = controls, a1 = patients, a2 = patients)
  g2 <- expand.grid(a = patients, c1 = controls, c2 = controls)
  c(mean(w3(g1$c, g1$a1, g1$a2)), mean(w3(-g2$a, -g2$c1, -g2$c2)))
}

oracle <- function(input, params) {
  controls <- as.numeric(input$controls); patients <- as.numeric(input$patients)
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  ci_method <- if (is.null(params$ciMethod)) "clopperPearson" else params$ciMethod
  dir_opt <- if (is.null(params$direction)) "auto" else params$direction
  nC <- length(controls); nP <- length(patients)
  vals <- sort(unique(c(controls, patients)))
  cEq <- sapply(vals, function(v) sum(controls == v))
  pEq <- sapply(vals, function(v) sum(patients == v))
  pAbove <- sapply(vals, function(v) sum(patients > v))
  cBelow <- sapply(vals, function(v) sum(controls < v))
  w <- sum(cEq * (pAbove + pEq / 2)) / (nC * nP)
  q1 <- sum(cEq * (pAbove^2 + pAbove * pEq + pEq^2 / 3)) / (nC * nP^2)
  q2 <- sum(pEq * (cBelow^2 + cBelow * cEq + cEq^2 / 3)) / (nC^2 * nP)
  if (nC * nP^2 <= 2e5 && nP * nC^2 <= 2e5) {
    bq <- brute_q(controls, patients)
    stopifnot(abs(bq[1] - q1) < 1e-12, abs(bq[2] - q2) < 1e-12)
  }
  wt <- suppressWarnings(wilcox.test(patients, controls, exact = FALSE))$statistic
  stopifnot(abs(wt / (nC * nP) - w) < 1e-12)

  direction <- if (dir_opt == "auto") (if (w < 0.5) "lower" else "higher") else dir_opt
  auc <- if (direction == "higher") w else 1 - w
  r <- roc(controls = controls, cases = patients, quiet = TRUE,
           direction = if (direction == "higher") "<" else ">")
  stopifnot(abs(as.numeric(auc(r)) - auc) < 1e-12)

  se <- sqrt((w * (1 - w) + (nP - 1) * (q1 - w^2) + (nC - 1) * (q2 - w^2)) / (nP * nC))
  z <- qnorm((1 + level) / 2)
  se0 <- sqrt((nP + nC + 1) / (12 * nP * nC))
  stopifnot(abs(se0 - sqrt((0.25 + (nP + nC - 2) / 12) / (nP * nC))) < 1e-15)
  zs <- (auc - 0.5) / se0

  m <- length(vals)
  points <- NULL
  if (m > 1) {
    th <- (vals[-m] + vals[-1]) / 2
    rows <- lapply(seq_len(m - 1), function(i) {
      t <- th[i]
      tp <- if (direction == "higher") sum(patients > t) else sum(patients < t)
      tn <- if (direction == "higher") sum(controls < t) else sum(controls > t)
      sci <- prop_ci(tp, nP, level, ci_method); cci <- prop_ci(tn, nC, level, ci_method)
      sens <- tp / nP; spec <- tn / nC
      lr <- if (spec == 1) (if (sens == 0) NaN else Inf) else sens / (1 - spec)
      data.frame(threshold = t, sensitivity = sens, sensLower = sci[1], sensUpper = sci[2],
                 specificity = spec, specLower = cci[1], specUpper = cci[2],
                 likelihoodRatio = lr)
    })
    points <- do.call(rbind, rows)
    co <- coords(r, "all", ret = c("threshold", "sensitivity", "specificity"),
                 transpose = FALSE)
    co <- co[is.finite(co$threshold), ]
    co <- co[order(co$threshold), ]
    stopifnot(nrow(co) == nrow(points), max(abs(co$threshold - points$threshold)) < 1e-12,
              max(abs(co$sensitivity - points$sensitivity)) < 1e-12,
              max(abs(co$specificity - points$specificity)) < 1e-12)
  }
  list(points = if (is.null(points)) I(list()) else points,
       auc = auc, se = se, lower = max(0, auc - z * se), upper = min(1, auc + z * se),
       p = min(1, 2 * pnorm(-abs(zs))), se0 = se0, z = zs, direction = direction,
       nControls = nC, nPatients = nP)
}
