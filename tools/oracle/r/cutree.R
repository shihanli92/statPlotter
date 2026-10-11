# Cutting a hierarchical clustering's tree into groups (roadmap 49c: a dendrogram layer's cut).
#
# - The tree: hclust() of the rows' distances, as suite `cluster` (euclidean = dist(X); pearson =
#   as.dist(1 - cor(t(X), use = "pairwise.complete.obs")); linkage complete, average, or
#   ward = "ward.D2"). merge, height and order (1-BASED) are returned so the test checks it is the
#   same tree.
# - byK[[i]]: cutree(hc, k = params$k[i]), each row's cluster (1-based numbers, R's numbering: in
#   the order of the rows).
# - byH[[i]]: cutree(hc, h = h[i]) for h = c(params$h, hc$height[params$hAtMerge]) — given
#   heights, then cuts exactly at merge heights (ties: every merge at or below h is kept). h is
#   returned with kOfH, R's number of clusters for each (n + 1 - which.max(c(height, Inf) > h)).
#   The TS test cuts at its own merge heights for the hAtMerge ones (the same merges; its heights
#   equal R's to rtol 1e-10).

PACKAGES <- character(0)

oracle <- function(input, params) {
  X <- input$rows
  if (!is.matrix(X)) X <- matrix(X, ncol = 1)
  storage.mode(X) <- "double"
  d <- switch(params$distance,
    euclidean = dist(X),
    pearson = as.dist(1 - suppressWarnings(cor(t(X), use = "pairwise.complete.obs"))))
  method <- switch(params$linkage, complete = "complete", average = "average",
                   ward = "ward.D2")
  hc <- hclust(d, method = method)
  n <- nrow(X)
  k <- as.integer(params$k)
  at <- as.integer(params$hAtMerge)
  h <- c(as.numeric(params$h), hc$height[at])
  kOfH <- vapply(h, function(hh) n + 1L - which.max(c(hc$height, Inf) > hh), integer(1))
  list(
    merge = unname(hc$merge),
    height = I(hc$height),
    order = I(hc$order),
    byK = lapply(k, function(kk) I(unname(as.vector(cutree(hc, k = kk))))),
    h = I(h),
    kOfH = I(kOfH),
    byH = lapply(h, function(hh) I(unname(as.vector(cutree(hc, h = hh)))))
  )
}
