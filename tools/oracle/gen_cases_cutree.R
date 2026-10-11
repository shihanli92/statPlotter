# Generates the oracle cases for cutting clustering trees (roadmap 49c) with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_cutree.R

source("lib.R")

# input$rows is a list of rows (n x p); params: distance, linkage, k (cluster counts), h (heights)
# and hAtMerge (1-based merges whose own heights are cut at: ties).
write_case <- function(name, X, distance, linkage, k, h = numeric(0), hAtMerge = integer(0),
                       note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", "cutree")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  X <- as.matrix(X)
  dimnames(X) <- NULL
  case <- list(input = list(rows = X),
               params = list(distance = unbox(distance), linkage = unbox(linkage),
                             k = as.integer(k), h = as.numeric(h),
                             hAtMerge = as.integer(hAtMerge)))
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "null"),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261011)
rmat <- function(n, p, sd = 1) matrix(round(rnorm(n * p, 0, sd), 2), n, p)

m12 <- rmat(12, 5) + outer(rep(c(0, 2, 5), each = 4), rep(1, 5))
write_case("euclidean_complete_12x5", m12, "euclidean", "complete", k = 1:12,
           h = c(0, 0.5, 1, 2, 4, 100), hAtMerge = c(1, 6, 11),
           note = "Every k from 1 to n; heights below, between and above the merges.")
write_case("euclidean_average_12x5", m12, "euclidean", "average", k = c(2, 3, 5),
           h = c(1.5, 3), hAtMerge = c(2, 9, 10))
write_case("euclidean_ward_12x5", m12, "euclidean", "ward", k = c(2, 3, 4, 11),
           h = c(2, 6), hAtMerge = c(5, 11))
write_case("pearson_complete_12x5", m12, "pearson", "complete", k = c(2, 3, 6),
           h = c(0.25, 1), hAtMerge = c(3, 8))
m25 <- rmat(25, 8, 3) + outer(rep(1:5, 5), 1:8 / 4)
write_case("pearson_average_25x8", m25, "pearson", "average", k = c(1, 2, 5, 10, 25),
           h = c(0.5, 1.2), hAtMerge = c(1, 12, 24))
write_case("pearson_ward_25x8", m25, "pearson", "ward", k = c(3, 7),
           h = c(1, 3), hAtMerge = c(20, 23))
write_case("euclidean_ward_25x8", m25, "euclidean", "ward", k = c(2, 4, 9),
           h = c(5, 15), hAtMerge = c(18, 22))
m40 <- rmat(40, 3, 2)
write_case("euclidean_complete_40x3", m40, "euclidean", "complete", k = c(2, 6, 13, 39),
           h = c(1, 3, 6), hAtMerge = c(25, 37, 39))

# Ties: duplicate rows (zero heights) and small-integer data with many equal heights.
m6 <- rmat(6, 4)
dup <- m6[c(1, 2, 3, 1, 4, 2, 5, 6, 3), ]
write_case("ties_duplicate_rows_complete", dup, "euclidean", "complete", k = c(2, 4, 6, 7, 9),
           h = c(0, 1e-9), hAtMerge = c(1, 3, 4, 8),
           note = "Rows 1 = 4, 2 = 6, 3 = 9: three merges at height 0; a cut at 0 keeps them.")
write_case("ties_duplicate_rows_average", dup, "euclidean", "average", k = c(3, 6, 7),
           h = 0, hAtMerge = c(3, 5, 7))
ints <- matrix(sample(0:2, 16 * 3, replace = TRUE), 16, 3)
write_case("ties_integer_complete", ints, "euclidean", "complete", k = c(2, 3, 5, 8, 12),
           h = c(1, sqrt(2), 2), hAtMerge = c(2, 7, 9, 13, 15),
           note = "Integer grid data: tied heights; cuts at them keep every tied merge.")
write_case("ties_integer_average", ints, "euclidean", "average", k = c(4, 9),
           h = c(1, 1.5), hAtMerge = c(4, 10, 14))
write_case("ties_integer_ward", ints, "euclidean", "ward", k = c(2, 5, 10),
           h = c(1, 2.5), hAtMerge = c(3, 8, 12))
write_case("one_column_complete", matrix(c(1, 2, 4, 7, 8, 10, 13, 14, 16, 3), ncol = 1),
           "euclidean", "complete", k = c(2, 3, 4, 5), h = c(1, 2, 3), hAtMerge = c(1, 5),
           note = "One column: 1-D points, ties at distances 1, 2, 3.")

# Small n.
write_case("n2_euclidean_complete", rmat(2, 3), "euclidean", "complete", k = c(1, 2),
           h = c(0, 100), hAtMerge = 1)
write_case("n3_pearson_average", rmat(3, 4), "pearson", "average", k = 1:3, h = 0.5,
           hAtMerge = c(1, 2))
