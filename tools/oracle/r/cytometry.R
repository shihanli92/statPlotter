# Cytometry display transforms (roadmap 34g: arcsinh and logicle axes).
#
# - arcsinh: asinh(x / cofactor) and its inverse cofactor * sinh(y).
# - logicle: flowCore::logicleTransform(w, t, m, a) (Parks, Roederer & Moore 2006; the
#   implementation of Moore & Parks 2012) of the data values, and
#   flowCore::inverseLogicleTransform of it of display values from below 0 to past M. flowCore's
#   output is the scale's 0-1 place times M.
#
# flowCore is a Bioconductor package (Artistic-2.0), in the oracle's renv project with its
# dependencies (Bioconductor 3.20 for R 4.4: renv::install("bioc::flowCore")).

PACKAGES <- c("flowCore")

suppressPackageStartupMessages(library(flowCore))

oracle <- function(input, params) {
  if (params$kind == "arcsinh") {
    cf <- params$cofactor
    return(list(scale = asinh(input$x / cf), inverse = cf * sinh(input$s)))
  }
  lg <- logicleTransform(w = params$W, t = params$T, m = params$M, a = params$A)
  inv <- inverseLogicleTransform(trans = lg)
  list(scale = lg(input$x), inverse = inv(input$s), zero = lg(0))
}
