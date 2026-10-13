# Roadmap

The version history and the plan's phases. This was [ARCHITECTURE.md](ARCHITECTURE.md) §8 until
audit 2 ("§8" still means this document); the decisions it cites are in
DECISIONS.md (not in the public repository).

## Versions

`0.<code audits>.<phases since the last audit>` (CLAUDE.md, Versioning); each is a `v…` tag on
the merge commit. Phases count in the order they reached main.

| Version | Phase(s) | Commit |
|---|---|---|
| 0.0.0 – 0.0.10 | Phases 0–10 | `136f913` … `755424f` |
| 0.0.11, 0.0.12 | 11, 12 (merged together) | `67d26d8` |
| 0.0.13 | 13 | `b056a14` |
| 0.0.14, 0.0.15 | 14, 15 | `d4907fa` |
| 0.0.16 | 16 Example projects | `963c712` |
| 0.0.17, 0.0.18 | 17, 18 | `43d67b9` |
| 0.0.19, 0.0.20 | 19, 20 | `dec325e` |
| 0.0.21 | 21 | `13347b3` |
| 0.0.22 | 22 | `2d8f6c2` |
| 0.0.23 | 23 | `0160846` |
| **0.1.0** | **Code audit 1** (steps 1–3) | `005bb77` |
| 0.1.1 | 24 | `f19f58c` |
| 0.1.2 | 25 | `a1d5a8e` |
| 0.1.3 | 26 | `e3117aa` |
| 0.1.4, 0.1.5 | 28, 28b | `7f04851` |
| 0.1.6 | 27 | `6cfdae6` |
| 0.1.7 | 29 | `3ec4d47` |
| 0.1.8, 0.1.9 | 31, 32 | `c6f2f3d` |
| 0.1.10 | 30 | `24d7ef3` |
| 0.1.11 | 33a | merge of 33a (tag `v0.1.11`) |
| 0.1.12 | 33b | merge of 33b (tag `v0.1.12`) |
| 0.1.13 | 33c | merge of 33c (tag `v0.1.13`) |
| 0.1.14 | 33d | merge of 33d (tag `v0.1.14`) |
| 0.1.15 | 33e | merge of 33e, the layer-order audit (tag `v0.1.15`) |
| 0.1.16 | 34a | merge of 34a, categorical axes from multiple-variables tables (tag `v0.1.16`) |
| 0.1.17 | 34b | merge of 34b, colour, shape, size and labels from variables (tag `v0.1.17`) |
| 0.1.18 | 34c | merge of 34c, group overlays, paths and PCA plots (tag `v0.1.18`) |
| 0.1.19 | 34d | merge of 34d, one graph per level, hover cards, Go to row (tag `v0.1.19`) |
| 0.1.20 | 34e | merge of 34e, large single-cell and FACS tables (tag `v0.1.20`) |
| 0.1.21 | 34f | merge of 34f, cells tables, 24-colour palette, natural level order, histograms of variables (tag `v0.1.21`) |
| 0.1.22 | 34g | merge of 34g, cytometry axes and density plots (tag `v0.1.22`) |
| 0.1.23 | 35 | merge of 35, results on graphs (tag `v0.1.23`) |
| 0.1.24 | 36 | merge of 36, axis extras (tag `v0.1.24`) |
| 0.1.25 | 37 | merge of 37, preferences and styles (tag `v0.1.25`) |
| 0.1.26 | 38 | merge of 38, data manipulation (tag `v0.1.26`) |
| 0.1.27 | 39 | merge of 39, import and interop (tag `v0.1.27`) |
| 0.1.28 | 40 | merge of 40, project organisation (tag `v0.1.28`) |
| 0.1.29 | 41 | merge of 41, polish and desktop distribution (never tagged: the first release is 0.2.0) |
| **0.2.0** | **Code audit 2** (steps 1–4: fixes, tests, clean-up and performance, docs; decisions 640–805) | `a21e9bd` (not tagged: no release yet) |
| 0.2.1 | 42 | merge of 42, audit follow-ups (not tagged: no release yet; the first release tags the version current then) |
| 0.2.2 | 43 | merge of 43, labelled toolbar and first session (not tagged) |
| 0.2.3 | 44 | merge of 44, one selection model (not tagged) |
| 0.2.4 | 45 | merge of 45, format bar and format painter (not tagged) |
| 0.2.5 | 46 | merge of 46, a simpler Format view (not tagged) |
| 0.2.6 | 46b | merge of 46b, reference lines and volcano thresholds (not tagged) |
| 0.2.7 | 47 | merge of 47, lists and getting started (not tagged) |
| 0.2.8 | 47b | merge of 47b, legend editing (not tagged) |
| **0.3.0** | **Code audit 3** (six reviews and six paper reproductions; steps 1–4: bugs, speed and memory, keyboard and screen readers, tests, docs and licence; decisions 1000–1164) | (not tagged: no release yet) |
| 0.3.1 | 48 | merge of 48, open source as statPlotter (not tagged) |
| 0.3.2 | 48b | merge of 48b, the commercial product's name removed (not tagged) |
| 0.3.3 | 49a | merge of 49a, aesthetics by data set or fixed (not tagged) |
| 0.3.4 | 49b | merge of 49b, one layer at a time in the Format view (not tagged) |
| 0.3.5 | 49c | merge of 49c, dendrograms as layers (not tagged) |
| 0.3.6 | 49d | merge of 49d, fill and outline mapped separately (not tagged) |
| 0.3.7 | 50 | merge of 50, zoom and pan with the mouse (not tagged) |
| 0.3.8 | 51a | merge of 51a, explanations and a guided chooser (not tagged) |
| 0.3.9 | 51c | merge of 51c, safer defaults and multiple comparisons (not tagged) |
| 0.3.10 | 51b | merge of 51b, the new Analyze dialog (not tagged) |
| 0.3.11 | 51d | merge of 51d, results that explain themselves (not tagged) |
| 0.3.12 | 51e | merge of 51e, curve fitting (not tagged) |
| 0.3.13 | 51f | merge of 51f, Guide me diagrams (not tagged) |
| **0.4.0** | **Code audit 4** (six reviews; steps 1–5: what the results say, the Analyze dialog and Guide me, speed, keyboard and screen readers, tests, docs and CI; decisions 1341–1452) | (not tagged: no release yet) |

## Phases

0. ✅ **Scaffold** — monorepo, CI, R oracle pipeline, NIST fixtures, font metrics.
1. ✅ **Vertical slice** — Column table → descriptives, t-tests (unpaired/Welch/paired), Mann-Whitney,
   Wilcoxon → scatter/bar + error bars → live update on edit → save/load → SVG/PDF export.
   (Also delivered: box and before–after graphs, live significance brackets, PNG export.)
2. ✅ **XY + curve fitting** — linear regression, LM nonlinear fitter, dose-response family with
   automatic initial values, shared params / global fit, F-test & AICc comparison, log axes.
3. ✅ **Grouped + ANOVA** — one/two-way, Tukey/Šidák/Dunnett/Holm/FDR, significance brackets.
4. ✅ **Survival, contingency, normality, nonparametrics** — Kaplan-Meier with log-rank / trend /
   Gehan-Breslow-Wilcoxon and hazard ratios, Fisher's exact / chi-square with RR, OR and
   sensitivity, normality tests, one-sample tests, Friedman + Dunn, Kolmogorov-Smirnov, correlation.
5. ✅ **Layouts, style templates, import** — live layout pages with panel labels and export,
   "Magic" format matching, CSV / XLSX / pzfx import.
6. ✅ **RM ANOVA, mixed-effects, regression, PCA, ROC, Bland–Altman** — repeated measures in
   the one- and two-way dialogs (REML mixed model with missing values), multiple linear /
   logistic / Cox regression, PCA with parallel analysis, ROC curves, Bland-Altman; graphs of
   analysis output.

7. ✅ **Graph formatting** — axes in depth (ticks, grid, breaks, number formats, reverse,
   crossing), frame and backgrounds, fonts and rich text, colour schemes, legend placement and
   box, text and arrow annotations, bracket style; inspector panels and on-canvas editing.

8. ✅ **Slices and aligned figures** — row/data-set slices, live shared axes, style presets, one
   graph per row or data set, layout pages with aligned plot areas and multi-select actions.

9. ✅ **Reproducing a published paper** — two-way "all cells" comparisons, import of multi-table
   source-data sheets, grouped box/floating-bar graphs, joined means on grouped graphs, axis ×10ⁿ
   labels, a published-results regression test and a "Paper example" project.

10. ✅ **Importing real source data** — block layouts read from structure (titles, two-row headers,
    annotation rows/columns, unequal and one-row data sets, groups as rows, survival layouts),
    long-format data and .zip archives, paste transposed; every import accounts for the numbers it
    leaves out and previews the table it makes; checked on seven papers' source data.

11. ✅ **Grouped-table statistics** — multiple t tests per row (t, Welch, consistent SD, paired,
    lognormal, Mann-Whitney, Kolmogorov-Smirnov, Wilcoxon) with FDR (two-stage BKY, BH, BY) or
    Holm-Šídák / Šídák / Bonferroni and a volcano plot; multiple one-way ANOVAs per row; ordinary
    three-way ANOVA (2 × 2 × k); ANOVA effect sizes (η², partial η², ω², Cohen's f) and Cohen's
    d / Hedges' g for t tests; Newman-Keuls; test for linear trend; row statistics; fraction of
    total; analyze a stack of P values.

12. ✅ **Formatting in dialogs** — Format graph / Format axes dialogs (plus legend,
    bracket and text/line dialogs) with tabs, opened by double-click, the toolbar, right-click ›
    Format… or Enter on the selection, each on the tab for the clicked element; a live preview of
    a draft inside the dialog, OK as one undo step and Cancel discarding; the side inspector is
    gone and the graph gets the full width. Selections are highlighted along the marks' own
    shapes, and single points can be selected and formatted on their own.

13. ✅ **Data processing, result tables and nested data** — analyses that produce tables
    (Transform, Normalize, Remove baseline and column math, Frequency distribution, Transpose,
    Prune rows) with stable data set ids, analyzed and graphed like data tables: chained analyses
    compute upstream first, wait while it computes and rerun when its table changes; result tables
    show read-only in the results view with Analyze / Graph this table. Area under the curve with
    peaks and Gagnon SE/CI; Identify outliers (ROUT, Grubbs, iterative Grubbs) with a cleaned-data
    table. Nested tables (groups → subjects → replicate measurements) end to end: New table option,
    subject names and ± subject in the editor, paste of header rows, pzfx import, nested scatter
    graphs; nested t test and nested one-way ANOVA (REML mixed model, variance components, ICC,
    comparisons). Three-way ANOVA with repeated measures is still missing.

14. ✅ **Curve fitting for lab assays** — interpolating unknowns from nonlinear and linear
    standard curves (every replicate, CIs from the confidence band, extrapolation and
    non-monotonic curves, an XY result table of the interpolated values);
    user-defined equations (`Y = …`, one statement per line; safe parser, exact gradients by
    automatic differentiation, initial values and limits); 23 more built-in equations (ECanything,
    biphasic and bell-shaped dose-response, two-site and competitive binding, binding kinetics,
    enzyme inhibition with data set constants, allosteric sigmoidal, kcat, plateau then decay,
    two phase association, exponential plateau, beta growth, segmental linear, sine waves,
    Lorentzian); fit diagnostics (residual plot, runs test, replicates test, normality of
    residuals, Hougaard's skewness, correlation matrix, dependency); robust regression and ROUT
    for curves. The equation editor UI is left for a UI phase.

15. ✅ **Formatting follow-ups** — a right Y axis on XY and grouped graphs (per data set, with
    its own range, format and title; curves follow their data); "All data sets" shows values that
    differ as mixed; Format dialogs from graphs on layout pages (double-click, right-click ›
    Format…, Enter); single bars and boxes on grouped graphs; drawing order of a data set's
    marks and annotations in front of or behind the data; a light hover highlight; a centre line
    length control with a shorter default; a form editor for Transform's K per data set
    (`transform.kByDataSet`, in `ui/src/analysis/transformFields.tsx`).

16. ✅ **Example projects** — Examples dialog with focused synthetic projects
    (`ui/src/examples/synthetic/`): Getting started (column data), Grouped data, Curve fitting
    and standard curves, Data processing and nested data, Survival / contingency / multiple
    variables, Formatting and figure layout; the old all-in-one demo ("tour") is retired.

17. ✅ **Graphs and chart types** — histograms (bars on XY graphs a bin wide; Frequency
    distribution tables graph as histograms by default); violin plots (column and grouped,
    truncated or extended, smoothing, lines at the median and quartiles, optional points);
    estimation plots (the groups beside each mean difference from the first with its CI, on a
    floating right axis whose zero is the control mean); bar labels (value, mean, median, n, SD
    or SEM, above or inside, number format); bubble plots of multiple-variables tables (X, Y,
    size and colour variables, size and colour legends); parts-of-whole tables end to end (New
    table option with sample data, pies, donuts and 100% stacked bars with value / percent /
    category labels and exploded slices); Plot a function (built-in or user-defined equations
    on XY graphs, parameters, X range, edited live in Format graph › Appearance). All with Format
    dialog fields, selection, export, layouts and Magic; examples in Getting started, Data
    processing, Formatting and a new Parts of whole project.

18. ✅ **Statistics additions** — contingency tables: phi / Cramér's V and comparisons of pairs of
    rows (Bonferroni, Holm-Šídák, Šídák); parts of whole: observed vs. expected (chi-square
    goodness of fit, binomial test); Deming regression, simple logistic regression on XY tables,
    Poisson regression; linear regression through any point, fit to the mean Y, intersection of
    two lines, and the "two intersecting lines" equation; nonlinear regression weighted by 1/Y^K,
    1/X, 1/X², 1/SD², the test for appropriate weighting, Hougaard's skewness of weighted fits,
    "is this parameter the same for every data set?", different equations for different data
    sets, fit to the mean Y; QQ plots for normality tests; PCA loadings plot, biplot and
    principal component regression; "Fit spline/LOWESS" (LOWESS, smoothing spline, Akima, cubic
    and point-to-point curves); Cox estimated survival curves and baseline functions; three-way
    ANOVA with repeated measures in any factors (RM ANOVA with Geisser-Greenhouse, mixed model
    with missing values); effect sizes for RM ANOVAs; sample size and power (t tests, one-way
    ANOVA, two proportions, correlation, log-rank) with a power curve. Multiple comparisons after
    RM three-way ANOVA and a multinomial test are left out.

19. ✅ **Multiple-variables tables** — text (categorical) variables end to end: conversion
    commands, text cells in the grid (left-aligned, marked in the header; typing or pasting words
    into a numeric variable makes it text), copy / paste, CSV / XLSX import as a
    multiple-variables table (also for long-format sheets) and pzfx MultipleVariables tables;
    bubble plots coloured by a text variable's categories. Calculated variables: a safe formula
    language over other variables by name (arithmetic, functions, IF, comparisons, text
    comparisons) evaluated when the table is normalized, so analyses, graphs and recompute see
    the values; errors per column (syntax, unknown names, circular references) and per cell
    (#NUM); a formula bar, "=…" typed in a header, convert to values; renaming a variable
    updates the formulas using it. Extract and rearrange into column or grouped tables (a copy).
    A "Multiple variables" example project.
    Statistics: text (and coded numeric) variables as categorical predictors of multiple linear,
    logistic, Poisson and Cox regression (dummy coding with reference-level rules or a
    chosen level, two- and three-way interactions, Type III ANOVA table and likelihood-ratio tests
    per variable, separation / empty-level diagnostics), predicted outcomes with CIs for rows
    without one and entered points (sheet and result table), multifactor (N-way) ANOVA with Type
    III sums of squares, effect sizes and comparisons of marginal means, and Kaplan-Meier curves
    from one row per subject grouped by text variables.

20. ✅ **Equations and simulation** — the user-equation language completed: special and
    distribution functions (gamma, beta, incomplete gamma and beta, erf, psi, Bessel, confluent
    and Gauss hypergeometric, z/t/F/χ²/binomial) with exact gradients, lines for particular data
    sets (`<A>`, `<~A:D>`, `<A:J,3>`), implicit equations, differential equations `Y' = …`
    (Dormand–Prince with sensitivity equations, stiff fallback), and rules for initial
    values; the built-in library completed to the common lab curve-fitting equations (126 equations,
    each with an R `nls` oracle and a recovery test); nonlinear fits from multiple-variables
    tables with a numeric or text grouping variable; Simulate XY data, Simulate column data and
    Simulate contingency table as seeded table-producing analyses; the Monte Carlo analysis
    (tabulated results, summaries, hits with CIs). Constraints relating two parameters and the
    three equations the guide prints no formula for are left out.

21. ✅ **Menu bar, icon toolbar, commands** — one command registry (id, label, menu
    position, `Mod+…` shortcut, icon, enabled / checked, run) that the shell and the open view
    add to; one global shortcut dispatcher.
    - *App frame (21A):* a File / Edit / View / Insert / Analyze / Format / (Arrange) / Help
      menu bar built from the registry (ARIA menubar: click, hover between open menus, arrow
      keys into and out of submenus, F10, focus returned; shortcut hints, ticks, submenus Open
      recent / Examples), the shared pop-up `Menu` with shortcuts, ticks and submenus; a lucide
      icon toolbar with the file name; app commands (New / Open / Open recent / Examples / Save /
      Import / Close project, Undo / Redo, Show navigator, New table / graph / layout, Plot a
      function, Analyze… and quick analyses preselected in the Analyze dialog, Sample size and
      power, simulations and Monte Carlo — on a new empty table when none is open, Command
      palette, Keyboard shortcuts, About); a ⌘K palette over commands, analyses and sheets; a
      shortcut sheet generated from the registry; native menus in the desktop app from the same
      registry (macOS application and Window menus, system clipboard items); Open recent (desktop
      paths, Chromium file handles in IndexedDB).
    - *View commands (21B):* the table offers Cut / Copy / Paste / Paste transposed (keys stay
      browser clipboard events; menu Copy / Cut go through the grid's own events), Clear, Select
      all, Exclude, rows / columns / subcolumns, Row titles and Extract and rearrange; results
      offer Edit parameters and Analyze / Graph this table; graphs offer Format graph / axes,
      Duplicate as…, Insert text / line / arrow, File › Export ▸ SVG / PDF / PNG and an Export…
      dialog with format and resolution, Zoom in / out / Actual size; layouts add an Arrange menu
      (order, align, stack, side by side, equal sizes, share Y, match format, grid), Insert ›
      Text and Graph on page ▸, Format, Export and Zoom; the navigator adds Rename / Duplicate /
      Delete sheet (undoable copies of tables, graphs and layouts) and View › Go to data table /
      results / graph. Context menus are built from the same commands, view toolbars keep only
      state and constant-use controls, and analyses that read no data (simulations, Monte Carlo,
      power without pilot data) list no data sets in the Analyze dialog.

22. ✅ **Arranging graphs on the canvas, point labels** — handles at the X axis' end, the Y
    axes' tops and the plot corner resize the plot with a live reflow and a size readout (Shift
    keeps the proportions; sizes snap to 0.1 in or to another graph's plot size: same kind in
    the project, any graph on the same page). The graph title, axis titles, each axis' tick
    labels (across the axis), brackets (up / down), the legend, text boxes and point labels are
    dragged, stored as offsets from their computed places so they keep following the plot; they
    snap to their own place, the plot's centre lines and edges and other text, with guides (Alt
    moves freely); arrow keys nudge and Reset position clears; moved elements grow the graph so
    exports keep them whole. On layout pages a graph selected alone can be resized and its
    elements moved the same way. Point labels (Format graph › Appearance › Label points): row
    titles or X / Y values on all points, points past up to four thresholds (and / or) or rows
    picked in a searchable list; number format, text style, labels moved apart by a
    deterministic grid-accelerated ring search inside the plot and off each other and the
    points, leader lines, a per-data-set maximum (most extreme first); a point's own label and
    dragged label positions share the code; XY, bubble, column and grouped graphs; clicking a
    label selects its point; labelled rows follow row edits. Multiple t tests' volcano plot
    labels its discoveries by row title by default.

23. ✅ **Copy as vector, proportional resizing, handles on every side** — Edit › Copy graph
    (⇧⌘C, toolbar, context menu; on layout pages Copy page and Copy graph for a graph selected
    alone; ⌘C on a canvas when no text is focused or selected) puts the export SVG (size in
    points, text as text, Liberation / Arial font names) and a 300 dpi PNG on the clipboard; the
    macOS desktop app adds a PDF with embedded fonts in the same pasteboard item, which
    Illustrator, Word, PowerPoint and Keynote paste as editable vectors; browsers write SVG where
    supported, PNG and the SVG code as text, with fallbacks and a message saying what was copied.
    A copied graph pastes onto a layout page (⌘V, Edit › Paste graph, the page's context menu),
    linked, at the pointer, while the clipboard still holds that copy. Resizing the plot scales
    text, symbols, line widths, gaps and the legend in proportion (`size.scale`, 10–1000%: laid
    out at plot size ÷ scale, then the whole scene scaled, so canvas, pages and exports follow);
    the scale follows the square root of the plot area, ⌘/Ctrl-drag keeps it, Format graph ›
    Graph settings has "Scale text and marks (%)" with Reset. Resize handles on all four edges
    and corners, the opposite side staying put in the graph view and on layout pages.

24. ✅ **End-to-end browser tests (Playwright)** — `apps/e2e`: the production build driven in
    Chromium, WebKit and Firefox, ~118 tests per browser: the app frame (menus by mouse and
    keyboard, ⌘K palette, shortcut sheet, toolbar, navigator, undo/redo from every route,
    unsaved-changes prompts); every table kind (typing, TSV and transposed paste, clear, exclusion,
    rows / columns / subcolumns, row titles, text and formula variables); CSV / XLSX / pzfx import
    from committed fixtures; representative analyses checked against R values, parameter edits,
    recompute after data edits, chaining, brackets; save → reopen round trips; every graph type
    per table kind and type switching; Format dialogs by double-click with live preview, one-step
    undo and cancel; canvas drags on all eight handles (text scaling, ⌘-drag, anchoring), element
    moves with snapping, nudges, reset; layout pages (grid, stack, align, resize, paste a copied
    graph); SVG / PNG export sizes and the clipboard (Chromium); every example project, every
    sheet. Any console or page error fails a test. Browser-specific skips are explicit (clipboard
    read-back and file handles are Chromium-only). 3,300 runs (×10 per test, three engines)
    passed with none flaky before the deploy was made to wait for them. In CI every push runs
    Chromium (split over two machines, ~5 min) before deploying; all three engines run nightly
    (`e2e-nightly.yml`), since GitHub's 2-core machines take ~23 min for the three in one job. Screenshot checks run in
    CI's Linux Chromium against the committed baselines (`apps/e2e/tests/visual.spec.ts-snapshots/`,
    made by the manual "Visual baselines" workflow; decision 747).
    Not covered: the desktop app's native menus, reopening from Open recent (Playwright's
    Chromium can't store file handles), pasting into other applications.

25. ✅ **Save safety** — recovery copies (`ui/src/recovery.ts`, `Platform.recovery`): the whole
    project exactly as Save writes it (results included), serialized in a worker 5 s after edits
    stop, at most every 30 s while editing, and when the tab is hidden or the window loses focus,
    to private storage — web: IndexedDB in the app's origin (with the file handle where Open
    recent keeps handles); desktop: the app data folder's `recovery/`, each file written to a
    temporary name and renamed — never to the user's file. Leaving right after an edit (reload,
    navigation, close: `beforeunload`, `pagehide`) serializes on the main thread, keeps the copy
    in a localStorage buffer (up to 1.5 MB) and starts its storage write; the buffer becomes the
    slot at the next start (decision 280). The worker starts when the page is first idle, and
    any failure of it falls back to the main thread. One slot per page load, held with a
    Web Lock (localStorage heartbeats where there are none), so a copy whose tab or window is
    still open is never offered. At the next start orphaned copies are offered newest first
    ("Recover unsaved changes to Weights.psproj from 14:32?", a list when there are several):
    Recover opens one as an unsaved project with its file name and path or handle, so Save goes
    back to the same file; Discard deletes it; Later keeps it for the next start. Cleared after a
    save, when another project replaces this one and on a clean close; at most 10 orphans, none
    older than 30 days; `?example=` URLs skip the prompt. The toolbar's file name says when the
    last copy was written (tooltip). Atomic save on desktop (Rust `save_project_file`): parsed
    with `readProjectFile`, written to `name.psproj.tmp`, flushed and read back unchanged, the
    previous version kept as `name.psproj.bak` (hard link, else a copy), renamed over the file; a
    failure at any step leaves the original (Rust tests inject one at each step). The browser's
    file handle writes through a swap file, and asks for permission again for a remembered
    handle; downloads create new files. Reopening the last project: on desktop at start after any
    recovery prompt (Recover wins; a missing file is skipped quietly); on the start screen,
    "Continue with <name>" for the most recent file (web: Chromium file handles, permission
    prompt on click). End-to-end tests cover a page closed with unsaved changes → Recover /
    Discard / Later / saving clears / an open tab's copy not offered / several listed / examples
    skip the prompt / an edit followed at once by another example, a reload or a closed tab (no
    page error, the edit in the copy offered), in all three browsers; not covered: "Continue
    with" (Playwright's Chromium can't store file handles) and the desktop app.

26. ✅ **Data and results out** — pure writers in `io/src/export/`: a neutral sheet (rows of
    cells: a number written in full with an optional display text and Excel number format, text,
    empty; title and column-title styles; an excluded flag; links between worksheets), CSV / TSV
    (RFC 4180, UTF-8 byte-order mark, CRLF, formula-like text guarded in files), HTML tables
    (inline styles) and a minimal `.xlsx` writer (inline strings, bold titles, grey italic
    excluded values, number formats, column widths, Excel's sheet-name rules), each read back by
    the importer in tests. A data table of any kind (result tables too) is laid out as the grid
    shows it (`tableRows`: data set titles, then subcolumn labels, X title and X error, row titles
    first, text and calculated variables); results blocks as on screen, "as displayed" (Excel
    keeps the number with a format showing the view's digits; "<0.0001" and intervals as text) or
    in full (an interval as two numbers). File › Export ▸ on a table: CSV… / TSV… / Excel (.xlsx)…
    and the toolbar's Export… (format; excluded values kept and marked, or left blank); on
    results: CSV… / Excel (.xlsx)… of the sheet shown, All results (Excel)… and Export… (sheet or
    all, format, numbers); on a graph or layout page: Source data (Excel)… (the data sets and rows
    a graph plots, its curves' points and every sheet of the analyses whose curves and brackets it
    shows; a page gets a worksheet per panel, named by its panel letter); always: All data and
    results… (a contents sheet linking every worksheet with its kind and source, then every data
    table, result table and results sheet). Copies carry tab-separated text and an HTML table:
    ⌘C on cells stays values only (pasting back round-trips) with the HTML beside it; Edit › Copy
    with titles copies the whole table with its header rows; on results Edit › Copy and ⌘C with no
    text selected copy the sheet shown, and a block's right-click menu has Copy table. Menu copies
    raise a copy event (`execCommand('copy')`, `beforecopy` cancelled for WebKit), then fall back
    to `ClipboardItem` with HTML and text, then `writeText`; end-to-end tests check the downloads'
    names and contents (xlsx read back with the importer) and the copies in all three engines
    (the system clipboard read back in Chromium). Not covered: pasting into Word / PowerPoint /
    Excel themselves, and the desktop app's native menu items (Copy with titles runs without a
    user gesture there).
27. ✅ **Figure export and printing** — one vector PDF writer in TypeScript
    (`graph/src/render/pdf.ts`, `sceneToPdf`) for the web and the desktop app, for File ›
    Export and for the macOS pasteboard (the Rust svg2pdf / usvg path and its crates are gone):
    the scene drawn straight into a Flate-compressed content stream with the SVG's colours,
    widths, dashes, caps, joins, fill opacity (ExtGState) and placed subtrees; text as text in
    the bundled fonts, each face embedded as a TrueType subset (fontkit) in a CIDFontType2 font
    with Identity-H, widths and a ToUnicode map, every glyph where the layout measured it
    (kerning as TJ adjustments), so it selects, searches and copies; page size the scene's, a
    title and "Plotting Software" as producer. Images: PNG (pHYs), TIFF (Deflate, RGB or RGBA)
    and JPEG (quality, JFIF density, on white) with their resolution in the file, rendered by the
    browser in tiles of at most 4096 px a side and encoded in bands (`render/raster.ts`), so PNG
    and TIFF reach 100 million pixels (a double-column figure at 1200 dpi) in every browser;
    JPEG, from one canvas, stops at Safari's 16.7 million. The toolbar's Export… (also first in
    File › Export ▸) chooses PDF, SVG, PNG, TIFF or JPEG; a width in mm, cm, in, pt or % with
    presets (actual size, single column 85 mm, 1.5 column 114 mm, double column 174 mm), the
    height following; Keep text size (default: the graph laid out again at that width on a copy,
    as resizing does, fonts, symbols and lines unchanged) or Scale everything (layout pages are
    always scaled); 150 / 300 / 600 / 1200 dpi or custom (72–2400); JPEG quality; a transparent
    background (the export's white left out; the graph's own backgrounds kept). It shows the
    size in the unit, the pixel size, the smallest text (a warning below 6 pt) and a progress bar,
    and remembers the settings in the browser's storage. File › Export ▸ All graphs… / All layout
    pages… use the same dialog for every one: the desktop app writes a file each into a folder
    it asks for, browsers download one zip; names are made file-safe and unique, and a failure is
    reported while the rest are written. File › Print… (⌘P) on graph and layout views prints the
    graph (on paper of its size plus half an inch round it) or the page (its own size) at the
    actual size from a print-only SVG, the app hidden by the print style sheet; the desktop app's
    webview prints through Tauri's print operation. Tests: the PDF read back structurally and
    with pdf.js (text, embedded fonts, page size, info, operators for colours, dashes, caps,
    opacity, rotation, underlines, every graph family), PNG / TIFF / JPEG read back by small
    readers (pixels, DPI, strips, alpha), sizes and relayout (text sizes unchanged, width as
    asked), batch names and failures, the dialog's settings; end-to-end in the three browsers:
    PDF, TIFF 85 mm at 600 dpi (settings remembered), JPEG at a custom resolution, transparent
    PNG, all graphs as a zip, and printing (`window.print` stubbed: the print DOM, @page size and
    the SVG's physical size). Compared with the old svg2pdf output on all 51 golden graphs
    rendered by Poppler: no visible difference (at most 2.1% of pixels differ, at anti-aliased
    edges); the new files are about 20% smaller, and the old ones had pages 4/3 too large (usvg
    reads pt as 4/3 px, svg2pdf wrote px as pt). Existing golden SVGs are unchanged. Not checked
    by hand: the PDFs in Illustrator and Acrobat, TIFFs placed in Word / InDesign, printing on
    paper in Safari, Chrome and the desktop app, and the desktop app's folder export.
28. ✅ **Rich text everywhere** — one rich text editor (`ui/src/richText/`: a contenteditable
    whose state is `RichText` runs, the editing logic pure and unit-tested) wherever text is
    typed: the canvas's in-place editor (graph and axis titles, text boxes, legend renames),
    Format dialog fields (titles, text, a bracket's manual label, a point's label, a function's
    legend name), layout text (in place on the page and in its inspector, which no longer drops
    the formatting) and the grid's data set, X, row and subcolumn titles. Typing is literal
    (`_`, `^`, `*` are characters); formatting from a floating toolbar (bold, italic, underline,
    superscript, subscript, a symbol picker of Greek letters and lab symbols the bundled fonts
    draw) and ⌘B / ⌘I / ⌘U, ⌘⇧= superscript, ⌘= subscript; ⇧↩ breaks the line in titles and text
    boxes, ↩ commits, Esc cancels; the editor keeps its own undo while open and the document gets
    one step; IME composition, copy / cut / paste (plain text, or bold / italic / underline /
    scripts from pasted HTML). Formatted table titles are stored beside the plain ones
    (`titleRich`, `rowTitlesRich`, `subcolumnTitlesRich`), shown formatted in the grid header and
    cells and used by legends, category and pie labels and slice titles; everything else keeps the
    plain title. Graph text gains line breaks (lines a font pitch apart, centred in titles,
    aligned left / centre / right in text boxes; rotated axis titles take the room they need) and
    underline (rects from the font's rule, identical on the canvas and in SVG, PNG and PDF).
    pzfx import keeps the file's title formatting (`<B>`, `<I>`, `<U>`, `<Sup>`, `<Sub>`,
    Symbol-font Greek). Existing golden SVGs are unchanged; five new ones cover formatted legends
    and categories, row titles, multi-line titles and underline. Not done: point labels taken from
    row titles stay plain; the desktop PDF of formatted text and IME in Safari were not checked by
    hand.
28b. ✅ **Word-style font controls** — the editor's floating toolbar grows to two compact rows:
    a font menu (Sans, Serif, Mono, Narrow, each shown in its face), a font size box (a
    combobox: type a size, or pick one of 6–72 pt) with grow / shrink buttons (⌘⇧> / ⌘⇧<,
    Ctrl+Shift elsewhere; Word's size steps), a text colour button (the selection's colour;
    Automatic, the palette, black and greys), then bold … subscript, alignment buttons for text
    boxes and layout text, Clear formatting and the symbol picker. Everything applies to the
    selection as in Word; at a caret it sets what typing continues with; the toolbar shows the
    selection's font, size and colour, blank when mixed; menus close on Escape or a press
    outside; the toolbar measures itself and stays inside the window, its menus opening upwards
    in the lower half. Editors show the element's own style (a bold title edits bold, Bold
    pressed) and Bold off inside it stores `bold: false` (decision 156). Runs gain an absolute `size` and a `color` (a palette reference or hex):
    `layoutText` measures each run at its size (scripts at 0.7 of it), lines of one size keep the
    font pitch while a line with larger runs takes their room, underlines follow the run's size
    and colour, and both SVG emitters write a tspan's `fill` only where it differs, so existing
    golden SVGs are byte-identical; three new ones cover mixed sizes and colours in a title, Mono
    and Narrow text and a coloured word in a legend entry. Legend rows grow for larger runs; grid
    titles store sizes and colours but show only colour and font at the grid's size. Fonts:
    Liberation Mono 2.1.5 (OFL, as Sans / Serif) and Liberation Sans Narrow 1.07.6 (GPL v2 with
    the font exception; see decision 152), bundled for measurement, the app's @font-face rules,
    PNG export (now embedding only the families a graph uses), portable SVG font stacks and the
    desktop PDF's font database. Not checked by hand: the desktop PDF with the new fonts and mixed
    sizes, and the toolbar in Safari outside the WebKit tests.

29. ✅ **Table editing** — spreadsheet editing of data tables, every edit one undo step. Rows:
    the row numbers select whole rows (Shift extends, a drag selects a range), selected rows are
    dragged by their numbers to a new place or moved with ⌥⌘↑ / ⌥⌘↓ (Edit › Move rows up /
    down), Insert rows inserts as many as are selected. Columns: data set headers are dragged to
    reorder them (Edit › Move column left / right; X and row titles stay first), Insert column
    adds one before the selection. Edit › Sort… sorts every row of the table by up to three keys
    (row titles, X, any subcolumn, text variables; ascending or descending, blanks last, numbers
    by value, text ignoring case with numbers inside in numeric order, stable); a column
    header's right-click menu has Sort ascending / descending by it. Fill down (⌘D), Fill right
    (⌘R) and Fill series… (linear, multiply for dilutions, log-spaced; the selection or a count
    of rows) go through the paste rules. Find and replace (⌘F, ⌘G / ⇧⌘G, Esc): a bar over the
    grid finding numbers by their entered value, text, calculated values, row / data set / X /
    subcolumn titles (match case, whole cell), all matches highlighted and the current one
    selected and scrolled to; Replace / Replace all (one step; numbers must stay numbers; titles
    keep their formatting). Format › Format column… (also in the header's menu): decimals,
    scientific, ×10ⁿ, percent, thousands for data sets and X, display only. Column widths:
    dragged at a header's edge, double-click fits the content, saved with the table. Keys:
    ⌘/Ctrl + arrows to the data's edge, Home / End, ⌘/Ctrl + Home / End, Page Up / Down, Shift
    extending each. One engine command reorders rows (`table.permuteRows`), and row inserts,
    deletes and reorders now also move analysis parameters that name rows (`ROW_PARAMS`:
    contingency's control row, goodness of fit's expected values) along with graphs' row
    slices, point labels and formats and brackets. Pure helpers (`table/reorder.ts`, `fill.ts`,
    `find.ts`, `display.ts`, `navigation.ts`, `columnWidths.ts`) carry the logic, unit-tested;
    end-to-end tests in the three engines cover sorting with a graph's labelled row following,
    row and column moves, fills, find and replace with undo, column format and width, and the
    keyboard jumps. Results, rendering, goldens and `ANALYSES_VERSION` are unchanged. Not done:
    remapping analyses and graphs of a result table computed from a sorted table (as for row
    inserts and deletes), a shortcut for moving columns, hiding or freezing columns.
30. ✅ **More graph types** — decisions 215–226; DATA_MODEL §6.4g.
    - *Stacked and horizontal (30a):* column and grouped graphs drawn horizontally (Format graph ›
      Graph settings › Orientation; New graph's Horizontal box; Duplicate as…): categories down
      the left, values along the bottom, the X / Y axis specs keeping their meaning; bars, dot
      plots, boxes, violins, estimation and forest-style (mean with CI) plots; brackets upright
      right of the data with level labels, stacked clear of each other's labels; bar and point
      labels beside the marks; an estimation plot's difference axis and a grouped graph's right Y
      axis along the top; tick labels, brackets and titles dragged and snapped along the turned
      axes. The layouts draw in the vertical frame and turn their marks (`layout/orient.ts`,
      `flipNode`), so vertical graphs are byte-identical. Stacked grouped bars (Data sets in each
      row › Stacked; presets "Stacked bars, mean ± SD" and "percent of each row's total"): one bar
      per row, positive and negative centres piled apart, percent stacks, gaps between segments,
      error bars on each segment's end. Bars from any baseline (Appearance › Bars start at a
      baseline other than 0), up or down from it, error bars pointing away.
    - *XY and time courses (30b):* a faded line through each replicate across X ("spaghetti",
      preset "Each replicate joined across X"), lines broken at missing values or joined across,
      the error as a shaded band (preset "Mean joined, SD as a shaded band"), the area under a
      line with its opacity and baseline, X error bars from the table's X errors, a box of the
      replicates at each X; line style and colour per data set (Appearance › Lines); geometric
      mean with its SD factor or CI (centre "Geometric mean", error bars geoSD / geoCI), whiskers
      at the 1st–99th and 2.5th–97.5th percentiles; a grand mean line on column graphs (Graph
      settings › Grand mean). R oracle suite `plotstats` (10 fixtures).
    - *Heat maps (30c):* `heatmap.cells` for grouped tables (rows × data sets, cell means) and
      multiple-variables tables (rows × numeric variables), in the New graph dialog, Graph type
      and Duplicate as…; 13 colour maps (viridis family, ColorBrewer sequential and diverging),
      reversed, automatic or fixed range, a diverging midpoint, a missing-cell colour and cell
      borders; z-scores by row or column; hierarchical clustering of rows and / or columns
      (Euclidean or 1 − Pearson r; complete, average or Ward) with dendrograms beside the map,
      ordered exactly as R's `hclust` (R's Fortran ported to `stats/src/gpl/hclust.ts`; oracle
      suite `cluster`, 19 fixtures, ties included); values in the cells; a colour scale right of
      or below the map drawn as 64 bands, so SVG, PDF, images and the canvas draw it alike. All
      in Format graph › Appearance.
    - A "More graph types" example (horizontal bars from a baseline of 1, a forest plot with
      brackets, stacked and 100% stacked bars, a mouse time course as a spaghetti plot and with an
      SEM band broken at a missing day, geometric titres with a grand mean, a clustered heat map
      of gene expression). Tests: layout unit tests (orientation, stacking, baselines, envelopes,
      spaghetti, gaps, X errors, boxes, geometric bars, grand mean, colour maps and scales,
      dendrograms, clustering order against every `cluster` fixture), 19 new golden SVGs, drags on
      horizontal graphs, the PDF of a heat map, five end-to-end tests in Chromium, WebKit and
      Firefox. Existing golden SVGs, example fingerprints and `ANALYSES_VERSION` are unchanged.
      Not done: stacked dot plots and boxes, "separated" grouped layouts (data sets as clusters),
      a width option for XY boxes (their half-width is not in the X range), heat maps of
      contingency tables, annotation bars beside heat maps.
31. ✅ **Reusing analyses** — a table's *family* (the analyses of it and of their result tables,
    the graphs of all of them, the analyses' own graphs and the layouts placing them; derived,
    `familyOf`) copied or re-pointed as a unit, every reference remapped by one pure module
    (`engine/src/remap.ts`: node ids, data set keys in inputs, parameters, series, output and
    comparison keys, brackets, point formats and labels, row slices, row parameters, shared-axis
    groups, layout items of any kind) and each operation one undo step. Edit › Duplicate
    family… (also the navigator's right-click on a table) copies a table with its values and its
    family, names changed by a substitution ("Replace ‘Day 1’ with ‘Day 2’", the next in the
    series by default), layouts showing only its graphs (or also mixed pages, whose other graphs
    stay shared); Edit › Duplicate analysis copies one analysis. Analyze › Apply analyses and
    graphs to… makes copies of the family for other tables of the same kind, data sets matched by
    position or by title, the source table's name replaced by each target's, and lists what has no
    place (data sets without a match, rows past the target's end: left out) before applying. The
    analysis parameters' Data choice points an analysis at another table of the same kind (its
    data sets and parameters remapped; graphs showing only its curves and brackets follow, others
    lose them; what reads its result table is remapped). Insert › New graph like this… makes an
    empty copy of the graph's table (titles, rows and format kept) with a copy of the graph and of
    the analyses its curves and brackets need. File › Save as template… writes the project with
    its tables cleared as a `.pstemplate` (the project format, flagged; no results); File › New
    from template… (and the start screen) opens one as a new untitled project, from the desktop
    app's templates folder, the browser's recent templates (IndexedDB) or a file. Analyze › Save
    as method… keeps a table's family without data as a versioned `.psmethod` (JSON holding a
    small project, so the project file's migrations and validation apply; checked with zod on
    load); Analyze › Apply method… lists the saved methods (desktop: app data folder; web:
    IndexedDB), imports, exports and deletes them and applies one to tables of its kind through
    the same code as Apply to other tables. From table editing (29): Format › Change table
    format… converts replicates to mean with SD, SEM or CV and N (computed; the values replaced
    are counted first), SD ↔ SEM ↔ CV given N exactly, ± errors ↔ limits, or changes the number
    of replicates (`table.setYFormat`); notes are editable above every table, results sheet and
    graph (`notes`, now also on analyses and graphs). Tests: engine tests of a deep family
    (chains, result tables, brackets, curves, point labels and formats, row slices and parameters,
    shared axes, whole and mixed layouts: every reference inside the copy, originals untouched,
    one undo step, copies computing what the originals compute), apply by position and by title
    with its warnings, change of table, methods (round trip, applied in another project, invalid
    files refused), templates and the conversions' arithmetic; real-plugin tests (curve fits,
    normalize and fit, t tests with brackets; a t test from converted mean/SD/N equal to the raw
    one); end-to-end tests in the three engines for each command. Results, rendering, goldens and
    `ANALYSES_VERSION` are unchanged. With layout objects (32, decision 210): live tables on pages
    count as family members and follow the copies like graphs, images are shared by id and saved
    with templates, methods leave images out, and layout pages have notes too. Not done:
    result-table data sets made from several inputs (hashed ids) are not remapped when applying to
    another table; templates and methods don't carry the project's settings.

32. ✅ **Layout objects** — layout pages hold, besides graphs and text: lines and arrows (heads
    at either end: filled or open arrow, bar, dot, with a size), rectangles (rounded corners)
    and ellipses with an outline and fill, text boxes that wrap at a width with a border,
    background and padding, PNG / JPEG images (cropped, a border, proportions kept unless freed)
    and live tables of a data table, a result table or a results sheet (rows and columns shown,
    font, grid lines, bold titles) that follow edits and recomputation. Drawing tools (Insert ›
    Line / Arrow / Rectangle / Ellipse / Text box, and a tool strip on the page's toolbar): drag
    on the page, or click for a default size; Shift keeps lines to 45° steps and shapes square
    or round; Escape puts the tool down; a new text box is typed into at once. Insert › Image…
    (the platform's file picker), an image pasted from the clipboard or a file dropped on the
    page; Insert › Table… Handles: eight on shapes and images (Shift keeps the proportions,
    images keep theirs unless Alt or the inspector frees them), the sides of a text box (its
    wrap width), the ends of a line, the corners of a group or several items (scaled as one:
    positions, sizes, graph size and font sizes; line widths stay); everything snaps to the
    other items' edges and centres and the page's margins and centre (Alt: not). Arrange for any
    items: Align ▸ left / centres / right / top / middles / bottom (within the selection, or on
    the page for one item or group), Distribute ▸ horizontally / vertically (three or more),
    Bring forward / Send backward beside Bring to front / Send to back, Group (⌘G) / Ungroup
    (⇧⌘G), Lock / Unlock all; Edit › Duplicate (⌘D). The graph-only commands stay, renamed Align
    plot left edges / Align plot tops. Copy (⌘C) with items selected puts a picture of them on the
    clipboard and records them for Paste (⌘V: copies stepped 12 pt off, their images carried
    along, also into another project); an image on the clipboard pastes as an image item.
    Inspector panels per kind, from the existing field components; the page panel lists locked
    items. Graph line annotations share the heads (Format › line or arrow) and get handles on
    their ends (Shift: 45°). Images are held beside the document in the engine's asset store and
    saved as `assets/<id>.png|jpg` in the project file, garbage-collected on save; SVG exports
    carry them as data URLs, the PDF writer as image XObjects (JPEG as is, PNG decoded to RGB with
    its alpha as a soft mask), raster exports and copies draw them. Scene primitives gain ellipses,
    paths, images and rounded rectangles in every renderer (SVG, PDF, the canvas, hit tests).
    Tests: headers and the PNG decoder on fixtures (grey, 1- and 16-bit, palettes with
    transparency, alpha, Adam7), PDFs read back and by pdf.js, page layout of every kind, the file
    format (ids, garbage collection, limits, damaged entries), undo and recovery with images, live
    tables, the arranging maths (57 new unit tests); five new golden SVGs (existing ones
    unchanged); eight end-to-end tests in Chromium, WebKit and Firefox: drawing each object, handles and Shift, line ends, an image from
    a file and a drop, crop, TIFF refused, group / align / distribute / duplicate / lock, a live
    table updating, PDF and PNG export with an image and a save → open round trip, pasted and
    dropped images, and a graph arrow's end handle. The image header reader is imported by
    subpath (`@ps/graph/image`) so the serializing worker stays small. Not checked by
    hand: images in the desktop app's save / open and pasting images there (WKWebView's paste
    and, with Tauri's drag-and-drop handler off, file drops), PDFs with images in Illustrator and
    Preview, very large images and recovery copies holding them.

33. ✅ **Grammar-of-graphics graphs** — design [GRAPH_LAYERS.md](design/GRAPH_LAYERS.md)
    (approved 2026-10-01): a graph becomes a frame plus layers (geom × stat × position), the table
    kind still implying the mapping; decisions 227–271. In four stages, all done, and an audit:
    - 33a ✅ **The layer engine, byte-identical.** `@ps/model` gains the v2 types
      (`layers.ts`: Layer, Geom, Stat, Position, LayerData, Aes, Frame, SeriesIdentity, colour
      and size scales, `drawOrder`, the layered graph node; not yet in `GraphNode`) and
      `compileV1` (`migrations/v1to2.ts`): a v1 graph as frame and layers with frozen v1
      defaults, deterministic layer ids (`bars`, `points`, `error`, `center`, `curves`…), styles
      moved section by section (`styleSections`: where each field's theme default lives), stats
      per layer and per data set (a data set's own kind, e.g. one grouped data set's mean
      symbol), v1's mark order as the layer list and per-data-set `order`, and a report of what
      it drops or can only approximate. Every graph is laid out by the layer engine
      (`graph/src/layers/`, every frame switched once its shadow comparison passed); the v1
      layouts moved to `graph/src/legacy/` for the shadow test. Goldens (75) byte-identical,
      example fingerprints and `ANALYSES_VERSION` unchanged; marks carry their layer
      (`SceneNode.layer`, not exported). Tests: the shadow comparison of every golden graph
      (70), every example graph (87 synthetic, 43 published) and 500 random v1 graphs (486
      compared, 14 left out as reported approximations); axis extents and linked axes on both
      paths; layout CPU within 10% of v1 (1.07, compiling included) and linear from 10k to 100k
      values on a 12-layer graph; the engine never reads a graph type and reads `look` only in
      its theme; drawing by layer (three new goldens of hand-built layer lists: XY bars under
      every symbol, a grouped time course, violin + box + points with `@<layer>` ids); the
      compatibility matrix; violin densities in `@ps/stats` against R (oracle suite
      `graphstats`, 9 fixtures). Approximations `compileV1` reports (left to 33b): points drawn
      on grouped bars with mean replicates (v1 left them out of the axis range), every replicate
      of entered XY means (v1's range reached error bars it didn't draw), points of functions
      (a legend symbol).
    - 33b ✅ **Layers in the document.** Schema v2: `GraphNode` is a frame, layers (back to
      front, at most 32), a look, a preset, a drawing order, data sets' identities
      (`seriesOverrides`: colour, Y axis, point labels, order), point formats and colour / size
      scales, with a trimmed `GraphStyle` (`polar` added); `GraphNodeV1` kept to read v1 files.
      `MIGRATIONS[1]` runs `compileV1` over every graph (frozen: its own copy of v1's defaults and
      of where each layer style field comes from), checking each v1 graph first, and reports what
      it changes: the three approximations of 33a become the layers' consistent behaviour (points
      drawn on grouped bars as mean symbols count in the axis range; every replicate of entered
      means: the range reaches only what is drawn; functions' points, never drawn, get no legend
      symbol), and settings v1 ignored are listed; the notes show once after opening a file
      (`MigrationNotice`). Templates, methods and recovery copies migrate the same way; older
      apps refuse v2 files with their newer-version message. One `graphRefs` / `mapGraphRefs`
      visitor serves every reference walker (node references, removal, reuse remapping, families,
      methods, row edits, data export), checked against a walk of the schema. Commands:
      `node.set` with `{ id }` path segments; `graph.addLayer`, `removeLayer` (with attached
      layers and the data sets' orders), `moveLayer`, `setLayers`, one undo step each. Creators,
      presets (`presetGraph`: a preset as a function from a table to layers), retyping, Magic,
      small multiples, output graphs and curves return v2 graphs; new graphs draw by layer
      (Appearance › Drawing order switches a graph to data set by data set, where a data set's
      own order counts). The UI keeps its behaviour: the panels read the graph's v1 view and the
      store applies their v1 paths (the scene's targets) as layer edits. The examples build v2 graphs drawn by data set,
      exactly their v1 documents migrated, so they look as before; their fingerprints were
      re-recorded with that proof. Tests: v1 fixtures (70 goldens, 10 examples, 12 exotic
      projects, a template, a method, a project file) migrated, rendered byte-identically and
      shadow-compared; the six local published examples likewise (not committed); the v1 view's
      fixed point and edits (fast-check); layer commands and their undo / redo (fast-check);
      Apply to other tables over layer references. All 78 goldens byte-identical,
      `ANALYSES_VERSION` unchanged.
    - 33c ✅ **The graph builder, the Layers section, selection by layer.** Native presets
      (`presets.ts`, decision 248): 31 layer lists from a table's kind, entry format and nesting,
      the 33b presets (each proven to draw what its compiled v1 style drew: 75 preset × table
      kind comparisons of scene and SVG, nested variants included) plus the graph types 33b
      offered apart from them (box with points, violin with box, before–after, heat map,
      survival, pie, donut, 100% bars, bubble plot). Plot styles (`plotStyles.ts`): a geom with a
      starting stat per frame in five families (raw values, summaries, trends, connections,
      special) and frame choices (columns, grouped bars, heat map, bubbles, wedges, 100% bars),
      available or not with the matrix's reason; their icons are laid out by the engine from
      tiny fixed tables (`icons.ts`, decision 251). **The graph builder** (decision 242;
      Insert › New graph…, Format › Duplicate as…, Format › Layers ▸ Change layers… and Graph
      settings › Change layers…): presets as a radio group of chips ("Custom" once edited) — a
      few per table kind (decision 254: column bars with points, scatter, box with points,
      violin with box; grouped the same and stacked bars; XY mean ± SD joined, mean with error
      band, each replicate; survival Kaplan-Meier; parts of whole pie; multiple variables
      bubbles and scatter; contingency bars and stacked bars; nested scatter and bars with
      points), the other presets internal and every one of them buildable from the icons — the
      icons as toggle buttons (unavailable ones dimmed, the reason as their description), the
      layer table bottom to top (front first since 33e, decision 265) with each layer's statistic, ↑ / ↓, Alt+↑ / ↓, drag and Delete
      (asking first for a layer others sit on), Horizontal, Groups, Pie / Donut, Map variables,
      a live preview with a generated description, and the data sets, rows and Make options
      (small multiples, a layout page) for new graphs or the stacking options for a copy; its
      state is a pure reducer (`builderState.ts`). Change layers keeps the formats of the layers
      that stay (`keepFormats`, decision 249), one undo step. **The user's presets** (decisions
      255–257, bringing forward part of roadmap 37's saved layer stacks): Save as preset… (the
      builder's presets row; Format › Layers ▸ Save layers as preset…; Graph settings) keeps a
      graph's layers as a recipe (`presetRecipe`: geoms, stats, positions, styles, attachments,
      orientation, drawing order, colour maps; nothing tied to the table's data sets, no titles,
      axes, annotations, labels or point formats), named with validation; they come first in the
      presets row, starred, for the table kinds they fit (the matrix), and apply as built-in
      presets do. Manage presets… renames, deletes (asking, no undo), reorders, makes one a table
      kind's default (chosen when the builder opens for a new graph of that kind) and exports or
      imports `.pspreset` files (zod and a version; other files refused with the reason). Kept
      per user as methods are: desktop `presets/` in the app data folder, web IndexedDB with an
      in-memory fallback. **Format graph › Appearance**: the
      Layers list (show / hide, Add filtered by the matrix with reasons, duplicate, remove, Alt+↑
      / ↓ or drag, drawing order), the selected layer's series picker, the series' identity and
      the layer's own fields (statistic, position, its geom's sections, name and legend entry).
      **The canvas** (decision 243): marks target their layer (`layerTargets`, assigned after the
      engine's layout so the shadow comparison is unchanged; decision 250); a click selects the
      layer's marks of the data set, a second click the point, Alt-click the whole layer, Escape
      steps back, a double-click opens Appearance on that layer and data set, the legend selects
      the identity; the hint names the layer. A mark's context menu: Format…, Hide this layer,
      Bring layer forward / Send layer backward, Remove layer, Add ▸ error bars or labels on it;
      Format › Layers ▸ Change layers…, Add…, Move forward / backward, Hide / Show, Remove act on
      the selected layer, one step each. Layers the table can't support are drawn as far as
      possible and named in the graph's warnings (`matrixWarnings`, decision 252). Magic, small
      multiples, output graphs and curves work on layers. **The v1 bridge is retired**
      (decision 253): no v1 view (`toV1`, `editAsV1`), no v1 paths in the store, the v1
      creators and presets only in `graph/test/v1/` for the shadow and parity tests. The
      examples build their graphs from presets and layer edits (renders unchanged: stage-1 SVG
      hashes and the migrated v1 scenes for the synthetic ones, panel by panel for the six local
      published papers), so only their fingerprints were re-recorded. Tests: presets × table
      kinds against the compiled 33b presets; the matrix and plot-style availability; icon
      determinism; layer targets and matrix warnings; the builder's reducer (presets, toggles,
      stats, moves, Custom, keep-formats); click / second click / Escape / Alt-click selection
      and the hint; layer commands; Playwright in Chromium, WebKit and Firefox (the builder:
      the grouped bars + points + SEM example, every preset of every table kind, disabled icons'
      reasons, keyboard-only creation, Format graph's Layers each one step, canvas selection,
      Duplicate as…, Change layers keeping formats, heat map and bubbles as frame choices; user
      presets saved, used on another table, made the default, exported, imported, renamed and
      deleted). All 78 goldens byte-identical, `ANALYSES_VERSION` unchanged.
    - 33d ✅ **New combinations, retiring the v1 layouts.** Combinations built from the
      builder's icons, each allowed by the matrix with reasons where not, drawn with legends,
      axes, brackets above the tallest layer and selection and Format by layer (decisions
      258–263; no new chips: users save their own presets): violin + box + points (a box added
      to a violin goes narrow inside it); mean symbols over every value (a second points layer,
      `point@<layer>` ids); a line through the means across a column graph's categories (Join
      means); grouped box plots with joined means; an error band across a grouped table's rows
      (a time course kept as grouped); labels showing each segment's percent of its row (the
      default on 100% stacked bars); contingency 100% stacked bars and heat maps (counts); XY
      stacked areas (position `stack` on areas) and step lines; a column table's histogram (the
      frame choice Histogram: the `bin` stat, count / percent / fraction, automatic or set bin
      width, its numbers from `@ps/stats` `histogram`, checked against R's `cut()` in the
      `frequency` suite); multiple-variables points coloured by a text variable with lines by
      group (`aes.group`; no facet decision needed, Q4 stays open). Drawing by layer now stacks
      every layer in the list's order, frame-drawn marks included (before-after lines, grand
      mean, differences, XY bands, areas and curves, survival bands, heat-map values, slice
      labels), so moving a layer moves its marks (a user-reported bug; graphs drawn by data set
      keep v1's planes exactly). **Retired**: `graph/src/legacy/` (the v1 layouts and their
      right-axis and chart-option resolvers), v1-only theme resolvers (`resolveSeriesStyle`,
      `MarkLayers`…), the v1 path of `layoutGraph` and linked axes, `graph/test/v1/` (creators and
      presets), the shadow test and its random v1 graphs, the 33b-parity tests; the graph tests
      build v2 graphs (`graph/test/graphs.ts`). The v1 fixtures stay as migration tests (migrated,
      rendered, SVG equal to the stage-1 SVGs and hashes); `compileV1` stays, frozen. The matrix
      is generated into DATA_MODEL.md §6.2a (a test keeps them equal). Tests: 14 new goldens
      (`combo-*`), the combinations' geometry, drawing by layer per frame (two layers swapped in
      each frame), every preset and every offered plot style against the matrix, the builder's
      reducer for each combination, histogram measures against R; Playwright in Chromium, WebKit
      and Firefox (each combination from the icons; before-after lines moved in front of the
      points and back). All 78 earlier goldens byte-identical, `ANALYSES_VERSION` and example
      fingerprints unchanged.
    - 33e ✅ **Layer-order audit.** The user reported that "the layer ordering is off". **Lists
      show the front first** (decision 265): the graph builder's layer table ("Layers, front to
      back") and Format graph › Layers put the front-most layer on top, as Illustrator, Affinity,
      PowerPoint and Photoshop do; the document stays back to front, only the lists are reversed.
      Up means towards the front everywhere: ↑ and Alt+↑, dragging a row into another's place,
      Format › Layers' Bring forward / Send backward, Format › Layers ▸ Move forward / backward and
      the canvas's Bring layer forward / Send layer backward (all off where nothing would move);
      the top and bottom rows say front and back; the focus follows a moved row and goes to the
      row taking a removed one's place. The list operations are one module shared by the builder,
      the Layers section and the canvas (`graph/src/layerList.ts`, decision 266): a layer moves
      with the layers attached just in front of it (they show above it, ↲ pointing down to it),
      steps past the next layer and what is attached to it, and an attached layer never goes
      behind its host; a new mark (points, a line, error bars…) goes on top, a new fill (bars,
      a box, a band, an area, the grand mean…) just behind the marks already there (decision
      271), attached ones just in front of their host (the canvas's Add ▸ used to put them at the
      very front); `graph.moveLayer` keeps document terms.
      **The engine** (decision 267): a test generated from the matrix draws every pair of (geom,
      stat) layers it allows on every frame of every table kind (14 kind × frame combinations,
      450 pair variants: apart, attached either way, stacked on grouped graphs; 341 more turned
      horizontal), both ways round, drawing by layer: every mark of the layer behind is painted
      before every mark of the one in front, the furniture (axes, grid, legend, brackets, point
      labels, colour scales, dendrograms, the difference axis) stays the same, and point labels
      and brackets stay on top; a function's line against every XY layer; drawing by data set,
      each data set's own order (450 variants), and frame-drawn layers beneath the data sets or,
      moved to the top, over them; the SVG writer, the PDF writer (content-stream order) and
      layout pages paint in the scene's order (the canvas, previews, raster export, copies and the
      desktop pasteboard draw `SceneSvg` / `sceneToSvg` / `sceneToPdf` of the same scene). What it
      found: the paint order followed the list in every frame drawing by layer, but the matrix
      allowed layers the frames never drew (points, bars, boxes… on heat maps; tiles and slices
      elsewhere; cell values and shares off heat maps, pies and 100% bars; labels of each value
      outside XY; XY bands of table data as identity; contingency bars as identity; heat-map and
      pie labels not on their tiles or slices; lines by group without mapped points), now refused
      with reasons (decision 269); a second before-after or grand-mean layer drew nothing; centre
      lines, labels and before-after lines didn't reach the value axis (alone, nothing drawn); a
      label with nothing under it had no place (decision 270); drawing by data set (every example),
      moving a frame-drawn layer (bands, areas, curves, functions, before-after lines, the grand
      mean, differences, heat-map values) did nothing: moved to the top it now draws over the data
      sets, migrated lists unchanged (decision 268); 100% bars drawn by data set honour a data
      set's order putting labels behind. Tests: 1,258 in the z-order suite, the list operations
      (exhaustive moves), the builder's reducer and the Layers section's move, drag and add
      commands; eight new goldens (`order-*`: grand mean, grouped points over bars, XY band over
      line, survival band over curve, each both ways round); Playwright in Chromium, WebKit and
      Firefox (`layerOrder.spec.ts`: the builder's before-after lines to the top row and back with
      buttons and keys, Format › Layers and the canvas's menu with the canvas following, XY band
      and line, grouped points and bars, grand mean and points). All earlier goldens
      byte-identical, `ANALYSES_VERSION` and example fingerprints unchanged.

34. **Multiple-variables graphs** — design [GRAPH_LAYERS.md](design/GRAPH_LAYERS.md) §9.6:
    graphs of a multiple-variables table's variables built in the graph builder, the mapping
    deciding the frame (decisions 281–291), more variables mapped to appearance (decisions
    300–311), group overlays, paths, vectors and grouped PCA plots (decisions 340–349), one
    graph per level as linked separate graphs (facets, GRAPH_LAYERS Q4 resolved; decisions
    380–389), tables of a million cells (decisions 400–417), cells tables, a larger palette,
    natural order and histograms of variables (decisions 430–437), cytometry axes and density plots
    (decisions 470–484). Brackets from analyses on these
    graphs are still to come (fits per group on them came with roadmap 35).
    - 34a ✅ **Categorical axes straight from the table.** The graph builder's Map variables
      (Insert › New graph…, Duplicate as…, Change layers…; each variable with its type: "Group
      (text)", "BMI (number, calculated)") takes X and Y of any type and the frame follows (`GraphNode.mapping`, decision 281): number ×
      number the XY graph of the rows as before; text × number a category per level of the text
      variable — every category geom and stat (swarm or jittered points, bars of the mean or
      median ± SD / SEM / CI, boxes, violins, centre lines, error bars, labels, joined means, the
      grand mean, differences) — and, with a text variable mapped to colour, a group per colour
      level within each category, side by side or stacked (the grouped frame); number × text the
      same turned, categories down the left; text × text the rows of each combination counted, as
      count bars (side by side, stacked or 100% stacked; Show: count, percent within each X level
      or percent of the total) or a count heat map. A data adapter turns the rows into the
      series the category, grouped and matrix frames already draw (`graph/src/mapped.ts`,
      decision 282): no frame code duplicated, every geom, legend, axis, point label and Format
      panel works as on a column or grouped table; series are keyed by their level's text
      (`levelKey`, decision 283), so formats follow a level. The compatibility matrix gains
      graphs of variables by their axes' types (`mvTextNumber`, `mvNumberText`, `mvTextText`,
      decision 284), so the plot-style icons, Format › Layers' Add and the canvas's Add ▸ offer
      what draws for the axes chosen; DATA_MODEL §6.2a regenerated. **Order of levels…**
      (decision 285; the builder's Map variables and Format graph › Data sets on graph): a
      text variable's levels — categories, colour groups, legend — moved with ↑ / ↓, Alt+↑ / ↓ or
      drag, sorted A→Z, by the mean of the number variable or by count, or reset to the order
      they first appear in the table (the default); `GraphNode.levels`, optional, no schema
      bump; new levels go at the end, levels gone stay in the stored order. Rows without a
      level or a value are left out with a count in the graph's warnings (decision 286);
      orientation follows the variables (decision 287); what text × text counts is the
      mapping's (decision 288). One new chip, "Box with points by group" (decision 289; shown
      when the table has a text and a number variable); the other presets take the mapping; user
      presets keep the variables' types, never the variables, and map the table's first ones of
      those types (decision 290). Everything follows table edits (new rows, levels renamed or
      added, exclusions), undo / redo and save / reopen: the adapter caches per table object.
      Tests: the adapter (levels, colour × level cells, counts and percents, rows left out,
      exclusions, calculated variables, caching), the order of levels (defaults, sorts, new and
      gone levels), level keys, `graphRefs` over the mapping and the levels, the matrix's kinds,
      presets of every kind with a mapping, the builder's reducer for each axis-type combination
      and the icons it offers, user presets of graphs of variables, live edits with undo, redo
      and a project file; the z-order test generated from the matrix covers the three new kinds
      (2,223 cases, 965 new); eight new goldens (`vars-*`: text × number box with points,
      coloured side by side and stacked, number × text turned, count bars, 100% stacked
      percents, a count heat map, an order of levels); Playwright in Chromium, WebKit and Firefox
      (`mappedVariables.spec.ts`: each axis-type combination from the builder on "Blood pressure
      trial", levels reordered in the builder and in Format graph with undo, a text cell edited
      to a new level). All earlier goldens byte-identical, `ANALYSES_VERSION` and example
      fingerprints unchanged; no new statistic (counts, percents and the existing summaries).
    - 34b ✅ **Mapping variables to appearance.** The builder's Map variables (Insert › New
      graph…, Duplicate as…, Change layers…) has rows for Colour, Shape, Size and Label, each
      listing the variables of the types it takes with their types, the ones the layers chosen
      can't show disabled with the matrix's reason (`aesAllowed`; "needs points of every row"),
      text × text graphs none. Colour by a text variable: the groups of a category graph (34a)
      or each row's point on an XY graph, the levels on the palette in the graph's order of
      levels, each editable (`seriesOverrides[levelKey]`); by a number variable: each row's point
      on a colour map (the bubble plot's gradient, or viridis and the others the heat maps have),
      a fixed or automatic range, a colour for values out of range and one for rows without a
      value, a colour bar in the legend with its tick count and number format (decision 303).
      Shape by a text variable (the sequence from the points' symbol, each level's editable);
      size by a number variable by area (the bubble plot's rule, default) or radius, smallest and
      largest size, a fixed range clamped or extended (decision 304); labels from any variable
      through point labels (number format, an offset, placed apart; decision 306). It works on
      XY graphs of variables (their points' `aes`, extended, not duplicated: the bubble plot is
      drawn by the same scales, its goldens byte-identical) and on the category and grouped graphs
      34a draws (`mapping.shape` / `size` / `label`, a number `mapping.color`), shape and size on
      category graphs included (decisions 300–302). Legends per variable: sizes, colour levels,
      swatches or a colour bar, shapes; colour and shape of one variable merged into one legend,
      a grouped graph's groups showing their symbols; headings the variables' names, editable;
      reversible (decision 305). Format graph › Appearance › **Appearance by variable** edits the
      variables (colour on category graphs: a number one; groups stay Change layers…'s), each
      level's colour and symbol, colour maps and ranges, sizes and legend headings; Format legend
      reverses the entries. Order of levels… also orders the variables mapped to shape (and colour
      on XY graphs; decision 310). User presets keep the variables' types, now XY graphs' too
      (decision 309). Axes and colour bars of counts tick at whole numbers (decision 307: the 34a
      count bars showed 0.5 steps, the count heat map's colour bar 2.25 / 2.75). Everything
      follows table edits (a new level the next colour or symbol), undo / redo and save / reopen.
      Tests: the scales (palette by order of levels, continuous colour with fixed ranges,
      out-of-range and missing colours, diverging midpoints, sizes by area and radius, clamp and
      extend, level shapes, legend values), each row's look on XY, category and grouped graphs,
      legends (merged, groups' symbols, colour bars, headings, reversed), labels from a variable,
      whole-number ticks, the matrix's aesthetics, scaffolds, `graphRefs`, orders of levels,
      presets of types, the builder's rows and live edits with undo, redo and a project file; nine
      new goldens (`aes-*`: XY coloured by text with a level's own colour and order, by a number
      with a colour bar, shaped by text, coloured and shaped by one variable, sized by radius with
      the legend reversed, labelled by a variable; a category graph coloured by a number, one
      shaped and sized; a grouped graph shaped by its groups); two 34a goldens changed on purpose
      (`vars-text-text-count-bars`, `vars-text-text-count-heatmap`: whole-number ticks);
      Playwright in Chromium, WebKit and Firefox (`appearance.spec.ts`: the builder's rows and
      what they offer, a colour bar, Format's colour map and a level's symbol with undo, a table
      edit's new level in the legend, a merged XY legend). All other goldens byte-identical,
      `ANALYSES_VERSION` and example fingerprints unchanged; DATA_MODEL §6.1d new, §6.2a
      regenerated.
    - 34c ✅ **Group overlays, paths and PCA plots.** Three geoms, drawn on XY graphs (an XY
      table's data sets; a graph of variables' groups, the levels of its text colour variable,
      else of its shape variable, after its mapped points; decision 340): `polygon` with stat
      `ellipse` (`norm`, the normal data ellipse; `mean`, the confidence region of the mean; `t`,
      the robust ellipse of `MASS::cov.trob`, ggplot2's default; a level, 95% by default; decision
      341) or `hull` (convex hulls, decision 342), outlined, filled or both, behind the marks;
      `path`, each group's points joined in table row order with arrowheads at the end or along
      the path (trajectories; decision 344); `segment`, an arrow per row from (X, Y) to the X end
      and Y end variables (`aes.xend` / `yend`, decision 345; vector plots), the heads those of
      layout lines (`layout/arrows.ts`). Before-after lines draw on grouped graphs: each subject
      (a replicate of a row) joined across the data sets within the row through its points as
      placed (decision 346; the pair lines of Contreras 1k, 1l, 5n). The numbers come from
      `@ps/stats` (`multivariate/ellipse.ts`: `confidenceEllipse`, `covTrob`, `ellipseOutline`,
      `convexHull`) with R oracle suites `ellipse` (21 cases against ggplot2's
      `calculate_ellipse`, car's `ellipse` and `dataEllipse`, `MASS::cov.trob`) and `hull` (8
      cases, `grDevices::chull`), rtol 1e-10. A group with no ellipse or hull (fewer than three
      points, one X or Y value, on a line, crossing what a log axis can show) draws nothing and
      the graph's warnings say why (decision 343). The builder's chips "Scatter with ellipses"
      and "Trajectories" (tables with a text and two number variables; decision 349), plot
      styles Ellipses, Convex hulls, Path and Vectors (also Format › Layers' Add, where the matrix
      allows), Map variables' "Paths by", "X end" and "Y end"; Format › Layers: an ellipse's kind
      and level or the hull, fill, outline and fill opacity, a path's or vector's line, heads and
      their size, a vector's ends. **PCA grouped by a variable** (decisions 347, 348): "Group by"
      (a text variable among those analyzed, left out of the PCA) and "Ellipses per group",
      optional parameters; grouped, the PCA makes a table of its scores with the group, and the
      score plot and biplot are graphs of it coloured by group (`OutputDecl.graph.variables`; a
      biplot's loading vectors over the points: the mapped XY frame now draws analysis outputs),
      live with the table and the grouping variable. Tests: the stats against R (degenerate
      input, a CPU growth guard), the matrix and the z-order test generated from it (2,360 cases,
      the three geoms on XY tables and graphs of variables and grouped pair lines among them),
      layer drawing (each ellipse kind, levels, warnings, extents, row order, vectors, pair lines,
      log axes), plot styles, chips, user presets of vectors, `graphRefs` over `xend` / `yend`,
      the builder's reducer, the PCA grouped (its table, the PCA unchanged, live edits of the
      table and of the grouping variable with undo, an edited analysis keeping its graphs and
      gaining ellipses, a save and reopen); eleven new goldens (`overlay-*`: each ellipse kind
      over points coloured by group, filled ellipses behind points, hulls, paths with arrowheads
      at the end and along, a vector plot, grouped pair lines, an XY table's ellipses and path, a
      grouped PCA's score plot with ellipses); Playwright in Chromium, WebKit and Firefox
      (`groupOverlays.spec.ts`: the chips, Format edits of ellipses, hulls and paths with undo, a
      PCA grouped with ellipses). All earlier goldens byte-identical, `ANALYSES_VERSION` and
      example fingerprints unchanged; DATA_MODEL §6.1e new, §6.2a regenerated.
    - 34d ✅ **One graph per level, row details.** Small multiples as linked separate graphs
      (GRAPH_LAYERS Q4 resolved; decision 41 kept): "One graph per level of a text variable" (the
      builder's Make, with the variable; a graph's menu and Format graph › Graph settings "Split
      into one graph per…") makes a set of ordinary graphs, each the original's layers, look,
      formats and mapping filtered to one level's rows (`seriesSource.filter`, applied where rows
      are resolved, `graphRows`: every 34a–c layer works, and a row whose level changes moves to
      the other graph; decision 380), titled with the level, the categories and colours in the
      whole table's order on every graph (decision 384), one legend; XY, column and grouped tables
      split per data set and grouped tables per row the same way (decision 381). A new page places
      the set on a grid in its order (plot areas aligned, equal plot sizes; columns automatic,
      editable on the page), the axes linked through link groups (decision 40) or free per set
      (decision 385). The set is recorded (`split: { set, by, variable }`, the page's `grids`), and
      a new level, data set or row in the table gets a graph like the others on the set's page in
      its place, in the same undo step as the edit (`splitFollowUps`; decisions 382, 383); an
      emptied level keeps its graph. "Apply this graph's format to all graphs of the set"
      (`matchSetFormat`, Magic by key; decision 388). Copies get sets of their own (decision 389).
      **Hover cards** (decision 386): hovering a mark on the graph's canvas, a layout page or the
      Format preview shows its whole row (every variable of a multiple-variables table; else the
      row's title, X, value and replicate) or, for bars and other summaries, the centre, error and n
      the graph draws, beside the mark over the graph (no layout shift, any zoom); a selected point
      keeps its card (`]` / `[` step through the points, Tab reaches the button). **Go to row**
      (the card's button and the point's context menu) opens the table with the row (or the
      value's cell) selected and scrolled into view (decision 387). Optional fields, no schema
      bump; DATA_MODEL §6.1f new, §6.5 and §7 extended. Tests: the filter (levels, exclusions,
      live edits, every frame and layer drawing exactly the level's rows, a missing variable),
      splitting (levels in order, other table kinds, links, legend, formats), `graphRefs` over the
      filter and the set, the engine's new graphs (a new level, data set and row; placement, page
      growth, set order, left-out and emptied levels, undo and redo, copies' fresh sets), hover
      content for each table kind and summary, the app's sets live with a save and reopen, free
      and shared axes, apply to the set, the cards' placement and Go to row (38 new unit tests);
      three new goldens (`split-level-member`, `split-level-member-xy`, `page-split-set`);
      Playwright in Chromium, WebKit and Firefox (`splitGraphs.spec.ts`: a split from the builder
      with a table edit's new level and undo, a split from a graph's menu, hover cards on the
      canvas, a page and the Format preview, a bar's statistics, Go to row by mouse and keyboard).
      All earlier goldens byte-identical, `ANALYSES_VERSION` and example fingerprints unchanged.
    - 34e ✅ **Large single-cell and FACS tables.** A multiple-variables table of about a million
      rows × 20–60 variables (a CSV export of Seurat, Scanpy or FlowJo: numbers plus a few text
      variables such as cluster and sample) is imported, plotted, hovered and exported with the
      app staying responsive (decision 400; no FCS or h5ad, no gating). Measured first with a
      synthetic generator (`model/test/synthetic.ts`: cell ids, samples, clusters, a clustered
      UMAP, PCs, counts, zero-inflated genes) and a profile of every step
      (`ui/test/largeTables.profile.test.ts`, `PROFILE_ROWS`), the hot spots fixed, each with a
      CPU-growth guard. **The store** freezes the document but its large arrays and patches cell
      edits cell by cell without Immer; row inserts and deletes replace whole arrays; undo and redo
      copy only along their patches (decision 401); per-row arrays are validated in one loop
      (decision 402). **Point clouds** (decision 403): a points layer of more than 20,000 points
      (per layer: Automatic, Always vector, Always image) is one primitive, drawn on screen as an
      image by our own anti-aliased rasteriser (graph canvas, pages, Format and builder
      previews), axes, text, legends and other layers vector, the layer in its place in the
      z-order; exports stay vector (the same SVG, byte for byte) unless "Points as image" is ticked
      (at the export's resolution), with a notice above 100,000 vector points (decision 410);
      hovering, Go to row and selection find a point among a million through a grid (decision
      407). **Drawing order** per points layer: table order, by the colour (or size) variable's
      value highest on top, or shuffled with a fixed seed (decision 408). **Group names**: a label
      layer (stat `centroid`) writing each group's level name at its median (or mean) X and Y,
      a halo or a box, never overlapping (decision 409; plot style "Group names"). **Project
      files** keep tables of more than 100,000 cells in binary entries (numbers as Float64 with a
      null bitmap, text dictionary-coded), small ones JSON, no format bump (decision 404); Save and
      recovery copies of such projects are made in the worker, the recovery buffer left to small
      ones (decision 406). **CSV import** of 8 MB or more streams the file in a worker into columns
      with progress and Cancel, columns chosen and typed in the dialog, limited by memory, not a
      cell count (decision 405). Large tables' defaults: new graphs start as XY graphs of the
      variables, grouped by a variable of few levels, crowded swarms spread evenly (decision 411);
      find and sort at a million rows (decision 412); analyses linear (decision 413). Two
      examples (decision 415): "Single-cell T cells", 30,000 simulated cells shipped with the app,
      and "Single-cell T cells (local data)", the user's own Seurat export read at run time from
      source_data (development only), each with a UMAP by cluster with the clusters named, a
      gene's feature plot drawn by value, the UMAP by sample, a gene by cluster, a figure page and
      one graph per sample on a linked page. Importing leaves text columns of more than 200
      distinct values (cell ids) out until ticked, and text variables of many levels are counted,
      never a default group, and capped in legends and lists (decisions 416, 417).
      Profile (ms on this machine, busy at load 40–80; before → after, 100,000 / 1,000,000 rows ×
      40 variables): CSV import 4,922 / fails (5 GB of cell objects, a string too long) → 1,406 /
      14,412 (in a worker in the app); table validation 131 / 1,047 → 63 / 671; adding the table
      562 / 4,792 → 199 / 2,099; a cell edit 12 / 116 → 1 / 2, its undo and redo 9 / 86 → 0 / 1;
      renaming the table 144 / 1,255 → 42 / 400; find a word 1,639 → 25 / 198, a number
      1,816 → 379 / 3,937; layout of a UMAP by cluster 294 / 1,782 (a million scene nodes,
      +1.2 GB) → 170 / 1,158; on screen a million SVG elements → one image (366 / 443 to draw at
      2 px/pt); a hover 17 / 54 (scene walk) → 0.01 / 0.2 (grid; the first builds it, 9 / 33);
      a cell edit with the graph laid out again 216 / 3,367 → 122 / 1,378; Save 2,189 (10 MB) /
      fails (string too long) → 802 (12 MB) / 8,106 (115 MB, in the worker), opening 529 → 325 /
      4,005; correlation of 10 variables 1,489 / 16,554 → 996 / 13,035. Unchanged and linear:
      descriptive statistics (~6.8 s at a million rows of 36 variables), PCA grouped by cluster
      (Kaiser 3.9 s; parallel analysis, 1,000 simulated tables, 100 s at 100,000 rows),
      vector SVG export (1.9 s) and vector PDF (23 s at a million points: hence the notice).
      The user's T-cell export (16,171 cells × 77 variables, 10 MB, 26 text variables) imports by
      either path to the same table (0.34 s by the new one, 1.3 s by the old), its UMAP lays out in
      0.13 s and saves to 2.3 MB in 0.4 s. Optional fields only, no schema bump: DATA_MODEL §3.1,
      §6.1g, §6.2a (regenerated), §6.5, §8.1, §9 and §9.1. Tests: the store (patches equal to
      Immer's, undo, a filled column one patch, the cost of an edit independent of the other
      columns, row deletes linear), the binary columns (every value, −0 and the extremes, nulls,
      unicode text, wide dictionaries, damaged files, a project round trip, small tables JSON,
      linear time), the CSV reader (14 files compared with `readCsv` + `sheetToTable`, the same in
      chunks of 1, 2, 3, 7 and 64 characters, types chosen, columns left out, the memory limit,
      linear time), recovery (large projects from the worker only, columns transferred), point
      clouds (vector SVG and PDF identical to nodes, the threshold, images), the rasteriser
      (coverage, anti-aliasing, order, every shape's area, determinism), the hit grid (topmost,
      linear build, hovers as fast at 16 times the points), draw orders, group names (centres from
      `@ps/stats`, no overlaps, halo and box), defaults, crowded swarms, find and sort and the
      canvas's cloud (image per zoom, hover card, pinned card); the z-order test generated from the
      matrix (2,362 cases, group names among them); five new goldens (`large-*`: a raster points layer, value and random
      orders, group names with a halo, at the mean in boxes over an image); Playwright in
      Chromium, WebKit and Firefox (`largeTables.spec.ts`: a 200,000-row CSV made at test time,
      Cancel, imported with a column left out, a UMAP by cluster with group names as one image,
      a hovered point's card, SVG exported with the notice and as vectors, then with points as an
      image). All earlier goldens byte-identical, `ANALYSES_VERSION` and example fingerprints
      unchanged.
    - 34f ✅ **Cells tables, a larger palette, natural order, histograms of variables.** The user
      found the graph builder "overloaded very easily" on big single-cell tables, especially when
      another plot style was clicked by accident. **Cells tables** (decision 430): a
      multiple-variables table of single-cell or cytometry data — automatically above 20,000 rows
      (`CELLS_TABLE_ROWS`), or by the table's own setting (`DataTable.cellsTable`: the table view's
      checkbox and View › "Cells table (single-cell / cytometry)", command `table.setCellsTable`
      with undo; "Treat as a cells table" in both import dialogs, on by default above 20,000 rows)
      — not a table kind. Its graphs offer only what scales (decision 431): the matrix lists the
      layers drawing a mark per row within categories or joining every row (`ROW_MARK_LAYERS`:
      swarms and every-value columns, before–after lines, paths, vectors, lines by group, heat maps
      of every value; DATA_MODEL §6.2a), which the builder's icons and chips, Format › Layers' Add
      and Map variables refuse with the reason ("16,171 rows: too many points for a swarm. Use a
      violin or box."); labels from a variable on at most 1,000 rows. Scatters and UMAP / feature
      plots (every 34b mapping, group names, ellipses and hulls, draw order, point clouds as images,
      one graph per level), violins and boxes, histograms, means ± error and counts are offered; a
      text variable on X makes violins with a box inside ("Violin by group", a chip of cells
      tables), the variables as columns boxes. Graphs made before keep drawing; Format › Layers
      names a layer of a mark per row and fixes it in one undo step (remove the points over a box,
      a violin in place of a swarm, joined means in place of before–after lines, else hide it). A
      removable style icon is no longer marked disabled. **Builder previews** of big tables are laid
      out of an evenly spaced sample of at most 5,000 rows with a note ("Preview of 5,000 of 16,171
      rows"), and only the latest of quick clicks is laid out, 120 ms after it (decision 433).
      **24-colour palette** (decision 432): data sets and levels past the 8 Okabe–Ito colours take 16
      more chosen for distinctness with normal vision and two kinds of colour blindness, before the
      palette repeats — in every graph, documents made before included (decision 436). **Natural
      order** (decision 434): new graphs order the levels they keep no order of naturally ("C2"
      before "C10", case and accents aside; `GraphNode.levelOrder`); graphs made before keep the
      order the levels first appear; Order of levels… sorts naturally too. **Histograms of
      variables** (decision 435): a number variable binned, alone or per level of a text variable,
      overlaid (translucent) or stacked, or one graph per level (34d) — the builder's "Histogram"
      (from a scatter, its X by its colour variable), Map variables' X, Colour and Groups, Format ›
      Layers' bin width, measure (count, percent, fraction) and position; on cells tables and
      others; bars' hover cards give the bin and its count; user presets keep them. The numbers are
      the column histogram's (`@ps/stats` `histogram`, oracle suite `frequency`): no new statistic.
      Optional fields only, no schema bump: DATA_MODEL §3.1, §6.1, §6.1c, §6.1h (new), §6.2a
      (regenerated), §8.1. Tests (63 new): natural order (numbers by value, leading zeros, case,
      accents, unicode and astral characters, numbers only, a total order), stored orders old and
      new, the threshold, the setting and its command with undo, the matrix's per-row layers and
      reasons, the builder's offers and chips on cells tables, Format's notices and their fixes,
      preview samples (rows, per-row arrays, result tables, notes), the latest-only scheduling
      (fake timers), a CPU-growth guard on switching plot styles at 20,000 and 200,000 rows, the
      palette by level count, histograms of variables (data sets per level, order, rows left out,
      split graphs, bins against `frequencyDistribution`, stacking, drawing, fills, scaffold, frame
      choice, matrix rules, Order of levels…, user presets, `graphRefs`, hover cards); the z-order
      test generated from the matrix (2,364 cases, histograms of variables among them); five new
      goldens (`cells-umap-natural-palette`, `cells-violins-palette`: 14 clusters in 14 colours in
      natural order; `mv-histogram`, `mv-histogram-overlaid`, `mv-histogram-stacked`); four 34e
      goldens changed on purpose (`large-raster-points`, `large-order-random`,
      `large-centroid-labels`, `large-centroid-mean-box`: their 14 clusters' 9th to 14th colours no
      longer repeat the first six); Playwright in Chromium, WebKit and Firefox
      (`cellsTables.spec.ts`: a 50,000-cell table imported as a cells table, the builder's
      disabled chip and icon with their reasons, the preview's note, quick clicks across plot
      styles, a stacked histogram, a UMAP's 14 clusters in 14 colours in natural order; the table
      setting from the checkbox and the View menu with undo; the import dialogs' checkbox);
      `mappedVariables.spec.ts` and `appearance.spec.ts` now expect new graphs' levels in natural
      order ("High dose, Low dose, Placebo"; a new level by its name). All
      other goldens byte-identical; `ANALYSES_VERSION` unchanged; the single-cell examples'
      graphs are in natural order on purpose, so the synthetic one's fingerprint changed (and the
      local-data one's hash will).
      **Fix after 0.1.21 (no version change; decisions 450–455).** The user's T-cell export
      (16,171 cells × 51 number variables, not a cells table by default) froze the app on the
      builder's Columns: every variable a column of the preview's 5,000 points (a near-quadratic
      swarm each: 22.9 s on the main thread per click, 253,630 SVG elements), and the graph made
      820,000 SVG elements (21.6 s; 51 data sets each under the 20,000 of decision 403). Now on
      screen a data set draws at most 1,000 per-row points, evenly spread (statistics and exports
      every row; a note and "Show all on screen"); a graph's per-row points count together for
      drawing them as images; previews draw at most 20 variables and about 5,000 marks; a cells
      table's Columns start with 20 variables; statistics and violins are kept per data set; a heat
      map of every value no longer overflows the stack. Measured in Chromium on this machine: a
      click on Columns 22.9 s → 0.15–0.2 s (5,169 preview elements, "Preview of 20 of 51
      variables, 5,000 of 16,171 rows"), on Box after it 22.7 → 0.12 s, the graph made 21.6 s →
      0.57 s (447 elements, 51 images), with violins of every row 2.1 s once, hovers under 1 ms,
      every point on screen by choice 3.0 s; its layout in Node 1.9 s → 0.45 s. Tests: unit tests
      of the sample, the note, columns, groups, pair lines, heat-map rows and pages on screen,
      statistics of every row, exports of every point, the graph-wide clouds (in place, byte for
      byte, hovered as rows), preview caps and the cells-table default; CPU-growth guards of the
      builder's Columns by rows and by width; `cellsTables.spec.ts` a 30,000-row × 60-variable
      table in Chromium, WebKit and Firefox. Goldens byte-identical, example fingerprints and
      `ANALYSES_VERSION` unchanged. Then, at the user's request, importing a multiple-variables
      table of more than 5,000 rows asks whether it is a cells table, the cells table the default
      (decision 456; `import.spec.ts`).
    - 34g ✅ **Cytometry axes and density plots.** For single-cell and flow / mass cytometry data
      in multiple-variables tables (cells tables above all), from CSV exports: no FCS import, no
      gating (decision 414). **Cytometry axes** (decisions 470–472): a continuous axis' scale may
      be arcsinh (`asinh(x / cofactor)`, cofactor 5 by default, 150 for flow, editable) or logicle
      (biexponential; flowCore's T, W, M, A, defaults 262144, 0.5, 4.5, 0), optional members and
      fields (`ContinuousAxisSpec.scale`, `arcsinh`, `logicle`), no schema bump; data stay raw,
      positions are linear in the transformed value (`graph/src/transform.ts`); zero and negative
      values are drawn; ticks at 0 and ±10ⁿ labelled as FlowJo does (0, 10³, 10⁴, 10⁵), decades
      squeezed into the linear region near zero left out, minor ticks between; a logicle axis shows
      at least its whole display. Points, point clouds, contours, hexagons, histograms (bins in
      transformed units, decision 473), ellipses, hulls and group names follow them; number colour
      variables may take the same scales (`ColorScale.transform`, decision 482). Format axes ›
      Range and scale: the scale, the cofactor (typical 5 / 150) and the logicle parameters
      (checked as the scale needs). **Hexbin plots** (decision 474): `hex` × `hexbin`, regular
      hexagons over the points (`hexbin::hexbin`, translated in `stats/src/gpl/hexbin.ts`),
      coloured by count on a colour map (viridis; a log option) with a colour bar. **2D density**
      (decisions 475–477): `kde2d` (MASS's, with ggplot2's bandwidths × adjust, a 100 × 100 grid;
      exact up to n · 10⁴ ≤ 10⁸, else the points binned linearly first: O(n) plus the grid) drawn
      as contour lines (`contour`) at ggplot2's levels (R's `pretty`, translated in
      `gpl/pretty.ts`) or at the levels enclosing 50–95% of the points (Hyndman 1996), filled bands,
      one set per group of the colour variable, or as a density image (`raster`). **Points coloured
      by their local density** (decision 478): the density grid interpolated at each point, on the
      colour scale (viridis and a colour bar by default), the densest on top with draw order by
      value; works with point clouds. **Histograms per channel** (decision 481): histograms of
      variables on arcsinh / logicle axes bin the transformed values; "One histogram per variable"
      makes 34d's set of linked graphs, each binning its own variable. **Dot plots** (decision 479):
      number variables by the levels of a text variable (`dotplot` on points, and on tiles for the
      averages behind them), dots sized by the percent of rows above a threshold and coloured by
      the average scaled per variable across the levels (Seurat's DotPlot: mean, or log1p of
      mean(expm1) for log-normalised data; z-scores clipped at ±2.5), sizes and colour bar in the
      legend, levels in natural order. **Builder and cells tables** (decision 480): chips "Density"
      (hexagons) and "Dot plot" on cells tables; plot styles Hexagons, Density contours, Filled
      contours, Density image, Average tiles and the frame choice Dot plot (Format › Layers' Add
      too, per the matrix); Map variables' "Colour the points by their local density"; every one a
      summary, so cells tables offer them (none is a layer of a mark per row). Format › Layers:
      hexagons' size, colours, log and outline; contours' bandwidth, grid, levels (round or shares),
      lines or bands; the image's grid and colours; points' density colouring; a dot plot's group,
      threshold, average and scaling. The numbers come from `@ps/stats` with R oracle suites
      `cytometry` (8 cases: flowCore's `logicleTransform` and its inverse for six parameter sets,
      arcsinh with cofactors 5 and 150; flowCore and Bioconductor 3.20 added to the oracle's renv
      project), `density2d` (9: `MASS::kde2d` grids, the binned estimate against a base-R version
      checked with `KernSmooth:::linbin2D`, densities at the points, levels holding shares,
      ggplot2's `pretty` levels, contour lines against `grDevices::contourLines` as point sets),
      `hexbin` (6: `hexbin::hexbin` cells, counts, centres of mass, `hcell2xy` centres; hexbin added
      to renv), `dotplot` (8: percents, averages and scaled averages as Seurat 5's DotPlot computes
      them, in base R, checked once against Seurat) and `pretty` (12), at rtol 1e-10. Optional
      fields only, no schema bump: DATA_MODEL §6.1a, §6.1d, §6.1i (new), §6.2a (regenerated), §6.3,
      §10. Tests: the transforms against R (and round trips, monotonicity, parameter checks), the
      2D densities, contours (orientation, regions closed along the grid, missing cells), pretty,
      hexbins and dot plot statistics against R, CPU-growth guards (kde2d binned, hexbin and dot
      plot statistics at 100,000 vs 1,000,000 points; hexagons and contours laid out at 20,000 vs
      200,000 rows), axis ticks, ranges and labels, placement on cytometry axes, colour scales on
      transformed scales, hexagons (counts as hexbin's, regular shapes, colour bars), contours per
      group and at shares, filled bands, images cut to the plot, density-coloured points, binned
      histograms on logicle axes with their hover cards, one histogram per variable, dot plots
      (sizes, colours, order, tiles, rules, split graphs, references, user presets), the builder's
      chips, styles and density colouring (80 new unit tests); the z-order test generated
      from the matrix (2,374 cases, the new geoms and stats among them); twelve new goldens
      (`cyto-arcsinh-axes`, `cyto-logicle-axes`, `density-hexbin`, `density-hexbin-logicle-log`,
      `density-contour-lines`, `density-contour-filled`, `density-contour-groups`,
      `density-image`, `density-colored-points`, `cyto-histogram-logicle`, `dotplot`,
      `dotplot-tiles`); Playwright in Chromium, WebKit and Firefox (`densityPlots.spec.ts`: a
      50,000-cell table imported as a cells table, the Density chip, a scatter of two channels on
      logicle and arcsinh axes with undo, density contours added in Format graph and filled with
      undo, a UMAP coloured by density, the Dot plot chip and its scaling turned off with undo).
      All earlier goldens byte-identical; `ANALYSES_VERSION` unchanged (no analysis changed); the
      synthetic single-cell example gains a dot plot of its marker genes by cluster and a hexbin
      of its UMAP, so its fingerprint changed on purpose (the local-data example is unchanged).

35. ✅ **Results on graphs** — design [GRAPH_LAYERS.md](design/GRAPH_LAYERS.md) item 35: an
    analysis' values drawn on its table's graphs, live (decisions 490–503; DATA_MODEL §6.1j).
    **Layers with an analysis source** (decision 490): `data: { from: 'analysis' }` with the stat
    `result` on the label, reference-line and band geoms, in the matrix for every graph with value
    axes (category, grouped and XY frames; survival graphs and histograms too), drawn in the
    list's order, with legend entries, extents and goldens. **Result labels**: a template of rich
    text with `{fields}` (italic *r*, *P*, *R*²), each field a reference to a value of the results
    by keys — a `values` key, a sheet's cell by its block's title, row label and column title, a
    comparison — and a format (significant digits or decimals, units, a unit from an axis title, P
    values below a threshold, exact, scientific, stars or the project's style; decisions 491–492);
    a value gone shows "—" with a warning. Each analysis offers ready ones (`graphResults`,
    decision 493): correlation (r or rs and P, n, CI), linear regression (equation and R², slope ±
    SE, P), nonlinear fits (IC50 / EC50 with the X axis' unit, drop lines at the fitted X, CI, Hill
    slope, Kd and Bmax, top and bottom, R²), t tests, ANOVA and nonparametric tests (P, the
    statistic, effect sizes, stars), survival (median per group, log-rank P, hazard ratio with its
    CI), contingency (Fisher's or χ² P, OR and RR with CIs), descriptive statistics (means and
    their CIs as lines and bands); any cell of any results sheet can be picked by hand. Labels sit
    in a corner (stacked), at a data position or beside their curve's end (repelled from each
    other, the points and the curves), one per data set in its colour, or appended to the legend's
    entries (decision 494). **Lines and bands** (decision 495): across the plot at a value, up it
    at an X, drop lines from a fitted curve at IC50 / EC50 (or any X) to the axes, bands between two
    values (a mean's CI). **Fits per group** (decision 500): fits of a table's variables per level
    carry their level and are drawn on the graph of the variables in each group's colour
    (`OutputDecl.onGraphsOf`); XY tables' fits already were. **Brackets** (decisions 496–497): at
    one X of an XY graph (vertical, beside the points there), labelled by an analysis of the values
    at that X (`input.atX`); from a group of bars to one (a line spanning the group), the group
    pooled by the analysis' input (`input.pools`; column tables: t, Welch or Mann-Whitney; grouped:
    multiple t tests per row) — both with the bracket options (stars, P, both, number; stacking,
    offsets). **Number at risk** (decision 498): an opt-in table under Kaplan-Meier curves, a row
    per group in its colour at the X axis' ticks (or chosen times), part of the graph's layout
    (following the axis, exported with it), counts from `@ps/stats` `numberAtRisk` (new R oracle
    suite `atrisk`, 5 cases against `survival::summary.survfit(times, extend = TRUE)$n.risk`).
    **Inset results tables** (decision 499): a results sheet (or chosen rows and columns) in a
    plot corner, beside the plot or at an anchor, by the page tables' renderer, with fonts, lines,
    digits and a background. **References** (decision 501): `graphRefs` walks the new analysis and
    result-key references, so removing an analysis strips its results (decision 35), Duplicate
    family and Apply to other tables point them at the copies. **UI** (decision 502): Insert ›
    Result ▸ (and Add ▾ › Result, the context menu) — Result label…, Drop lines…, Reference line
    from a result…, Shaded band from results…, Number at risk, Inset results table…, Bracket at
    one X…, Bracket from a group to one…; their dialogs; Format panels with the template editor,
    every field's format and a picker of the results' values; "Show on graph" checkboxes in the
    analysis dialog. Optional fields and union members only, no schema bump (DATA_MODEL §5.1,
    §5.3, §6.1, §6.1a, §6.1j (new), §6.2a (regenerated), §6.4, §10). `ANALYSES_VERSION` 1.3.1 →
    1.3.2: fits per group gain their level (no number changes). Tests: templates, fields, number
    and P formats, references and their misses, input modifiers (model); analyses of values at
    one X and of pooled data sets, removal with undo and remapping of result layers and tables
    (engine); the number at risk against R; every ready result of 13 analyses resolved against
    their real results (20 cases); labels live and placed (corners, data positions, per data set,
    legend), lines, bands, drop lines, both new brackets, the number at risk (alignment, ticks,
    times), inset tables, fits per group and the matrix (graph); the analysis dialog's results on
    graphs live after an edit with undo and redo, brackets with their analyses, the value picker
    (ui): 70 new unit tests; the z-order test generated from the matrix now 3,732 cases (1,358 of
    the result stat); ten new goldens (`result-correlation-label`, `result-regression-equation`,
    `result-ic50-drop-lines`, `result-fits-per-group`, `result-refline-band`,
    `result-xy-bracket`, `result-group-bracket`, `result-risk-table`, `result-inset-table`,
    `result-legend-label`); Playwright in Chromium, WebKit and Firefox (`resultsOnGraphs.spec.ts`:
    r and P from the analysis dialog, edited and following a data edit; EC50 with drop lines; the
    number at risk with undo; a bracket at one X; a bracket from a group to one; an inset table).
    Every earlier golden byte-identical; example fingerprints unchanged.

36. ✅ **Axis extras** — design [GRAPH_LAYERS.md](design/GRAPH_LAYERS.md) item 36: what an axis
    carries besides its ticks (decisions 510–521; DATA_MODEL §6.1k). **+/− treatment grids**
    (decisions 510, 511, 518): rows of treatments under a category axis ("TNF", "CHX",
    "Z-VAD-FMK"), a cell per category ('+', '−', blank or short text, drawn as + / −, ● / ○ or ✓),
    row titles before (or after) the categories, lines between rows, the names hidden or kept
    above; on category and grouped frames (a cell per group or per bar), vertical or turned,
    part of the axis' depth (the graph grows, exports and pages include it). Cells name their
    categories by key (`CategoryKey`: a data set or level, a grouped table's row `@<row>`, a bar
    `<group>/<series>`), so they follow reordering, slices and new categories; `graphRefs` walks
    them. Edited in a grid editor (Insert › Treatment grid (+/−)…, Format axes › X axis) seeded
    from names that read as combinations ("TNF+CHX", "TNF + zVAD", "WT TNF", "−/+", any minus) or
    from a table's other text variables (yes/no as +/−). **Two-level category labels** (decision
    512): a grouped graph's groups spanning their bars, each bar named by its data set (or a
    graph of variables' colour level), renamed by key; spans typed by hand over any categories on
    up to three levels; a line, a bracket or nothing over each (Insert › Two-level category
    labels). **Broken axes** (decision 513): pieces of set lengths (a fraction of the axis or
    points; the rest in proportion), several breaks per axis, marks '//' (as before), a zigzag or a
    plain gap with their size; X and Y of XY graphs, the value axis of category and grouped
    graphs either way round; graphs without lengths byte-identical. **Custom ticks** (decision
    514): ticks at listed values (minor ones too) and text at values ("Monomer" at 1 … "Pentamer"
    at 5, rich text), on linear, log, arcsinh and logicle axes. **Lines and bands at typed
    values** (decision 515): roadmap 35's reference-line and band layers with a `values` source
    (`{ from: 'number' }` fields), a label at the line's start or end, styles, an optional legend
    entry, drawn in the list's order (Insert › Line at a value…, Shaded band between values…).
    **Scale bars** (decision 516): a bar of a set length in data units on X and / or Y, labelled
    (the length and the axis title's unit), in a corner (two meeting in an L) or from a data
    position; with the axis hidden it stands in for it. **Corner arrows** (decision 517): the
    axis style "Corner arrows (UMAP style)" (Format axes › Frame & origin): short arrows from a
    corner with the axis titles beside them, no ticks or frame, their length a fraction of the
    plot or points; the single-cell examples' UMAPs use them, and new graphs of an embedding's
    two axes (UMAP_1 by UMAP_2) from the builder. Optional fields and union members only, no
    schema bump. Tests: name parsing (24 spellings), seeding from names and variables, categories
    by key, grids aligned under every frame and orientation, keys through reordering, slices and
    new categories, spans from the data and typed, piece lengths, break marks, listed and text
    ticks (log, arcsinh, logicle), scale bars in data units on linear and log axes, corner
    arrows, typed lines and bands (graph: 48; model: graphRefs walks and maps the category keys);
    the z-order of typed lines and bands with every layer of the category, grouped and XY frames
    (both orientations); fourteen new goldens (`axis-treatment-grid`, `-horizontal`, `-seeded`,
    `axis-spans-grouped`, `axis-spans-variables`, `axis-break-lengths-slash`, `-zigzag`, `-gap`,
    `axis-two-breaks-horizontal`, `axis-text-ticks`, `axis-tick-list-log`,
    `axis-manual-line-band`, `axis-scale-bar`, `axis-corner-arrows-umap`); Playwright in Chromium,
    WebKit and Firefox (`axisExtras.spec.ts`: a grid seeded from names then edited, two-level
    labels, a break with a set length, text ticks, a typed band and line, a scale bar, corner
    arrows, each with undo). Every earlier golden and v1 fixture byte-identical;
    `ANALYSES_VERSION` unchanged; the example fingerprints of `single-cell` and `tcells-local`
    change (their UMAPs' `style.frame` 'arrows', nothing else).

37. ✅ **Preferences and styles** — design [GRAPH_LAYERS.md](design/GRAPH_LAYERS.md) item 37 and
    Q3 (decisions 530–539; DATA_MODEL §2, §6.2b, §9.5). **Styles** (decision 530): a named,
    partial set of graph defaults as plain data (`FigureStyle`, `@ps/model`): fonts and sizes per
    role (graph titles, axis titles, tick labels, legends, text on graphs, bracket labels, result
    and point labels), line widths per role (axes, ticks, error bars, data lines and curves, bar
    and box outlines, brackets), symbol size, bar fill opacity, the categorical palette and the
    default colour map, axis look (touching or offset, tick marks), P values, new graphs' legend
    place and figure widths. A project's style is `ProjectSettings.theme` (its id, as before) and
    `style` (its values copied in; absent: the app's own look, so old files read identically); a
    graph may have its own (`GraphNode.theme`). Resolved into the theme layouts read
    (`graphTheme(project, graph)`: `themeOf(effectiveStyle(...))`, the empty style being
    `DEFAULT_THEME` itself). **Precedence, keeping the user's edits** (decision 531): what a graph
    sets itself > its style > the project's > the app's; "set by the user" is an explicit value in
    the document, Format dialogs write only what changed (axis and bracket lines field by field);
    continuous axes' frame and the legend's place, which every graph holds, follow a style change
    while still at the old style's value, and new graphs take the project's. **Built-in styles**
    (decision 532): Default, unchanged, and "Journal: Nature-style (7 pt, 89/183 mm)", Cell-style
    (85/174 mm), Science-style (55/120/183 mm) and PNAS-style (87/178 mm): sans text of 6–8 pt,
    0.5 pt lines, 3.5 pt symbols, the journals' column widths as remembered, each described as
    approximate and not endorsed. **User styles** (decision 537): Format › Save this graph's look
    as a style… (its resolved fonts, lines, symbols, palette, axis look, the project's P values;
    decision 534), the Styles dialog (built-in and own styles; the Style editor; rename, delete,
    duplicate a built-in, export and import `.psstyle` files; apply to this graph, the graphs
    selected on a page, a page's graphs, the whole project or the project's style only), kept as
    presets are (desktop `styles/`, web IndexedDB version 3, memory fallback). **Reset to style**
    (decision 533): per graph, a page's graphs or every graph, with a confirm and undo, clears the
    user's fonts, line widths, tick marks, palettes, symbol sizes and bar fills. **Fit to column**
    (decision 535): a graph or a layout page made a style's single, 1.5 or double column wide at
    scale 1 (`size.scale` dropped, so text is at the style's point sizes), the plot keeping its
    proportions or its height; pages in proportion. **Preferences** (decision 538): Edit ›
    Preferences… (macOS: the application menu's Settings…, ⌘,): new projects' style, P values and
    confidence level (the starting blank project too; open projects keep theirs), the unit of
    sizes (in, mm, pt), new pages' size, the Export dialog's format and resolution; stored per
    user (web IndexedDB, desktop `settings/preferences.json`). **Retiring `look`** (decision 536,
    GRAPH_LAYERS Q3): the per-chart-type theme table became per-geom defaults under context rules
    (`CONTEXT_RULES`), a style's values over every context; `look` stays in documents as the
    context's name, read only by `markDefaults` (the donut's hole now a context default, no
    branch). Optional fields only, no schema bump; `ANALYSES_VERSION` unchanged. Tests: the
    context rules reproduce the frozen v1 table exactly, and every preset on every table kind
    draws the same SVG in each of the 15 contexts under the default style and under the v1 table
    (graph: 144 cases); journal styles as themes, palettes, colour maps, precedence at each
    level, edits kept through a change of style, Reset to style, axis frames and legend places
    following, a graph's look saved as a style drawing the same, Fit to column for graphs and
    pages (graph); the schema, merging, `.psstyle` files, preferences for new projects (model:
    10); project styles set and cleared with undo, `fresh` graphs (engine: 3); the style library
    and its memory fallback, preferences, applying and resetting with undo, sparse line edits,
    Fit to column, the Settings… item (ui: 11). Eight new goldens (`style-nature-bars-points`,
    `style-cell-bars-points`, `style-science-bars-points`, `style-pnas-bars-points`,
    `style-nature-xy-fit`, `style-edits-kept`, `style-reset`, `page-fit-to-column`); Playwright in
    Chromium, WebKit and Firefox (`styles.spec.ts`: a journal style for the project, a graph's own
    font kept through another style, Reset to style and undo; a graph's look saved as a style,
    applied elsewhere, exported, deleted and imported; Preferences giving new projects a style; a
    page fitted to a column with undo). Every earlier golden and v1 fixture byte-identical; the
    example fingerprints unchanged.

38. ✅ **Data manipulation** — decisions 550–561 (DATA_MODEL §3.5, §5.2, §8.1, §10). **Swap X
    and Y** (decision 553): Analyze › Data manipulation › Swap X and Y… on XY tables
    (`table.swapXY`: a data set becomes X and X a data set in its place; tables with replicates,
    summary data or X errors refused with the reason; graphs and analyses of the data set follow
    through `mapGraphRefs`; one undo step) and Format › Swap X and Y on graphs of variables
    (mapping or the layers' `aes`, axes' formats and shared axes; a number by a text variable
    turns). **Transforms for every table kind** (decisions 551, 559): multiple-variables tables'
    Transform variables… writes calculated variables (log of any base, √, 1/x, z-score, 0–1 or %
    of the range, rank, logit, arcsinh with a cofactor, minus or divided by the mean or median),
    the statistics optionally within each group of a text variable (`zscore(x, g)`,
    `x - medianby(x, g)`); contingency and parts-of-whole tables get row, column and total
    percentages (`percentages`, a table of the same kind); survival tables Convert time units
    (`survivalTime`: days, weeks, months, years); Transform accepts parts of whole. **Formula
    functions** (decisions 552, 554, 555, 560): 46 more (74 in all) — statistics over a column
    or within groups (`median sd var quantile` (R's types 1–9) `rank` (average, min, max,
    first) `zscore`, `meanby medianby sumby countby sdby minby maxby`), text (`concat upper lower
    left right mid len trim replace contains startswith endswith text value`), logic (`ifs case
    iferror coalesce isnumber istext`), maths (`mod round clamp log(x, base) logit expit asinh`),
    running values (`cumsum lag lead diff`) and categories (`recode cut cutwidth
    cutquantile`); infix `and`, `or`, `not`; a formula may give text (a calculated text
    variable, a text variable to graphs, levels, splits and analyses: `resolvedTable`). Column
    statistics are computed once per evaluation (O(n log n)); the formula bar suggests functions
    and variables as you type (Tab, or arrows and Enter) and its ƒx button lists every function
    by kind. **Filter rows** (decision 557): a table of the rows meeting a condition, built in
    the Analyze dialog's condition editor (variable, operator, value; AND within a group, OR
    between groups) or typed as a formula; multiple-variables tables and every kind with rows
    (XY by X or Y, column and grouped by row titles or values, with `X`, `Row_title`, `Row`).
    **Aggregate by group** (decision 558): one row per combination of text variables — mean,
    median, SD, SEM, n, min, max, sum, % above a threshold, % non-zero of each number variable,
    from `@ps/stats` — a multiple-variables table ready to graph. **Live derived tables with
    Freeze** (decisions 550, 556): Filter rows and Aggregate are analyses producing tables
    (decision 67): they follow their source live, are read-only, graph like any table (cells
    mode, splits, results on graphs) and go with their source; "Freeze as data table" (results
    view) adds an editable copy in one undo step; saving keeps the derivation, and result tables
    of more than 100,000 cells aren't cached in the file. **Recode and bin** (decision 551):
    Recode levels… (rename or merge a text variable's levels, others kept or blank) and Bin a
    variable… (cut points, equal widths or quantiles; right- or left-closed; automatic "(a, b]"
    or custom labels, as R's `cut`) add calculated text variables, live with their sources,
    usable as groups, colours and splits. No schema change (optional union members and
    commands only); `ANALYSES_VERSION` unchanged (existing results unchanged). R oracle suites
    `formula` (16 cases: `quantile(type = 1…9)`, `rank(ties.method =)`, `ave()` by group, `cut()`)
    and `aggregate` (3 cases: `tapply`), rtol 1e-10. Tests: formula functions, the R oracle and
    growth guards at 100k vs 1M rows (model: 36); Filter rows, Aggregate (R), percentages, time
    units, degenerate inputs and growth guards (analyses: 22, and 39 more registry-wide
    degenerate cases for the new plugins and kinds); Swap X and Y and text formulas
    converted (engine: 3); big result tables left out of saved files (io: 1); the dialogs'
    formulas, the condition editor, suggestions, swapping graphs of variables, Freeze (ui: 9);
    Playwright in Chromium, WebKit and Firefox (`dataManipulation.spec.ts`: Swap X and Y with
    undo; a transform within groups; formula functions with suggestions and the reference; a
    filter built in the condition editor following an edit of its source; an aggregate by
    group graphed and frozen; recoded and binned variables as colours). Every golden and v1
    fixture byte-identical; the example fingerprints unchanged.

39. ✅ **Import and interop** — decisions 570–581 (DATA_MODEL §3.3a, §8.1, §9.1, §9.5; design
    [PZFX_GRAPHS.md](design/PZFX_GRAPHS.md)). **Graphs in .pzfx files** (decisions 570–573): a
    time-boxed reading of a .pzfx file's binary section (`<Template>`: base64 of zlib data,
    `PCFFGRA4` then tagged records, `io/src/import/pcff.ts`) found the record structure (u16 tag,
    u32 length; bit 15 opens a container, bit 14 closes it) and, per graph, its name, its data sets
    (by column ids unique across the file: table and column) in the file's order, the graph and axis
    titles with their hidden flag, the axis ranges, whether X is numeric, and each data set's colour
    and symbol (circle, square, triangle). Each decoded graph becomes its table's default graph with
    those set (`graphsFromPzfx`, validated); the kind of marks, error bars, log scales, fonts and
    sizes aren't decoded and stay the defaults, listed per graph in a report after the import.
    Graphs of analyses' results or of several tables are not imported (reported); a section that
    can't be read gives every table its default graph. .pzfx files get an import dialog: the tables
    and graphs found, "Import graphs" (ticked when one decoded; unticked, the import is as before).
    On the user's two .pzfx files (version 9.2): 9 graphs of 9 tables (7 XY, 2 grouped), all 9
    decoded (data sets, titles, Y ranges, colours; symbols on the 7 drawn with points), 2 layouts
    not imported. **Missing codes and detection limits** (decisions 574–578): the import dialog's
    own missing-value codes ("-999, ND, not done") besides NA…, starting from Preferences' list, and
    values at detection limits ("<0.5", "< 0.5 ng/mL", "≤0.5", ">ULOQ", "<LLOQ", "ULOQ+", "BLQ",
    "below LOD"…) substituted below by LOD/2 (default), LOD, LOD/√2, blank or a fixed value and
    above by the limit, blank or a fixed value, with limits typed per column or for all for cells
    that name none. Both apply to the sheet before any reader (`prepareSheet`: limit cells as unique
    stand-in numbers, so layouts are detected with them as numbers), the table finished after
    (`finishCellRules`). Substituted cells are flagged in the document (`CellColumn.limit`: side and
    original text; the rule `DataTable.limits`), marked in the grid, substituted again from their
    text by Edit › Limits… (`table.setLimits`, one undo step; "Remove flags"), drawn as open symbols
    on the graphs made at import (single-point formats, `graph/src/limitPoints.ts`; Limits… turns
    them on or off for the table's graphs); analyses use the substituted values and their results
    say so. **Dropping files** (decisions 579–580): projects open (asking about unsaved changes),
    CSV/TSV/TXT/XLSX/ZIP open the import dialog (the large-CSV dialog and the 5,000-row prompt as
    from the menu), .pzfx the .pzfx import dialog, images land on a layout page where dropped or,
    elsewhere, go on a page of your choice or are ignored, .pspreset and .psstyle go into the
    library; several files one after another (each dialog waited for), then a summary; an overlay
    says what will happen. Web and desktop alike (the webview's HTML5 drop events). Optional fields
    and a command only, no schema bump; `ANALYSES_VERSION` unchanged (results of existing documents
    unchanged). Tests: the record reader and decoder on synthetic records and the real .pzfx
    fixtures, graph mapping, pairing, fallbacks, unchanged table import (io: 14); missing codes,
    limits in sheets and CSV, layout detection, title-keyed limits, project-file round trips small
    and large, a growth guard (io: 11); limit text in many spellings (unicode ≤ ≥, spaces, units,
    decimal commas and thousands), substitution, re-substitution and schema (model: 69);
    `table.setLimits` with undo, flags through edits, inserts, deletes and sorts (engine: 4); open
    symbols at limits (graph: 3); drop routing, the dialog's rules, the .pzfx report's text (ui:
    25). One new golden (`limit-open-symbols`); Playwright in Chromium, WebKit and Firefox
    (`importInterop.spec.ts`: a CSV, an XLSX and a project dropped, several files with a summary;
    images on a page and from a graph; custom missing codes and "<LOD" cells at LOD/2, marked,
    changed with undo, noted on results; a .pzfx with Import graphs and its report;
    `import.spec.ts`'s pzfx test through the new dialog). Every other golden and v1 fixture
    byte-identical; the example fingerprints unchanged.

40. ✅ **Project organisation** — decisions 590–604 (DATA_MODEL §2, §3.5, §7, §8.1, §9, §11).
    **Reordering** (decision 600): sheets are dragged within their section (pointer events, so
    Chromium, WebKit and Firefox alike, and never an HTML5 drag the file-drop overlay of 39 would
    see; a line marks where the sheet lands, Escape cancels), moved with Edit › Move sheet up /
    down (and the sheet's menu) or Alt+↑/↓ on the focused sheet; each one undo step, kept in
    `Project.order` (`moveSheetCommands`, `stepSheetCommands`). **Folders** (decisions 590–592):
    the user's own, optional project data (`Project.folders`: id, name, parent, members), one
    level of nesting; Insert › New folder (or the navigator's +), rename inline, fold (per user
    and per view, not in the document), "Move to folder…" (Edit menu and the sheet's menu),
    dragged in and out, deleted keeping the sheets (a subfolder's go to its parent), every step
    undoable; removing, duplicating, making from a table and importing keep folders valid. In the
    by-kind view a folder shows in each section holding sheets of that kind; in the Family view
    it holds whole families. **Family view** (decision 593): a toggle (the navigator's
    "By kind | Families", View › Show families in the navigator) to a tree derived from the
    references nodes make (`familyTree`): info sheets, each data table with its analyses (chains
    through result tables and derived tables of 38), their results and the graphs of the table
    and of the results (split sets grouped as their set), then layouts listing the graphs they
    place; ←/→ fold a branch. **Info sheets** (decisions 594–597): an Info section, an editor of
    label/value fields with rich-text notes, Insert › Info sheet ▸ Blank / Experiment / Assay /
    Animal study, data export (CSV, TSV, Excel; also in All data and results); fields as named
    constants in formulas, `[Info: dilution]` (the first info sheet with that field) or
    `[Sheet name: dilution]`, numbers only, live (bound to tables when read, never stored),
    renames of fields and sheets followed in formulas, a missing one the formula's error; the
    formula bar's reference lists them. **Search** (decisions 598–599): a search box at the top
    of the navigator and ⌘F (Ctrl+F) where focus isn't in a table (a table keeps its find bar):
    sheet names, notes, info fields, column and variable titles, graph and axis titles, text on
    pages and analysis names, never cell values, so instant at any size (a CPU-growth guard at
    100k vs 1M rows); results grouped by sheet with the matched snippet, ↑/↓ and Enter in the box,
    a click, jumping to the sheet and the column or info field. **Thumbnails** (decision 603): a
    toggle (▦, View › Thumbnails in the navigator) adds small pictures to graphs and layouts;
    View › Gallery shows every graph and page in a grid — a click opens one; ticked graphs get
    "Apply style…" (37's Styles dialog, "The graphs chosen in the Gallery") or "Add to page" (a
    new page or below what an existing one holds), one step each. Thumbnails are drawn in idle
    time one at a time (screen-sampled points for large tables, 34e), cached per node and version
    in memory, redrawn when anything they read changes, never saved. **Merging projects**
    (decisions 601–602): File › Import from project… lists the other project's sheets by family
    with checkboxes ("Tables bring their families", on); pages bring their graphs and anything
    brought brings what it reads; new ids with every reference remapped (`remapNode` →
    `mapGraphRefs`), names taken by a sheet of the same kind given " (2)", the other project's
    style kept as graphs' own where it differs, images, info sheets and folders along; one undo
    step. A project dropped on an open one asks "Open" or "Import into this project…" (Alt or
    Shift held: import); on an empty one it opens. Optional fields and commands only, no schema
    bump; `ANALYSES_VERSION` unchanged (tables without info constants read as before). Tests:
    info constants (first sheet, named sheet, decimal comma, live, errors, a variable's title
    winning, renames), folders' integrity and walker, unique names (model: 9);
    reordering with undo, folders (make, file, nest one level, rename, delete keeping sheets,
    undo; sheets deleted, made from a filed table, duplicated, families duplicated), the Family
    view of a deep family with an info sheet, a derived table and a split set, info renames and
    notes, search matching, ranking, snippets and a growth guard, merging (selection closures,
    remapped references, links, names, styles, assets, folders, results equal to the originals',
    one undo step) (engine: 14); the navigator's by-kind and family items with folders
    and folding, thumbnail versions and the background cache, thumbnails drawn, info export,
    folders through a saved file, the drop hint (ui: 9). Playwright in Chromium, WebKit
    and Firefox (`projectOrganisation.spec.ts`: reorder by drag and Alt+↑/↓ with undo; folders;
    the Family view; an info sheet and a formula using its field, live and renamed; search
    jumping to a column; thumbnails and the Gallery with Apply style and Add to page; Import from
    project with a family, names made unique, undo, and a project dropped with Alt;
    `importInterop.spec.ts`'s dropped project now asked about). Every golden and v1 fixture
    byte-identical; the example fingerprints unchanged.

41. ✅ **Polish and desktop distribution** — decisions 610–626 (DATA_MODEL §9.5;
    [RELEASING.md](RELEASING.md)). **Installers** (decisions 610–611): `.github/workflows/release.yml`
    builds, for each version tag `v*` (refused unless it is `v` + `APP_VERSION`), a universal macOS
    `.dmg` (Apple Silicon and Intel) and Windows `.msi` and `.exe` (NSIS) with tauri-action, attaches
    them to a draft GitHub Release whose notes quote the version's row of the table above, and
    publishes it when both builds pass; run by hand it is a dry run keeping the installers as
    artifacts. Unsigned for now: each signing step (Developer ID, notarization, a Windows
    certificate) runs only when its secrets exist. **Updates** (decisions 612, 615): Tauri's updater
    plugin reads the latest release's `latest.json`, in builds made with the update key only
    (`tools/release-config.mjs` merges `plugins.updater` and `createUpdaterArtifacts` in when the
    public key and the private key's secret exist; the shell starts the plugin only with a public
    key, `updates_supported`); at start, at most once a day, "Version X is available" with the notes:
    Update now (download, install, restart), Later, Skip this version; Preferences › Updates (check
    automatically, Check now; "Updates aren't set up for this build"); none on the web. **File
    associations** (decisions 613–614, 616): `.psproj`, `.pspreset`, `.psstyle` owned; `.pzfx`,
    `.csv`, `.tsv`, `.xlsx` in Open With only (macOS rank Alternate; Windows `OpenWithProgids` from
    NSIS hooks, never their default); files opened at launch or while running (macOS
    `RunEvent::Opened`; Windows arguments and the single-instance plugin) wait in the shell
    (`take_opened_files`, the `opened-files` event) and go through 39's drop queue, except that a
    project opens (asking about unsaved changes) and a launch with files doesn't reopen the last
    project; recent files stay in File › Open Recent (no Dock menu or jump list in Tauri v2).
    **Dark mode** (decisions 617–619): the app's chrome on colour tokens (`styles.css`, redefined
    under `:root[data-theme="dark"]`), following the system or Preferences › Colours (System,
    Light, Dark; `AppPreferences.colorScheme`, the last choice kept for the first paint), the
    desktop window's title bar too; graphs, pages, Format previews, thumbnails, plot-style icons and
    the editors of text that goes on graphs stay on white paper, with a shadow on the dark canvas;
    every text token meets WCAG AA on its backgrounds in both themes (the light accent and muted
    grey darkened slightly for it). **Accessibility** (decision 620): axe (WCAG 2.1 A/AA) clean on
    the start screen, table grid, graph view, layout page, Format and Analyze dialogs, Preferences
    and the import dialog in both themes — the grid's table presentational with explicit grid
    roles, no controls inside the layer list's options or the navigator's rows (their eye and ×
    are pointer shortcuts for Space and Delete), the graph canvas a named group with its keys
    described, visible focus on everything focusable; a keyboard-only path (import a CSV, a graph,
    an analysis, export). **Polish** (decisions 621–625): grey points of missing colour values get
    a "Missing" legend entry; histograms of values all ≥ 0 start their bins at 0 (no axis left of
    zero); a graph split by the variable that colours it keeps each level's colour; long text in
    treatment grids is cut with an ellipsis to its category (the editor's long level names with
    tooltips); typed line and band labels move along their line or to its other side off the data,
    and result labels keep off them; + Calculated variable focuses the formula box in the same
    commit (the name typed meanwhile was lost: the `tables.spec` flake); the find growth guard
    times only the search, fastest of five runs. Optional preferences fields only, no schema bump;
    `ANALYSES_VERSION` unchanged. Tests: preferences fields (model: 1); a split set’s pinned
    colours with a new level (engine: 1); the Missing entry, histograms from 0, split colours,
    fitted grid text, line labels off data (graph: 8); release configuration, bundle and workflow
    files, opened-file routing, updates with a fake updater, colours, contrast of every token in
    both themes (ui: 58); Rust: accepted kinds, paths from arguments, the waiting list (desktop:
    3, in CI). Playwright `accessibility.spec.ts` and `darkMode.spec.ts` in Chromium, WebKit and
    Firefox. Goldens changed: the Missing entry (`aes-xy-colour-by-text`,
    `aes-xy-colour-by-number-bar`, `aes-category-colour-by-number-bar`, `overlay-ellipse-norm`,
    `-mean`, `-t`, `-filled-behind`, `overlay-hull`, `overlay-path-arrows`), bins from 0
    (`mv-histogram`, `-overlaid`, `-stacked`), level colours (page golden `page-split-set`);
    every other golden and v1 fixture byte-identical; the example fingerprints unchanged.

42. ✅ **Audit follow-ups** — decisions 810–824. **PCA's default variables** (decision 810): an
    analysis can ask for number variables only by default (`AnalysisDef.numbersByDefault`, set on
    PCA and the multiple-variables curve fit; `ui/src/analysis/defaultSelection.ts`): on a
    multiple-variables table whose text variables come first (the single-cell "T cells"), PCA no
    longer starts with them ticked and every row dropped; text variables stay tickable (a grouped
    PCA ticks its group first), and the regressions, multifactor ANOVA, survival, Filter rows and
    Aggregate keep the old default, using text as factors. **Split sets** (decision 811, amends
    761): a member graph deleted in the same batch as an edit of the set's table no longer comes
    back; a graph is added only for a slice new to the table that no set graph shows after the
    change. **Exports off the main thread** (decisions 815–819): figure exports (SVG, PDF and the
    tiles of PNG/TIFF/JPEG), Copy graph, Copy as SVG code and prints of sampled views are laid out
    with every point and written in an export worker (`ui/src/worker/figure*`), started at the
    first export or Export dialog, never at start-up or while the page is being left, closed after
    two minutes unused; the document goes over by changes only (per-row arrays once, numbers as
    transferred `Float64Array`s); one export at a time with a status bar; the clipboard is written
    in the click with promised items; output byte-identical to the main-thread path (checked over
    every synthetic example's graphs and pages), which stays as the fallback. A 1M-row SVG export
    stalls the window 21–102 ms instead of 1.3 s, a page of two 1M graphs 51 ms instead of 2.3–3 s,
    Export…'s measuring 19 ms instead of 10 s; drawing raster pixels stays on the main thread (a
    worker can't draw SVG). Copy as SVG code on a page now copies every point, as Copy does.
    **Progress of long analyses** (decisions 820–824, amends 791): an analysis's `run` takes an
    optional `progress(done, total)`, throttled to ten reports a second and kept on the engine's
    side channel (no re-render, cache untouched; late reports of finished, cancelled or replaced
    jobs ignored); the results view shows a filling bar, the percentage and the time left. PCA's
    parallel analysis, Monte Carlo simulations and nonlinear fits (and their multiple-variables
    form) report; the rest keep the indeterminate bar. No result changed: `ANALYSES_VERSION`, the
    analyses fingerprint (now run with a listener), every R and NIST oracle unchanged. Tests:
    defaults per analysis, split sets in a batch, the export worker's bytes, column syncing,
    lifecycle and fallbacks, the throttle, the runner and engine progress plumbing, JobStatus
    (happy-dom); Playwright `analyses.spec.ts` (text variables start unticked; the bar advances),
    `groupOverlays.spec.ts`, `figureExport.spec.ts` (the worker starts at the first export and is
    reused) in Chromium, WebKit and Firefox. Every golden and v1 fixture byte-identical; the
    example fingerprints unchanged. Found and left: the nested t test and nested ANOVA slow down
    faster than linearly with replicates per subject (minutes at 1,000).

43. ✅ **Labelled toolbar and first session** — the first of the UI/UX series planned from two
    reviews of 0.2.1 (a new user's first session; selection and editing mechanics); decisions
    830–844. **Toolbar** (830–834): each main command an icon above a label (New table, Import,
    Open, Save, Undo, Redo, Analyze, New graph, Function, Layout; Copy, Export and Format on graphs
    and pages), 40 px wide or more in a 52 px bar, one row at 1024 px; View › Toolbar ▸ Icons only
    keeps the compact bar (remembered). Tooltips drawn by the app (350 ms, at once on keyboard
    focus) show the name, the shortcut and why a button is disabled; native `title` gone from the
    toolbar, the layout tool strip and the navigator's header buttons. Split buttons: New graph ▾
    (recent presets), Analyze ▾ (recent analyses), Export ▾ (SVG, PDF, PNG, TIFF; tables and
    results their own formats). One Format button named by the selection ("Format title…",
    "Format Y axis…", ⇧⌘E). The graph and layout view toolbars have a fixed height (no jump when
    the selection changes) and the selection hint sits next to Add ▾. **First session** (835–839):
    Import data… (CSV, Excel, .pzfx) on the start screen and the toolbar, with "or drop a file
    anywhere"; the New table dialog in two columns with everything in view at 1024×768, "Start with
    sample data" ticked while the project has no tables; a notice when a table's graph is made; a
    second graph of a table is "Another graph of …", named "Data 1 (2)" (a table's first graph made
    by hand is now named after it); an empty graph says "No values yet" with Go to table; the
    navigator shows a section once it has something (Data tables always), "Info" renamed "Info
    sheets". **Notices and Analyze** (840–844): a 3 s "… · Undo" notice after a Format dialog's OK
    or a drag on a graph or page (the same thing dragged again replaces it; Undo only while that
    step is the last); the Analyze dialog has a search field (type, ↑/↓, Enter) and a Common group
    per table kind; results errors link to their table and say what the analysis needs; input
    checks disappear after 8 s while failures stay. UI only: every golden and v1 fixture
    byte-identical, the example fingerprints and `ANALYSES_VERSION` unchanged; the CI screenshot
    checks re-baselined for the new toolbar. Tests: tooltips, toolbar modes, split menus, sample
    defaults, graph naming, empty-graph detection, navigator sections, undo notices, Analyze search
    (happy-dom and unit); Playwright `toolbar.spec.ts` (new) and steps in shell, accessibility,
    tables, graphs, import, projectOrganisation, analyses, format and canvas specs in Chromium,
    WebKit and Firefox.

44. ✅ **One selection model** — decisions 850–874 (UI/UX review O2–O5, O10, O13, O18–O20, F9,
    F10, F16). One `Selection` (keys in click order, a primary, the drill; key kinds `element`,
    `item`, `pageElement`; `ui/src/selection/`) for the graph canvas and layout pages, every
    existing single-target path fed by the primary. **On a graph**: Shift/⌘/Ctrl-click toggles
    (on a point of another data set it adds that data set), Alt+Shift a whole layer; ⌘A selects
    every element in reading order; halos for every key; dragging, arrow nudges and Reset position
    act on every selected movable element as one undo step ("Move 3 elements"); Delete removes
    annotations and hides data sets in their layer ("Hide 2 data sets"); a right-click on a
    multi-selection shows what applies to all, with counts; Tab / Shift-Tab step through
    elements, Enter goes in (data set → point, axis → tick labels), Escape / Shift+Enter come out,
    a live region reads the selection; a click within 4 px of a thin line hits it (`hitTest`
    fallback); a double-click on a point formats its data set; hover cards wait 300 ms and hide
    while selecting. **Drag to select**: a box from empty space or a background picks an element
    when one of its marks lies wholly inside (one bar → its data set; tick labels → their group);
    Alt, or a selected data set, picks points; Shift/⌘ adds; a live preview halo and count; the
    page's box keeps its touch rule through the same `pickInBox`. **On pages**: a click on a
    graph you are working in selects its part (title, axis, data set), halo drawn through the
    item's transform; Shift-click adds parts of other graphs (B's and C's Y titles together);
    Escape steps out to the graph item; Enter / ⇧⌘E formats the part on its own graph; a drag
    still moves the part, several selected parts across graphs together; several items show the
    fields they share (size on page, text style, border, fill; mixed values blank) and align moved
    to the view toolbar's Align ▾. UI only: every golden, page golden and v1 fixture
    byte-identical, the example fingerprints and `ANALYSES_VERSION` unchanged. Tests: the model,
    click and marquee rules, page parts, key resolution after undo (unit); Playwright
    `selection.spec.ts` (new) and steps in layoutObjects, canvas, format, largeTables and
    cellsTables specs in Chromium, WebKit and Firefox.

45. ✅ **Format bar and format painter** — decisions 880–894 (UI/UX review F1–F5, O1, O4, O12,
    O14, O21). **The format bar** (`ui/src/formatBar/`): a fixed 33 px strip under the graph and
    layout view toolbars acting on the selection: its name with ▾ to pick any element (or the
    page's items and the parts of the graph you are working in); Text (family, size, A↑ A↓, B, I,
    colour), Fill, Line (colour, width, dash), Symbols (shape, size), Reset position, the
    paintbrush and Format…; groups by what every selected thing has, the rest greyed in place;
    values that differ blank ("—", striped swatch, B/I mixed); with nothing selected it sets the
    graph's base text. Every change one undo step labelled with the count ("Font size 10 pt (3
    elements)"), quick repeats on the same thing merged (`DocumentStore.dispatch(…, { coalesce })`,
    1.5 s). Setting a title's size or font sets the whole title (that field cleared from its rich
    text runs); the in-place editor's toolbar docks in the bar while editing, and with the whole
    text selected it sets the element's style too (a selected word still gets runs). ⌘B, ⌘I,
    ⌘⇧> and ⌘⇧< act on the selection. **Format painter**: Copy format (⌥⌘C) and Paste format
    (⌥⌘V) between texts, data sets and lines, across graphs and pages; onto data sets everything
    but colour unless "Paste format with colour"; the paintbrush applies once, or until Escape
    when double-clicked. **Select ▸ Same kind** (Edit menu, palette, right-click): every title,
    tick-label group, data set of a layer or of every layer, bracket, text box…, across the graphs
    you are working in or every graph on a page, or every page item of a type. Right-click menus
    list the selection commands with counts. Canvas and page drags redraw at most once a frame
    (a 120-move drag laid out 30 times instead of 120; the committed edit unchanged). UI only:
    every golden and v1 fixture byte-identical, the example fingerprints and `ANALYSES_VERSION`
    unchanged. Tests: the selection-to-path map per element kind, mixed values, merged undo
    steps (engine), runs cleared, painter compatibility, drag frames, Same kind (unit);
    Playwright `formatBar.spec.ts` (new), steps in selection, toolbar, accessibility and
    layoutObjects specs in Chromium, WebKit and Firefox.

46. ✅ **A simpler Format view** — decisions 900–929 (UI/UX review V1–V9, F12–F15, O6–O8, P3;
    reverses decision 56). **A docked Format panel** (`graph/format/FormatPanel.tsx`) on the right
    of the graph view follows the selection: Format… (format bar, toolbar, menus), Enter,
    double-click and ⇧⌘E open it at the element, ⌘1 shows or hides it; it writes straight to the
    document, one undo step per change with quick repeats on a field merged, and Revert undoes
    the panel's steps since the element was selected; keys typed in it stay in it; 340 px,
    resizable and remembered; under 1200 px a drawer over the canvas; on pages it takes the
    inspector's slot while a graph is worked in. The modal dialog stays as "Open in window"
    (draft, preview, OK / Cancel unchanged). **Organised by element** (910–919): every place —
    the graph, the title, each axis, the legend, a data set, a layer, a point, annotations —
    opens on Common (axis: range and scale, interval and ticks, title and tick-label fonts; data
    set: colour, line and error bars; graph: text, frame, background; title and legend: text and
    font), the rest in collapsible sections remembered per kind; "Titles & fonts" gone (fonts with
    their element); a data set never opens on the layer stack (layers and drawing order under the
    graph and Advanced); plain names ("Show points for this data set", "Drawing order", "Copy this
    format to…"). A completeness test (`ui/test/formatCompleteness.test.ts`) checks every one of
    the 9,793 fields of the old dialogs over 46 graphs is still present and writes the same
    paths. **Colour and search** (920–929): every colour field a swatch button opening a palette
    popover (Automatic, the palette, greys, recent, custom; the format bar's menus the same);
    a search over every setting of the graph ("thousands" → Y axis › Numbers › Thousands
    separators) that selects the element, opens the section and focuses the field; the dark
    dialog preview edged; at 1024 px the page's inspector a strip with a drawer, and the dialog
    sized to fit and remembered. UI only: every golden and v1 fixture byte-identical, the example
    fingerprints and `ANALYSES_VERSION` unchanged. Tests: the panel shell, Revert and focus,
    places and sections, the inventory of fields, the colour popover, search and jump (unit and
    happy-dom); Playwright `formatPanel.spec.ts` (new) and steps across format, formatBar,
    fontControls, layerOrder, axisExtras, styles, darkMode, accessibility and other specs in
    Chromium, WebKit and Firefox.


46b. ✅ **Reference lines and volcano thresholds** — decisions 930–948 (amends 852). **Identity
    and reference lines** (930–934): Insert › Identity line (y = x) (Add ▾ and the palette; graphs
    with two continuous axes) adds y = a·x + b, y = x by default — a typed result line with
    optional `ResultStat.slope` and `intercept` (no schema bump), drawn edge to edge where it is on
    both axes (`graph/src/layers/geoms/sloped.ts`): straight on linear axes, sampled along log,
    arcsinh and logicle axes, broken at axis breaks, never widening the axes; dashed grey, its
    equation as an optional label, its legend hidden until shown. Its panel edits slope,
    intercept, label and line, one undo step each; the format bar's Line group formats it; Delete
    removes a whole line or band of typed values (these and roadmap 36's). **Lines at ± a value**
    (940): "Line at a value…" takes ± (`mirror`): one value c drawn at −c and +c; a band shades
    between ±c or beyond it (`outside`). **The Significance layer** (941–942): a new stat
    `threshold` on the points geom (XY tables, analysis outputs, graphs of variables) colouring
    points Up, Down or NS (red, blue, grey, editable) with counts in the legend, the table
    untouched; the classing in `@ps/stats` (`thresholdClass`, ≥ at a cut-off counts). **Shared
    cut-offs** (943–944): `GraphNode.cutoffs` (|fold change| and P, the fold change's axis, an
    axis of −log10 P or of P), read by the lines (`ResultRef { from: 'cutoff' }`) and the layer, so
    one edit moves the lines and re-colours the points in one undo step. **Insert › Volcano
    thresholds…** (945–946): the log₂ FC cut-off (1), the P cut-off (0.05), which axis is the fold
    change (on a graph of variables, which variables), colouring on; one step adds the lines, the
    Significance layer in front of the base points, greys them and shows the legend's counts.
    Lines and bands at values are allowed on an analysis' own XY graph (947). New goldens only
    (`identity-line-scatter`, `identity-line-slope-offset`, `cutoff-pm-lines`,
    `cutoff-pm-band-outside`, `cutoff-volcano-significance`); every existing golden and v1
    fixture byte-identical, the example fingerprints and `ANALYSES_VERSION` unchanged. Tests:
    sloped geometry on linear, log, reversed and broken axes, ± lines and bands, classes, ties and
    missing values, shared cut-offs, the dialog's one step (unit); generated z-order, legend-glyph
    and robustness cases; Playwright `referenceLines.spec.ts` (new) in Chromium, WebKit and
    Firefox.

47. ✅ **Lists and getting started** — decisions 950–979 (UI/UX review S8, S9, N8, N9; amends 852,
    880, 881, 925, 934). **The navigator selects several sheets** (950–959): a plain click opens
    one as before, ⌘- or Ctrl-click toggles, Shift-click and Shift+↑/↓ select a range in the order
    shown (both views), ⌘A selects every sheet shown, Escape goes back to the open one; the
    selection is the navigator's (`organise/navSelection.ts`), never saved. The By kind view is a
    multi-selectable tree like Families. Batch actions, one undo step each with counts: Delete (one
    question listing everything that goes with them: the union of the cascades), Duplicate, Move
    to folder…, dragging several, Export selected… (graphs and pages: a folder on the desktop, a
    zip in the browser), Apply style… and Match format… for just the selected graphs. **The layer
    list selects several layers** (960–967): its rows are the canvas's whole-layer keys, so ⌘ /
    Shift selection halos them on the graph and Delete acts on them from either; Hide / Show, Move
    forward / backward as a block, drag, Duplicate and Remove act on all of them (multi-layer
    helpers in `graph/src/layerList.ts`). Delete on the canvas removes a whole layer of any kind
    (asking first when others depend on it) and hides a selected point (the table untouched), on
    graphs and pages alike. The format bar formats selected points (colour, border, symbol, size)
    and the Format panel writes its edits to every selected point, each keeping its own other
    fields. **Getting started** (970–975): a checklist card under the navigator on a new project
    (enter or import data, make a graph, run an analysis, format something, export) ticking itself
    off by watching the document and the exporter, with "Show me" for each step; × hides it, Help ›
    Getting started brings it back. Open an example… is a grid of cards with thumbnails drawn ahead
    of time and committed (`examples/thumbnails.json`, checked for staleness, a lazy chunk of 23 KB
    gzipped), Getting started first as "Start here". **Follow-ups from 46** (976–977): the format
    bar folds the groups that don't fit into More ▾ (Format… first, the painter, Reset position,
    then Symbols, Line, Fill, Text last) instead of scrolling them away; the Format search lists a
    setting once, naming the layers it applies to, each one a jump. UI only: every golden and v1
    fixture byte-identical, the example fingerprints and `ANALYSES_VERSION` unchanged. Tests: the
    selection models, batch steps and undo, the merged delete question, layer ranges and block
    moves, the Delete rules, point formatting, the checklist's steps, the cards, the thumbnails'
    staleness, the overflow rule, search grouping (unit and happy-dom); Playwright
    `navigatorSelection`, `layerSelection` and `gettingStarted` specs (new) and steps in shell,
    reuse, referenceLines and others in Chromium, WebKit and Firefox.

47b. ✅ **Legend editing** — decisions 980–993 (the user's request; amends 243, 305, 851, 853,
    881, 913, 915, 962, 976). **Select the legend, then an entry**: the first click on any part of
    the legend selects the whole legend, a second click on an entry selects that entry (Shift / ⌘
    more), Escape steps back out; an entry formats its data set (or its layer, for Significance
    classes and value lines) with a "Legend entry" section: Move earlier / later, Hide from legend,
    Legend label. **Order** (`legend.order`, entry keys within each group): drag a selected entry
    to a new place (an insertion line, in grids too) or Alt+arrows, one undo step; only the
    legend's order changes, never the marks, data sets or table columns; entries not listed (a data
    set added later) follow in their own order. **Legend-only labels** (`legend.labels`, rich
    text): double-click an entry's text; Use data set name resets it. **Rows and columns**:
    `columns` at every position and `fill` across rows or down columns, from the format bar's new
    Layout group (− n col +, Fill down columns) or the panel, so four entries make a 2 × 2 legend.
    Delete hides selected entries. The Format panel's Entries list every kind of entry with a drag
    handle, show / hide and the label. On pages too (except the in-place label editor). One place
    applies order, hiding, labels, the cap and the grid (`layout/legend.ts`); the scene lists the
    entries with their keys and groups for the UI. New goldens only (`legend-order-columns-2x2`,
    `legend-fill-columns`, `legend-labels`, `legend-columns-inside`); every existing golden, v1
    fixture and example fingerprint byte-identical, `ANALYSES_VERSION` unchanged. Tests: the
    fields' references (graphRefs), every frame that builds a legend, odd orders and labels
    (robustness), clicks, drags, keys, Delete and labels on graphs and pages, the Layout group and
    the panel (unit and happy-dom); Playwright `legendEditing.spec.ts` (new) in Chromium, WebKit and
    Firefox.

Audit 3. ✅ **Code audit 3** — decisions 1000–1164. Six read-only reviews (UI state, model and
    graphs, statistics, performance, accessibility and UX, security, tests and docs) and six new
    paper reproductions (Johnston, Jiang, Tawk: Nature Immunology / Microbiology; Zhong, Hoffmann:
    Nature Chemistry; Fratini: Nature Physics), plus side-by-side checks of the seven earlier papers;
    60 findings fixed in four steps, 24 feature gaps kept for later phases. **Papers**: six new
    published examples — Johnston, Hoffmann and Tawk (CC BY 4.0) built in with their data embedded,
    Jiang, Zhong and Fratini local-only — and Chen and Swaminathan (CC BY 4.0) now built in too;
    every printed statistic compared with the app (no statistics bug found; the differences are the
    papers' or method choices, each declared). **Step 1, bugs**: a focused Format-panel field no
    longer undoes an Undo; annotations held by id; deleting another sheet keeps the open one; legend
    edits keyed to rows and levels, not positions; Match format carries cut-offs and hidden entries;
    bands at breaks and log edges; ANOVA rounding noise is no effect; SDs and t tests at any
    magnitude; "—" for undefined P; P = 0 on volcano plots; two-stage step-up q values (Benjamini,
    Krieger & Yekutieli); lognormal tests keep rows with zeros; the format bar offers only what
    reaches the marks; new graphs start with solid bars and white points; hexagonal binning
    rewritten clean from Carr et al. (1987), so no GPL-2-only code remains. **Step 2, speed and
    memory**: nested t test and nested ANOVA linear in the replicates (9,600 values 37 s → 8 ms; new
    large R cases first); Satterthwaite df only when asked (12,000 subjects 1.9 GB → 0.35 GB); large
    point graphs keep no layout working set (1M-point UMAP 1,039 → 365 MB after two drags),
    thumbnails from a sample (11.8 s → 0.13 s), cloud images reused and released, a new project
    frees the old (556 → 26 MB), the Format panel and autosave no longer rescan big tables. **Step
    3, keyboard and screen readers**: the legend in Tab and ⌘A order with ]/[ through its entries
    and Format › Format legend…; focus rings on the panel's sections and after ⌘1; arrow keys nudge
    only on the canvas; Tab out of the canvas keeps the selection; focus kept after deletes; the
    layer list's Add ▾ a keyboard menu; undo and redo announced; one verb "Delete"; 24 px targets.
    **Step 4, tests, docs and licence**: GPL-3.0-or-later (LICENSE, NOTICE, package fields, SPDX
    lines); deploy, release and scheduled jobs only in this repository; e2e under the production
    CSP; flaky tests fixed at the root (Playwright's clock, one axe scan per screen, a small export
    test); the affected-specs map corrected; 11 new hard R cases (missing values, P below 1e-12, a
    zero-variance cell, repeated X, n = 2); tolerances tightened, none loosened; dead code removed;
    ARCHITECTURE.md and PAPER_PANELS.md brought up to date. `ANALYSES_VERSION` 1.4.0 (S2, S6
    verdicts, two-stage q values, lognormal rows with zeros); goldens changed only for new graphs'
    looks (34 bar graphs).

48. ✅ **Open source as statPlotter** — decisions 1170–1203. **The name**: the app is statPlotter
    (titles, About, the desktop app's product name and file types, PDF and TIFF metadata, release
    names); the bundle identifier is `dev.statplotter.app`; file extensions, the formats inside saved
    files, browser storage names and package names are kept, so every existing file and recovery copy
    still opens. **Licence and docs**: GPL-3.0-or-later, "Copyright (C) 2026 Shihan Li"; a public
    README (what it is, a screenshot, how statistics are checked, building, privacy, licence),
    CONTRIBUTING (pull requests reviewed and applied here, published with the next version) and
    SECURITY (private vulnerability reporting); "Your data stays on this device." on the start
    screen and in About, every privacy claim checked against the code (no request leaves the app's
    own address; recovery copies stay in the browser). **Publishing**: the papers whose data can't be
    shared moved to an optional folder the app and tests load only when it is there; `tools/
    publish-public.mjs` makes one commit per version on https://github.com/shihanli92/statPlotter
    (dry run by default; leaves out the agent files, the decision log, the paper-panels notes and
    the private examples; refuses on private data, home paths, personal addresses, secret-shaped
    strings or broken links; runs the full check, the web build and Cloudflare's build command in the
    copy; pushes only with `--push` and a typed yes). The demo builds on Cloudflare Pages from the
    public repo, with the app's security headers and no preview deployments. CodeQL and Dependabot
    for the public repo; workflows checked for read-only tokens, pinned actions and no
    `pull_request_target`. Steps in docs/PUBLISHING.md.

48b. ✅ **One name, statPlotter's own** — decisions 1210–1211. The commercial product whose `.pzfx`
    files the app reads is named nowhere: the app says ".pzfx" ("Import data… (CSV, Excel, .pzfx)"),
    the equation field says "Y = …, one statement per line", comments say what each convention is
    (Tukey's test as the usual default, the two-stage step-up with m̂₀ from the first stage, Type
    III sums of squares for unbalanced designs) instead of whose it is; the coverage list is the
    app's own (docs/FEATURE_COVERAGE.md); identifiers, test names and the R cases renamed (the R
    generators rewrite them byte-identically). Only the `.pzfx` schema's own names, which every
    such file carries, remain. A test keeps the name out. `ANALYSES_VERSION` 1.4.1 (three result
    texts reworded, no number changed). Also: the demo builds as a Cloudflare Worker serving static
    assets (`wrangler.jsonc`), and the scene-retention test measures what letting a scene go gives
    back, so caches don't count.
    **Fix after 0.3.2 (no version change; decision 1212).** In the Format panel's Open in window,
    colour fields did nothing: every dialog is modal (the top layer, the rest of the page inert),
    and the colour popovers, the format bar's menus and tooltips were portalled to the body, under
    the dialog (Escape on one closed the dialog). Pop-ups now go into the open dialog their button
    is in (`portalHost`), and the Format dialog is no longer a containing block for them (it moves
    by its insets and measures its own width instead of a `translate` and a container query), which
    also puts + Add ▾ and the rich text toolbar back beside their buttons. Tests: the helper, a
    colour popover in a dialog and a guard on the dialogs' styles (ui); `formatWindow.spec.ts`
    (a data set's colour and a custom hex through OK and one undo step; every control of every
    place on an XY, a column scatter, a grouped bar and a multiple-variables graph; the list of
    layers, + Add ▾, the dialogs over it, Match format). UI only: every golden and v1 fixture
    byte-identical, the example fingerprints and `ANALYSES_VERSION` unchanged.

49a. ✅ **Aesthetics by data set or fixed** — decisions 1213–1224 (the user's request: ggplot's
    `aes(fill = group)` beside `geom_point(shape = 21, colour = 'black')`). **The Appearance
    table**: a layer's Format place (docked and in its window; a data set's part too) shows a row
    per aesthetic its geom draws — fill, fill opacity, outline, outline width, shape, size for
    points; fill and outline for bars, boxes, violins, ellipses; line colour, width and style for
    lines, steps, error bars, centre lines, paths, vectors, connecting lines — each **By data set**
    (the group's colour, the graph's shapes or line styles in turn), **Fixed** (one colour, shape,
    pattern or size for every data set), **None**, or on multiple-variables tables **By variable**
    (the existing colour, shape and size mappings). It replaces Hollow, the symbol Border, the
    bars' Border and Fill opacity and the scattered line fields. A data set set by hand still wins:
    the table says "2 data sets set by hand · Reset". **Recipes**, one step each: Filled by group,
    black outline; Outlined by group, white fill; Solid by group. **Model** (optional fields and
    union members, no schema change): a shape or line pattern may be `{ series: true }` as colours
    are; the graph's orders of shapes (circle, square, triangle, diamond, cross, plus) and line
    styles (solid, dashed, dotted) are `style.shapes` / `style.dashes`, edited like the palette
    (in the graph's place and under the row), kept by styles (`.psstyle`), user presets and Match
    format; the format painter copies a shape by data set as such. Resolved by the style resolver
    at each series' colour index, so legends draw what layers draw. New goldens only
    (`bygroup-points-filled-black-outline`, `-points-outlined-white-fill`, `-shapes-cycled`,
    `-shapes-custom-cycle`, `-dashes-cycled`, `-bars-fixed-fill`, `-boxes-fixed-fill`); every
    existing golden, v1 fixture and example fingerprint byte-identical, `ANALYSES_VERSION`
    unchanged. Tests: the resolution (cycling, wrapping, lists' precedence, overrides, places of
    outputs and functions), legend glyphs, styles, presets, Match format and the format painter
    (unit); the table's rows, modes, recipes, Reset, mixed values, one data set, By variable and
    the lists (happy-dom); Playwright `byGroup.spec.ts` (new: docked panel and window) in
    Chromium, WebKit and Firefox. Left for 49d (first named 49b, then 49c; decisions 1237, 1253): fill and outline
    mapped separately (a second colour channel with its own palette), ggplot-style merged or split
    legends.
    **After 0.3.3 (no version change; decision 1225).** The public demo moves to Netlify
    (`statplotter.netlify.app`, the README's "Try it"): `netlify.toml` holds its build, the publish
    script's demo build matches it (`DEMO_BUILD`), `wrangler.jsonc` is gone, and
    docs/PUBLISHING.md says how the Netlify site is set up (previews off).

49b. ✅ **One layer at a time in the Format view** — decisions 1226–1238 (the user's request:
    "clicking on a layer will open controls from that layer only; small arrows to move through
    the layers"; amends 910, 913). **One layer's view**: a mark clicked opens only the layer that
    drew it, the data set (curve, function) it draws picked; a data set's identity, a legend entry
    or a curve's label opens its home layer (the front-most of its own: the points, not their
    error bars). The view is headed by the layer's name, **‹ › and "n of m ▾"**: the arrows step
    through every layer of the graph in the Layers list's order, the front first ("Layer in
    front", "Layer behind"; no wrap), the menu jumps to any layer; the data set stays picked where
    the layer landed on draws it, else All data sets; the canvas selection (on pages too) follows,
    the layer's marks highlighted; no shortcut (none free). Then the Data set picker (All · each),
    **"Data set colour (every layer)"**, a row at the top when one is picked, and only that
    layer's sections: Common, its fields (statistic, position, the Appearance table), labels, the
    Layers list, Advanced, Copy this format. The stack of every layer's sections in a data set's
    place is gone. Layers of their own (heat maps, the grand mean, connecting lines, the
    Significance layer, lines at values) have no picker; an estimation plot's differences now
    have one. **Several data sets** of one layer selected: that layer's view of them together,
    fields that differ mixed, each data set's own entry written. Revert takes back the changes
    made on the layer shown; "Open in window" opens the window at the same view, with the arrows
    (the preview highlighting). Model: `FormatTarget`'s layer place takes an optional series pick
    and a point is a place of its own (`route.ts`); every producer and consumer moved (routing,
    legend entries, the search, the panel and window, the graph and page views). The completeness
    check steps through the layers; its inventory drops only fields that drew nothing (the grand
    mean's and a heat map's per-data-set fields) and renames the colour row. UI only: every golden
    and v1 fixture byte-identical, the example fingerprints and `ANALYSES_VERSION` unchanged.
    Tests: routing, the arrows' order, ends and kept or dropped data sets, the colour row, search
    jumps, legend entries, several data sets, Revert across arrow moves (unit and happy-dom);
    Playwright `layerSteps.spec.ts` (new: docked panel and window) and steps across format,
    formatPanel, formatWindow and other specs in Chromium, WebKit and Firefox.
    **Fix after 0.3.4 (no version change; decision 1239).** In the Format window, Enter in a field
    commits the field and the window stays (the value selected for the next typing); ⌘Enter /
    Ctrl+Enter is OK, as the footer says. Test: `formatWindow.spec.ts` (a font size and Enter, the
    preview following and the graph waiting; Mod+Enter OK as one undo step).

49c. ✅ **Dendrograms as layers** — decisions 1240–1253 (the user's request: "dendrograms as their
    own layer, available as part of the heat map; allow adjustment of the height/width", with
    cutting the tree into clusters and dendrograms alone; amends 225). **Trees as layers**: geom
    `dendrogram`, stat `cluster` (of the rows or the columns; its own distance and linkage where
    the tiles don't cluster that axis; a cut), named "Row dendrogram" / "Column dendrogram": in
    the Layers list, Add layer (Special), the ‹ › steps and their own Format view, selected on the
    canvas, hidden, removed, moved in the list. The heat map keeps the clustering that orders its
    cells (rows, columns, distance, linkage); a tree draws that tree, so its leaves meet their
    cells, and clustering an axis on adds its tree (off removes it), one step. **Size and place,
    per tree**: a row tree right or left of the map, a column tree above or below it (the names
    step out beyond it), its depth (width or height, pt) and gap to the map — the depth also
    dragged from a handle on the tree's outer edge on the graph view, one undo step — and branch
    heights as R's merge heights or equal steps; its line in the Appearance table. **Cuts**: into
    k clusters or at a height, each leaf's cluster exactly R's `cutree` (translated to
    `stats/src/gpl/cutree.ts`; oracle suite `cutree`, 16 fixtures: every linkage and distance,
    ties); branches below the cut in their cluster's colour (the palette's, or each cluster's
    own), an optional cluster strip between tree and map, the clusters in the legend when it
    shows. **A dendrogram alone**: the preset and the builder's frame choice "Dendrogram"
    (grouped, multiple-variables and contingency tables): its tree fills the plot over its leaves
    along the bottom, or beside them down the left, the leaves named by the rows or data sets, the
    merge heights up the other axis. **Schema v3**: v2 files' trees (the tile's
    `cluster.dendrogram` depth) become tree layers (`migrations/v2to3.ts`; user preset files
    version 2), drawing exactly as before: v2 fixtures written by 0.3.4 with its SVGs (byte for
    byte by data set; by layer the same primitives in order, the trees' marks in their layers'
    groups), and every golden of the v1 fixtures through v1 → v2 → v3 byte for byte. Older apps
    refuse v3 files with their newer-version message. Example fingerprints re-recorded (every
    document's `schemaVersion`; the three clustered heat maps' two tree layers; `v1Examples`
    proves them equal to their v1 documents migrated); `ANALYSES_VERSION` unchanged. New goldens
    (`tree-rows-left-columns-bottom`, `-depths-gaps-steps`, `-cut-strip-legend`,
    `-cut-colours-left`, `-by-data-set`, `-alone-bottom-cut`, `-alone-left-steps`,
    `-alone-left-merge`); every existing golden byte-identical. Tests: cutree against R, the
    tree's geometry (sides, depths, gaps, equal steps, cuts and their colours, strips), the
    owner of each axis' tree, legend entries, a tree alone both ways, the matrix's rules, plot
    styles, presets, the migration's edges and its v2 fixtures, the canvas drag (unit); the
    heat map's clustering adding and removing trees and a tree's Format view (happy-dom);
    Playwright `dendrogram.spec.ts` (new) in Chromium, WebKit and Firefox. Left then and done in
    49d: the tree's handle on graphs placed on layout pages, the format bar's line group for a
    tree, hover cards on trees.

49d. ✅ **Fill and outline mapped separately** — decisions 1254–1265 (the
    user's request continued from 49a: ggplot's `fill =` beside `colour =`; amends 1214). **Two
    colour channels**: a fill by data set (`{ series: true }` in a fill) is the data set's fill
    colour — its own ("Data set fill (every layer)" under "Data set colour (every layer)", or a
    link "Set a separate fill colour"), else the graph's fill palette at its place (Common's "Fill
    colours of the data sets": Same as their colours, Lighter colours, the colour schemes; a
    style's too), else its colour — while outlines and lines stay the colour; put into the resolved
    style by the layout's style resolver as 49a's shapes and dashes are, so the legend's keys draw
    both. A fourth recipe, "Light fill, dark outline by group". **Fill by a variable** on
    multiple-variables tables (`aes.fill`, `mapping.fill`; the matrix's `fill`, §6.2a
    regenerated): a text variable's levels in their fill colours, a number variable on a colour
    scale of its own (`scales.fill`, viridis with a colour bar to start); the Appearance table's
    Fill row By variable chooses it ("Same as the colour" until then), the Outline row the colour
    variable, a fixed fill unmaps it; Appearance by variable lists its levels' fills. **Legends as
    ggplot's**: one legend whose keys show both when fill and colour map the same thing (data
    sets; a variable's levels as symbols outlined and filled), separate legends headed by their
    variables when not (numbers as colour bars), each ordered, hidden and relabelled as 47b's.
    **Line patterns by group** for ellipses, hulls, paths, vectors and contours (the graph's line
    styles in turn, by the group's place), legend samples too. Carried by styles, presets (fill
    palette, fill scale, the fill variable's type), Match format, the format painter (a data set's
    own fill with its colour) and Change layers; `graphRefs` walks `aes.fill` and `mapping.fill`.
    Model: optional fields and union members only, no schema change; absent, everything draws as
    before — every golden, v1 and v2 fixture and example fingerprint byte-identical,
    `ANALYSES_VERSION` unchanged. New goldens (`filloutline-fill-palette-black-outline`,
    `-light-fill-dark-outline-bars`, `-xy-own-fills`, `-variables-split-legends`,
    `-variables-merged-legend`, `-variables-fill-number`, `-ellipses-dashed-by-group`,
    `-paths-dashed-by-data-set`). **The 49c leftovers** (decisions 1262–1265): a tree's
    handle also on graphs placed on layout pages (the drag scaled by the item, the plot staying
    put, one undo step "Dendrogram size"); the format bar's Line group formats selected trees
    (colour, width, style; mixed across trees; written where the Appearance rows write); hover
    cards on trees — a branch its merge height, leaves and cluster, a leaf (its leg or strip band)
    its row or column and cluster — the facts riding on the scene nodes, never drawn. Tests: the fill channel's resolution (absent =
    today, a fill palette equal to the palette drawing the 49a goldens byte for byte, own fills
    over the palette, wrapping, which layers fill by data set), fill variables and their scales,
    merged and split legends, overlay dashes, styles, presets, Match format, graphRefs and the
    format painter, tree hover cards, the page's tree handle and the format bar's tree Line
    (unit); the fill row and its link, the data sets' fill colours, the recipe, the
    Fill and Outline variables on graphs of variables, a tree's hover cards (happy-dom); Playwright `fillOutline.spec.ts`
    (new) and `dendrogram.spec.ts` (a tree's handle on a page, the format bar's Line on trees,
    hover cards) in Chromium, WebKit and Firefox.

50. ✅ **Zoom and pan with the mouse** — decisions 1266–1270 (the user's request: "Alt + scroll
    to zoom in/out and a middle mouse button to move the plot when zoomed in"). On the graph
    view's canvas and on layout pages, **Alt (Option) + wheel and Ctrl + wheel zoom about the
    pointer**: the point under it stays under it (the canvas scrolls to keep it, as far as it
    scrolls; a graph narrower than the canvas stays centred), ×1.1 a notch, continuous (deltas
    normalised from lines and pages), within graphs' 25%–800% and pages' 25%–400% (the zoom lists
    widened: 4 and 6 for graphs, 2 to 4 for pages). **A trackpad's pinch** zooms the same way
    (Ctrl + wheel in Chromium and Firefox, gesture events in WebKit), never the page itself — the
    canvas' wheel listener is not passive — and Alt + wheel never goes back in Firefox's history.
    The zoom box shows a zoom between its levels ("133%") and ⌘= / ⌘- step on from it. **The
    middle button dragged moves a zoomed graph or page**, taken before anything on the canvas
    sees it (never selects, moves or edits, over any mark or item, with something selected; a
    grabbing hand; pointer capture; no autoscroll or paste). **Two fingers on a trackpad** scroll
    as before, both ways: the wheel without a modifier is never intercepted. While the wheel
    zooms, point clouds keep their image until it rests (200 ms), one image per gesture. A hover
    card on a page is in the page's canvas (it scrolls with it; the wheel and the middle button
    over it act on the canvas) and a zoom clears it till the next move over the mark. View
    state only, as the zoom box's: no undo step, nothing in the document. The shortcut sheet's
    "With the mouse or trackpad" and the zoom box's tooltip list the gestures. UI only: every
    golden, fixture and example fingerprint unchanged, `ANALYSES_VERSION` unchanged. (Space +
    drag panning was considered and dropped at the user's choice.) Tests: the zoom's math —
    anchoring, clamping, delta normalisation, pinch rate, stepping from between levels, the zoom
    box's choices, the gestures' text (unit); the hook on a canvas — Alt and Ctrl + wheel
    anchored, plain, Shift and ⌘ scrolling left alone, the ends, the clouds' resolution held then
    caught up, the middle button seen by nothing on the canvas (happy-dom); Playwright
    `mouseZoom.spec.ts` (new: also a page's hover card under the wheel and after a zoom) in
    Chromium, WebKit and Firefox.
    **Fix after 0.3.7 (no version change; decision 1271).** The scene-retention test takes its
    heap measure up to three times and the smallest counts (the bound unchanged): one measure on
    the shared CI runner was noisy (54 and 57 bytes a point once each).
    **Fix after 0.3.7 (no version change; decisions 1272–1275).** Bars no longer restyle points
    (the user's report): the table's points keep their data set's colour, and bars made with
    them start a lighter version of their colour (40%, the theme's outline in that colour); bars
    without points stay solid. The same rule decides a new layer's look wherever layers are added,
    Add layer included, and never restyles layers already there. The builder's preview draws the
    graph Create makes (one function for both, the project style's axis frames and legend place
    too). The Tawk and Johnston examples' own solid bars are made lighter where points are drawn
    on them (Johnston's 6p keeps its black outlines, its points outlined in black). Goldens of
    graphs with bars and points (21 and the journal-style page), the Johnston, Tawk and
    Swaminathan example fingerprints and thumbnails (Tawk, Swaminathan) change in those layers'
    styles (and Tawk's and Johnston's format notes) only; `ANALYSES_VERSION` unchanged. Tests: `newLooks`, the builder's preview
    against Create for every preset, Add layer's looks (unit); `graphBuilder.spec.ts` (the Bars
    with points preview and graph) and `examples.spec.ts` in Chromium, WebKit and Firefox.

51a. ✅ **Explanations and a guided chooser** — decisions 1276–1285 (design
    [design/ANALYSIS_GUIDE.md](design/ANALYSIS_GUIDE.md) §2–§3, approved 2026-10-12; the first of
    51a → 51c → 51b → 51d → 51e). **Every method has a card** (88 `MethodCard`s: what it asks, the
    null in words and what P is, when to use it and its neighbours instead, its assumptions in
    experiment terms, how to read it; the formula, R call and one to three references behind
    "More"; the compare-groups cards as the design gives them), and **every field and option of
    the 54 analyses has its text** (405 fields, 599 options: a line under each, a longer card
    behind ⓘ, and "Recommended: why" beside every "(recommended)"), in `@ps/analyses`
    (`explain/`), attached to the forms when the registry is built; `AnalysisDef.cards(params)`
    names the method the options choose. One source for the Analyze form (the lines, ⓘ, About
    this method), the results' **How to read this** (the cards' null and reading with the data
    sets' names), the chooser and **Help › Choosing an analysis** (generated from the trees and
    the cards). The text is true of 0.3.8: where 51c changes a default it says what the app does
    now and recommends the better choice in words (Student's t test still the starting choice,
    Welch's recommended; Kruskal-Wallis' approximate P; Dunn's comparisons Bonferroni-adjusted;
    the survival results listing every test; one-tailed P in the observed direction).
    **The guided chooser** (`analyses/src/guide/`, types in `model/src/guide.ts`): 40 questions
    by table kind (the rails of design §3.4), follow-up questions in the experiment's words (same
    subjects? measurements, values that change by a factor, or scores? can scatter differ? which
    comparisons?), counting questions answered from the table's shape (`TableFacts`: groups,
    values, raw or mean/SD/N, complete rows, 2 × 2, X's range — never a test), answers the table
    rules out greyed with the reason, then a recommendation: the method, a reason for these
    answers, "You will get", the method line and up to two alternatives with when to choose
    them; **Use this** fills All analyses with its params (288 paths through the trees end in 38
    analyses with params; 4 in another table kind). It never runs anything and never shows a
    statistic. **Entry points**: the Analyze dialog's **Guide me** tab beside **All analyses**
    (the dialog widened to min(1200 px, 94vw); it opens on the tab last used in the project,
    first time Guide me; an analysis asked for by name opens the list), the navigator's empty
    Results (a table with no analyses: "What do you want to know about “…”?" and its kind's first
    three questions), **Compare these columns…** on selected columns, Analyze › Guide me… and
    the getting-started checklist's "Run an analysis". **Search by question across table
    kinds** (U3): the chooser's questions, this table's analyses (by titles, keywords and their
    methods' names, words in any order and by their start) and, greyed, what another table kind
    answers, with a New table… of that kind; questions of other kinds also under the chooser's
    "Not here?". **U2**: the list opens on the last analysis used for the table's kind (else its
    first common one), each analysis listed once (the common ones under Common only). **U5**:
    the Analyze menu is Analyze…, Guide me…, All analyses…, the table kind's common analyses
    (the dialog's Common, one source), Recent analyses ▸ and every analysis in a submenu per
    category (the fixed quick list and the top-level simulations went). An analysis made after
    Use this records `origin.guide` (its question, answers, and whether the params were kept;
    optional, DATA_MODEL §5.1). Three-way ANOVA's comparisons no longer offer Newman-Keuls, which
    its params never accepted (decision 1281). No statistic, default or result changes:
    `ANALYSES_VERSION` unchanged, every golden, fixture and example fingerprint byte-identical.
    Deferred: S38's "Y = log10(Y)" label (it is also Transform's result text, so 51c renames it
    with its version bump; the form's line says log is base 10), the survival questions that
    need 51c's params (trend, pairs, early weighting, the reference group), a 2 × 2's roles
    (first row and column until 51c), the chips and side panel (51b). Tests: `explain.test.ts`
    (every analysis' cards for every combination of its options, every field and option's line,
    tags with reasons, lengths, cards complete and reachable, the writing style of §2.4),
    `guide.test.ts` (every path ends in a recommendation or another kind; every recommendation
    and alternative parses with no unknown key, accepts its question's kinds and runs on a
    fixture table; every answer reachable; a snapshot of every path's params; the walk and the
    facts), the search, the opening analysis and the list once (unit); the Guide me tab and the
    form's lines, ⓘ and reasons (happy-dom); Playwright `analysisGuide.spec.ts` (new: Guide me →
    the recommendation → Use this → Analyze → results and How to read this; Not here? → a new XY
    table; search by question by keyboard; the empty Results' questions and Help) and the specs
    whose dialog and menu changed (`analyses`, `shell`, `gettingStarted`) in Chromium, WebKit
    and Firefox.

51c. ✅ **Safer defaults and multiple comparisons** — decisions 1286–1301 (design
    [design/ANALYSIS_GUIDE.md](design/ANALYSIS_GUIDE.md) §6–§7; the second of 51a → 51c → 51b →
    51d → 51e). **Saved analyses keep what they computed**: stored params are read one way
    (`paramsOf`: migrated from the version they were saved with, then parsed); 22 analyses move
    to params version 2 and their migrations write 0.3.8's defaults into older params, so only
    new analyses get the new defaults (checked against the params 0.3.8 wrote). **New defaults**:
    Welch's t test (the F test only when asked, the SDs and their ratio instead; no "Consider
    Welch"), one-way ANOVA without Bartlett's test by default, Kruskal-Wallis' **exact P** for
    small designs (up to 2 × 10⁷ arrangements, else the approximation, said), Dunn's comparisons
    by Holm (Šidák, Bonferroni, none), the false discovery rate (Benjamini-Hochberg, Q = 5%)
    across multiple one-way ANOVAs' rows and across a correlation's pairs, Q = 5% for multiple t
    tests and P stacks, Satterthwaite's df for mixed models and nested analyses, the RM method
    chosen (auto / ANOVA of complete subjects / mixed model, the model and its df said; sphericity
    greyed with its reason while values are missing), one survival test (log-rank) with pairwise
    log-rank tests corrected for three or more groups and one hazard ratio against a control,
    trend tests off unless the rows or groups are ordered, Shapiro-Wilk alone with the QQ plot,
    ROC's direction asked, new one- and two-way comparisons later − earlier. **One-tailed P for
    the predicted direction** (decision 18 superseded): the direction asked in the groups' names,
    the large P reported, and warned, when the data went the other way; saved one-tailed
    analyses keep theirs, flagged. Main-effect comparisons of a repeated factor without
    sphericity by per-contrast errors (no longer refused). Notes on analyses of outlier-cleaned
    or normalized values, on two-way main effects beside an interaction, on comparing lines;
    pilot data in power planning (the effect's CI and the n at its bound nearer zero); rank-test
    wording ("Shift between groups"); "(pooled SD)" on d and g; "Y = log10(Y)"; Šidák; P = 0.05
    is "ns"; α and Q as percentages; Newman-Keuls and LSD under "Other (not recommended)"; a 2 × 2's
    exposed row and outcome column; the Fisher fall-back a warning; one model comparison in
    curve fits. **Safeguards against test-switching** (§7): a method changed after its results
    were seen shows a notice (the changes, a reason, Add as a new analysis; never blocking) and
    is kept in the analysis' **method history** under its results (`analysis.recordChange`, one
    undo step); brackets offer **Welch's t test** first and, with three or more groups or a
    second bracket, **one analysis of all the groups** (one-way ANOVA with Tukey's or Dunnett's;
    two-way within rows; two-way at each X through `input.byX`), relabelling bracket tests from
    it ("Label these N brackets from one ANOVA"), separate bracket tests marked "(uncorrected)";
    P labels name their test ("P = 0.0014 (Welch's t)"); two tests of one comparison on a graph
    raise a warning badge. The explanations and Guide me follow (survival questions, a 2 × 2's
    roles, the new defaults). `ANALYSES_VERSION` 1.4.1 → 1.5.0. R oracle: new suites
    `onetailed` (17 cases), `kw_exact` (6), `rm_main_effects` (4), `survival_pairwise` (4),
    `multiple_oneway_rows` (3), `correlation_family` (3), `power_pilot` (4); more cases in
    `mixed` (2), `nested` (Satterthwaite outputs), `multcomp` and `friedman` (Dunn by Holm); the
    `contingency` 2 × 2 cases through the roles. Example fingerprints change in their analyses'
    params version and pinned params (the clinical ROC states its direction; two notes reworded);
    goldens unchanged. Left for 51c-2: the stars' key label (§7.4), the power curve over a range
    of effects (S29), the history in a methods paragraph (51d). Tests: `migrateParams` (0.3.8's
    params full and sparse, every new and pinned choice), `paramsOfOnly`, `methodChanges`, the
    oracle suites, the new defaults and their saved behaviour per analysis (unit); the method
    history, its notice, the form's greyed choices, percentages and names (happy-dom); the
    engine's history command, source notes and `byX`; brackets from one analysis, uncorrected
    marking and duplicates; Playwright `methodHistory.spec.ts` (new) and the specs whose defaults
    changed (`analyses`, `resultsOnGraphs`, `reuse`, `files`) in Chromium, WebKit and Firefox.

51b. ✅ **The new Analyze dialog** — decisions 1302–1312 (design
    [design/ANALYSIS_GUIDE.md](design/ANALYSIS_GUIDE.md) §4–§5; the third of 51a → 51c → 51b →
    51d → 51e). **Three panels** (U11): the list (search, Common, categories; Guide me beside it),
    the options (the only column that scrolls) and a side panel with the live sketch, the checks
    and the method's cards (or the card of a question's ⓘ); min(1200 px, 94vw) × min(820 px,
    90vh), resizable and remembered; at 860–1099 px the list folds to a strip opening over the
    options and the side panel narrows to 300 px, below 860 px the sketch is a strip above the
    options (Hide sketch). **Analyze** (or **Apply**); editing opens on the current method,
    "Edit “name”", with **Change method…** (U28); ⌘Enter, ⌘1 / ⌘2, ⌘K. **Options in the
    experiment's words, in tiers** (U7, U9, U14): Essentials (the design questions: "Same subjects
    in both groups?", "What kind of values?", "Could a treatment change how much values vary?",
    "Which comparisons?", "Were the same subjects measured across a factor?"), Reporting (the
    confidence level, extra output, Show on graph — also while editing — with a summary line) and
    Advanced (corrections, df and P methods, one-tailed P; its first choice and a count of changed
    values); a tier on every field of the 54 analyses. **Groups as chips** (U6, U17) in the
    analysis' order (`input.dataSets`), included or left out, reordered by drag or Alt + ←/→,
    swapped with ⇄, the control set on its chip, with the comparison spelled out in 51c's sign
    convention ("Comparing: “Treated” − “Control”, row by row"). **Invalid combinations
    prevented** (S10, U8): fields hidden where they never apply to the table and options greyed
    with the reason (`appliesTo`, `unavailable`, facts about the chosen data: raw values, X values,
    2 × 2, gaps in matched values, groups, values per cell, rows, factors), 26 of §4.4's 28 rows
    (row 9 fixed in 51c, row 22 needs 51e); a greyed choice still chosen holds Analyze until
    changed, never switched silently; no reason suggests changing an assumption. **Checks before
    Analyze** (U16) through one `validate` that `run` calls first: the groups chosen, the roles,
    the problems `run` would have refused (with the same message), and notes (unequal sizes, the
    values a ratio can't take); Analyze disabled with the first block as its reason. Results that
    fail say **Error** with the right link (Change parameters… or Go to table). **Switching
    methods keeps the shared choices** (U13: confidence level, tails and direction, control,
    comparisons, matching; returning restores a method). **Role boxes** (U12) for analyses of
    variables (Outcome, Predictors, Factors, Time, Event, Group by, X, Y): the outcome starts empty,
    PCA leaves coded and text variables out and names them. **The live sketch** (§5): a graph of a
    transient table in a native preset drawn by `@ps/graph` (`sketchGraph`), produced as data by
    each analysis (`analyses/src/sketch/`, no branching on the method in drawing code): the groups
    with their own or the pooled SD, a line per pair and the differences, ranks (Mann-Whitney,
    Kruskal-Wallis, Friedman within rows, Wilcoxon's signed ranks), the grand mean, the comparisons
    as brackets, the factor grid and the independent units, the first rows of many, the regression
    line's shape and a curve fit's starting shape ("not the fit"), contingency shares and a 2 × 2's
    roles, Kaplan-Meier steps, the outcome against each predictor; a caption, a counts line, notes
    (the SD ratio described, rows without a pair, missing values) and a text alternative; sampled by
    rows above 2,000; never a P, CI, r, R² or fitted value. No statistic, default or result
    changes: `ANALYSES_VERSION` unchanged, the results fingerprint, every golden, fixture and
    example fingerprint unchanged. Deferred: §4.4 row 22 (51e), checks' fix buttons, Q-Q panels,
    the control drawn emphasized and set by clicking the sketch, the one-tailed side shaded, the
    two-way axis toggle and additive lines, PCA's correlation strip, the volcano preview's axes; the
    stars' key label and the power curve stay 51c-2. Tests: `check.test.ts` (check ⇔ run for every
    analysis on degenerate tables and every option, with the computed failures listed),
    `dialog.test.ts` (tiers on every field, the words, the comparison sentence, carrying choices,
    roles), `analysisConditions.test.ts` (§4.4's table walked: hidden, greyed with the reason, a
    block, and `run` still refusing), `analysisSketch.test.ts` (every analysis' sketch on every
    option: presets exist, graphs lay out, no result words; pairs, pooled SD, ranks, comparisons,
    sampling, the CPU-time guard, the import boundary), the dialog in happy-dom
    (`analyzeDialog.test.tsx`); Playwright `analyzeDialog.spec.ts` (new: panels and sizes, chips
    and order, the sketch following Welch / Student / paired / ranks / comparisons, a greyed
    option, a check before Analyze, switching keeping choices, roles, no P before Analyze) and the
    specs the dialog changed (`analyses`, `analysisGuide`, `methodHistory`, `dataManipulation`,
    `groupOverlays`, `reuse`, `resultsOnGraphs`, `gettingStarted`, `toolbar`, `shell`,
    `accessibility`) in Chromium, WebKit and Firefox.

51d. ✅ **Results that explain themselves** — decisions 1313–1323 (design
    [design/ANALYSIS_GUIDE.md](design/ANALYSIS_GUIDE.md) §8; the fourth of 51a → 51c → 51b →
    51d → 51e). **The answer first, in a sentence** (U18): every statistical result begins with a
    summary written from its own values in the user's names — "Treated is higher than Control by
    12.7 (95% CI 8.26 to 17.1); P < 0.0001, Welch’s t test. n = 8 each." — by family: t tests
    (unpaired, paired, ratio), rank tests, one sample, one-way (each group against the control, or
    the pairs that differ, largest first), Kruskal-Wallis and Friedman, repeated measures, two-way
    (the interaction first), factorial ANOVAs, multiple t tests and one-way ANOVAs (the rows that
    are discoveries), correlation, regression (the slope per unit of X, the comparison of lines),
    curve fits (EC50 with the X title's unit: "62.6 nM"), contingency (the outcome's percentage
    per row, relative risk, with 51c's roles), survival (medians, "not reached", the test, the
    hazard ratio), normality, descriptive, ROC, Bland-Altman, models of variables, Monte Carlo,
    power, PCA, outliers; "no evidence of a difference" for P ≥ 0.05, a one-tailed P with its
    prediction (and said when the effect went the other way). **The first tab is the answer**
    (U21): the summary and a small **effect plot** (U25: each difference with its CI, drawn by
    `@ps/graph` from a transient table and a native preset) above the tabs, the comparisons sheet
    first, derived tables last, the details collapsed (U22), and **Method** with a generated
    **methods paragraph** (the method, options, corrections, how it was set up, the method history
    when it changed after results were seen, the software's version) to copy. **Comparisons-table
    headers** (S23): which comparisons form the family, the method, simultaneous or not, what P
    and the CIs refer to. **The user's names** (U19): "Mean of Control", "Difference between means
    (Treated − Control)" in place of "column A / B" and "B − A"; grouped tables' **factor names**
    asked for in the Analyze dialog and used by results ("The effect of Treatment depends on
    Genotype"); rows and blocks keyed so result labels on graphs keep resolving (keys, labels, then
    the labels of before 0.3.11). **One sign convention** (U20, S25): new multiple t tests and
    Bland-Altman later − earlier, saved ones pinned. **Names follow the method** (U23): "Welch’s t
    test: Treated vs Control (Day 1)", "One-way ANOVA + Dunnett: Doses", renamed with the method until the
    user renames the analysis. **Readable, accessible numbers** (U26, U29): "Not reached" medians,
    NNT as a positive number for one fewer or one more of the outcome, row and column headers,
    star summaries in words, "Error:" with an icon. `ANALYSES_VERSION` 1.5.0 → 1.6.0 (no number
    changes); example fingerprints change in the params version of their multiple t tests and
    Bland-Altman analyses (results unchanged); goldens unchanged. Deferred: opening the effect
    plot as a graph and its plots for regressions, fits and survival; editing factor names in the
    grid's header and using them in two-way RM's and three-way's tables; units in results
    tables; the U26 EC50 rows in the unit's prefix. Tests: `summaries.test.ts` (every family's
    sentence on fixtures: both P branches and directions, one-tailed with and against the
    prediction, missing values, long lists, saved signs; the headers), `resultNames.test.ts`
    (names that follow the method, keys and old labels resolving, factor names, the methods
    paragraph), `migrateParams.test.ts` (the sign pins), `effectPlot.test.ts`, the results view
    and auto-naming in happy-dom (`resultsView.test.tsx`); Playwright `analysisResults.spec.ts`
    (new: a t test's sentence, names, effect plot, details and method; one-way ANOVA with Dunnett's
    comparisons first with their header; survival with a log-rank label on the graph; a curve
    fit's EC50 in nM) and the specs whose results view changed, in Chromium, WebKit and Firefox.

51e. ✅ **Curve fitting** — decisions 1324–1333 (design
    [design/ANALYSIS_GUIDE.md](design/ANALYSIS_GUIDE.md) §9; the last of 51a → 51c → 51b → 51d →
    51e). **The model chosen by goal** (U10): the 127-entry Model select becomes a picker in the
    Analyze dialog — 13 goals (dose-response stimulation and inhibition, receptor pharmacology,
    binding saturation, competition and kinetics, enzyme kinetics, decay and growth, growth
    curves, standard curve — which also interpolates unknowns —, lines and polynomials, peaks,
    distributions and waves, radiation), each model a card with a **thumbnail of its shape**
    drawn by `@ps/graph` from typical values (plateaus and midpoint dashed and named), the shape
    in words, the X it expects and its parameters; All equations (searchable) and My own
    equation beside them. **Equation metadata** for all 126 built-in equations
    (`analyses/src/explain/equations.ts`): goals, the X scale expected (log, concentration,
    time, any), each parameter's meaning and unit, the midpoint and plateaus, the models it is a
    special case of (52 declared, checked by evaluating both models), its form on the other X
    scale. **X checked against the model** (S8): concentrations under a log model (and log molar
    under a concentration model, X = 0 under a log model) are a note in the dialog's checks with
    one-click fixes — **Transform X to log10** (a Transform analysis and the fit of its result)
    or the model's other form. **Dose-response warnings with their fixes**: the EC50 outside the
    doses, a plateau not reached, an EC50 the data don't determine, too few doses, an ambiguous
    fit; "Fix Bottom = 0" (or Top = 100 for percentages) opens Edit with it set.
    **Profile-likelihood CIs by default** for new fits (saved fits pinned to the asymptotic
    ones; params version 3). **One model comparison, chosen in advance** (S18): the F test only
    between nested models (one a special case of the other; a user equation never), greyed with
    "These models aren’t nested; compare them by AICc." otherwise (§4.4 row 22: 27 of 28 rows now
    prevented in the dialog); the question asked with the comparison, the nested models listed
    first; one verdict in the results' values and the summary sentence; the chooser asks how a
    compared EC50 will be decided. **The curve-fit sketch** follows the picker: the starting
    shape from the initial values, constants and shared parameters as the fit starts, constants
    on plateaus as dashed lines ("Bottom = 0"), the compared model's own starting shape.
    `ANALYSES_VERSION` 1.6.0 → 1.6.1. R oracle: new `nonlinear` cases (`inhibitor_4pl_profile`,
    `inhibitor_4pl_vs_3param`, `decay_two_vs_one_phase`, `gaussian_vs_lorentzian_aicc`,
    `global_shared_hill_profile`; the oracle profiles a global fit's per-data-set parameters
    too). Example fingerprints change in their curve fits' params version only (results
    unchanged); goldens unchanged. Deferred: weights as point sizes and a shared parameter as one
    handle in the sketch, the effect plot's fitted-curve family (51d's list), a model picker in
    "A different equation for some data sets" (still a select). Tests: `curveModels.test.ts`
    (metadata coverage, the special cases evaluated, X rules and fixes, warning fixtures, profile
    pins, nesting, row 22, the verdict sentences), `modelThumbnails.test.ts` (every model's
    thumbnail laid out; each goal's first pinned as an SVG), the picker, the X fixes, Transform
    first, row 22 and Edit with a fix in happy-dom (`modelPicker.test.tsx`), the oracle cases;
    Playwright **`curveFitting.spec.ts`** (new: an IC50 from a log-X table through the picker;
    concentrations noticed and fixed by Transform X to log10; EC50s compared by the F test chosen
    in advance; models that aren't nested compared by AICc with the F test greyed) and
    `analyses.spec.ts` (profile CIs) in Chromium, WebKit and Firefox.

51f. ✅ **Guide me diagrams** — decisions 1334–1340 (the user's request after 51e; design
    [design/ANALYSIS_GUIDE.md](design/ANALYSIS_GUIDE.md) §12). **What will be tested**: a
    schematic of the question that builds up as Guide me's questions are answered — the groups
    (or rows, a grid's cells, variables) as boxes with the user's names, what each holds (mean,
    mean of log values, ranks, distribution, % of the outcome, risk or odds, survival curve,
    slope, a fitted curve's parameter such as the EC50) with a small picture, the comparisons as
    arrows (two groups, every pair, each against the control, a trend in order, any difference,
    each against a set value, within each row or column of a grid, one test per row, one shared
    parameter or one each, predictors pointing at an outcome), the same subjects as links, a
    grouped table's factor grid with what counts as an independent unit ("6 subjects, not 24
    values"), nested subjects inside their groups, a one-tailed prediction as the arrow's
    direction, the question in words ("Is the mean of Treated different from that of
    Control?") and what "no effect" means, the family and its correction, and the question to
    answer next. Data from `@ps/analyses` (each answer's `draws` in the trees, then the
    recommendation's params: `analyses/src/schematic/`), drawn by `@ps/graph` (`schematicScene`)
    in the dialog's light or dark colours; a text alternative; never a value of the data or a
    result. **The map of the path**, under the question chosen in the rail: the questions
    answered with their answers (the table's counts marked), the next question, the method the
    path leads to; a step goes back to its question, and changing an answer now keeps the later
    answers that still apply (amends 51a); one tab stop, ↑ ↓ Home End and Enter. Placement:
    Guide me's third column from 860 px (340 / 280 px), a strip above the questions below
    (Hide); on All analyses the method's own schematic heads the side panel above the sketch (a
    one-tailed direction, the control, the correction follow the options), for 39 analyses.
    Also: the wide builder's variables guard (CPU time at two sizes) steps 15 → 120 variables
    with the fastest of 4 runs, bound 3 (a CI ratio of 2.24 was noise). `ANALYSES_VERSION`
    unchanged (1.6.1); goldens, fixtures and example fingerprints unchanged. Tests:
    `analyses/test/schematic.test.ts` (every step of every path on a table of each kind:
    well-formed, the user's names, no data value or statistic; the answers and the params
    agree; groups, measures, comparisons, links, grids and units, one-tailed arrows, the
    sentences; the map and `reanswer`; the import boundary), `graph/test/schematic.test.ts`
    (boxes, arcs in levels, heads, lines, links, headings, roles, themes, cut labels),
    `ui/test/schematicGoldens.test.ts` (15 SVGs pinned), `ui/test/guideDiagrams.test.tsx` (the
    dialog with both diagrams in happy-dom: step by step, every pair or each against the
    control, links, going back, the keyboard, after Use this with a one-tailed arrow, the narrow
    strip, the colours); Playwright **`guideDiagrams.spec.ts`** (new) in Chromium, WebKit and
    Firefox. Deferred: clicking a box in the schematic to set the control (the chips and Guide
    me's Control group do it).

Audit 4. ✅ **Code audit 4** — decisions 1341–1356, 1371–1388, 1401–1413, 1421–1438, 1446–1452.
    Six read-only reviews of everything since audit 3 (48–51f: statistics, UI state, graphs and
    the model, speed and memory, accessibility, security, tests and docs), 69 verified findings;
    the user took every recommendation: 67 fixed in five steps, the public repository's security
    settings turned on (private vulnerability reporting, Dependabot alerts and security updates,
    approval for all outside contributors), and the old Cloudflare Workers build left for the
    user to remove. **Step 1, what the results say**: rank comparisons name the higher group and
    the medians (no rank differences in the data's unit); summaries never take a direction or a
    verdict from a value that wasn't computed, and one-tailed results against the prediction say
    so in every template; the correlation summary counts the pairs the correction keeps;
    comparison captions give each family's size and the control the rows use; model comparisons
    apply the fitted model's constants to the compared one (an F test only when still nested,
    else AICc with a note), and give no verdict from a failed fit or an undefined statistic;
    the hazard ratio of the method shown; profile CIs unbounded where the profile never reaches
    its target (as R's `confint` gives NA); a constant parameter said as constant; alpha in
    multiple one-way ANOVAs; the schematic's corrections; Guide me asks "same subjects?" and
    about scatter for three or more groups at each row. New R cases: three-way repeated
    measures' Satterthwaite df, weighted and unbounded profile CIs, a constrained comparison.
    **Step 2, the Analyze dialog, Guide me and the pictures**: editing an analysis with input
    modifiers reads its data as it runs; a control left out of the groups, deleted data sets in
    Guide me's memory, factor names on result tables, duplicate results on graphs, an empty
    Apply; each curve-fit model keeps its own constraints and starting values; Guide me hides
    answers a change makes stale and gives them back; method history bounded and in words;
    result tables on graphs and pages without the summary sentence, as before 0.3.11; sketches
    and schematics bounded with many, long or non-Latin names; limits in the user-equation
    parser (a 14-character equation no longer hangs the app, deep nesting no longer crashes it).
    **Step 3, speed**: the Analyze dialog rests while nothing changes (it re-rendered every
    120 ms); global fits of more than 10 data sets profile their shared parameters only, with a
    note (40 curves 274 s → 2.9 s); the dialog's facts read once per input (choosing a variable
    on 250k rows 2.5 s → 0.8 s); sketches draw at most 4,000 values (Mann-Whitney on 2 × 100k:
    a 35 MB picture → 0.7 MB); a heat map's clustering cached; a zoomed point cloud's sharp
    image drawn in a worker (1M points: 1.3 s of main thread → 16 ms); the dialog's and the
    results' parts load with them (start-up bundle −265 KB); result tables show 500 rows, then
    Show all. **Step 4, keyboard and screen readers**: the sketch and schematic named; what
    blocks Analyze and new results announced; focus kept at 1024 px and after removing a role
    variable; Escape clears the search first; group chips by keyboard (C makes the control) and
    by name; heat-map tiles and dendrograms in the canvas' Tab order; dark-mode contrast; one
    name, "Edit parameters…"; the Analyze dialog's keys in Help; axe scans of the new screens.
    **Step 5, tests, docs and CI**: the Rust audit and the nightly three-browser run in the
    public repository too; Dependabot left out of the public copy, `pnpm audit` clean; CLAUDE.md,
    ARCHITECTURE.md and PUBLISHING.md describe the deploy as it is now (private CI off, the
    publish script and Netlify; versions tagged from the first release on); a docs-drift test;
    the affected-specs map for the sketch and schematic; the curve-fit graph-results test 65 s
    → 6 s; dead code; the vendor name guarded in the UI, Linux home paths, zip members and PNG
    text in the publish leak check. `ANALYSES_VERSION` 1.8.0; goldens changed only for three
    schematics (the row-factor name on its own line) and two new result-table goldens; example
    fingerprints unchanged.
