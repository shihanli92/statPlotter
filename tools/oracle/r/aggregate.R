# Aggregate by group (roadmap 38): one row per combination of the group variables that occurs
# (rows with a blank group value left out), per value variable: mean, median, SD, SEM, n, min,
# max, sum, % of values above the threshold and % of values that aren't zero, missing values
# left out (tapply with na.rm). Groups are listed by key ("S1|ctrl", sorted) with their
# statistics; the app's order (first appearance) is matched by key in the test.

PACKAGES <- character(0)

oracle <- function(input, params) {
  groups <- as.data.frame(input$groups, stringsAsFactors = FALSE)
  keep <- stats::complete.cases(groups)
  key <- do.call(paste, c(unname(as.list(groups[keep, , drop = FALSE])), sep = "|"))
  keys <- sort(unique(key))
  out <- list(keys = keys)
  for (name in names(input$values)) {
    v <- as.numeric(input$values[[name]])[keep]
    s <- function(f) {
      r <- tapply(v, key, function(w) { w <- w[!is.na(w)]; f(w) })
      as.numeric(r[keys])
    }
    out[[name]] <- list(
      mean = s(function(w) if (length(w)) mean(w) else NA),
      median = s(function(w) if (length(w)) median(w) else NA),
      sd = s(function(w) if (length(w) > 1) sd(w) else NA),
      sem = s(function(w) if (length(w) > 1) sd(w) / sqrt(length(w)) else NA),
      n = s(length),
      min = s(function(w) if (length(w)) min(w) else NA),
      max = s(function(w) if (length(w)) max(w) else NA),
      sum = s(sum),
      pctAbove = s(function(w) if (length(w)) 100 * mean(w > params$threshold) else NA),
      pctNonzero = s(function(w) if (length(w)) 100 * mean(w != 0) else NA)
    )
  }
  out
}
