# Shared helpers for the R oracle. Run from tools/oracle/ so renv activates (.Rprofile).

suppressPackageStartupMessages(library(jsonlite))

ORACLE_DIR <- normalizePath(".")
ROOT <- normalizePath(file.path(ORACLE_DIR, "..", ".."))
FIXTURES <- file.path(ROOT, "packages", "stats", "test", "fixtures")

# 17 significant digits round-trips every double exactly. digits = NA gives only 15.
to_json <- function(x, ...) {
  toJSON(x, auto_unbox = TRUE, digits = I(17), na = "string", null = "null",
         json_verbatim = TRUE, pretty = TRUE, ...)
}

# Compact JSON that holds every number exactly: 15 significant digits when they round-trip (the
# shortest text for most numbers), else 17, which round-trips every double (1/3, log10(3)).
exact_json <- function(x) {
  short <- toJSON(x, auto_unbox = TRUE, digits = I(15), null = "null")
  if (isTRUE(all.equal(fromJSON(short, simplifyVector = FALSE), x, tolerance = 0))) return(short)
  toJSON(x, auto_unbox = TRUE, digits = I(17), null = "null")
}

# A case file is { "input": {...}, "params": {...}, "tol": {...}? }. The input is re-emitted
# verbatim into the fixture so length-1 arrays keep their shape.
read_cases <- function(suite) {
  files <- sort(list.files(file.path(ORACLE_DIR, "cases", suite), pattern = "\\.json$",
                           full.names = TRUE))
  lapply(files, function(f) {
    raw <- paste(readLines(f, warn = FALSE), collapse = "\n")
    parsed <- fromJSON(raw, simplifyVector = TRUE)
    list(
      name = sub("\\.json$", "", basename(f)),
      input = parsed$input,
      params = if (is.null(parsed$params)) setNames(list(), character(0)) else parsed$params,
      tol = parsed$tol,
      note = parsed$note,
      input_json = structure(toJSON(fromJSON(raw, simplifyVector = FALSE)$input,
                                    auto_unbox = TRUE, digits = I(17), null = "null"),
                             class = "json"),
      params_json = structure(
        if (is.null(parsed$params)) "{}" else
          exact_json(fromJSON(raw, simplifyVector = FALSE)$params),
        class = "json")
    )
  })
}

source_info <- function(packages = character(0)) {
  pk <- setNames(lapply(packages, function(p) as.character(packageVersion(p))), packages)
  list(r = paste(R.version$major, R.version$minor, sep = "."), packages = pk)
}

write_fixture <- function(suite, case, expected, packages = character(0)) {
  dir <- file.path(FIXTURES, suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  out <- list(
    name = case$name,
    input = case$input_json,
    params = case$params_json,
    expected = expected,
    source = source_info(packages)
  )
  if (!is.null(case$tol)) out$tol <- case$tol
  if (!is.null(case$note)) out$note <- case$note
  writeLines(to_json(out), file.path(dir, paste0(case$name, ".json")))
}
