# Sample size from pilot data (roadmap 51c, S29): the effect and SD estimated from two pilot
# columns (unpaired: difference of means, pooled SD; paired: mean and SD of the differences
# b - a), the effect's 95% CI (t.test, var.equal = TRUE / paired = TRUE), and the n per group for
# the target power at the observed effect and at the CI bound nearer zero (NA when the CI
# includes 0): uniroot (tol 1e-14) on power.t.test(strict = TRUE), as the power suite.
# input: a, b; params: type ("two.sample" / "paired"), alpha, target, tails (1 / 2).

PACKAGES <- character(0)

oracle <- function(input, params) {
  a <- input$a; b <- input$b
  paired <- identical(params$type, "paired")
  if (paired) {
    d <- b - a
    delta <- mean(d); sd <- sd(d)
    ci <- t.test(b, a, paired = TRUE)$conf.int
  } else {
    delta <- mean(b) - mean(a)
    sd <- sqrt(((length(a) - 1) * var(a) + (length(b) - 1) * var(b)) / (length(a) + length(b) - 2))
    ci <- t.test(b, a, var.equal = TRUE)$conf.int
  }
  tails <- if (is.null(params$tails)) 2 else params$tails
  alt <- if (tails == 2) "two.sided" else "one.sided"
  nFor <- function(effect) {
    pw <- function(n) power.t.test(n = n, delta = effect, sd = sd, sig.level = params$alpha,
                                   type = params$type, alternative = alt, strict = TRUE)$power
    uniroot(function(n) pw(n) - params$target, c(2, 1e7), tol = 1e-14)$root
  }
  zero <- ci[1] <= 0 && ci[2] >= 0
  bound <- if (ci[1] > 0) ci[1] else ci[2]
  nBound <- if (zero) NA else nFor(abs(bound))
  list(delta = delta, sd = sd, ciLo = ci[1], ciHi = ci[2], nFor = nFor(abs(delta)),
       nBound = nBound, nBoundCeiling = if (zero) NA else ceiling(nBound))
}
