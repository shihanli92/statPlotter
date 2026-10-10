# Two-dimensional kernel densities, their contour lines and levels (roadmap 34g: density contours,
# density images, points coloured by density).
#
# - Bandwidths: ggplot2's stat_density_2d (ggplot2:::precompute_2d_bw: MASS::bandwidth.nrd of X and
#   Y, bw.nrd0 * 4 where that is 0, times `adjust`).
# - Grid ("exact"): MASS::kde2d(x, y, h, n, lims) itself (lims: the data's ranges unless given).
# - Grid ("binned", the app's estimate for many points): the points linearly binned onto nodes four
#   times as close as the grid's (seq.int over the grid's span; each point's weight shared among the
#   four nodes around it by its distance, KernSmooth's linbin2D rule, a point on an upper edge in
#   the last cell), then z = Kx W t(Ky) / (n h1 h2) with Kx[i, m] = dnorm((gx_i - fx_m) / h1) and
#   h = h_MASS / 4: kde2d's sum over the nodes, weighted by their counts. The binning is checked
#   against KernSmooth:::linbin2D for the points inside the nodes' span (which linbin2D keeps).
# - The density at each point: bilinear interpolation of the grid.
# - Levels containing shares of the points (Hyndman 1996): quantile(density at the points,
#   1 - p) (type 7).
# - ggplot2's default contour levels: pretty(range(z), 10) (ggplot2:::contour_breaks).
# - Contour lines at those levels and at the shares' levels: grDevices::contourLines, compared as
#   point sets per level.

PACKAGES <- c("MASS", "ggplot2", "KernSmooth")

bin2d <- function(x, y, fx, fy) {
  m1 <- length(fx); m2 <- length(fy)
  d1 <- (fx[m1] - fx[1]) / (m1 - 1); d2 <- (fy[m2] - fy[1]) / (m2 - 1)
  l1 <- (x - fx[1]) / d1; l2 <- (y - fy[1]) / d2
  ok <- l1 >= 0 & l1 <= m1 - 1 & l2 >= 0 & l2 <= m2 - 1
  l1 <- l1[ok]; l2 <- l2[ok]
  i <- pmin(floor(l1), m1 - 2); j <- pmin(floor(l2), m2 - 2)
  r1 <- l1 - i; r2 <- l2 - j
  W <- numeric(m1 * m2)
  add <- function(at, w) {
    s <- rowsum(w, at)
    W[as.integer(rownames(s))] <<- W[as.integer(rownames(s))] + s[, 1]
  }
  base <- i + j * m1 + 1
  add(base, (1 - r1) * (1 - r2))
  add(base + 1, r1 * (1 - r2))
  add(base + m1, (1 - r1) * r2)
  add(base + m1 + 1, r1 * r2)
  matrix(W, m1, m2)
}

bilinear <- function(gx, gy, z, px, py) {
  n1 <- length(gx); n2 <- length(gy)
  fx <- (px - gx[1]) / (gx[n1] - gx[1]) * (n1 - 1)
  fy <- (py - gy[1]) / (gy[n2] - gy[1]) * (n2 - 1)
  i <- pmin(floor(fx), n1 - 2); j <- pmin(floor(fy), n2 - 2)
  u <- fx - i; v <- fy - j
  (1 - u) * (1 - v) * z[cbind(i + 1, j + 1)] + u * (1 - v) * z[cbind(i + 2, j + 1)] +
    (1 - u) * v * z[cbind(i + 1, j + 2)] + u * v * z[cbind(i + 2, j + 2)]
}

lines_of <- function(gx, gy, z, levels) {
  if (!length(levels)) return(list())
  lapply(contourLines(gx, gy, z, levels = levels),
         function(l) list(level = l$level, x = l$x, y = l$y))
}

oracle <- function(input, params) {
  x <- input$x; y <- input$y
  n <- params$n
  adjust <- if (is.null(params$adjust)) 1 else params$adjust
  h <- ggplot2:::precompute_2d_bw(x, y, adjust = adjust)
  lims <- if (is.null(params$lims)) c(range(x), range(y)) else params$lims
  if (params$method == "exact") {
    d <- MASS::kde2d(x, y, h = h, n = n, lims = lims)
    gx <- d$x; gy <- d$y; z <- d$z
  } else {
    gx <- seq.int(lims[1], lims[2], length.out = n)
    gy <- seq.int(lims[3], lims[4], length.out = n)
    fx <- seq.int(lims[1], lims[2], length.out = 4 * (n - 1) + 1)
    fy <- seq.int(lims[3], lims[4], length.out = 4 * (n - 1) + 1)
    W <- bin2d(x, y, fx, fy)
    inside <- x < lims[2] & y < lims[4]
    ks <- KernSmooth:::linbin2D(cbind(x[inside], y[inside]), fx, fy)
    stopifnot(max(abs(ks - bin2d(x[inside], y[inside], fx, fy))) <= 1e-12 * max(ks))
    h4 <- h / 4
    Kx <- dnorm(outer(gx, fx, "-") / h4[1])
    Ky <- dnorm(outer(gy, fy, "-") / h4[2])
    z <- Kx %*% W %*% t(Ky) / (length(x) * h4[1] * h4[2])
  }
  at <- bilinear(gx, gy, z, x, y)
  probs <- params$probs
  hdr <- unname(quantile(at, 1 - probs, type = 7))
  breaks <- pretty(range(z), 10)
  list(h = h, x = gx, y = gy, z = as.vector(z), at = at, hdr = hdr, breaks = breaks,
       lines = lines_of(gx, gy, z, breaks), hdrLines = lines_of(gx, gy, z, hdr))
}
