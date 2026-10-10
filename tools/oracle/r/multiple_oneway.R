# Multiple one-way ANOVAs: one one-way ANOVA (or Kruskal-Wallis test) per row of a grouped
# table, with multiple comparisons within each row. input$rows: [[group values...]] (each row a
# list of groups). Every row is checked with the oneway and multcomp suites' own oracles, so the
# per-row statistics have the same references as the single one-way ANOVA:
#   oneway     anova(lm), oneway.test (Welch), Brown-Forsythe (explicit), kruskal.test
#   multcomp   params$method (tukey / sidak / holm-sidak / dunnett / games-howell / dunnett-t3 /
#              dunn ...), all pairs or each vs params$control (0-based), with k = the row's groups
# The analysis plugin (packages/analyses) is compared with these, row by row.

PACKAGES <- c("car", "multcomp", "dunn.test")

suite_env <- function(name) {
  env <- new.env()
  sys.source(file.path(ORACLE_DIR, "r", paste0(name, ".R")), envir = env)
  env
}
OW <- suite_env("oneway")
MC <- suite_env("multcomp")

# fromJSON simplifies rows of equal-length groups into matrices / arrays.
as_rows <- function(x) {
  if (is.array(x) && length(dim(x)) == 3)
    return(lapply(seq_len(dim(x)[1]), function(i) lapply(seq_len(dim(x)[2]), function(j) x[i, j, ])))
  lapply(x, function(r) if (is.matrix(r)) lapply(seq_len(nrow(r)), function(j) r[j, ]) else r)
}

oracle <- function(input, params) {
  lapply(as_rows(input$rows), function(groups) {
    out <- list(anova = OW$oracle(list(groups = groups), list()))
    if (!is.null(params$method)) {
      mp <- list(method = params$method)
      if (!is.null(params$control)) {
        mp$control <- params$control
        k <- length(groups)
        mp$pairs <- t(vapply(setdiff(seq_len(k) - 1, params$control),
                             function(j) c(params$control, j), c(0, 0)))
      }
      if (params$method == "dunn") mp$adjust <- "bonferroni"
      out$comparisons <- MC$oracle(list(groups = groups), mp)
    }
    out
  })
}
