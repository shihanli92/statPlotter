# Contour lines of a grid (roadmap 34g; audit 2, S13): grDevices::contourLines itself, for grids
# whose cells are saddles (two opposite corners above the level, two below), where how the four
# crossings are joined decides which lines there are. The density2d suite compares lines as point
# sets; this one compares each line's points in order (its connectivity).
#
# z is the grid's values column-major (R's matrix: z[i + (j - 1) * nx] at (x[i], y[j])).

PACKAGES <- character(0)

oracle <- function(input, params) {
  x <- input$x; y <- input$y
  z <- matrix(input$z, length(x), length(y))
  lines <- contourLines(x, y, z, levels = input$levels)
  list(lines = lapply(lines, function(l) list(level = l$level, x = l$x, y = l$y)))
}
