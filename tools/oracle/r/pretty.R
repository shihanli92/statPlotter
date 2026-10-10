# R's pretty() of a range (roadmap 34g: ggplot2's default contour levels, pretty(range(z), 10)).

PACKAGES <- character(0)

oracle <- function(input, params) {
  list(breaks = pretty(input$range, params$n))
}
