# Multiple one-way ANOVAs, the rows' P values corrected for their number (roadmap 51c, S9): each
# row's P (ordinary ANOVA: anova(lm); Kruskal-Wallis: kruskal.test, the chi-square P — as the
# oneway suite computes them), then the family across the rows:
#   bh, by       p.adjust(p, "BH" / "BY")
#   bky          the two-stage step-up q values at Q (ref_padjust.R's bky_q, as multiple_t.R)
#   holm-sidak   step-down Sidak (ref_padjust.R), sidak 1 - (1 - p)^m, bonferroni p.adjust
# input$rows as the multiple_oneway suite; params: test ("ordinary" / "kruskalWallis"), Q.

source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- c("car")

OW <- new.env()
sys.source(file.path(ORACLE_DIR, "r", "oneway.R"), envir = OW)

as_rows <- function(x) {
  if (is.array(x) && length(dim(x)) == 3)
    return(lapply(seq_len(dim(x)[1]), function(i) lapply(seq_len(dim(x)[2]), function(j) x[i, j, ])))
  lapply(x, function(r) if (is.matrix(r)) lapply(seq_len(nrow(r)), function(j) r[j, ]) else r)
}

oracle <- function(input, params) {
  p <- vapply(as_rows(input$rows), function(groups) {
    a <- OW$oracle(list(groups = groups), list())
    if (identical(params$test, "kruskalWallis")) a$kruskalWallis$p else a$p
  }, 0)
  m <- length(p)
  Q <- if (is.null(params$Q)) 0.05 else params$Q
  list(p = p, bh = p.adjust(p, "BH"), by = p.adjust(p, "BY"), bky = bky_q(p, Q),
       holmSidak = holm_sidak(p), sidak = sidak_adj(p, m), bonferroni = p.adjust(p, "bonferroni"))
}
