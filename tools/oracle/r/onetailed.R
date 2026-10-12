# One-tailed P values for a direction predicted in advance (roadmap 51c, S1; design §6.3), checked
# through the analyses: each case gives the two-sided P and the one-tailed P for each direction
# ("greater": the effect B - A, the mean above mu, r, or the exposed row's risk is larger;
# "less": smaller), whichever way the data went. The analyses compute the predicted one; with
# the data against the prediction it is the large one.
#
# params$suite names the test, params$rparams its options as the stats-level suite of the same
# test takes them; those suites' oracles are reused unchanged with `alternative` set (ttest,
# mannwhitney, wilcoxon, onesample, correlation), so the one-tailed P values are the same R
# calls those suites document:
#   ttest        t.test(b, a, var.equal, paired; ratio: log10)    mannwhitney  wilcox.test / coin
#   wilcoxon     coin::wilcoxsign_test / wilcox.test              onesample    t.test(x, mu)
#   correlation  cor.test (Pearson; Spearman exact or t)
# and here:
#   nested       balanced data: the t test of the subject means (the nested t test's
#                containment df then equals the pooled t test's, as nested.R checks)
#   fisher       fisher.test(table, alternative) (greater: odds ratio > 1, row 1's risk of
#                column 1 higher)
#   chisquare    prop.test(x, n, alternative, correct = yates): the signed z test of the two
#                proportions, P = P/2 in the observed direction and 1 - P/2 against it
# params$analysis and params$app are the analysis and its parameters (read by the TS test only).

PACKAGES <- c("coin", "pspearman")

suite_env <- function(name) {
  e <- new.env()
  sys.source(file.path(ORACLE_DIR, "r", paste0(name, ".R")), envir = e)
  e
}

with_alt <- function(rparams, alt) {
  p <- if (is.null(rparams) || length(rparams) == 0) list() else as.list(rparams)
  p$alternative <- alt
  p
}

oracle <- function(input, params) {
  suite <- params$suite
  if (suite %in% c("ttest", "mannwhitney", "wilcoxon", "onesample", "correlation")) {
    e <- suite_env(suite)
    p <- function(alt) e$oracle(input, with_alt(params$rparams, alt))$p
    return(list(two = p("two-sided"), greater = p("greater"), less = p("less")))
  }
  if (suite == "nested") {
    # input$groups[[g]][[s]]: subject s of group g; balanced: each subject the same n.
    g <- input$groups
    # fromJSON makes equal-sized groups a [group, subject, replicate] array.
    means <- if (is.array(g) && length(dim(g)) == 3) {
      m <- apply(g, c(1, 2), mean)
      list(m[1, ], m[2, ])
    } else lapply(g, function(x) vapply(x, function(s) mean(unlist(s)), 0))
    a <- means[[1]]; b <- means[[2]]
    p <- function(alt) t.test(b, a, var.equal = TRUE, alternative = alt)$p.value
    return(list(two = p("two.sided"), greater = p("greater"), less = p("less")))
  }
  m <- matrix(unlist(input$table), nrow = 2, byrow = TRUE)
  if (suite == "fisher") {
    p <- function(alt) fisher.test(m, alternative = alt)$p.value
    return(list(two = p("two.sided"), greater = p("greater"), less = p("less")))
  }
  if (suite == "chisquare") {
    yates <- isTRUE(params$rparams$yates)
    p <- function(alt) prop.test(x = m[, 1], n = rowSums(m), alternative = alt,
                                 correct = yates)$p.value
    two <- chisq.test(m, correct = yates)$p.value
    stopifnot(abs(p("two.sided") - two) < 1e-12)
    return(list(two = two, greater = p("greater"), less = p("less")))
  }
  stop("unknown suite ", suite)
}
