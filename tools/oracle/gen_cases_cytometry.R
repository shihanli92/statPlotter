# Generates the oracle cases of roadmap 34g's cytometry transforms (suite `cytometry`), with a
# fixed seed.
#
#   cd tools/oracle && Rscript gen_cases_cytometry.R

source("lib.R")

write_case <- function(name, x, s, params) {
  dir <- file.path(ORACLE_DIR, "cases", "cytometry")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = list(x = x, s = s), params = lapply(params, unbox))
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261005)
# Data values: zero, tiny, the linear region, decades up to and past T, negatives, random.
x <- c(0, 1e-12, -1e-12, 0.5, -0.5, 1, -1, 3, 10, -10, 37.5, 100, -100, 250, 999.9, 1000,
       -1000, 2500, 1e4, -1e4, 5e4, 1e5, 262144, 3e5, 1e6, -2e5,
       round(sign(rnorm(20)) * 10^runif(20, -1, 5.5), 3))
display <- function(M) c(-1, -0.25, 0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, M - 0.01, M,
                         M + 0.5, round(runif(10, -0.5, M), 4))
logicle <- function(name, T, W, M, A, values = x)
  write_case(name, values, display(M), list(kind = "logicle", T = T, W = W, M = M, A = A))

logicle("logicle_defaults", 262144, 0.5, 4.5, 0)
logicle("logicle_w1", 262144, 1, 4.5, 0)
# W = 0 (no linear region, an arcsinh): flowCore's Halley iteration doesn't reach its absolute
# tolerance for |x| ~ 1e-12 (it throws), so those two values are left out here.
logicle("logicle_w0", 262144, 0, 4.5, 0, x[abs(x) > 1e-9 | x == 0])
logicle("logicle_a1", 262144, 0.5, 4.5, 1)
logicle("logicle_t10000_m4", 10000, 0.75, 4, 0)
logicle("logicle_cytof", 1e5, 0.25, 5, 0.5)
s <- c(-10, -2, -0.5, 0, 0.1, 1, 2.5, 5, 8, 12)
write_case("arcsinh_5", x, s, list(kind = "arcsinh", cofactor = 5))
write_case("arcsinh_150", x, s, list(kind = "arcsinh", cofactor = 150))
