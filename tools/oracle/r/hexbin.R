# Hexagonal bins (roadmap 34g: hexbin plots): hexbin::hexbin(x, y, xbins, shape, xbnds, ybnds)
# — its occupied cells, their counts and centres of mass — and hexbin::hcell2xy, the cells'
# centres.

PACKAGES <- c("hexbin")

suppressPackageStartupMessages(library(hexbin))

oracle <- function(input, params) {
  args <- list(input$x, input$y, xbins = params$xbins, shape = params$shape)
  if (!is.null(params$xbnds)) args <- c(args, list(xbnds = params$xbnds, ybnds = params$ybnds))
  h <- do.call(hexbin, args)
  xy <- hcell2xy(h)
  list(cell = h@cell, count = h@count, xcm = h@xcm, ycm = h@ycm, cx = xy$x, cy = xy$y,
       dimen = h@dimen)
}
