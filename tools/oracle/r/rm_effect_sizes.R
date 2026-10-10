# Effect sizes of repeated-measures ANOVA, as Prism 11 reports them (Statistics Guide,
# "Understanding ANOVA effect sizes"): eta^2 = SS_effect / SS_total (all values), partial
# eta^2 = SS_effect / (SS_effect + SS of the error term the effect is tested against; for one-way
# RM ANOVA this is Prism's R^2 of the treatment effect, Keppel), Cohen's f = sqrt(pe / (1 - pe)).
# SS from aov(... + Error(...)) on balanced complete data.
# input: y, row, col (two-way; one-way uses col only), subject. params: repeated ("one" |
# "rows" | "columns" | "both").

PACKAGES <- character(0)

es <- function(ss, err, sst) {
  pe <- ss / (ss + err)
  list(etaSquared = ss / sst, partialEtaSquared = pe, cohensF = sqrt(pe / (1 - pe)))
}

term <- function(tabs, name) {
  hit <- which(trimws(tabs$term) == name)
  tabs[hit, ]
}

oracle <- function(input, params) {
  d <- data.frame(y = input$y, s = factor(input$subject), c = factor(input$col))
  if (!is.null(input$row)) d$r <- factor(input$row)
  sst <- sum((d$y - mean(d$y))^2)
  rep <- params$repeated
  form <- switch(rep,
    one = y ~ c + Error(s/c),
    rows = y ~ r * c + Error(s/r),
    columns = y ~ r * c + Error(s/c),
    both = y ~ r * c + Error(s/(r * c)))
  a <- summary(aov(form, data = d))
  tabs <- do.call(rbind, lapply(names(a), function(st) {
    t <- a[[st]][[1]]; data.frame(stratum = st, term = trimws(rownames(t)), ss = t$`Sum Sq`)
  }))
  res <- function(st) tabs$ss[tabs$stratum == st & tabs$term == "Residuals"]
  eff <- function(nm) tabs[tabs$term == nm, ]
  pick <- function(nm) { e <- eff(nm); es(e$ss, res(e$stratum), sst) }
  if (rep == "one") return(list(treatment = pick("c")))
  list(row = pick("r"), column = pick("c"), interaction = pick("r:c"))
}
