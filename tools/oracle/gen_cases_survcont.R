# Generates the Phase 4 oracle cases for survival, contingency tables and binomial tests with
# fixed seeds, separately from the earlier generators so their cases are never rewritten.
#
#   cd tools/oracle && Rscript gen_cases_survcont.R

source("lib.R")
unbox <- jsonlite::unbox

write_case <- function(suite, name, input, params = NULL, tol = NULL, note = NULL) {
  dir <- file.path(ORACLE_DIR, "cases", suite)
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  case <- list(input = input)
  if (!is.null(params)) case$params <- lapply(params, unbox)
  if (!is.null(tol)) case$tol <- lapply(tol, unbox)
  if (!is.null(note)) case$note <- unbox(note)
  writeLines(toJSON(case, auto_unbox = FALSE, digits = I(17), pretty = TRUE, na = "string"),
             file.path(dir, paste0(name, ".json")))
}

# ---- survival ---------------------------------------------------------------------------------
sv <- function(name, groups, params = NULL, note = NULL) {
  write_case("survival", name,
             list(time = lapply(groups, function(g) g$time),
                  event = lapply(groups, function(g) as.integer(g$event))),
             params = params, note = note)
}
set.seed(20261201)
gen_group <- function(n, rate, cens_rate, digits = 1) {
  t <- rexp(n, rate); c <- rexp(n, cens_rate)
  list(time = round(pmin(t, c), digits), event = t <= c)
}
g2 <- list(gen_group(20, 0.1, 0.03), gen_group(18, 0.2, 0.03))
sv("two_groups", g2)
sv("two_groups_symmetric_90", g2, params = list(ciMethod = "symmetric", confLevel = 0.9),
   note = "Symmetric (Greenwood, truncated) CIs at 90%; the median CI stays log-log.")
sv("three_groups", list(gen_group(15, 0.08, 0.02), gen_group(15, 0.12, 0.02),
                        gen_group(15, 0.2, 0.02)))
sv("four_groups_trend", list(gen_group(12, 0.05, 0.02), gen_group(14, 0.08, 0.02),
                             gen_group(11, 0.12, 0.02), gen_group(13, 0.2, 0.02)))
sv("ties_between_groups",
   list(list(time = c(1, 2, 2, 3, 4, 4, 5, 6, 6, 8), event = c(1, 1, 0, 1, 1, 1, 0, 1, 0, 1)),
        list(time = c(2, 2, 3, 3, 4, 5, 5, 7, 8, 9), event = c(1, 1, 1, 0, 1, 1, 1, 1, 0, 1)),
        list(time = c(1, 3, 4, 4, 6, 6, 7, 9), event = c(1, 1, 0, 1, 1, 1, 0, 0))),
   note = "Integer times with events tied within and between groups.")
sv("tied_event_censor",
   list(list(time = c(3, 3, 3, 5, 5, 8, 8, 10), event = c(1, 0, 0, 1, 0, 1, 0, 0)),
        list(time = c(2, 3, 3, 4, 5, 5, 6, 6), event = c(1, 1, 0, 1, 1, 0, 1, 0))),
   note = "Events and censorings at the same times: events first, censored still at risk.")
sv("all_censored_group",
   list(list(time = c(2, 4, 5, 7, 9, 12), event = c(1, 1, 0, 1, 1, 0)),
        list(time = c(3, 6, 8, 10), event = c(0, 0, 0, 0))),
   note = paste("Group 2 all censored: its curve stays at 1, median undefined (NaN, CI upper",
                "Inf), log-rank HR 0 with CI [0, 0], no median ratio."))
sv("all_censored_three",
   list(list(time = c(2, 4, 5, 7, 9, 12), event = c(1, 1, 0, 1, 1, 0)),
        list(time = c(3, 6, 8, 10), event = c(0, 0, 0, 0)),
        list(time = c(1, 2, 6, 7, 11), event = c(1, 0, 1, 1, 1))))
sv("median_undefined",
   list(list(time = c(5, 8, 12, 15, 20, 22, 25, 30, 30, 30), event = c(1, 0, 1, 0, 0, 0, 0, 0,
                                                                      0, 0)),
        list(time = c(2, 3, 6, 9, 11, 14, 18, 21), event = c(1, 1, 1, 0, 1, 1, 0, 1))),
   note = "Group 1 stays above 50%: median undefined, so no median ratio.")
sv("flat_at_half",
   list(list(time = c(1, 2, 4, 6, 17, 20), event = c(1, 1, 1, 0, 1, 0)),
        list(time = c(1, 3, 5, 7, 9, 11), event = c(1, 1, 1, 1, 1, 1))),
   note = paste("Group 1: S = 1/2 exactly from t = 4 to 17 (a censoring at 6 leaves it there),",
                "so the median is the midpoint 10.5 (Machin / Prism / R). Group 2 falls to 0",
                "(last subject has the event)."))
sv("ends_at_half",
   list(list(time = c(1, 2, 3, 4), event = c(1, 1, 0, 0)),
        list(time = c(1, 5, 7), event = c(1, 1, 1))),
   note = paste("Group 1 ends flat at exactly 1/2: median = midpoint of the time it reaches 1/2",
                "and the last time (R's findq)."))
sv("single_subject", list(list(time = 4, event = 1), list(time = c(1, 3, 6), event = c(1, 0, 1))),
   note = "A group of one subject.")
sv("single_group", list(gen_group(25, 0.1, 0.03)),
   note = "One group: KM only; the tests are NaN with df 0.")
lt <- list(gen_group(15, 1e-6, 2e-7, digits = 0), gen_group(15, 2e-6, 2e-7, digits = 0))
sv("large_times", lt, note = "Times of order 1e6.")
sv("time_zero_events",
   list(list(time = c(0, 0, 1, 2, 3, 5), event = c(1, 0, 1, 1, 0, 1)),
        list(time = c(0, 2, 4, 4, 6), event = c(1, 1, 1, 0, 1))),
   note = "Events at time 0: the prepended time-0 row (S = 1) is followed by a second time-0 row.")
sv("big_two_groups", list(gen_group(120, 0.05, 0.01), gen_group(110, 0.07, 0.01)))

# ---- contingency tables ------------------------------------------------------------------------
ct <- function(name, table, params = NULL, tol = NULL, note = NULL) {
  write_case("contingency", name, list(table = table), params = params, tol = tol, note = note)
}
ct("t2x2_moderate", list(c(23, 12), c(9, 28)))
ct("t2x2_moderate_90", list(c(23, 12), c(9, 28)), params = list(confLevel = 0.9))
ct("t2x2_doll_hill", list(c(688, 650), c(21, 59)),
   note = "Prism's odds-ratio example (the guide's CI 1.787-4.950 there is Woolf's).")
ct("t2x2_azt", list(c(76, 399), c(129, 332)), note = "Prism's relative-risk example.")
ct("t2x2_newcombe", list(c(56, 14), c(48, 32)),
   note = "Newcombe (1998) example 56/70 vs 48/80: hybrid score 0.0524-0.3339, with CC 0.0428-0.3422.")
ct("t2x2_small", list(c(3, 1), c(1, 3)))
ct("t2x2_7_3_2_8", list(c(7, 3), c(2, 8)),
   note = "The Baptista-Pike lower limit sits on a jump of the P-value function near 1.")
ct("t2x2_yates_backwards", list(c(5, 5), c(4, 5)),
   note = "|O - E| < 1/2: Prism's Yates correction still subtracts 1/2 (R's chisq.test would not).")
ct("t2x2_zero_a", list(c(0, 10), c(5, 5)))
ct("t2x2_zero_b", list(c(5, 0), c(3, 7)))
ct("t2x2_zero_c", list(c(6, 4), c(0, 9)))
ct("t2x2_zero_column", list(c(0, 5), c(0, 7)),
   note = "No outcomes: chi-square NaN, RR NaN with CI [0, Inf], OR CI [0, Inf].")
ct("t2x2_all_outcome", list(c(5, 0), c(7, 0)),
   note = "Every subject has the outcome: RR = 1 with the Koopman limits n1/(n1+z^2), (n2+z^2)/n2.")
ct("t2x2_zero_row", list(c(0, 0), c(3, 4)),
   note = "Empty first row: its proportions and the RR, difference and OR are NaN.")
ct("t2x2_separation", list(c(10, 0), c(0, 10)))
ct("t2x2_large", list(c(1200, 800), c(950, 1050)))
ct("t2x2_mcnemar_prism", list(c(13, 25), c(4, 92)), note = "Prism's McNemar example.")
ct("t2x2_mcnemar_equal", list(c(5, 3), c(3, 6)),
   note = "b = c: McNemar chi-square 0 (no correction), as R's mcnemar.test.")
ct("t2x3", list(c(3, 7, 2), c(8, 2, 5)))
ct("t3x3", list(c(2, 3, 4), c(5, 1, 0), c(1, 1, 6)))
ct("t3x4", list(c(4, 2, 0, 3), c(1, 5, 2, 2), c(0, 1, 6, 1)))
ct("t4x2_trend", list(c(5, 20), c(9, 17), c(14, 12), c(20, 6)))
ct("t5x2_trend_empty_row", list(c(3, 12), c(0, 0), c(6, 9), c(8, 6), c(11, 4)),
   note = "An empty row contributes nothing to the trend test (and makes chi-square NaN).")
ct("t3x2_trend", list(c(10, 40), c(15, 35), c(12, 38)))

# ---- binomial ---------------------------------------------------------------------------------
bn <- function(name, k, n, p0 = 0.5, params = NULL, note = NULL) {
  write_case("binomial", name, list(k = unbox(k), n = unbox(n), p0 = unbox(p0)),
             params = c(list(fn = "binomial"), params), note = note)
}
bn("prism_example", 7, 100, 0.2, note = "Prism's guide: two-tailed P = 0.00061307.")
bn("zero_of_10", 0, 10)
bn("all_of_10", 10, 10)
bn("one_of_20", 1, 20, 0.3, note = "Wilson/Brown: Poisson lower limit (x = 1).")
bn("two_of_45", 2, 45, 0.1, note = "Wilson/Brown: Poisson lower limit (x = 2).")
bn("three_of_40", 3, 40, 0.1, note = "x = 3 with n <= 50: plain Wilson.")
bn("three_of_60", 3, 60, 0.05, note = "x = 3 with n > 50: Poisson lower limit.")
bn("fiftyeight_of_60", 58, 60, 0.9, note = "n - x = 2: Poisson upper limit.")
bn("ninetyseven_of_100", 97, 100, 0.9, note = "n - x = 3 with n > 50: Poisson upper limit.")
bn("one_of_1", 1, 1, note = "x = n = 1: upper 1, lower by Wilson (x = n takes precedence).")
bn("one_of_2", 1, 2, note = "x = 1 and n - x = 1: both limits from the Poisson rule.")
bn("mcnemar_prism", 25, 29)
bn("mid_1000", 500, 1000, 0.52)
bn("large_10000", 4000, 10000, 0.41)
bn("conf99", 12, 37, 0.25, params = list(confLevel = 0.99))
bn("p0_zero", 0, 10, 0)
bn("p0_one", 8, 8, 1)
gf <- function(name, observed, expected, note = NULL) {
  write_case("binomial", name, list(observed = observed, expected = expected),
             params = list(fn = "gof"), note = note)
}
gf("gof_two", c(7, 93), c(20, 80))
gf("gof_proportions", c(18, 55, 27), c(0.25, 0.5, 0.25))
gf("gof_counts_rescaled", c(12, 30, 25, 13), c(20, 40, 30, 10),
   note = "Expected counts summing to 100 against 80 observed: rescaled.")
gf("gof_uneven", c(0, 3, 9, 30), c(1, 2, 3, 4))
