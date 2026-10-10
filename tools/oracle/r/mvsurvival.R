# Kaplan-Meier survival analysis of a multiple-variables table (roadmap item 19), checked through
# the analysis plugin: grouping by the combinations of grouping variables' levels (ordered by the
# first variable's levels in order of first appearance, then the next's), status as numeric codes
# (eventCode / censoredCode, default 1 / 0) or text (eventLevel; any other value censored).
#
# input: columns. params: time, status, groups, eventLevel.
# Expected: group titles (levels joined by ", "), subjects and events per group, median survival
# (survfit, as the survival suite), and the log-rank test (survdiff, rho = 0).

PACKAGES <- c("survival")
suppressPackageStartupMessages(library(survival))

oracle <- function(input, params) {
  cols <- input$columns
  time <- cols[[params$time]]
  st <- cols[[params$status]]
  groups <- if (length(params$groups)) unlist(params$groups) else character(0)
  if (is.character(st)) {
    s <- trimws(st)
    event <- ifelse(is.na(s), NA, s == params$eventLevel)
  } else event <- ifelse(is.na(st), NA, ifelse(st == 1, TRUE, ifelse(st == 0, FALSE, NA)))
  ok <- !is.na(time) & !is.na(event) & time >= 0
  for (g in groups) ok <- ok & !is.na(cols[[g]])
  rows <- which(ok)
  key <- if (length(groups)) {
    ranks <- lapply(groups, function(g) {
      v <- as.character(cols[[g]][rows])
      match(v, unique(v))
    })
    labs <- do.call(paste, c(lapply(groups, function(g) as.character(cols[[g]][rows])), sep = ", "))
    ord <- do.call(order, ranks)
    lv <- unique(labs[ord])
    factor(labs, levels = lv)
  } else factor(rep(params$status, length(rows)))
  d <- data.frame(time = time[rows], event = as.numeric(event[rows]), g = key)
  fit <- survfit(Surv(time, event) ~ g, data = d)
  med <- unname(summary(fit)$table[, "median"])
  sd <- survdiff(Surv(time, event) ~ g, data = d)
  list(titles = levels(key), n = as.vector(table(d$g)),
       events = as.vector(tapply(d$event, d$g, sum)), median = med,
       logRankChiSq = sd$chisq,
       logRankP = pchisq(sd$chisq, length(levels(key)) - 1, lower.tail = FALSE))
}
