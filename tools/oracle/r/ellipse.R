# Confidence ellipses of a group of points (roadmap 34c: the graph layers' ellipses).
#
# - norm: ggplot2's stat_ellipse(type = "norm") (calculate_ellipse): centre and shape from
#   stats::cov.wt (the mean and the sample covariance), radius sqrt(2 * qf(level, 2, n - 1));
#   the same ellipse as car::dataEllipse(x, y, levels = level) (checked below).
# - t: ggplot2's default stat_ellipse(type = "t"): MASS::cov.trob's centre and scatter (its
#   defaults: nu = 5, maxit = 25, tol = 0.01), radius sqrt(2 * qf(level, 2, n - 1)).
# - mean: the confidence region of the mean (Hotelling's T^2; Johnson & Wichern eq. 5-18):
#   car::ellipse(colMeans(X), cov(X) / n, sqrt(2 * (n - 1) / (n - 2) * qf(level, 2, n - 2))).
#
# The outline is ggplot2's: centre + radius * (cos, sin) %*% chol(shape) at (0:segments) * 2 pi /
# segments; checked against calculate_ellipse itself for norm and t (n >= 4, its minimum), and
# against car::ellipse (a pivoted Cholesky factor, so the same curve from another starting angle)
# by the points' Mahalanobis radius for every type.

PACKAGES <- c("ggplot2", "MASS", "car")

oracle <- function(input, params) {
  X <- cbind(x = input$x, y = input$y)
  n <- nrow(X)
  level <- params$level
  segments <- params$segments
  type <- params$type
  if (type == "t") {
    v <- MASS::cov.trob(X)
    center <- unname(v$center); shape <- unname(v$cov)
    radius <- sqrt(2 * qf(level, 2, n - 1))
  } else if (type == "norm") {
    v <- stats::cov.wt(X)
    center <- unname(v$center); shape <- unname(v$cov)
    radius <- sqrt(2 * qf(level, 2, n - 1))
  } else {
    center <- unname(colMeans(X)); shape <- unname(cov(X) / n)
    radius <- sqrt(2 * (n - 1) / (n - 2) * qf(level, 2, n - 2))
  }
  angles <- (0:segments) * 2 * pi / segments
  outline <- t(center + radius * t(cbind(cos(angles), sin(angles)) %*% chol(shape)))
  if (type != "mean" && n >= 4) {
    gg <- as.matrix(ggplot2:::calculate_ellipse(as.data.frame(X), c("x", "y"), type, level,
                                                 segments))
    stopifnot(max(abs(gg - outline)) <= 1e-12 * max(abs(outline)))
  }
  car <- car::ellipse(center, shape, radius, segments = segments, draw = FALSE)
  d <- sweep(car, 2, center)
  stopifnot(max(abs(sqrt(rowSums((d %*% solve(shape)) * d)) - radius)) <= 1e-9 * radius)
  if (type == "norm") {
    de <- car::dataEllipse(X[, 1], X[, 2], levels = level, segments = segments, draw = FALSE)
    stopifnot(max(abs(de - car)) <= 1e-9 * max(abs(car)))
  }
  out <- list(center = center, shape = c(shape[1, 1], shape[1, 2], shape[2, 2]),
              radius = radius, x = outline[, 1], y = outline[, 2])
  if (type == "t") out$iter <- v$iter
  out
}
