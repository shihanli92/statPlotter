# Convex hulls of a group of points (roadmap 34c: the graph layers' hulls): grDevices::chull, the
# indices of the hull's corners in clockwise order (1-based here; 0-based in the app).

PACKAGES <- character(0)

oracle <- function(input, params) {
  list(hull = chull(input$x, input$y))
}
