# The formula language's statistics (roadmap 38), with missing values left out (na.rm = TRUE):
#   quantile  quantile(x, p, type = 1..9) for every p
#   rank      rank(x, ties.method = average / min / max / first, na.last = "keep")
#   groups    ave() by a group: mean, median, sum, count, sd, var and z-scores (x - mean) / sd;
#             a row without a group gets NA (ave would leave its x); the whole column too
#   cut       cut(x, breaks, right, include.lowest = TRUE) codes and labels (", " between the
#             ends, as the app writes them); breaks = n (equal widths, R's own breaks) or the
#             type-7 quantiles 0, 1/n, ..., 1

PACKAGES <- character(0)

oracle <- function(input, params) {
  x <- as.numeric(input$x)
  switch(params$kind,
    quantile = {
      out <- lapply(1:9, function(t) unname(quantile(x, input$p, type = t, na.rm = TRUE)))
      names(out) <- paste0("type", 1:9)
      out
    },
    rank = {
      r <- function(m) as.numeric(rank(x, ties.method = m, na.last = "keep"))
      list(average = r("average"), min = r("min"), max = r("max"), first = r("first"))
    },
    groups = {
      g <- input$g
      by <- function(f) {
        v <- ave(x, ifelse(is.na(g), "<none>", g), FUN = f)
        v[is.na(g)] <- NA
        as.numeric(v)
      }
      each <- function(f) function(v) rep(f(v), length(v))
      z <- function(v) (v - mean(v, na.rm = TRUE)) / sd(v, na.rm = TRUE)
      const <- function(f) rep(f(x), length(x))
      list(
        meanby = by(each(function(v) mean(v, na.rm = TRUE))),
        medianby = by(each(function(v) median(v, na.rm = TRUE))),
        sumby = by(each(function(v) sum(v, na.rm = TRUE))),
        countby = by(each(function(v) sum(!is.na(v)))),
        sdby = by(each(function(v) sd(v, na.rm = TRUE))),
        varby = by(each(function(v) var(v, na.rm = TRUE))),
        zscoreby = by(z),
        mean = const(function(v) mean(v, na.rm = TRUE)),
        median = const(function(v) median(v, na.rm = TRUE)),
        sd = const(function(v) sd(v, na.rm = TRUE)),
        var = const(function(v) var(v, na.rm = TRUE)),
        zscore = as.numeric(z(x))
      )
    },
    cut = , cutwidth = , cutquantile = {
      right <- isTRUE(params$right)
      breaks <- switch(params$kind,
        cut = input$breaks,
        cutwidth = input$n,
        cutquantile = quantile(x, seq(0, 1, length.out = input$n + 1), type = 7, na.rm = TRUE))
      f <- cut(x, breaks, right = right, include.lowest = TRUE)
      list(code = as.integer(f), labels = gsub(",", ", ", levels(f), fixed = TRUE))
    })
}
