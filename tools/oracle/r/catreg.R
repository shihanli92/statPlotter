# Categorical predictors in multiple linear, logistic, Poisson and Cox regression of a
# multiple-variables table (roadmap item 19), checked through the analysis plugins.
#
# input: columns (name -> values; text or numbers, null = missing). params: model (linear |
# logistic | poisson | cox), y (or time + event), categorical (numeric columns used as factors),
# referenceRule (first | last | mostFrequent | leastFrequent), referenceLevels (name -> level),
# interactions (lists of names), interpolate, predictions / survivalCurves (name -> value),
# confidenceLevel, ciMethod (Wald only here). Every column other than the outcome(s) is a
# predictor, in column order.
#
# Conventions reproduced independently of the TypeScript code:
# - complete cases over the outcome(s) and predictors; text trimmed, "" missing; a numeric column
#   used as a factor has levels as.character(value);
# - levels in order of first appearance in the whole column, restricted to the analyzed rows;
#   reference by the rule (counts over analyzed rows, ties to the earlier level) or as chosen;
# - the model is fitted with R's formula interface: factor(levels) + relevel(ref) and the default
#   contr.treatment, so coefficient names are R's ("SexM", "Age:SexM"); the test strips the
#   brackets of ours ("Sex[M]") to match;
# - term tests: car::Anova(type = 3) (F for lm; LR chi-square for glm and coxph), cross-checked
#   against refits without each term's model-matrix columns (glm.fit / coxph at tight
#   tolerances, which are the expected LR values; car's own glm refits use epsilon 1e-8, so it is
#   only checked to 1e-6);
# - the ANOVA table's Regression row: SS_total - SS_residual on p - 1 df;
# - predictions: predict(interval = "confidence") for lm; predict(type = "link", se.fit = TRUE)
#   transformed by the inverse link with z for glm; rows with every predictor but no outcome, then
#   the points (a missing numeric = mean of the analyzed values, missing categorical = reference);
# - Cox survival curves: survfit(fit, newdata, stype = 1) (Kalbfleisch-Prentice, as the
#   coxcurves suite) at the event times; missing numeric = 0, missing categorical = reference.

PACKAGES <- c("car", "survival")
suppressPackageStartupMessages({
  library(car)
  library(survival)
})

GLM_CTRL <- glm.control(epsilon = 1e-14, maxit = 100)
COX_CTRL <- coxph.control(eps = 1e-11, iter.max = 100)

labels_of <- function(x) {
  if (is.character(x)) {
    s <- trimws(x)
    s[!is.na(s) & s == ""] <- NA
    s
  } else ifelse(is.na(x), NA_character_, as.character(x))
}

as_list_of_vectors <- function(x) {
  if (is.null(x) || length(x) == 0) return(list())
  if (is.matrix(x)) return(lapply(seq_len(nrow(x)), function(i) x[i, ]))
  x
}

rows_of <- function(x) {
  if (is.null(x) || length(x) == 0) return(list())
  if (is.data.frame(x)) return(lapply(seq_len(nrow(x)), function(i) as.list(x[i, , drop = FALSE])))
  x
}

prepare <- function(input, params) {
  cols <- input$columns
  nm <- names(cols)
  model <- params$model
  outcomes <- if (model == "cox") c(params$time, params$event) else params$y
  preds <- setdiff(nm, outcomes)
  catset <- if (is.null(params$categorical)) character(0) else unlist(params$categorical)
  is_cat <- sapply(preds, function(p) is.character(cols[[p]]) || p %in% catset)
  n <- max(sapply(cols, length))
  has <- function(v) if (is.character(cols[[v]])) !is.na(labels_of(cols[[v]])) else !is.na(cols[[v]])
  used <- c(outcomes, preds)
  ok <- Reduce(`&`, lapply(used, has))
  rows <- which(ok)
  pred_ok <- Reduce(`&`, lapply(preds, has))
  predict_rows <- which(!ok & pred_ok)
  rule <- if (is.null(params$referenceRule)) "first" else params$referenceRule
  chosen <- params$referenceLevels
  df <- data.frame(row.names = seq_along(rows))
  for (o in outcomes) df[[o]] <- cols[[o]][rows]
  lv <- list()
  for (p in preds) {
    if (!is_cat[[p]]) { df[[p]] <- cols[[p]][rows]; next }
    lab <- labels_of(cols[[p]])
    all_lv <- unique(lab[!is.na(lab)])
    levels <- all_lv[all_lv %in% unique(lab[rows])]
    counts <- sapply(levels, function(l) sum(lab[rows] == l))
    ref <- switch(rule, first = 1, last = length(levels), mostFrequent = which.max(counts),
                  leastFrequent = which.min(counts))
    if (!is.null(chosen[[p]]) && chosen[[p]] %in% levels) ref <- match(chosen[[p]], levels)
    lv[[p]] <- list(levels = levels, ref = levels[ref])
    df[[p]] <- relevel(factor(lab[rows], levels = levels), ref = levels[ref])
  }
  inter <- lapply(as_list_of_vectors(params$interactions), function(t) preds[sort(match(t, preds))])
  inter <- inter[order(sapply(inter, length))]
  terms <- c(preds, sapply(inter, paste, collapse = ":"))
  list(cols = cols, df = df, preds = preds, is_cat = is_cat, lv = lv, rows = rows,
       predict_rows = predict_rows, terms = terms, outcomes = outcomes)
}

# New data: the table's rows to interpolate, then the points.
newdata_of <- function(pr, params, missing_numeric) {
  nd <- list()
  add_row <- function(vals) {
    r <- lapply(pr$preds, function(p) {
      v <- vals[[p]]
      if (pr$is_cat[[p]]) {
        lab <- if (is.null(v) || is.na(v) || identical(v, "")) pr$lv[[p]]$ref else trimws(as.character(v))
        factor(lab, levels = levels(pr$df[[p]]))
      } else {
        if (is.null(v) || is.na(v) || identical(v, "")) missing_numeric(p) else as.numeric(v)
      }
    })
    names(r) <- pr$preds
    nd[[length(nd) + 1]] <<- as.data.frame(r, check.names = FALSE)
  }
  if (isTRUE(params$interpolate))
    for (r in pr$predict_rows) add_row(lapply(setNames(pr$preds, pr$preds), function(p) {
      v <- pr$cols[[p]][r]
      if (pr$is_cat[[p]]) labels_of(pr$cols[[p]])[r] else v
    }))
  pts <- rows_of(if (!is.null(params$survivalCurves)) params$survivalCurves else params$predictions)
  for (pt in pts) add_row(pt)
  if (!length(nd)) return(NULL)
  do.call(rbind, nd)
}

coef_rows <- function(est, se, stat, p, lower, upper, ratio) {
  lapply(seq_along(est), function(j) {
    r <- list(name = names(est)[j], estimate = unname(est[j]), se = unname(se[j]),
              lower = unname(lower[j]), upper = unname(upper[j]), stat = unname(stat[j]),
              p = unname(p[j]))
    if (ratio) {
      r$ratio <- exp(unname(est[j])); r$ratioLower <- exp(unname(lower[j]))
      r$ratioUpper <- exp(unname(upper[j]))
    }
    r
  })
}

oracle <- function(input, params) {
  pr <- prepare(input, params)
  level <- if (is.null(params$confidenceLevel)) 0.95 else params$confidenceLevel
  z <- qnorm(1 - (1 - level) / 2)
  model <- params$model
  rhs <- paste(pr$terms, collapse = " + ")
  out <- list(n = length(pr$rows))
  mean_of <- function(p) mean(pr$df[[p]])

  if (model == "linear") {
    fml <- as.formula(paste0("`", params$y, "` ~ ", rhs))
    fit <- lm(fml, data = pr$df)
    s <- coef(summary(fit))
    ci <- confint(fit, level = level)
    out$coefficients <- coef_rows(s[, 1], s[, 2], s[, 3], s[, 4], ci[, 1], ci[, 2], FALSE)
    a <- Anova(fit, type = 3)
    X <- model.matrix(fit); asg <- attr(X, "assign"); y <- pr$df[[params$y]]
    rss <- function(M) sum(lm.fit(M, y)$residuals^2)
    rssFull <- rss(X)
    tl <- attr(terms(fit), "term.labels")
    out$terms <- lapply(seq_along(tl), function(k) {
      row <- a[tl[k], ]
      manual <- rss(X[, asg != k, drop = FALSE]) - rssFull
      stopifnot(abs(manual - row[["Sum Sq"]]) < 1e-8 * (1 + manual))
      list(name = tl[k], ss = row[["Sum Sq"]], df = row[["Df"]], F = row[["F value"]],
           p = row[["Pr(>F)"]])
    })
    dfr <- fit$df.residual
    sst <- sum((y - mean(y))^2)
    ssm <- sst - rssFull; dfm <- ncol(X) - 1
    out$model <- list(ss = ssm, df = dfm, F = (ssm / dfm) / (rssFull / dfr),
                      p = pf((ssm / dfm) / (rssFull / dfr), dfm, dfr, lower.tail = FALSE))
    out$residual <- list(ss = rssFull, df = dfr)
    out$total <- list(ss = sst, df = length(y) - 1)
    nd <- newdata_of(pr, params, mean_of)
    if (!is.null(nd)) {
      pp <- predict(fit, newdata = nd, interval = "confidence", level = level)
      out$predictions <- lapply(seq_len(nrow(pp)), function(i)
        list(value = pp[i, "fit"], lower = pp[i, "lwr"], upper = pp[i, "upr"]))
    }
    return(out)
  }

  if (model %in% c("logistic", "poisson")) {
    fam <- if (model == "logistic") binomial() else poisson()
    fml <- as.formula(paste0("`", params$y, "` ~ ", rhs))
    fit <- glm(fml, family = fam, data = pr$df, control = GLM_CTRL)
    for (r in 1:2) fit <- glm(fml, family = fam, data = pr$df, start = coef(fit), control = GLM_CTRL)
    s <- coef(summary(fit))
    out$coefficients <- coef_rows(s[, 1], s[, 2], s[, 3], s[, 4], s[, 1] - z * s[, 2],
                                  s[, 1] + z * s[, 2], TRUE)
    X <- model.matrix(fit); asg <- attr(X, "assign"); y <- pr$df[[params$y]]
    ll <- function(M) {
      f <- glm.fit(M, y, family = fam, control = GLM_CTRL)
      f <- glm.fit(M, y, family = fam, start = f$coefficients, control = GLM_CTRL)
      if (model == "logistic") sum(dbinom(y, 1, f$fitted.values, log = TRUE)) else
        sum(dpois(y, f$fitted.values, log = TRUE))
    }
    llFull <- as.numeric(logLik(fit))
    stopifnot(abs(ll(X) - llFull) < 1e-9 * abs(llFull))
    a <- Anova(fit, type = 3, test.statistic = "LR")
    tl <- attr(terms(fit), "term.labels")
    out$terms <- lapply(seq_along(tl), function(k) {
      chi <- 2 * (llFull - ll(X[, asg != k, drop = FALSE]))
      df <- sum(asg == k)
      stopifnot(abs(chi - a[tl[k], "LR Chisq"]) < 1e-6 * (1 + chi), a[tl[k], "Df"] == df)
      list(name = tl[k], chiSq = chi, df = df, p = pchisq(chi, df, lower.tail = FALSE))
    })
    nd <- newdata_of(pr, params, mean_of)
    if (!is.null(nd)) {
      pp <- predict(fit, newdata = nd, type = "link", se.fit = TRUE)
      inv <- fam$linkinv
      out$predictions <- lapply(seq_along(pp$fit), function(i)
        list(value = inv(pp$fit[i]), lower = inv(pp$fit[i] - z * pp$se.fit[i]),
             upper = inv(pp$fit[i] + z * pp$se.fit[i])))
    }
    return(out)
  }

  # Cox
  d <- pr$df
  d$.time <- d[[params$time]]; d$.event <- d[[params$event]]
  fml <- as.formula(paste("Surv(.time, .event) ~", rhs))
  fit <- coxph(fml, data = d, ties = "efron", control = COX_CTRL)
  fit <- coxph(fml, data = d, ties = "efron", init = coef(fit), control = COX_CTRL)
  s <- coef(summary(fit))
  out$coefficients <- coef_rows(s[, 1], s[, 3], s[, 4], s[, 5], s[, 1] - z * s[, 3],
                                s[, 1] + z * s[, 3], TRUE)
  X <- model.matrix(fit); asg <- attr(X, "assign")
  S <- Surv(d$.time, d$.event)
  llc <- function(M) {
    if (ncol(M) == 0) return(fit$loglik[1])
    f <- coxph(S ~ M, ties = "efron", control = COX_CTRL)
    f <- coxph(S ~ M, ties = "efron", init = coef(f), control = COX_CTRL)
    f$loglik[2]
  }
  llFull <- fit$loglik[2]
  a <- Anova(fit, type = 3, test.statistic = "LR")
  tl <- attr(terms(fit), "term.labels")
  out$terms <- lapply(seq_along(tl), function(k) {
    chi <- 2 * (llFull - llc(X[, asg != k, drop = FALSE]))
    df <- sum(asg == k)
    stopifnot(abs(chi - a[tl[k], "LR Chisq"]) < 1e-6 * (1 + chi))
    list(name = tl[k], chiSq = chi, df = df, p = pchisq(chi, df, lower.tail = FALSE))
  })
  nd <- newdata_of(pr, params, function(p) 0)
  if (!is.null(nd)) {
    sf <- survfit(fit, newdata = nd, stype = 1)
    ev <- sf$n.event > 0
    out$curves <- lapply(seq_len(nrow(nd)), function(i) unname(as.matrix(sf$surv)[ev, i]))
  }
  out
}
