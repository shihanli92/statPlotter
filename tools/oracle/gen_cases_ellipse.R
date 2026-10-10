# Generates the oracle cases of roadmap 34c's group overlays: ellipses (suite `ellipse`) and
# convex hulls (suite `hull`), with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_ellipse.R

source("lib.R")

write_case <- function(suite, name, x, y, params = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = list(x = x, y = y))
  if (!is.null(params)) case$params <- lapply(params, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261002)
x30 <- round(rnorm(30, 10, 2), 3)
y30 <- round(0.6 * x30 + rnorm(30, 0, 1), 3)
iris_s <- iris[iris$Species == "setosa", ]
x4 <- c(1, 2.5, 3, 4.2); y4 <- c(2, 1.5, 4, 3.1)
x3 <- c(0, 1, 3); y3 <- c(1, 3, 2)
# Heavy tails: a few far points the robust ellipse downweights.
xo <- c(round(rnorm(25, 0, 1), 3), 6, -7, 8); yo <- c(round(rnorm(25, 0, 1), 3), -5, 6, 7)
big <- round(rnorm(200, 1e6, 3), 4); bigy <- round(big * 0.5 + rnorm(200, 0, 2), 4)
for (type in c("norm", "mean", "t")) {
  p <- function(level = 0.95, segments = 51) list(type = type, level = level, segments = segments)
  write_case("ellipse", paste0(type, "_n30"), x30, y30, p())
  write_case("ellipse", paste0(type, "_n30_level68"), x30, y30, p(0.68, 72))
  write_case("ellipse", paste0(type, "_setosa"), iris_s$Sepal.Length, iris_s$Sepal.Width, p(0.9))
  write_case("ellipse", paste0(type, "_n4"), x4, y4, p())
  write_case("ellipse", paste0(type, "_n3"), x3, y3, p(0.99))
  write_case("ellipse", paste0(type, "_outliers"), xo, yo, p())
  write_case("ellipse", paste0(type, "_offset_1e6"), big, bigy, p(0.95, 36))
}

write_case("hull", "n12", round(runif(12), 4), round(runif(12), 4))
write_case("hull", "n50", round(rnorm(50), 3), round(rnorm(50), 3))
write_case("hull", "setosa", iris_s$Sepal.Length, iris_s$Sepal.Width,
           note = "repeated points: the first is a corner")
write_case("hull", "square_edges", c(0, 1, 1, 0, 0.5, 1, 0.5, 0, 0.5),
           c(0, 0, 1, 1, 0, 0.5, 1, 0.5, 0.5), note = "points along edges are not corners")
write_case("hull", "triangle", c(0, 2, 1), c(0, 0, 3))
write_case("hull", "collinear", c(1, 2, 3, 4), c(2, 4, 6, 8), note = "a line: its two ends")
write_case("hull", "two_points", c(1, 3), c(5, 2))
write_case("hull", "one_point", c(4), c(4))
