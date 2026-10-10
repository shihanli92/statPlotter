# Fraction of total. input$grid: rows x columns (NA = empty; empty cells stay empty and count in
# no total). params$divideBy: "column" (x / colSums), "row" (x / rowSums) or "grand" (x / sum),
# with na.rm; a zero total gives NaN.

PACKAGES <- character(0)

oracle <- function(input, params) {
  g <- input$grid
  g <- matrix(as.numeric(g), nrow = nrow(g))
  tot <- switch(params$divideBy,
    column = matrix(colSums(g, na.rm = TRUE), nrow(g), ncol(g), byrow = TRUE),
    row = matrix(rowSums(g, na.rm = TRUE), nrow(g), ncol(g)),
    grand = matrix(sum(g, na.rm = TRUE), nrow(g), ncol(g)))
  f <- g / tot
  f[tot == 0] <- NaN
  f[is.na(g)] <- NaN
  list(fractions = f,
       totals = switch(params$divideBy, column = colSums(g, na.rm = TRUE),
                       row = rowSums(g, na.rm = TRUE), grand = sum(g, na.rm = TRUE)))
}
