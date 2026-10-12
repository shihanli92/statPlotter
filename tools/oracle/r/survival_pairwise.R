# Pairwise comparisons of three or more survival curves (roadmap 51c, S16): the chosen test —
# log-rank (survdiff(rho = 0)) or Gehan-Breslow-Wilcoxon — on each pair's subjects alone, the
# pairs' P values corrected as one family by p.adjust (holm, bonferroni) or Sidak
# (1 - (1 - p)^m), or not at all. Each pair's test is the survival suite's own oracle on the two
# groups (survival.R: survdiff for the log-rank test, its hand-coded and coin-checked
# Gehan-Breslow-Wilcoxon), so the pairs are tested exactly as two-group analyses are.
#
# input: { time: [[...]...], event: [[...]...] } (a list per group, as the survival suite).
# params: { pairs: "all" | "control", control: 0-based group }.

PACKAGES <- c("survival", "coin")

surv <- new.env()
sys.source(file.path(ORACLE_DIR, "r", "survival.R"), envir = surv)

sidak_adj <- function(p, m) -expm1(m * log1p(-p))

oracle <- function(input, params) {
  time <- input$time; event <- input$event
  if (is.matrix(time)) {
    time <- lapply(seq_len(nrow(time)), function(i) time[i, ])
    event <- lapply(seq_len(nrow(event)), function(i) event[i, ])
  }
  k <- length(time)
  pairs <- if (identical(params$pairs, "control")) {
    c0 <- params$control
    lapply(setdiff(seq_len(k) - 1, c0), function(j) c(c0, j))
  } else unlist(lapply(0:(k - 2), function(i) lapply((i + 1):(k - 1), function(j) c(i, j))),
                recursive = FALSE)
  tests <- lapply(pairs, function(p) {
    sub <- list(time = list(time[[p[1] + 1]], time[[p[2] + 1]]),
                event = list(event[[p[1] + 1]], event[[p[2] + 1]]))
    r <- surv$oracle(sub, list())
    # The log-rank test against survdiff directly (rho = 0).
    d <- data.frame(t = unlist(sub$time), e = unlist(sub$event),
                    g = rep(1:2, lengths(sub$time)))
    sd <- survdiff(Surv(t, e) ~ g, data = d)
    stopifnot(abs(pchisq(sd$chisq, 1, lower.tail = FALSE) - r$logRank$p) < 1e-12)
    r
  })
  one <- function(which) {
    chi <- vapply(tests, function(t) t[[which]]$chiSq, 0)
    p <- vapply(tests, function(t) t[[which]]$p, 0)
    m <- length(p)
    list(chiSq = chi, p = p, holm = p.adjust(p, "holm"), bonferroni = p.adjust(p, "bonferroni"),
         sidak = sidak_adj(p, m), none = p)
  }
  list(i = vapply(pairs, `[`, 0, 1), j = vapply(pairs, `[`, 0, 2),
       logRank = one("logRank"), gehanBreslowWilcoxon = one("gehanBreslowWilcoxon"))
}
