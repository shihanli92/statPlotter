# Single-cell dot plot statistics (roadmap 34g), per variable (gene) and group (cluster), computed
# as Seurat's DotPlot does (Seurat 5.4, R/visualization.R; reimplemented here in base R rather
# than adding Seurat and its many dependencies to the oracle's renv project):
#
#   pct.exp = PercentAbove(x, threshold) = mean(x > threshold) * 100
#   avg.exp = mean(expm1(x))                       ("expm1": log-normalised data)
#   shown   = log1p(avg.exp)                       (unscaled)
#   scaled  = MinMax(scale(log1p(avg.exp)), -2.5, 2.5) across the groups, per gene
#
# "mean" is the app's plain average (data that aren't log-normalised): mean(x), scaled the same way
# without log1p. Missing values (NA) are left out of their gene's statistics; one group is left
# unscaled (Seurat warns and doesn't scale). The definitions were checked against
# Seurat::DotPlot's own data (plot$data) on a Seurat object outside this project.

PACKAGES <- character(0)

oracle <- function(input, params) {
  g <- factor(input$group, levels = input$levels)
  thr <- params$threshold
  # jsonlite reads a list of equal-length vectors as a matrix (a gene per row).
  values <- if (is.matrix(input$values))
    lapply(seq_len(nrow(input$values)), function(i) input$values[i, ]) else input$values
  genes <- lapply(values, function(v) {
    v <- as.numeric(v)
    ok <- !is.na(v)
    pct <- vapply(levels(g), function(l) {
      x <- v[ok & g == l]
      if (length(x)) mean(x > thr) * 100 else NaN
    }, 0)
    avg <- vapply(levels(g), function(l) {
      x <- v[ok & g == l]
      if (!length(x)) NaN else if (params$average == "expm1") log1p(mean(expm1(x))) else mean(x)
    }, 0)
    if (params$scale && sum(is.finite(avg)) > 1) {
      s <- as.vector(scale(avg))
      s[!is.na(s) & s > 2.5] <- 2.5
      s[!is.na(s) & s < -2.5] <- -2.5
      avg <- s
    }
    list(percent = unname(pct), average = unname(avg))
  })
  list(genes = genes)
}
