# Generates the oracle cases of roadmap 34g's density plots, with fixed seeds: 2D kernel densities
# and contours (suite `density2d`), hexagonal bins (suite `hexbin`), dot plot statistics (suite
# `dotplot`) and R's pretty() (suite `pretty`).
#
#   cd tools/oracle && Rscript gen_cases_density.R

source("lib.R")

write_case <- function(suite, name, input, params = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (!is.null(params)) case$params <- lapply(params, function(p) if (length(p) == 1) unbox(p) else p)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261005)
# Two clusters (a UMAP-like embedding), a skewed cloud, a narrow ridge.
two <- function(n) {
  k <- rbinom(n, 1, 0.4)
  list(x = round(ifelse(k == 1, rnorm(n, 4, 1), rnorm(n, -2, 1.5)), 4),
       y = round(ifelse(k == 1, rnorm(n, 3, 0.8), rnorm(n, 0, 1.2)), 4))
}
c150 <- two(150)
skew <- list(x = round(rexp(120, 0.5), 4), y = round(rlnorm(120, 0, 0.6), 4))
ridge <- local({ t <- runif(80, 0, 6); list(x = round(t, 4), y = round(sin(t) + rnorm(80, 0, 0.15), 4)) })
small <- list(x = c(1, 2, 2.5, 4, 5.5), y = c(2, 1, 3, 2.5, 4))
c2000 <- two(2000)
p <- function(n, method, adjust = 1, lims = NULL)
  c(list(n = n, method = method, adjust = adjust, probs = c(0.5, 0.75, 0.9, 0.95)),
    if (is.null(lims)) list() else list(lims = lims))

write_case("density2d", "two_clusters_n40", c150, p(40, "exact"))
write_case("density2d", "two_clusters_n100", c150, p(100, "exact"))
write_case("density2d", "two_clusters_adjust_half", c150, p(30, "exact", 0.5))
write_case("density2d", "skewed_adjust2", skew, p(35, "exact", 2))
write_case("density2d", "ridge", ridge, p(40, "exact"))
write_case("density2d", "five_points", small, p(25, "exact"))
write_case("density2d", "lims_wider", c150, p(30, "exact", 1, c(-8, 9, -5, 7)))
write_case("density2d", "binned_n40", c2000, p(40, "binned"))
write_case("density2d", "binned_skewed", skew, p(30, "binned", 1.5))

# Hexagonal bins.
hx <- function(d, xbins, shape, xbnds = NULL, ybnds = NULL)
  c(list(xbins = xbins, shape = shape),
    if (is.null(xbnds)) list() else list(xbnds = xbnds, ybnds = ybnds))
write_case("hexbin", "two_clusters_30", c2000, hx(c2000, 30, 1))
write_case("hexbin", "two_clusters_15_wide", c2000, hx(c2000, 15, 0.6))
write_case("hexbin", "two_clusters_50_tall", c2000, hx(c2000, 50, 1.4))
write_case("hexbin", "skewed_20", skew, hx(skew, 20, 1))
write_case("hexbin", "bounds", c150, hx(c150, 12, 1, c(-10, 10), c(-6, 8)))
grid <- expand.grid(x = 0:10, y = 0:10)
write_case("hexbin", "lattice_ties", list(x = grid$x / 2, y = grid$y / 2), hx(NULL, 10, 1),
           note = "points on a regular lattice: ties between candidate centres")

# Dot plots: variables (genes) by group (cluster).
dot_input <- function(n, genes, groups) {
  g <- sample(groups, n, replace = TRUE)
  vals <- lapply(seq_len(genes), function(k) {
    on <- runif(n) < c(0.1, 0.5, 0.9)[(match(g, groups) + k) %% 3 + 1]
    round(ifelse(on, rlnorm(n, 0.5 + 0.2 * k, 0.5), 0), 4)
  })
  list(values = vals, group = g, levels = groups)
}
d1 <- dot_input(300, 5, c("C0", "C1", "C2", "C3", "C4", "C5"))
d1$values[[2]][c(3, 50, 99)] <- NA
write_case("dotplot", "mean_scaled", d1, list(average = "mean", scale = TRUE, threshold = 0))
write_case("dotplot", "mean_unscaled", d1, list(average = "mean", scale = FALSE, threshold = 0))
write_case("dotplot", "seurat_expm1_scaled", d1, list(average = "expm1", scale = TRUE, threshold = 0))
write_case("dotplot", "seurat_expm1_unscaled", d1, list(average = "expm1", scale = FALSE, threshold = 0))
write_case("dotplot", "threshold_1", d1, list(average = "mean", scale = TRUE, threshold = 1))
d2 <- dot_input(40, 3, c("A", "B"))
write_case("dotplot", "two_groups", d2, list(average = "expm1", scale = TRUE, threshold = 0))
d3 <- dot_input(30, 2, c("only"))
write_case("dotplot", "one_group", d3, list(average = "mean", scale = TRUE, threshold = 0),
           note = "one group: Seurat leaves the averages unscaled")
d4 <- list(values = list(c(1, 1, 1, 0, 0, 0), c(0.5, 0.5, 2, 2, 0, 1)), group = c("a", "a", "b", "b", "c", "c"),
           levels = c("a", "b", "c"))
write_case("dotplot", "constant_gene", list(values = list(rep(2, 6), d4$values[[2]]), group = d4$group,
                                            levels = d4$levels),
           list(average = "mean", scale = TRUE, threshold = 0),
           note = "a gene with the same average in every group: its scaled averages are NaN")

# R's pretty() of ranges (ggplot2's contour levels: pretty(range(z), 10)).
ranges <- list(c(0, 1), c(0.000123, 0.0377), c(1.234e-5, 9.87e-4), c(-3.2, 17.9), c(5, 5),
               c(0, 0), c(1e6, 1.0000001e6), c(0.0021, 0.00211), c(-1e-3, 2e-3), c(2.5e-8, 0.31))
for (k in seq_along(ranges))
  write_case("pretty", sprintf("range_%02d", k), list(range = ranges[[k]]), list(n = 10))
write_case("pretty", "n5", list(range = c(0.17, 9.3)), list(n = 5))
write_case("pretty", "n3", list(range = c(-0.4, 0.9)), list(n = 3))
