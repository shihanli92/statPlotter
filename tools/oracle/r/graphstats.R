# Statistics the graph layers draw that no analysis computes (roadmap 33, decision 239): the
# violins' kernel density.
#
# - Bandwidth: bw.nrd0(x) (Silverman's rule of thumb, density()'s default) times the smoothing
#   factor `adjust` (density()'s `adjust`).
# - Density: the Gaussian kernel density evaluated exactly at each point of `at`,
#   mean(dnorm((at - x) / bw)) / bw — what density(x, bw, kernel = "gaussian") approximates on its
#   binned FFT grid; cross-checked against it (within its approximation) on a fine grid.

PACKAGES <- character(0)

oracle <- function(input, params) {
  x <- input$values
  adjust <- if (is.null(params$adjust)) 1 else params$adjust
  bw <- bw.nrd0(x) * adjust
  at <- input$at
  d <- vapply(at, function(a) mean(dnorm((a - x) / bw)) / bw, numeric(1))
  approx <- density(x, bw = bw, kernel = "gaussian", n = 4096,
                    from = min(at), to = max(at))
  near <- approx(approx$x, approx$y, xout = at)$y
  stopifnot(max(abs(near - d)) <= 1e-2 * max(d))
  list(bw = bw, density = d)
}
