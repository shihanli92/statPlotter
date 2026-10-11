# Multiplicity adjustment of P values. bonferroni, holm, BH ("bh") and BY ("by") are R's
# p.adjust (with n = the family size when params$n is given); Sidak and Holm-Sidak are written
# out (ref_padjust.R); "bky" is the q value of the two-stage step-up procedure of Benjamini,
# Krieger & Yekutieli (2006, Definition 6) at Q = 0.05 (bky_q: BH-adjusted
# P x (1 + Q) m0 / m).

source(file.path(ORACLE_DIR, "ref_padjust.R"))

PACKAGES <- character(0)

oracle <- function(input, params) {
  p <- input$p
  m <- if (is.null(params$n)) length(p) else params$n
  list(
    bonferroni = p.adjust(p, "bonferroni", n = m),
    sidak = pmin(1, sidak_adj(p, m)),
    holm = p.adjust(p, "holm", n = m),
    holmSidak = holm_sidak(p, m),
    bh = p.adjust(p, "BH", n = m),
    by = p.adjust(p, "BY", n = m),
    bky = bky_q(p, 0.05, m)
  )
}
