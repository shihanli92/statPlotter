# Frequency distribution (Prism: "How to: Frequency distribution"; FAQ 1660 for the automatic
# bin width). input$dataSets: one vector of values per data set. params (optional): binWidth,
# firstCenter, upperLimit.
#
# Automatic width: per data set (max - min)/(1 + log2 n), averaged, rounded down to a "nice"
# value (two significant digits, the second lowered to 0, 2 or 5: our reading of "last digit
# ends with 0, 2, or 5"), then down to an integer (>= 1) if every value is an integer.
# Automatic first centre (undocumented): the multiple of the width nearest the smallest value.
# Bins [c0 + (i - 1/2) w, c0 + (i + 1/2) w): a value on a border goes to the higher bin
# (findInterval with left-closed intervals). Values below the first bin or above the upper limit
# are omitted and counted.

PACKAGES <- character(0)

nice_floor <- function(w) {
  e <- floor(log10(w))
  if (10^e > w) e <- e - 1 else if (10^(e + 1) <= w) e <- e + 1
  up <- if (e - 1 >= 0) 10^(e - 1) else 1
  down <- if (e - 1 < 0) 10^(1 - e) else 1
  two <- min(99, floor(w * down / up + 1e-9))
  d2 <- two %% 10
  two <- two - d2 + (if (d2 >= 5) 5 else if (d2 >= 2) 2 else 0)
  two * up / down
}

auto_width <- function(D) {
  D <- Filter(length, D)
  w <- mean(vapply(D, function(v) (max(v) - min(v)) / (1 + log2(length(v))), 0))
  w <- if (w > 0) nice_floor(w) else 1
  if (all(unlist(D) == round(unlist(D)))) w <- max(1, floor(w))
  w
}

oracle <- function(input, params) {
  ds <- input$dataSets
  D <- if (is.matrix(ds)) lapply(seq_len(nrow(ds)), function(i) ds[i, ]) else lapply(ds, as.numeric)
  D <- lapply(D, function(v) as.numeric(v[!is.na(v)]))
  w <- if (is.null(params$binWidth)) auto_width(D) else params$binWidth
  all <- unlist(D)
  c0 <- if (is.null(params$firstCenter)) w * floor(min(all) / w + 0.5) else params$firstCenter
  lo <- c0 - w / 2
  top <- if (is.null(params$upperLimit)) max(all) else min(max(all), params$upperLimit)
  # number of bins: up to the one holding `top`
  nb <- 0
  while (lo + nb * w <= top) nb <- nb + 1
  breaks <- lo + (0:nb) * w
  counts <- t(vapply(D, function(v) {
    keep <- if (is.null(params$upperLimit)) v else v[v <= params$upperLimit]
    i <- findInterval(keep, breaks, left.open = FALSE, rightmost.closed = FALSE)
    tabulate(i[i >= 1 & i <= nb], nb)
  }, numeric(nb)))
  below <- vapply(D, function(v) sum(v < lo), 0)
  above <- vapply(D, function(v) length(v) - sum(v < lo), 0) - rowSums(counts)
  # The graphs' histogram bars (bin stat, roadmap 33d), binned independently with cut() on the
  # same left-closed breaks: counts, and percent / fraction of each data set's values binned.
  cuts <- t(vapply(D, function(v) {
    keep <- if (is.null(params$upperLimit)) v else v[v <= params$upperLimit]
    as.numeric(table(cut(keep, breaks, right = FALSE)))
  }, numeric(nb)))
  binned <- rowSums(cuts)
  list(binWidth = w, firstCenter = c0, centers = c0 + (0:(nb - 1)) * w,
       counts = counts, below = below, above = above,
       histCounts = cuts, histPercent = 100 * cuts / binned, histFraction = cuts / binned)
}
