# Generates the oracle cases for the graphs' summary statistics (roadmap 30) with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_plotstats.R

source("lib.R")

write_case <- function(name, values, level = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", "plotstats")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = list(values = values))
  if (!is.null(level)) case$params <- list(level = unbox(level))
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261002)
write_case("lognormal_n12", round(rlnorm(12, 1, 0.6), 3))
write_case("lognormal_n40_level90", round(rlnorm(40, 2, 1), 2), level = 0.9)
write_case("normal_n25_outliers", c(round(rnorm(23, 50, 5), 1), 90, 3))
write_case("ties_n15", c(3, 3, 3, 4, 4, 5, 5, 5, 5, 6, 7, 7, 8, 12, 30))
write_case("n2", c(2.5, 10))
write_case("n3", c(1, 4, 16))
write_case("n1", 7)
write_case("with_zero", c(0, 1.5, 2, 3.5, 8),
           note = "A value of 0: geometric statistics are undefined (NaN)")
write_case("negative_n9", c(-4.2, -1, 0.5, 2, 2, 3.1, 6, 9.5, 20))
write_case("uniform_n101", round(runif(101, 0, 100), 3))
