# Generates the oracle cases for the graph layers' statistics (roadmap 33): violin densities,
# with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_graphstats.R

source("lib.R")

write_case <- function(name, values, at, adjust = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", "graphstats")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = list(values = values, at = at))
  if (!is.null(adjust)) case$params <- list(adjust = unbox(adjust))
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE),
             file.path(dir, paste0(name, ".json")))
}

# 129 points over the values' range (a 'truncated' violin), or 3 bandwidths past it ('extended').
grid <- function(x, past = 0) {
  bw <- bw.nrd0(x)
  seq(min(x) - past * bw, max(x) + past * bw, length.out = 129)
}

set.seed(20261001)
normal <- round(rnorm(30, 50, 8), 2)
write_case("normal_n30", normal, grid(normal))
write_case("normal_n30_extended", normal, grid(normal, 3))
write_case("normal_n30_smooth2", normal, grid(normal, 3), adjust = 2)
skewed <- round(rlnorm(12, 1, 0.7), 3)
write_case("lognormal_n12_smooth05", skewed, grid(skewed), adjust = 0.5)
write_case("bimodal_n40", round(c(rnorm(20, 10, 1), rnorm(20, 16, 1.5)), 2),
           seq(5, 22, length.out = 129))
write_case("n2", c(3, 7.5), seq(0, 10, length.out = 41))
write_case("zero_iqr", c(5, 5, 5, 5, 5, 6, 9), seq(3, 11, length.out = 41),
           note = "IQR 0: the bandwidth falls back to the SD")
write_case("constant", c(4, 4, 4), seq(0, 8, length.out = 41),
           note = "No spread: the bandwidth falls back to |x1|")
write_case("constant_zero", c(0, 0, 0, 0), seq(-3, 3, length.out = 41),
           note = "No spread and x1 = 0: the bandwidth falls back to 1")
