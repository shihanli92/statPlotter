# Multifactor (N-way) ANOVA of a multiple-variables table (roadmap item 19), checked through the
# analysis plugin.
#
# input: columns (name -> values; text or numbers, null = missing). params: y (response), factors
# (default: every other column), interactions (lists of names; absent/null = every two- and
# three-way interaction), comparisons (none | mainEffects | simpleEffects | cells), compareFactor,
# byFactor, method (tukey | sidak | bonferroni | holm-sidak | fisher), family (perLevel | all),
# confidenceLevel.
#
# - Complete cases; each factor's levels in order of first appearance (numbers as.character).
# - lm with contr.sum for every factor; car::Anova(type = 3): SS, Df, F, P of each term and the
#   residual. Effect sizes from the SS: eta^2 = SS/SS_total, partial = SS/(SS + SS_res),
#   Cohen's f = sqrt(partial/(1 - partial)).
# - Estimated marginal means: emmeans(fit, factor) (equal weights); SE, t-based CI.
# - Comparisons: emmeans pairs() (differences i - j, i < j, in level order). Main effects: pairs of
#   emmeans(fit, A); simple effects: emmeans(fit, A, by = B) — one family per level of B, or all
#   pairs as one family (Tukey with k = LA*LB means, the other methods over every pair); cells:
#   emmeans(fit, c(B, A)) (B varying fastest, the plugin's order). The t ratios are emmeans'
#   (adjust = "none"); P values and CIs per family from them: Tukey with the integrate()
#   reference ptukey (ref_integrals.R; R's ptukey/qtukey are good to ~1e-8) and k means (LA, or
#   LA*LB for cells and simple effects as one family), Sidak / Holm-Sidak / Bonferroni over the
#   family's pairs (ref_padjust.R, accurate for tiny P), Fisher unadjusted; no CI for
#   Holm-Sidak.
# - The response is shifted by round(mean) before fitting (exact here) so the 1e6-offset case
#   isn't limited by R's accuracy.

source(file.path(ORACLE_DIR, "ref_integrals.R"))
source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- c("car", "emmeans")
suppressPackageStartupMessages({
  library(car)
  library(emmeans)
})
emm_options(msg.interaction = FALSE, msg.nesting = FALSE)

labels_of <- function(x) {
  if (is.character(x)) {
    s <- trimws(x)
    s[!is.na(s) & s == ""] <- NA
    s
  } else ifelse(is.na(x), NA_character_, as.character(x))
}

oracle <- function(input, params) {
  cols <- input$columns
  nm <- names(cols)
  yname <- params$y
  factors <- if (length(params$factors)) unlist(params$factors) else setdiff(nm, yname)
  ok <- !is.na(cols[[yname]])
  for (f in factors) ok <- ok & !is.na(labels_of(cols[[f]]))
  rows <- which(ok)
  # Fitted on y - shift (exact for these data) so a large offset costs R no accuracy; the
  # marginal means get the shift back.
  shift <- round(mean(cols[[yname]][rows]))
  d <- data.frame(y = cols[[yname]][rows] - shift)
  for (f in factors) {
    lab <- labels_of(cols[[f]])
    lv <- unique(lab[!is.na(lab)])
    lv <- lv[lv %in% unique(lab[rows])]
    d[[f]] <- factor(lab[rows], levels = lv)
  }
  k <- length(factors)
  inter <- list()
  if (is.null(params$interactions)) {
    if (k >= 2) for (a in 1:(k - 1)) for (b in (a + 1):k) inter[[length(inter) + 1]] <- factors[c(a, b)]
    if (k >= 3) for (a in 1:(k - 2)) for (b in (a + 1):(k - 1)) for (c in (b + 1):k)
      inter[[length(inter) + 1]] <- factors[c(a, b, c)]
  } else {
    raw <- params$interactions
    if (is.matrix(raw)) raw <- lapply(seq_len(nrow(raw)), function(i) raw[i, ])
    inter <- lapply(raw, function(t) factors[sort(match(t, factors))])
    if (length(inter)) inter <- inter[order(sapply(inter, length))]
  }
  terms <- c(factors, vapply(inter, paste, "", collapse = ":"))
  fml <- as.formula(paste("y ~", paste(terms, collapse = " + ")))
  fit <- lm(fml, data = d, contrasts = setNames(rep(list("contr.sum"), k), factors))
  a <- Anova(fit, type = 3)
  ssRes <- a["Residuals", "Sum Sq"]
  ssTot <- sum((d$y - mean(d$y))^2)
  level <- if (is.null(params$confidenceLevel)) 0.95 else params$confidenceLevel
  tl <- attr(terms(fit), "term.labels")
  sources <- lapply(tl, function(t) {
    ss <- a[t, "Sum Sq"]; pe <- ss / (ss + ssRes)
    list(name = t, ss = ss, df = a[t, "Df"], F = a[t, "F value"], p = a[t, "Pr(>F)"],
         etaSquared = ss / ssTot, partialEtaSquared = pe, cohensF = sqrt(pe / (1 - pe)),
         pctOfTotal = 100 * ss / ssTot)
  })
  means <- lapply(factors, function(f) {
    e <- summary(emmeans(fit, f), level = level)
    list(factor = f, mean = e$emmean + shift, se = e$SE, lower = e$lower.CL + shift,
         upper = e$upper.CL + shift)
  })
  out <- list(n = nrow(d), sources = sources,
              residual = list(ss = ssRes, df = a["Residuals", "Df"]),
              total = list(ss = ssTot, df = nrow(d) - 1), means = means)
  cmp <- if (is.null(params$comparisons)) "none" else params$comparisons
  if (cmp == "none") return(out)
  method <- if (is.null(params$method)) "tukey" else params$method
  fA <- if (is.null(params$compareFactor) || params$compareFactor == "") factors[1] else params$compareFactor
  fB <- if (is.null(params$byFactor) || params$byFactor == "") setdiff(factors, fA)[1] else params$byFactor
  emm <- switch(cmp,
    mainEffects = emmeans(fit, fA),
    simpleEffects = emmeans(fit, fA, by = fB),
    cells = emmeans(fit, c(fB, fA)))
  s <- as.data.frame(summary(pairs(emm, adjust = "none")))
  LA <- nlevels(d[[fA]]); LB <- if (cmp == "mainEffects") 1 else nlevels(d[[fB]])
  per_level <- cmp == "simpleEffects" && !identical(params$family, "all")
  fam <- if (per_level) as.integer(s[[fB]]) else rep(1L, nrow(s))
  k <- if (cmp == "mainEffects" || per_level) LA else LA * LB
  alpha <- 1 - level
  out$comparisons <- list(diff = s$estimate, se = s$SE, lower = numeric(0), upper = numeric(0),
                          p = numeric(0))
  lo <- hi <- p <- numeric(nrow(s))
  for (g in unique(fam)) {
    idx <- which(fam == g)
    t <- s$t.ratio[idx]; df <- s$df[idx[1]]; m <- length(idx)
    raw <- 2 * pt(abs(t), df, lower.tail = FALSE)
    r <- switch(method,
      tukey = list(p = vapply(sqrt(2) * abs(t), ptukey_ref, 0, k = k, df = df, lower = FALSE),
                   crit = upper_quantile(function(x) ptukey_ref(x, k, df, lower = FALSE), alpha,
                                         qtukey(level, k, df)) / sqrt(2)),
      sidak = list(p = pmin(1, sidak_adj(raw, m)), crit = qt(-expm1(log1p(-alpha) / m) / 2, df,
                                                          lower.tail = FALSE)),
      bonferroni = list(p = pmin(1, m * raw), crit = qt(alpha / m / 2, df, lower.tail = FALSE)),
      fisher = list(p = raw, crit = qt(alpha / 2, df, lower.tail = FALSE)),
      "holm-sidak" = list(p = holm_sidak(raw), crit = NaN))
    p[idx] <- r$p
    lo[idx] <- s$estimate[idx] - r$crit * s$SE[idx]
    hi[idx] <- s$estimate[idx] + r$crit * s$SE[idx]
  }
  out$comparisons$lower <- lo; out$comparisons$upper <- hi; out$comparisons$p <- p
  out
}
