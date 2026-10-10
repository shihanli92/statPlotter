# Data processing that produces tables (Phase 13): Transform, Normalize, Remove baseline /
# column math, Prune rows. Closed forms in base R, written independently of the TS code.
#
# params$kind:
#   transform  input { rows (rows x replicates, null = empty), x (or null) }, params y, k, x, kx.
#              Y functions as Prism's list (User Guide, "Transform data"): trig in radians,
#              probit = 5 + qnorm(Y) ("an older definition of probit that adds 5"), logit =
#              ln(Y/(1-Y)), rank = average ranks within the data set (all replicates),
#              zscore = (Y - mean)/SD over the data set; rounding half away from zero (the app
#              rounds on the decimal digits, as spreadsheets: round(1.005, 2) = 1.01; the inputs
#              here hold no decimal ties, which the TS tests pin). A result
#              that is not finite (log of a negative number...) is empty (NA).
#   normalize  input { rows }: 0% / 100% from the row means (smallest, first, value; largest,
#              last, value, sum, mean); Y' = scale (Y - Z)/(H - Z).
#   baseline   input { dataSets: [rows...] }: mode dataSet (baseline index b), rows (first/last n
#              rows with values, averaged), pairs (A op B, C op D); op difference, ratio,
#              percentDifference, sum; match mean (baseline row mean) or replicate.
#   prune      input { rows, x }: everyK, xRange, average (every K rows, X too).

PACKAGES <- character(0)

as_mat <- function(m) {
  if (is.null(m)) return(NULL)
  if (is.list(m)) m <- do.call(rbind, lapply(m, function(r) as.numeric(unlist(lapply(r, function(v) if (is.null(v)) NA else v)))))
  m <- as.matrix(m)
  storage.mode(m) <- "double"
  m
}
fin <- function(v) { v[!is.finite(v)] <- NA; v }

yfun <- function(fn, y, k, x) {
  switch(fn,
    none = y, multiplyK = y * k, addK = y + k, subtractK = y - k, divideK = y / k,
    square = y^2, powerK = y^k, log10 = log10(y), negLog10 = -log10(y), ln = log(y),
    log2 = log2(y), pow10 = 10^y, exp = exp(y), pow2 = 2^y, reciprocal = 1 / y,
    sqrt = sqrt(y), abs = abs(y), sin = sin(y), cos = cos(y), tan = tan(y), arcsin = asin(y),
    arcsinSqrt = asin(sqrt(y)), logit = log(y / (1 - y)),
    probit = ifelse(y > 0 & y < 1, 5 + qnorm(y), NA),
    kMinusY = k - y, kDivY = k / y,
    round = { d <- trunc(k); sign(y) * floor(abs(y) * 10^d + 0.5) / 10^d },
    xDivY = x / y, yDivX = y / x, yMinusX = y - x, yPlusX = y + x, yTimesX = y * x,
    xMinusY = x - y,
    rank = { r <- rep(NA_real_, length(y)); ok <- !is.na(y); r[ok] <- rank(y[ok], ties.method = "average"); r },
    zscore = (y - mean(y, na.rm = TRUE)) / sd(y, na.rm = TRUE),
    stop("unknown ", fn))
}

oracle_transform <- function(input, params) {
  Y <- as_mat(input$rows)
  x <- if (is.null(input$x)) rep(NA_real_, nrow(Y)) else as.numeric(input$x)
  k <- if (is.null(params$k)) 1 else params$k
  X <- matrix(x, nrow(Y), ncol(Y))
  out <- suppressWarnings(fin(yfun(params$y, as.vector(Y), k, as.vector(X))))
  res <- list(rows = matrix(out, nrow(Y), ncol(Y)))
  if (!is.null(params$x) && params$x != "none") {
    kx <- if (is.null(params$kx)) 1 else params$kx
    res$x <- suppressWarnings(fin(yfun(params$x, x, kx, NA)))
  }
  res
}

oracle_normalize <- function(input, params) {
  Y <- as_mat(input$rows)
  m <- rowMeans(Y, na.rm = TRUE)
  m <- m[!is.nan(m)]
  z <- switch(params$zero, smallest = min(m), first = m[1], value = params$zeroValue)
  h <- switch(params$hundred, largest = max(m), last = m[length(m)], value = params$hundredValue,
              sum = sum(m), mean = mean(m))
  s <- if (params$display == "percent") 100 else 1
  list(rows = s * (Y - z) / (h - z), zero = z, hundred = h)
}

op <- function(o, y, b) fin(switch(o, difference = y - b, ratio = y / b, sum = y + b,
                                   percentDifference = 100 * (y - b) / b))

oracle_baseline <- function(input, params) {
  ds <- input$dataSets
  D <- if (is.array(ds) && length(dim(ds)) == 3) lapply(seq_len(dim(ds)[1]), function(i) matrix(ds[i, , ], dim(ds)[2])) else lapply(ds, as_mat)
  o <- params$operation
  rep_ <- params$match == "replicate"
  out <- list()
  if (params$mode == "dataSet") {
    b <- params$baselineIndex + 1
    B <- D[[b]]
    bm <- rowMeans(B, na.rm = TRUE); bm[is.nan(bm)] <- NA
    for (i in seq_along(D)) if (i != b) {
      Y <- D[[i]]
      Bm <- if (rep_) B else matrix(bm, nrow(Y), ncol(Y))
      out[[length(out) + 1]] <- matrix(op(o, Y, Bm), nrow(Y))
    }
  } else if (params$mode == "rows") {
    n <- params$rowCount
    for (Y in D) {
      filled <- which(rowSums(!is.na(Y)) > 0)
      rows <- if (params$rowsAt == "first") head(filled, n) else tail(filled, n)
      if (rep_) {
        b <- colMeans(Y[rows, , drop = FALSE], na.rm = TRUE)
        Bm <- matrix(b, nrow(Y), ncol(Y), byrow = TRUE)
      } else {
        b <- mean(rowMeans(Y[rows, , drop = FALSE], na.rm = TRUE))
        Bm <- matrix(b, nrow(Y), ncol(Y))
      }
      out[[length(out) + 1]] <- matrix(op(o, Y, Bm), nrow(Y))
    }
  } else {
    for (i in seq(1, length(D) - 1, by = 2)) {
      A <- D[[i]]; B <- D[[i + 1]]
      bm <- rowMeans(B, na.rm = TRUE); bm[is.nan(bm)] <- NA
      Bm <- if (rep_) B else matrix(bm, nrow(A), ncol(A))
      out[[length(out) + 1]] <- matrix(op(o, A, Bm), nrow(A))
    }
  }
  list(dataSets = out)
}

oracle_prune <- function(input, params) {
  Y <- as_mat(input$rows)
  x <- if (is.null(input$x)) NULL else as.numeric(input$x)
  R <- nrow(Y)
  groups <- switch(params$mode,
    everyK = as.list(seq(1, R, by = params$k)),
    xRange = as.list(which(!is.na(x) & x >= params$xMin & x <= params$xMax)),
    average = lapply(seq(1, R, by = params$k), function(r) r:min(R, r + params$k - 1)))
  avg <- params$mode == "average"
  pick <- function(v) vapply(groups, function(g) {
    if (!avg) return(v[g[1]])
    m <- mean(v[g], na.rm = TRUE); if (is.nan(m)) NA_real_ else m
  }, 0)
  res <- list(rows = matrix(apply(Y, 2, pick), length(groups)))
  if (!is.null(x)) res$x <- pick(x)
  res
}

Y_FNS <- c("none", "multiplyK", "addK", "subtractK", "divideK", "square", "powerK", "log10",
           "negLog10", "ln", "log2", "pow10", "exp", "pow2", "reciprocal", "sqrt", "abs", "sin",
           "cos", "tan", "arcsin", "arcsinSqrt", "logit", "probit", "kMinusY", "kDivY", "round",
           "rank", "zscore", "xDivY", "yDivX", "yMinusX", "yPlusX", "yTimesX", "xMinusY")

oracle <- function(input, params) {
  # transformAll: every Y function of the list on the same input (expected: by name).
  if (params$kind == "transformAll") {
    out <- lapply(Y_FNS, function(fn) oracle_transform(input, list(y = fn, k = params$k))$rows)
    return(setNames(out, Y_FNS))
  }
  switch(params$kind,
    transform = oracle_transform(input, params),
    normalize = oracle_normalize(input, params),
    baseline = oracle_baseline(input, params),
    prune = oracle_prune(input, params))
}
