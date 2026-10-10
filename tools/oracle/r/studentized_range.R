# Studentized range distribution (ptukey / qtukey). params$fn selects:
#   "ptukey_r"    R's ptukey() on a grid (both tails). R is accurate only to ~1e-11 absolute
#                 (fixed 16-point Gauss-Legendre panels), so its upper tail -- computed as
#                 1 - lower -- has large relative errors below ~1e-6; the case tolerance says so.
#   "ptukey_ref"  reference values by explicit nested integrate() (ref_integrals.R), both tails
#                 computed directly; these agree with ptukey() to its accuracy and are what the
#                 TS code is held to at ~1e-11.
#   "qtukey"      quantiles: R's qtukey() (documented as accurate to ~4 decimals) and the root
#                 of ptukey(q) = p by uniroot() at tol 1e-14 (limited by ptukey's ~1e-11).
#   "qtukey_ref"  quantiles as roots of the reference upper tail (ptukey_ref) = 1 - p.

source(file.path(ORACLE_DIR, "ref_integrals.R"))

PACKAGES <- character(0)

oracle <- function(input, params) {
  q <- as.numeric(input$q); k <- as.numeric(input$k); df <- as.numeric(input$df)
  switch(params$fn,
    ptukey_r = list(
      lower = ptukey(q, k, df),
      upper = ptukey(q, k, df, lower.tail = FALSE)
    ),
    ptukey_ref = {
      lo <- mapply(ptukey_ref, q, k, df, MoreArgs = list(lower = TRUE))
      up <- mapply(ptukey_ref, q, k, df, MoreArgs = list(lower = FALSE))
      # cross-check against R's own ptukey, which is off by up to ~6e-5 (q = 12, k = 50, df = 2)
      stopifnot(all(abs(lo - ptukey(q, k, df)) < 1e-4))
      list(lower = lo, upper = up)
    },
    qtukey = {
      p <- as.numeric(input$p)
      root <- mapply(function(p, k, df) {
        uniroot(function(x) ptukey(x, k, df) - p, c(1e-3, 200), tol = 1e-14)$root
      }, p, k, df)
      stopifnot(all(abs(root - qtukey(p, k, df)) < 1e-3 * root))
      list(q = root, qR = qtukey(p, k, df))
    },
    qtukey_ref = {
      p <- as.numeric(input$p)
      root <- mapply(function(p, k, df) {
        upper_quantile(function(x) ptukey_ref(x, k, df, lower = FALSE), 1 - p,
                       qtukey(p, k, df))
      }, p, k, df)
      list(q = root)
    },
    stop("unknown fn ", params$fn)
  )
}
