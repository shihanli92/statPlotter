# Estimated survival curves from a Cox model (the Cox regression "Graphs" tab and "Baseline
# values"): the baseline survival of an individual with every predictor 0, as a product of the
# Kalbfleisch-Prentice factors alpha (survfit.coxph(stype = 1)), and S(t | x) = S0(t)^exp(x b)
# for each row of `newdata` (survfit(fit, newdata, stype = 1)). Values at the event times.
# alpha = S0(t_k) / S0(t_{k-1}); cumulative hazard -log S0. Cross-checked: a hand-written KP
# (closed form for one event, uniroot at tol 1e-15 for ties) agrees with survfit to 1e-12.
# input: time, event, X (rows), names, newdata (rows). params: ties (efron | breslow).

PACKAGES <- c("survival")
suppressPackageStartupMessages(library(survival))

CTRL <- coxph.control(eps = 1e-11, iter.max = 100)

oracle <- function(input, params) {
  ties <- if (is.null(params$ties)) "efron" else params$ties
  X <- as.matrix(input$X)
  if (is.null(dim(X))) X <- matrix(X, ncol = length(input$names))
  colnames(X) <- input$names
  d <- data.frame(time = input$time, event = input$event, X)
  fml <- as.formula(paste("Surv(time, event) ~", paste(input$names, collapse = " + ")))
  fit <- coxph(fml, data = d, ties = ties, control = CTRL)
  fit <- coxph(fml, data = d, ties = ties, init = coef(fit), control = CTRL)
  b <- unname(coef(fit))
  nd <- as.matrix(input$newdata)
  if (is.null(dim(nd))) nd <- matrix(nd, ncol = length(input$names))
  zero <- as.data.frame(matrix(0, 1, length(input$names), dimnames = list(NULL, input$names)))
  s0 <- survfit(fit, newdata = zero, stype = 1)
  ev <- s0$n.event > 0
  S0 <- s0$surv[ev]
  # Hand-written KP check.
  r <- exp(X %*% b)
  S <- 1; hand <- c()
  for (tt in s0$time[ev]) {
    D <- which(d$time == tt & d$event == 1); R <- which(d$time >= tt); sr <- sum(r[R])
    a <- if (length(D) == 1) (1 - r[D] / sr)^(1 / r[D]) else
      uniroot(function(a) sum(r[D] / (1 - a^r[D])) - sr, c(1e-300, 1 - 1e-15), tol = 1e-15)$root
    S <- S * a; hand <- c(hand, S)
  }
  stopifnot(max(abs(hand - S0) / S0) < 1e-10)
  nd_df <- as.data.frame(nd); colnames(nd_df) <- input$names
  sx <- survfit(fit, newdata = nd_df, stype = 1)
  curves <- lapply(seq_len(nrow(nd)), function(i) {
    s <- if (nrow(nd) == 1) sx$surv else sx$surv[, i]
    stopifnot(max(abs(s[ev] - S0^exp(sum(nd[i, ] * b))) / pmax(s[ev], 1e-300)) < 1e-10)
    s[ev]
  })
  list(beta = b,
       baseline = list(time = s0$time[ev], atRisk = s0$n.risk[ev], events = s0$n.event[ev],
                       alpha = S0 / c(1, head(S0, -1)), survival = S0, cumHazard = -log(S0)),
       curves = curves)
}
