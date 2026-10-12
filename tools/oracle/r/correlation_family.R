# Correlation of several columns, the pairs' P values corrected for their number (roadmap 51c,
# S30): every pair of columns (i < j, in column order), values matched by row (complete pairs),
# r and P as the correlation suite computes them (cor.test; Spearman's t approximation for
# n > 17), then the family across the tested pairs:
#   bh    p.adjust(p, "BH")     holm  p.adjust(p, "holm")
# A pair with fewer than three complete rows is not tested (NA, left out of the family, as
# p.adjust leaves out NA).
# input$columns: a list of numeric vectors (null = missing); params: method.

COR <- new.env()
sys.source(file.path(ORACLE_DIR, "r", "correlation.R"), envir = COR)

PACKAGES <- COR$PACKAGES

oracle <- function(input, params) {
  cols <- input$columns
  if (is.matrix(cols)) cols <- lapply(seq_len(nrow(cols)), function(i) cols[i, ])
  cols <- lapply(cols, function(x) as.numeric(unlist(lapply(x, function(v) if (is.null(v)) NA else v))))
  k <- length(cols)
  r <- c(); p <- c(); n <- c()
  for (i in seq_len(k - 1)) for (j in (i + 1):k) {
    m <- max(length(cols[[i]]), length(cols[[j]]))
    x <- c(cols[[i]], rep(NA, m - length(cols[[i]])))
    y <- c(cols[[j]], rep(NA, m - length(cols[[j]])))
    ok <- !is.na(x) & !is.na(y)
    n <- c(n, sum(ok))
    if (sum(ok) < 3) {
      r <- c(r, NA); p <- c(p, NA)
      next
    }
    a <- COR$oracle(list(x = x[ok], y = y[ok]), list(method = params$method))
    r <- c(r, a$r); p <- c(p, a$p)
  }
  list(r = r, p = p, n = n, bh = p.adjust(p, "BH"), holm = p.adjust(p, "holm"))
}
