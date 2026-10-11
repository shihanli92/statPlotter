# Area under the curve. input: x and either
# rows (replicates, null = empty) or mean + sem. params: baseline, minHeight (fraction of
# max Y - min Y), minPoints, direction ("above" / "both").
#
# Written independently of the TS code: the area of each segment above / below the baseline is
# integrated piecewise (split at the crossing), and regions are the maximal runs of X where the
# curve is strictly on one side of the baseline (a data point on the baseline ends a run).
# SE (Gagnon & Peterson 1998): AUC = sum w_i ybar_i, w_i = (x_{i+1} - x_{i-1})/2 (half the
# interval at the ends), Var = sum w_i^2 SEM_i^2; CI = AUC -/+ qnorm(0.975) SE. Rows with a
# single replicate have no SEM (SE NA).

PACKAGES <- character(0)

oracle <- function(input, params) {
  x <- as.numeric(input$x)
  if (!is.null(input$rows)) {
    Y <- input$rows
    if (!is.matrix(Y)) Y <- matrix(Y, ncol = 1)
    storage.mode(Y) <- "double"
    n <- rowSums(!is.na(Y))
    y <- rowMeans(Y, na.rm = TRUE)
    s2 <- apply(Y, 1, function(v) if (sum(!is.na(v)) > 1) var(v, na.rm = TRUE) else NA)
    semsq <- s2 / n
  } else {
    y <- as.numeric(input$mean)
    semsq <- as.numeric(input$sem)^2
    n <- rep(1, length(y))
  }
  keep <- !is.na(x) & !is.nan(y) & !is.na(y)
  x <- x[keep]; y <- y[keep]; semsq <- semsq[keep]
  o <- order(x)
  x <- x[o]; y <- y[o]; semsq <- semsq[o]
  b <- params$baseline
  d <- y - b
  N <- length(x)
  both <- identical(params$direction, "both")
  # pieces: (x0, x1, signed area, side) with side = sign of the curve on the piece
  pieces <- list()
  for (i in seq_len(N - 1)) {
    a <- d[i]; c <- d[i + 1]; x0 <- x[i]; x1 <- x[i + 1]
    if (a * c < 0) {
      xc <- x0 + (x1 - x0) * a / (a - c)
      pieces[[length(pieces) + 1]] <- c(x0, xc, (xc - x0) * a / 2, sign(a), i, NA)
      pieces[[length(pieces) + 1]] <- c(xc, x1, (x1 - xc) * c / 2, sign(c), NA, i + 1)
    } else if (a + c != 0) {
      pieces[[length(pieces) + 1]] <- c(x0, x1, (x1 - x0) * (a + c) / 2, sign(a + c), i, i + 1)
    } else {
      pieces[[length(pieces) + 1]] <- c(x0, x1, 0, 0, i, i + 1)
    }
  }
  P <- do.call(rbind, pieces)
  # regions: consecutive pieces with the same nonzero side, broken where the curve touches 0
  regs <- list()
  cur <- NULL
  for (r in seq_len(nrow(P))) {
    side <- P[r, 4]
    startsOnZero <- !is.na(P[r, 5]) && d[P[r, 5]] == 0
    if (side == 0) { if (!is.null(cur)) regs[[length(regs) + 1]] <- cur; cur <- NULL; next }
    if (is.null(cur) || cur$side != side || startsOnZero) {
      if (!is.null(cur)) regs[[length(regs) + 1]] <- cur
      cur <- list(side = side, start = P[r, 1], end = P[r, 2], area = 0, pts = integer(0))
    }
    cur$area <- cur$area + P[r, 3]
    cur$end <- P[r, 2]
    cur$pts <- unique(c(cur$pts, na.omit(P[r, 5:6])))
  }
  if (!is.null(cur)) regs[[length(regs) + 1]] <- cur
  thr <- params$minHeight * (max(y) - min(y))
  minPts <- if (is.null(params$minPoints)) 1 else params$minPoints
  out <- lapply(regs, function(g) {
    pts <- g$pts[d[g$pts] != 0 & sign(d[g$pts]) == g$side]
    pk <- pts[which.max(abs(d[pts]))]
    list(sign = g$side, startX = g$start, endX = g$end, peakX = x[pk], peakY = y[pk],
         area = abs(g$area), points = length(pts),
         counted = abs(d[pk]) >= thr && length(pts) >= minPts)
  })
  if (!both) out <- Filter(function(g) g$sign > 0, out)
  total <- sum(vapply(out, `[[`, 0, "area"))
  cnt <- Filter(function(g) g$counted, out)
  peak <- sum(vapply(cnt, `[[`, 0, "area"))
  net <- if (both) sum(vapply(cnt, function(g) g$sign * g$area, 0)) else NA
  w <- (c(x[-1], x[N]) - c(x[1], x[-N])) / 2
  se <- sqrt(sum(w^2 * semsq))
  z <- qnorm(0.975)
  list(totalArea = total, totalPeakArea = peak, netArea = net, nPeaks = length(cnt),
       se = se, lo = total - z * se, hi = total + z * se,
       regions = list(sign = vapply(out, `[[`, 0, "sign"),
                      startX = vapply(out, `[[`, 0, "startX"),
                      endX = vapply(out, `[[`, 0, "endX"),
                      peakX = vapply(out, `[[`, 0, "peakX"),
                      peakY = vapply(out, `[[`, 0, "peakY"),
                      area = vapply(out, `[[`, 0, "area"),
                      counted = vapply(out, `[[`, TRUE, "counted")))
}
