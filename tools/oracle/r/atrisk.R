# The number at risk at chosen times (roadmap 35: a Kaplan-Meier graph's number-at-risk table):
# summary(survfit(Surv(time, event) ~ 1), times = times, extend = TRUE)$n.risk, one group at a
# time. extend = TRUE gives times past the last observation (0 at risk) as well.
# input: time (rows), event (1 event, 0 censored), times (in any order).

PACKAGES <- c("survival")
suppressPackageStartupMessages(library(survival))

oracle <- function(input, params) {
  fit <- survfit(Surv(input$time, input$event) ~ 1)
  times <- as.numeric(input$times)
  # summary() sorts the times: put them back in the order asked.
  o <- order(times)
  s <- summary(fit, times = times[o], extend = TRUE)
  n <- numeric(length(times))
  n[o] <- s$n.risk
  # Cross-check: the subjects whose time is at or after t.
  hand <- vapply(times, function(t) sum(input$time >= t), numeric(1))
  stopifnot(all(hand == n))
  list(nRisk = n)
}
