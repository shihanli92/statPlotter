# Analyze a stack of P values: input$p (one per row), params$family (bky / bh / by / holm-sidak /
# sidak / bonferroni / none), params$q (a fraction), params$alpha. The decisions, q values /
# adjusted P values and BKY's estimated number of true nulls come from the multiple_t suite's
# family() (p.adjust, ref_padjust.R, the step-up procedures written out).

PACKAGES <- character(0)

MT <- new.env()
sys.source(file.path(ORACLE_DIR, "r", "multiple_t.R"), envir = MT)

oracle <- function(input, params) {
  MT$family(as.numeric(input$p), params)
}
