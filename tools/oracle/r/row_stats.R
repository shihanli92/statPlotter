# Row statistics of a grouped table. input$rows: [[values of data set 1], [values of data set 2],
# ...] per row (NA = empty). For each data set (params$scope = "perDataSet") or across all data
# sets ("allDataSets"): mean, sd, sem = sd / sqrt(n), n, the t-based CI of the mean
# (t.test()$conf.int; NaN below n = 2), sum, min, max, median. params$summary only changes the TS
# side (mean/SD/N per cell: combined exactly, no min/max/median).

PACKAGES <- character(0)

stats_of <- function(v, level) {
  v <- v[!is.na(v)]
  n <- length(v)
  if (n == 0) return(list(n = 0, mean = NaN, sd = NaN, sem = NaN, lo = NaN, hi = NaN, sum = NaN,
                          min = NaN, max = NaN, median = NaN))
  ci <- if (n >= 2) t.test(v, conf.level = level)$conf.int else c(NaN, NaN)
  s <- if (n >= 2) sd(v) else NaN
  list(n = n, mean = mean(v), sd = s, sem = s / sqrt(n), lo = ci[1], hi = ci[2], sum = sum(v),
       min = min(v), max = max(v), median = median(v))
}

as_rows <- function(x) {
  if (is.array(x) && length(dim(x)) == 3)
    return(lapply(seq_len(dim(x)[1]), function(i) lapply(seq_len(dim(x)[2]), function(j) x[i, j, ])))
  lapply(x, function(r) if (is.matrix(r)) lapply(seq_len(nrow(r)), function(j) r[j, ]) else r)
}

oracle <- function(input, params) {
  level <- if (is.null(params$confLevel)) 0.95 else params$confLevel
  rows <- as_rows(input$rows)
  if (identical(params$scope, "allDataSets"))
    return(lapply(rows, function(r) stats_of(as.numeric(unlist(r)), level)))
  lapply(rows, function(r) lapply(r, function(v) stats_of(as.numeric(v), level)))
}
