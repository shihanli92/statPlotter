# Feature coverage

What statPlotter covers, area by area: the data tables, analyses and graphs of a lab graphing and
statistics app. Status: ✅ done (R oracles), ◐ partly, ✗ missing. "Phase" is the roadmap phase
([ROADMAP.md](ROADMAP.md)) that did an item or where a missing item is planned; blank means not
yet planned.

## Data tables

| Table | Status | Notes |
| --- | --- | --- |
| XY, Column, Grouped, Contingency, Survival | ✅ | |
| Multiple variables | ✅ | Numeric, text (categorical) and calculated variables with a formula language (19) |
| Parts of whole | ✅ | Editor, New table option and graphs (pie, donut, 100% stacked bars; 17); observed vs. expected (chi-square goodness of fit, binomial) and fraction of total (18) |
| Nested | ✅ | Nested t test and nested one-way ANOVA, editor, import and graphs (13) |

## Data table editing

Roadmap 29; every edit is one undo step.

| Feature | Status | Notes |
| --- | --- | --- |
| Sort rows | ✅ | Edit › Sort… by up to three columns (row titles, X, any subcolumn, text variables), ascending or descending, blanks last; quick sorts in a column header's menu. The whole table is sorted; graphs' row slices, point labels and formats, brackets and analysis settings naming rows follow |
| Select, insert, delete and move rows | ✅ | Row numbers select rows (Shift extends, drag selects); drag selected rows to a new place, ⌥⌘↑ / ⌥⌘↓; Insert rows adds as many as are selected |
| Insert, delete and move columns | ✅ | Drag data set headers; Move column left / right; Insert column before the selection; X and row titles stay first |
| Fill | ✅ | Fill down (⌘D), fill right (⌘R); Fill series… (linear, multiply e.g. dilutions, log-spaced) over the selection or a count of rows |
| Find and replace | ✅ | ⌘F bar over the grid (numbers by their entered value, text, row / column / subcolumn titles; match case, whole cell), ⌘G / ⇧⌘G, Replace, Replace all; numbers stay numbers |
| Column format | ✅ | Format › Format column…: decimals, scientific, ×10ⁿ, percent, thousands; display only (copies and exports keep full precision) |
| Column widths | ✅ | Drag a header's edge, double-click to fit; saved with the table |
| Keyboard | ✅ | ⌘/Ctrl + arrows to the data's edge (⇧ extends), Home / End, ⌘/Ctrl + Home / End, Page Up / Down |

## Statistical comparisons

| Analysis | Status | Phase | Notes |
| --- | --- | --- | --- |
| Unpaired / Welch / paired t test, P and CI | ✅ | 51c | Welch's by default (51c); one-tailed P for a stated direction |
| Mann-Whitney with CI of the difference of medians | ✅ | | Hodges-Lehmann |
| Kolmogorov-Smirnov (two groups) | ✅ | | |
| Wilcoxon matched pairs with CI of the median | ✅ | | |
| Multiple t tests, one per row (t, Welch, paired, Mann-Whitney, Wilcoxon), FDR or Bonferroni/Holm-Šidák | ✅ | 11 | Also consistent SD, lognormal / ratio, Kolmogorov-Smirnov; FDR BKY / BH / BY (Q = 5% by default, 51c) |
| Volcano plot from multiple t tests | ✅ | 11 | No threshold lines |
| One-way ANOVA, ordinary and repeated measures | ✅ | | |
| Comparisons: Tukey, Dunnett, Bonferroni, Holm-Šidák, Šidák, Fisher's LSD, FDR (BKY) | ✅ | | New one- and two-way comparisons later − earlier (51c) |
| Comparisons: Newman-Keuls | ✅ | 11 | Not with repeated measures; reports a step-down P |
| Post-test for linear trend (one-way) | ✅ | 11 | Ordinary ANOVA only |
| Welch and Brown-Forsythe ANOVA; Games-Howell, Tamhane T2, Dunnett T3 | ✅ | | |
| Multiplicity-adjusted P values and CIs for comparisons | ✅ | | |
| Geisser-Greenhouse (one- and two-way RM) | ✅ | | |
| Kruskal-Wallis, Friedman, Dunn's test | ✅ | 51c | Kruskal-Wallis' exact P for small designs (up to 2 × 10⁷ arrangements); Dunn's by Holm, Šidák, Bonferroni or none |
| Fisher's exact / chi-square with RR, OR, CIs | ✅ | | |
| Chi-square test for trend; comparisons within larger contingency tables | ✅ | 18 | Cochran-Armitage (k × 2; asked for, 51c); pairs of rows (or each vs. a control row) with Bonferroni / Holm-Šidák / Šidák; a 2 × 2's exposed row and outcome column (51c) |
| Two-way ANOVA with missing values | ✅ | | |
| Two-way RM in one or both factors; main and simple effects | ✅ | | Newman-Keuls only without repeated measures |
| Mixed-effects model for RM with missing values (one-, two-way) | ✅ | 51c | REML; the method chosen (auto, ANOVA of complete subjects, mixed); Satterthwaite or containment df |
| Multiple one-way ANOVAs, one per row | ✅ | 11, 51c | Ordinary, Welch, Brown-Forsythe, Kruskal-Wallis; no repeated measures; the rows corrected (FDR by Benjamini-Hochberg by default, 51c) |
| Three-way ANOVA (2 × 2 × k), ordinary, RM and mixed | ◐ | 11, 18 | Ordinary (Type III, effect sizes, three comparison families); RM in any factors (GG) and mixed model with missing values (18); no comparisons after RM |
| Nested t test, nested one-way ANOVA | ✅ | 13 | REML mixed model, Satterthwaite (51c) or containment df; variance components, ICC, F test and likelihood-ratio test of the subcolumns; comparisons as one-way ANOVA (no Newman-Keuls) |
| Multifactor (N-way) ANOVA | ✅ | 19 | Multiple-variables tables: text or coded factors, chosen two- and three-way interactions (default all), Type III SS for unbalanced data, η² / partial η² / Cohen's f / % of total, comparisons of marginal means (main effects, simple effects, cells; Tukey, Šídák, Bonferroni, Holm-Šídák, Fisher); no Dunnett, no residual plots |
| Effect sizes for t tests, ANOVA and contingency tables | ✅ | 11, 18 | t tests: η², Cohen's d, Hedges' g, Glass's Δ; ANOVAs: η², partial η², ω² (ordinary), Cohen's f, RM designs against each effect's error term (18); contingency: RR/OR, phi, Cramér's V (18) |

## Nonlinear regression

| Feature | Status | Notes |
| --- | --- | --- |
| Built-in equations | ✅ | 126 (14, 20): the common lab curve-fitting equations — dose-response on log or concentration scales (4PL/5PL, normalized, ECanything, biphasic, bell-shaped, operational model, Gaddum/Schild, EC50 and allosteric EC50 shifts, absolute IC50), binding (saturation, total and nonspecific together, ligand depletion, allosteric modulators, competitive one/two sites, homologous, kinetics incl. Motulsky–Mahan), enzyme kinetics and inhibition (incl. Morrison), exponentials (one to three phases, plateau then decay/association), lines (horizontal, through origin, segmental, hinge, semilog, log-log, two crossing lines), polynomials 1–6 plain and centered, Gaussians (sum of two, lognormal, cumulative), Lorentzians, sine waves (damped, sinc), growth, linear-quadratic radiation models, classic forms. Left out: the classic Gaussian, Hyperbola and Padé (1,1) and classic duplicates |
| User-entered equations; differential and implicit equations | ✅ | The equation syntax (14: `Y = …`, one statement per line) with special and distribution functions, lines for particular data sets (`<A>`, `<~A:D>`, `<A:J,3>`), implicit equations and differential equations `Y' = …` (20); rules for initial values and default constraints. Editor: equation text with live checking, constraints, initial values and rules, limits |
| Different equations per data set | ✅ | 18: separate fits per equation (no parameter shared across equations) |
| Global fit, shared parameters | ✅ | |
| Robust regression; ROUT outlier detection/removal | ✅ | 14: robust (Lorentzian) fit, ROUT identify or eliminate |
| Model comparison: extra sum-of-squares F and AICc | ✅ | 51e: one method chosen before the results (F test by default); the F test only between nested models (declared special cases), greyed otherwise; one verdict in the results and the summary |
| Compare one parameter between data sets | ✅ | 18: extra sum-of-squares F and AICc, the parameter(s) shared in the null model; 51e: one method chosen in advance |
| The model chosen by goal: goals (dose-response, binding, enzyme kinetics, decay and growth, standard curve, peaks…) with each model's thumbnail, its parameters in words and units, the X it expects; All equations; my own equation | ✅ | 51e (13 goals; every built-in equation's metadata) |
| X checked against the model (concentrations under a log model, log values under a concentration model, X = 0 under a log model), fixed in one click (Transform X to log10, the other form of the model) | ✅ | 51e |
| Dose-response warnings with their fixes: the EC50 outside the doses, a plateau not reached, an EC50 the data don't determine, too few doses, an ambiguous fit (Fix Bottom = 0 opens Edit with it) | ✅ | 51e |
| Constraints, initial values | ✅ | Constant, shared, data set constant (column title or mean X), limits; initial values per parameter and rules for initial values (20). No constraints relating two parameters (Kfast > Kslow) |
| Weighting | ✅ | 1/Y, 1/Y², 1/Y^K, 1/X, 1/X², 1/SD²; test for appropriate weighting (18) |
| Symmetric and profile-likelihood CIs | ✅ | Profile likelihood by default for new fits (51e; global fits' per-data-set parameters too, up to 10 data sets: above, the shared ones only, audit 4 P1); saved fits keep the asymptotic CIs |
| Hougaard's skewness | ✅ | 14; weighted fits too (18) |
| Confidence and prediction bands | ✅ | |
| Residual normality, runs test, replicates test | ✅ | 14; residual plot and table |
| Covariance matrix / dependency report | ✅ | 14 (normalized covariance = correlation matrix) |
| Interpolate unknowns from the curve (standard curves) | ✅ | 14; result table of interpolated values; no separate "Interpolate a standard curve" analysis |
| Two lines: intersection and slopes | ✅ | 18: built-in equation with the crossing point shared; linear regression reports where two lines cross |
| Nonlinear fits from multiple-variables tables | ✅ | 20: X, Y and an optional grouping variable (numbers or text), every fitting option; curves on an output graph (first 12 groups) |

## Survival

| Feature | Status | Notes |
| --- | --- | --- |
| Kaplan-Meier, log-rank (Mantel-Cox), trend, Gehan-Breslow-Wilcoxon, hazard ratios | ✅ | One test chosen; pairwise tests corrected for three or more groups (51c) |
| Cox proportional hazards regression | ✅ | |
| Survival curves for chosen covariate values (Cox) | ✅ | 18: Kalbfleisch–Prentice baseline, step curves on an output graph, baseline functions sheet |
| Kaplan-Meier from a multiple-variables table (grouping variables, text status) | ✅ | 19: curves per combination of grouping levels; makes the survival table for graphing; one status variable |

## Principal components

| Feature | Status | Notes |
| --- | --- | --- |
| Parallel analysis, Kaiser, proportion of variance, fixed | ✅ | |
| Scree and score plots | ✅ | |
| Loading plots, biplots | ✅ | 18: vectors as lines from the origin (no arrowheads yet) |
| Principal component regression | ✅ | 18: option of the PCA dialog |

## Column statistics

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| Descriptive statistics (quartiles, CI, CV, skewness, kurtosis, geometric mean) | ✅ | | |
| Frequency distribution, cumulative histogram | ✅ | 13 | Counts, relative (% / fraction), cumulative over bins; automatic width per FAQ 1660; no exact (unbinned) cumulative. Graphed as a histogram by default (17) |
| Normality: D'Agostino-Pearson, Anderson-Darling, Shapiro-Wilk, KS; lognormality | ✅ | 51c | Shapiro-Wilk with the QQ plot by default (51c) |
| QQ plot | ✅ | 18 | Output graph of the normality test (on by default, 51c) |
| One-sample t / Wilcoxon | ✅ | | |
| Outliers: Grubbs, ROUT | ✅ | 13 | ROUT (Q), Grubbs, iterative Grubbs; cleaned-data table |
| Analyze a stack of P values (Bonferroni, FDR) | ✅ | 11 | Same correction code as multiple t tests; ranked-P graph |

## Linear regression and correlation

| Feature | Status | Notes |
| --- | --- | --- |
| Slope and intercept with CIs; force through a point | ✅ | Any point (18) |
| Replicate Y vs. mean Y | ✅ | Each replicate (default) or the mean Y of each row (18); summary data use the means |
| Runs test for linearity; residual plots | ✅ | 14; also replicates test and residual normality |
| Compare slopes and intercepts | ✅ | |
| Interpolate from a standard line | ✅ | 14 |
| Pearson and Spearman correlation | ✅ | Several pairs corrected (FDR by Benjamini-Hochberg or Holm, 51c) |

## Generalized linear models

| Model | Status |
| --- | --- |
| Multiple linear regression | ✅ |
| Multiple logistic regression | ✅ |
| Simple logistic regression (XY) | ✅ |
| Poisson regression | ✅ |
| Categorical (text) predictors, interpolation from the model | ✅ (19: dummy coding with reference-level rules, interactions, Type III ANOVA table / LR tests per variable; predicted Y, probability or count with CIs for rows and entered points; no transforms of predictors) |

## Clinical lab statistics

| Feature | Status |
| --- | --- |
| Bland-Altman | ✅ |
| ROC curves | ✅ (the direction stated, 51c) |
| Deming (type II) regression | ✅ |

## Simulations

| Feature | Status |
| --- | --- |
| Simulate XY, column, contingency tables | ✅ (20: random-error models and outliers, seeded; contingency 2 × 2 designs) |
| Monte Carlo analysis | ✅ (20: tabulated results with summaries, hits with CI; the simulation and analysis are set in its dialog) |
| Plot a function | ✅ (17: built-in or user equations on XY graphs, live parameters) |

## Data processing ("Other calculations")

| Feature | Status | Phase |
| --- | --- | --- |
| Area under the curve, with CI | ✅ | 13 |
| Transform | ✅ | 13 |
| Normalize | ✅ | 13 |
| Transpose tables | ✅ | 13 |
| Remove baseline, combine columns | ✅ | 13 |
| Fraction of row, column or grand total | ✅ | 11 |
| Row means with SD/SEM/CI (row statistics) | ✅ | 11 |
| Prune rows | ✅ | 13 |

Transform: the standard Y and X functions (plus Y with X, rank, z score, probit, logit);
missing are user-defined equations, Y + random, X ↔ Y interchange and the linearizing plots
(Scatchard, Lineweaver-Burk, Hanes-Woolf, Eadie-Hofstee, Hill, log-log). The data-processing
analyses produce tables that other analyses and graphs can use (Phase 13).

## Other

| Feature | Status |
| --- | --- |
| Sample size and power | ✅ |
| Smoothing / Akima splines, LOWESS | ✅ |
| Bubble plots, violin plots, estimation plots | ✅ (17; estimation plots unpaired only, differences from the first data set) |
| Automatic stars from multiple comparisons on graphs | ✅ |
| Horizontal graphs (bars, dot plots, boxes, violins, estimation / forest-style plots) | ✅ (30: brackets beside the data, point and bar labels, drags follow) |
| Stacked bars, 100% stacked, stacked with gaps (grouped tables) | ✅ (30: error bars on each segment) |
| Bars from a baseline other than 0 | ✅ (30: column, grouped and XY bars) |
| XY: line through each replicate, gaps at missing values, shaded error band, area fill, X error bars, boxes at each X | ✅ (30) |
| Error bars: geometric mean ×/÷ geometric SD, CI of the geometric mean; whiskers at 1–99 / 2.5–97.5 percentiles | ✅ (30) |
| Grand mean line (column graphs) | ✅ (30) |
| Heat maps (grouped and multiple-variables tables) | ✅ (30: sequential / diverging colour maps, fixed range and midpoint, z-scores by row or column, clustering matching R's hclust with dendrograms, values in cells, colour scale) |
| Dendrograms: layers of their own beside a heat map or alone; side, size and gap per tree (dragged on the canvas), equal-step heights; cut into k clusters or at a height (R's cutree) with coloured branches, a cluster strip and legend entries | ✅ (49c) |
| Fill and outline mapped separately (ggplot's `fill =` beside `colour =`): each data set's fill colour beside its colour, a fill palette (lighter colours, schemes), a fill variable on its own scale with merged or separate legends; ellipses, hulls, paths, vectors and contours dashed by group | ✅ (49d) |
| Explanations of every analysis, option and method (a line under each, a card behind ⓘ, the reason beside "recommended", how to read the results; Help › Choosing an analysis) | ✅ (51a) |
| A guided chooser: questions about the experiment by table kind lead to an analysis set up with its reasons and alternatives; search by question across table kinds | ✅ (51a) |
| The Analyze dialog in three panels: the list, the options in the experiment's words (Essentials, Reporting, Advanced), the groups as chips in order with the comparison spelled out, role boxes for analyses of variables; invalid combinations hidden or greyed with the reason; checks before Analyze; switching methods keeps the shared choices | ✅ (51b) |
| Results that explain themselves: a summary sentence in the user's names (direction, size with CI, P with its test, n), an effect plot, the comparisons first with their family's header, details collapsed, a methods paragraph to copy, names that follow the method, factor names | ✅ (51d) |
| Curve fitting guided: the model picked by goal with thumbnails, X checked against the model with one-click fixes, dose-response warnings with fixes, profile CIs by default, one model comparison chosen in advance (F test greyed for models that aren't nested), the starting shape following the model, constraints and compared model | ✅ (51e) |
| Guide me's diagrams: "What will be tested" — a schematic of the question built up as it is answered (the groups in the user's names, what is compared, the comparisons as arrows, matched subjects as links, a grouped table's grid and independent units, nested subjects, a one-tailed direction, the question and what "no effect" means), also the chosen method's above the sketch — and a clickable map of the path (back to any question, later answers kept where they apply; by keyboard) | ✅ (51f) |
| A live sketch of the data as the analysis will see it (groups, pairs and differences, pooled or own SDs, ranks, comparisons, the factor grid, replicates, a model's shape or starting shape, contingency roles, survival steps), never a result | ✅ (51b) |
| Zoom and pan with the mouse on graphs and layout pages: Alt (Option) or Ctrl + wheel and a trackpad's pinch zoom about the pointer (graphs 25%–800%, pages 25%–400%), a middle-button or two-finger drag moves a zoomed view | ✅ (50) |
| Bar labels (mean, median, n) | ✅ (17; also SD, SEM, the bar's value; above or inside) |
| Point labels (row titles, X / Y values; volcano plots) | ◐ (22: all points, thresholds or chosen rows, moved apart with leader lines; on by default for Multiple t tests' discoveries; dragging a label is 22's canvas part) |
