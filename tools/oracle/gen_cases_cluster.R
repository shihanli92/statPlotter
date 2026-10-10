# Generates the oracle cases for hierarchical clustering (heat maps) with fixed seeds.
#
#   cd tools/oracle && Rscript gen_cases_cluster.R

source("lib.R")

# input$rows is a list of rows (n x p); missing cells are null.
write_case <- function(name, X, distance, linkage, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", "cluster")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  X <- as.matrix(X)
  dimnames(X) <- NULL
  case <- list(input = list(rows = X),
               params = list(distance = unbox(distance), linkage = unbox(linkage)))
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "null"),
             file.path(dir, paste0(name, ".json")))
}

set.seed(20261001)
rmat <- function(n, p, sd = 1) matrix(round(rnorm(n * p, 0, sd), 2), n, p)

m6 <- rmat(6, 4)
write_case("euclidean_complete_6x4", m6, "euclidean", "complete")
m12 <- rmat(12, 5) + outer(rep(c(0, 2, 5), each = 4), rep(1, 5))
write_case("euclidean_average_12x5", m12, "euclidean", "average")
write_case("pearson_complete_12x5", m12, "pearson", "complete")
m25 <- rmat(25, 8, 3) + outer(rep(1:5, 5), 1:8 / 4)
write_case("euclidean_ward_25x8", m25, "euclidean", "ward")
write_case("pearson_average_25x8", m25, "pearson", "average")
m40 <- rmat(40, 3, 2)
write_case("euclidean_ward_40x3", m40, "euclidean", "ward")
write_case("pearson_ward_40x3", m40, "pearson", "ward")
write_case("columns_euclidean_ward_5x12", t(m12), "euclidean", "ward",
           note = "The 12 x 5 matrix transposed: clustering its columns.")

# Ties: duplicate rows and small-integer data with many equal distances and heights.
dup <- m6[c(1, 2, 3, 1, 4, 2, 5, 6, 3), ]
write_case("ties_duplicate_rows_complete", dup, "euclidean", "complete",
           note = "Rows 1 = 4, 2 = 6, 3 = 9: zero distances and tied merges.")
write_case("ties_duplicate_rows_average", dup, "euclidean", "average")
ints <- matrix(sample(0:2, 16 * 3, replace = TRUE), 16, 3)
write_case("ties_integer_complete", ints, "euclidean", "complete",
           note = "Integer grid data: many tied distances and heights.")
write_case("ties_integer_average", ints, "euclidean", "average")
write_case("ties_integer_ward", ints, "euclidean", "ward")
write_case("one_column_complete", matrix(c(1, 2, 4, 7, 8, 10, 13, 14, 16, 3), ncol = 1),
           "euclidean", "complete", note = "One column: 1-D points, ties at distance 1, 2, 3.")

# Missing values.
mm <- rmat(10, 6)
mm[cbind(c(1, 3, 3, 6, 9), c(2, 1, 5, 6, 3))] <- NA
write_case("missing_euclidean_average", mm, "euclidean", "average")
write_case("missing_pearson_complete", mm, "pearson", "complete")

# Small n.
write_case("n2_euclidean_complete", rmat(2, 3), "euclidean", "complete")
write_case("n3_pearson_average", rmat(3, 4), "pearson", "average")

# A constant row: its correlations (and so the distances) are NaN; hclust refuses them.
cst <- rmat(5, 4)
cst[2, ] <- 1.5
write_case("pearson_constant_row", cst, "pearson", "average",
           note = "Row 2 is constant: NaN distances, no clustering; zRow of row 2 is NaN.")
