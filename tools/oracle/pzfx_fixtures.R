# Regenerates the .pzfx import fixtures in packages/io/test/fixtures/pzfx/.
#
#   cd tools/oracle && Rscript pzfx_fixtures.R
#
# 1. Copies the example .pzfx files shipped with the CRAN package pzfx (MIT, Yue Jiang;
#    inst/extdata and inst/testdata) into the fixture directory.
# 2. Reads every .pzfx file there (including our hand-written synthetic_*.pzfx) with
#    pzfx::read_pzfx and writes <file>.expected.json:
#      { file, source, tables: [{ title, columns: [{ name, values, excluded }] }] }
#    Columns are laid out as read_pzfx lays them out (ROWTITLE, X or X_X/X_ERROR, then each Y
#    column with _1.._n or _MEAN/_SD/_N… suffixes). `values` come from strike_action = "keep"
#    (excluded values kept; numbers, or strings when a column has text); `excluded` from
#    strike_action = "star". Date X columns use date_x = "numeric" (the files' numeric X values).

suppressPackageStartupMessages({
  library(jsonlite)
  library(pzfx)
})

ROOT <- normalizePath(file.path("..", ".."))
DIR <- file.path(ROOT, "packages", "io", "test", "fixtures", "pzfx")
dir.create(DIR, recursive = TRUE, showWarnings = FALSE)

examples <- c(
  list.files(system.file("extdata", package = "pzfx"), "\\.pzfx$", full.names = TRUE),
  list.files(system.file("testdata", package = "pzfx"), "\\.pzfx$", full.names = TRUE)
)
invisible(file.copy(examples, DIR, overwrite = TRUE))

for (f in sort(list.files(DIR, "\\.pzfx$", full.names = TRUE))) {
  titles <- pzfx_tables(f)
  tables <- lapply(seq_along(titles), function(i) {
    keep <- read_pzfx(f, i, strike_action = "keep", date_x = "numeric")
    star <- read_pzfx(f, i, strike_action = "star", date_x = "numeric")
    cols <- lapply(seq_along(keep), function(j) {
      s <- as.character(star[[j]])
      list(
        name = names(keep)[j],
        values = I(keep[[j]]),
        excluded = I(!is.na(s) & grepl("\\*$", s))
      )
    })
    list(title = titles[[i]], columns = cols)
  })
  out <- list(
    file = basename(f),
    source = list(
      r = paste(R.version$major, R.version$minor, sep = "."),
      pzfx = as.character(packageVersion("pzfx"))
    ),
    tables = tables
  )
  json <- toJSON(out, auto_unbox = TRUE, digits = I(17), na = "null", null = "null",
                 pretty = TRUE)
  writeLines(json, sub("\\.pzfx$", ".expected.json", f))
  cat(sprintf("%-32s %d table(s)\n", basename(f), length(tables)))
}
