# Regenerates oracle fixtures from cases/.
#
#   pnpm oracle                  # all suites
#   pnpm oracle descriptive      # one suite
#
# Each suite is r/<suite>.R defining:
#   PACKAGES      character vector of packages whose versions are recorded in fixtures
#   oracle(input, params)  -> named list of expected values
# and a matching cases/<suite>/ directory.

source("lib.R")

suites <- commandArgs(trailingOnly = TRUE)
if (length(suites) == 0) suites <- sub("\\.R$", "", list.files("r", pattern = "\\.R$"))

for (suite in suites) {
  env <- new.env()
  sys.source(file.path("r", paste0(suite, ".R")), envir = env)
  cases <- read_cases(suite)
  for (case in cases) {
    expected <- env$oracle(case$input, case$params)
    write_fixture(suite, case, expected, packages = env$PACKAGES)
  }
  cat(sprintf("%-20s %d fixtures\n", suite, length(cases)))
}
