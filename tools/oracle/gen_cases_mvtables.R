# Generates the oracle cases of roadmap item 19 (statistics of multiple-variables tables:
# categorical predictors, prediction, multifactor ANOVA, survival from variables) with fixed
# seeds. Missing cells are JSON null. Each section can be run on its own:
#
#   cd tools/oracle && Rscript gen_cases_mvtables.R [catreg | multifactor | mvsurvival ...]

source("lib.R")

write_case <- function(suite, name, columns, params, note = NULL, tol = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = list(columns = columns),
               params = structure(params, class = "json"))
  if (!is.null(tol)) case$tol <- lapply(tol, jsonlite::unbox)
  if (!is.null(note)) case$note <- jsonlite::unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "null",
                    json_verbatim = TRUE),
             file.path(dir, paste0(name, ".json")))
}

sections <- commandArgs(trailingOnly = TRUE)
want <- function(s) length(sections) == 0 || s %in% sections

# ---- catreg: categorical predictors in linear, logistic, Poisson and Cox regression -----------
if (want("catreg")) {
  set.seed(20261901)
  n <- 48
  age <- round(runif(n, 30, 75))
  sex <- sample(c("M", "F"), n, replace = TRUE)
  sex[1] <- "M"   # first level in the table is M (not alphabetical)
  arm <- rep(c("Placebo", "Low", "High"), length.out = n)
  site <- sample(c("North", "South"), n, replace = TRUE)
  dose <- c(Placebo = 0, Low = 10, High = 20)[arm]
  sbp <- round(95 + 0.5 * age + 6 * (sex == "M") - 0.3 * dose +
                 0.15 * (age - 50) * (sex == "M") + rnorm(n, 0, 7), 1)
  sbp[5] <- NA        # a row to interpolate
  age_miss <- age; age_miss[9] <- NA   # a row left out
  write_case("catreg", "linear_interactions", list(
    SBP = sbp, Age = age_miss, Sex = sex, Arm = arm),
    '{"model": "linear", "y": "SBP", "interactions": [["Age", "Sex"], ["Sex", "Arm"]],
      "interpolate": true,
      "predictions": [{"Age": 50, "Sex": "F", "Arm": "High"}, {"Sex": "M"}]}',
    note = "Sex first appears as M (the reference by the first-level rule); row 5 has no SBP (interpolated), row 9 no Age (left out); the second point takes the mean Age and the reference Arm.")

  write_case("catreg", "linear_reference_rules", list(
    SBP = sbp, Age = age, Sex = sex, Dose = unname(dose), Site = site),
    '{"model": "linear", "y": "SBP", "categorical": ["Dose"], "referenceRule": "mostFrequent",
      "referenceLevels": {"Dose": "20"}, "confidenceLevel": 0.9,
      "predictions": [{"Age": 60, "Sex": "M", "Dose": 10, "Site": "South"}]}',
    note = "Numeric Dose treated as categorical with a chosen reference (20); Sex and Site by the most-frequent rule; 90% CIs.")

  set.seed(20261902)
  n3 <- 120
  sex3 <- rep(c("F", "M"), length.out = n3)
  arm3 <- rep(rep(c("A", "B", "C"), each = 2), length.out = n3)
  site3 <- sample(c("S1", "S2"), n3, replace = TRUE)
  age3 <- round(runif(n3, 20, 70))
  y3 <- round(10 + 0.1 * age3 + 2 * (sex3 == "M") + c(A = 0, B = 1, C = 3)[arm3] +
                1.5 * (sex3 == "M") * (arm3 == "C") * (site3 == "S2") + rnorm(n3, 0, 2), 2)
  write_case("catreg", "linear_three_way", list(
    Y = unname(y3), Age = age3, Sex = sex3, Arm = arm3, Site = site3),
    '{"model": "linear", "y": "Y", "referenceRule": "last",
      "interactions": [["Sex", "Arm"], ["Sex", "Site"], ["Arm", "Site"], ["Sex", "Arm", "Site"]]}',
    note = "Three-way interaction of categorical variables; references by the last-level rule.")

  set.seed(20261903)
  nl <- 90
  agel <- round(runif(nl, 25, 80))
  arml <- sample(c("Placebo", "Drug A", "Drug B"), nl, replace = TRUE)
  sexl <- sample(c("F", "M"), nl, replace = TRUE)
  eta <- -3 + 0.04 * agel + c(Placebo = 0, "Drug A" = 0.8, "Drug B" = 1.4)[arml] - 0.4 * (sexl == "M")
  resp <- as.numeric(runif(nl) < plogis(eta))
  resp[3] <- NA
  write_case("catreg", "logistic_categorical", list(
    Response = resp, Age = agel, Arm = arml, Sex = sexl),
    '{"model": "logistic", "y": "Response", "ciMethod": "wald", "interactions": [["Age", "Arm"]],
      "referenceLevels": {"Arm": "Placebo"}, "interpolate": true,
      "predictions": [{"Age": 40, "Arm": "Drug B", "Sex": "F"}]}',
    note = "Text levels with a space; Placebo chosen as reference; row 3 has no outcome (predicted probability).")

  set.seed(20261904)
  np <- 80
  agep <- round(runif(np, 30, 75))
  smoker <- sample(c("no", "yes"), np, replace = TRUE, prob = c(0.65, 0.35))
  region <- sample(c("East", "West", "Central"), np, replace = TRUE)
  mu <- exp(-1.2 + 0.025 * agep + 0.6 * (smoker == "yes") + c(East = 0, West = 0.3, Central = -0.2)[region])
  visits <- rpois(np, mu)
  visits[np] <- NA
  write_case("catreg", "poisson_categorical", list(
    Visits = visits, Age = agep, Smoker = smoker, Region = unname(region)),
    '{"model": "poisson", "y": "Visits", "referenceRule": "leastFrequent", "interpolate": true,
      "predictions": [{"Age": 55, "Smoker": "yes", "Region": "West"}]}',
    note = "References by the least-frequent rule; the last row has no count (predicted).")

  set.seed(20261905)
  nc <- 100
  agec <- round(runif(nc, 40, 80))
  armc <- rep(c("Control", "Low", "High"), length.out = nc)
  sexc <- sample(c("F", "M"), nc, replace = TRUE)
  hz <- 0.01 * exp(0.03 * (agec - 60) + c(Control = 0, Low = -0.4, High = -0.9)[armc] + 0.3 * (sexc == "M"))
  tt <- rexp(nc, hz)
  cens <- runif(nc, 50, 300)
  days <- round(pmin(tt, cens)); days[days < 1] <- 1
  died <- as.numeric(tt <= cens)
  write_case("catreg", "cox_categorical", list(
    Days = days, Died = died, Age = agec, Arm = unname(armc), Sex = sexc),
    '{"model": "cox", "time": "Days", "event": "Died", "ciMethod": "wald",
      "interactions": [["Arm", "Sex"]],
      "survivalCurves": [{"Age": 60, "Arm": "High", "Sex": "F"}, {"Arm": "Low"}]}',
    note = "Cox with a categorical interaction; estimated survival curves at categorical values (missing numeric = 0, missing categorical = reference).")
}

# ---- multifactor: N-way ANOVA -----------------------------------------------------------------
if (want("multifactor")) {
  set.seed(20261911)
  lv <- expand.grid(A = c("a1", "a2", "a3"), B = c("b1", "b2"), C = c("c1", "c2"),
                    stringsAsFactors = FALSE)
  reps <- sample(2:5, nrow(lv), replace = TRUE)
  d <- lv[rep(seq_len(nrow(lv)), reps), ]
  d <- d[sample(nrow(d)), ]
  eff <- c(a1 = 0, a2 = 1.5, a3 = 3)[d$A] + c(b1 = 0, b2 = -1)[d$B] + c(c1 = 0, c2 = 0.8)[d$C] +
    1.2 * (d$A == "a3") * (d$B == "b2")
  y <- round(20 + eff + rnorm(nrow(d), 0, 1.2), 2)
  cols <- list(Y = y, A = d$A, B = d$B, C = d$C)
  write_case("multifactor", "unbalanced_3way_full", cols,
    '{"y": "Y", "comparisons": "mainEffects", "compareFactor": "A", "method": "tukey"}',
    note = "3 x 2 x 2 unbalanced, 2-5 values per cell, rows shuffled; default terms (all two- and three-way interactions); Tukey on A.")
  write_case("multifactor", "unbalanced_3way_simple_sidak", cols,
    '{"y": "Y", "interactions": [["A", "B"]], "comparisons": "simpleEffects",
      "compareFactor": "A", "byFactor": "B", "method": "sidak"}',
    note = "Only the A:B interaction; simple effects of A within B, one family per level, Sidak.")
  write_case("multifactor", "unbalanced_3way_simple_all_holm", cols,
    '{"y": "Y", "interactions": [["A", "B"]], "comparisons": "simpleEffects",
      "compareFactor": "A", "byFactor": "B", "method": "holm-sidak", "family": "all"}',
    note = "Simple effects as one family, Holm-Sidak.")
  write_case("multifactor", "unbalanced_3way_cells_bonferroni", cols,
    '{"y": "Y", "interactions": [["A", "B"], ["A", "C"]], "comparisons": "cells",
      "compareFactor": "A", "byFactor": "C", "method": "bonferroni"}',
    note = "A:B and A:C only; every A x C cell with every other, Bonferroni.")
  write_case("multifactor", "main_effects_only_tukey_cells", cols,
    '{"y": "Y", "interactions": [], "comparisons": "cells", "compareFactor": "B",
      "byFactor": "C", "method": "tukey"}',
    note = "Additive model (no interactions): marginal means from the additive fit.")

  set.seed(20261912)
  lv4 <- expand.grid(A = c("x", "y"), B = c("p", "q"), C = c("u", "v"), D = c(1, 2),
                     stringsAsFactors = FALSE)
  d4 <- lv4[rep(seq_len(nrow(lv4)), sample(3:6, nrow(lv4), replace = TRUE)), ]
  y4 <- round(5 + (d4$A == "y") * 1 + (d4$B == "q") * 0.5 + (d4$D == 2) * 0.7 + rnorm(nrow(d4), 0, 1), 3)
  write_case("multifactor", "four_factors_numeric_factor", list(
    Response = y4, A = d4$A, B = d4$B, C = d4$C, Dose = d4$D),
    '{"y": "Response", "comparisons": "mainEffects", "compareFactor": "Dose", "method": "fisher"}',
    note = "Four factors (Dose numeric, used as a factor), default terms: 4 main effects, 6 two-way and 4 three-way interactions, no four-way; Fisher's LSD.")

  set.seed(20261913)
  d2 <- expand.grid(A = c("lo", "mid", "hi"), B = c("K", "L"), stringsAsFactors = FALSE)
  d2 <- d2[rep(1:6, c(4, 5, 3, 6, 4, 5)), ]
  y2 <- 1e6 + round(c(lo = 0, mid = 0.02, hi = 0.05)[d2$A] + c(K = 0, L = 0.01)[d2$B] +
                      rnorm(nrow(d2), 0, 0.01), 4)
  write_case("multifactor", "offset_1e6_two_way", list(Y = unname(y2), A = d2$A, B = d2$B),
    '{"y": "Y", "comparisons": "simpleEffects", "compareFactor": "B", "byFactor": "A",
      "method": "tukey"}',
    note = "Large offset (1e6) and small variance: numerical stability.")
}

# ---- mvsurvival: Kaplan-Meier from multiple-variables tables ----------------------------------
if (want("mvsurvival")) {
  set.seed(20261921)
  n <- 60
  trt <- sample(c("Standard", "New"), n, replace = TRUE)
  stage <- sample(c("I", "II"), n, replace = TRUE)
  t <- round(rexp(n, 0.02 * c(Standard = 1, New = 0.6)[trt] * c(I = 1, II = 1.8)[stage]))
  t[t < 1] <- 1
  cens <- round(runif(n, 20, 120))
  time <- pmin(t, cens)
  status <- ifelse(t <= cens, "Died", "Alive")
  status[7] <- NA
  write_case("mvsurvival", "text_status_two_groups", list(
    Months = time, Outcome = status, Treatment = unname(trt), Stage = unname(stage)),
    '{"time": "Months", "status": "Outcome", "groups": ["Treatment", "Stage"], "eventLevel": "Died"}',
    note = "Text status (Died = event, any other = censored), one curve per Treatment x Stage combination; row 7 has no status.")
  code <- as.numeric(t <= cens)
  write_case("mvsurvival", "numeric_status_one_group", list(
    Months = time, Code = code, Treatment = unname(trt)),
    '{"time": "Months", "status": "Code", "groups": ["Treatment"]}',
    note = "Numeric status (1 = event, 0 = censored), grouped by treatment.")
}
