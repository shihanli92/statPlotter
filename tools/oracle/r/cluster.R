# Hierarchical clustering of the rows of a matrix, for clustered heat maps.
#
# - dist: euclidean = dist(X) (R scales the sum of squares over the columns both rows have by
#   ncol / columns used); pearson = as.dist(1 - cor(t(X), use = "pairwise.complete.obs")).
#   Both as the dist vector (lower triangle by column: d(2,1), d(3,1), ..., d(3,2), ...).
# - hclust(d, method): linkage complete, average, or ward = "ward.D2". merge (n - 1 x 2, R's
#   coding: -i = row i, +k = the cluster of step k), height, and order (1-BASED, R's hc$order;
#   the TS code returns order - 1). merge / height / order are null when some distance is
#   NA / NaN (hclust refuses them; the TS code throws).
# - zRow / zCol: (x - mean) / sd by row / by column over the non-missing values (sd with
#   n - 1); a row or column whose sd is 0 or NA is all NaN; missing values stay NA.
# Missing matrix cells are JSON null in the cases (NA here).

PACKAGES <- character(0)

zscore <- function(v) {
  s <- sd(v, na.rm = TRUE)
  if (is.na(s) || s == 0) return(rep(NaN, length(v)))
  (v - mean(v, na.rm = TRUE)) / s
}

oracle <- function(input, params) {
  X <- input$rows
  if (!is.matrix(X)) X <- matrix(X, ncol = 1)
  storage.mode(X) <- "double"
  n <- nrow(X)
  d <- switch(params$distance,
    euclidean = dist(X),
    pearson = as.dist(1 - suppressWarnings(cor(t(X), use = "pairwise.complete.obs"))))
  zRow <- X
  for (i in seq_len(n)) zRow[i, ] <- zscore(X[i, ])
  zCol <- X
  for (j in seq_len(ncol(X))) zCol[, j] <- zscore(X[, j])
  dimnames(zRow) <- NULL
  dimnames(zCol) <- NULL
  out <- list(dist = I(as.vector(d)), zRow = zRow, zCol = zCol)
  if (any(!is.finite(d))) {
    out["merge"] <- list(NULL)
    out["height"] <- list(NULL)
    out["order"] <- list(NULL)
    return(out)
  }
  method <- switch(params$linkage, complete = "complete", average = "average",
                   ward = "ward.D2")
  hc <- hclust(d, method = method)
  # Cross-check ward.D2 against ward.D on squared distances (same merges, heights squared).
  if (method == "ward.D2") {
    w1 <- hclust(d^2, method = "ward.D")
    stopifnot(identical(w1$merge, hc$merge), isTRUE(all.equal(w1$height, hc$height^2)))
  }
  out$merge <- unname(hc$merge)
  out$height <- I(hc$height)
  out$order <- I(hc$order)
  out
}
