# Analysis guide: explanations, a guided chooser, a live sketch and safer statistics

Status: **approved 2026-10-12** (roadmap series 51). The user's answers to §10.4 are recorded
at the end of that section.

**Built so far — 51a (0.3.8, decisions 1276–1285; ROADMAP 51a):** §2 whole (the content model,
88 cards, the text of every field and option, the tests of §2.3; the text written by family and
attached at registration, decision 1277, and true of 0.3.8's defaults, decision 1278); §3.1–§3.7
(the facts, the trees with today's params, the Guide me tab in the current dialog widened to
min(1200 px, 94vw), the entry points, search by question across kinds, "Not here?") with the
deviations recorded in decisions 1279–1285 (the survival questions and a 2 × 2's roles wait for
51c's params; "Not sure" about scatter leads to Welch ANOVA; values that change by a factor lead
to Transform, then the test; S38's label waits for 51c); `origin.guide` of §10.1; U2, U3, U5.

**Built so far — 51c (0.3.9, decisions 1286–1301; ROADMAP 51c):** §6 whole — `paramsOf` and
pinning migrations (22 definitions at version 2), every row of §6.2's table that is 51c's, §6.3,
the oracle suites of §6.4 (`onetailed`, `kw_exact`, `rm_main_effects`, `survival_pairwise`,
`multiple_oneway_rows`, `correlation_family`, `power_pilot`, more `mixed`, `nested`, `multcomp`,
`friedman` cases; the contingency cases through the roles), `ANALYSES_VERSION` 1.5.0 — and §7.1–
§7.5 (the method history and its notice, brackets from one analysis with `input.byX`, uncorrected
marking, P labels naming their test, the duplicate-comparison badge). Deviations, recorded in the
decisions: what counts as a change of method is every field but a list of reporting ones (not a
`method: true` flag per field, 1296); the Kruskal-Wallis enumeration limit is 2 × 10⁷
arrangements (1289); BH, not BKY, is the default across multiple one-way ANOVAs' rows (the
answer to §10.4 question 4, 1293); new one- and two-way comparisons are later − earlier already
(1292); several 51d texts came with their version bump (S12's wording, S15, S41, S43, 1295). Left
for 51c-2: the stars' key label (§7.4), the power curve over a range of effects (S29). Still to
build: §4, §5, §8, §9 (51b, 51d, 51e). Written from `main` at
e363961 (0.3.7) and two private reviews of the analysis section (a statistics review, findings
S1–S44, and a usability review, findings U1–U29, with wireframes). Finding numbers below are
those reviews'. Decisions are numbered when each phase is built (the next free number is 1313).

**Built so far — 51b (0.3.10, decisions 1302–1312; ROADMAP 51b):** §4 whole but what is listed
below — the three panels with the layouts by the dialog's width (measured, not a container query,
1302), tiers and the experiment's words (§4.2's table; Brown-Forsythe stays the scatter
question's third answer, 1303), chips with the comparison (§4.3), the conditions of §4.4 (26 rows;
`INVALID_COMBINATIONS`, 1304), checks through one `validate` that `run` calls (§4.6; `where` is
asked of `validate` by the results view rather than stored in results, 1305), carried choices
(§4.5; an untouched default selection becomes the new method's, 1308), roles (§4.7, 1309),
keyboard and screen readers (§4.8) — and §5 for every family including §9.5's starting shape
(the user's answer to question 3): the sketch as data drawn by `@ps/graph`'s `sketchGraph`
(brackets and lines as plain data in the spec, 1310), the families of §5.2–§5.7 (1311), sampling
and the CPU guard (1312). Left: §4.4 row 22 (51e), the checks' fix buttons, Q-Q panels, the
control drawn emphasized and set by clicking the sketch, the one-tailed side shaded, the two-way
axis toggle and additive lines, PCA's correlation strip, the volcano preview's axes. Still to
build: §8, §9 (51d, 51e).

**Built so far — 51d (0.3.11, decisions 1313–1323; ROADMAP 51d):** §8 but what is listed
below — summary blocks and sentences for every statistical family (§8.2's table; stored after
the first sheet's blocks and shown first, 1313), the results' order with details collapsed and the
Method section's generated paragraph with the method history (§8.1, §7.2; 1314, 1321), the
comparisons tables' headers (§8.4; 1315), the user's names in labels with keys and the labels of
before 0.3.11 for references (§8.2; the legacy table in `@ps/model`, 1316), grouped tables'
factor names asked for in the Analyze dialog (1317), one sign convention — multiple t tests and
Bland-Altman later − earlier for new analyses, saved ones pinned (§8.3; 1318), names that follow
the method (§8.6; 1319), the effect plot of differences (§8.5; 1320), readable numbers and
accessible results (§8.6; 1322); `ANALYSES_VERSION` 1.6.0 (1323). Left: the effect plot opened as
a graph and its other families' plots (scatter with line, fitted curves, KM with medians, stacked
percent), factor names edited in the grid's header and used in two-way RM's and three-way's
tables, units in the results tables, the RM one-way template's "conditions" naming. Still to
build: §9 (51e).

Contents

1. [Goals, non-goals and principles](#1-goals-non-goals-and-principles)
2. [The explanation content model](#2-the-explanation-content-model)
3. [The guided chooser](#3-the-guided-chooser)
4. [The Analyze dialog](#4-the-analyze-dialog)
5. [The live data sketch](#5-the-live-data-sketch)
6. [Defaults and statistics changes (51c)](#6-defaults-and-statistics-changes-51c)
7. [Test-switching safeguards](#7-test-switching-safeguards)
8. [Results that explain themselves (51d)](#8-results-that-explain-themselves-51d)
9. [Curve fitting (51e)](#9-curve-fitting-51e)
10. [Data model changes, phase plan, risks and open questions](#10-data-model-changes-phase-plan-risks-and-open-questions)
11. [Appendix: every finding and where it is handled](#11-appendix-every-finding-and-where-it-is-handled)

---

## 1. Goals, non-goals and principles

### 1.1 Goals

- A lab scientist who knows the experiment but not the vocabulary can get from "I want to know
  whether the drug changed activity compared with vehicle" to the right analysis, set up
  correctly, without outside help (U1, U7).
- Every method and every option says, in plain words, what it asks and when to choose it; the
  formula and the R equivalent are one click deeper (S6, U27).
- While choosing, the user sees their own data in the shape the analysis will see it: which
  groups, which pairs, which comparisons, which values are left out (U6, U17).
- Defaults protect the error rate a reader assumes (Welch, stated one-tailed direction,
  corrected brackets, honest repeated measures), and switching tests after seeing P values is
  visible rather than effortless (S1–S5, S7, S9, U24).
- Results lead with the answer in a sentence, in the user's names, with the size and direction
  of the effect (U18–U22, U25).

### 1.2 Non-goals

- New statistical families. 51 adds options and corrections to existing analyses (exact
  Kruskal-Wallis P, pairwise log-rank, FDR across rows, Satterthwaite df as an option); it adds
  no new kind of analysis. McNemar's test, the lognormal option in the t test and one-way ANOVA
  (S44), Poisson extras (S40) and the Cox proportional-hazards check (S17) are later.
- Merging the two-group analyses into one "Compare two groups" analysis (S37, later): the
  chooser hides the split instead.
- Live results. JASP-style analyses that recompute as options change are deliberately not
  copied (§1.3).
- A "planned analysis" mode (pre-registration inside a project): mentioned by the usability
  review as optional and later; the method history (§7) is the step towards it.

### 1.3 Principles

1. **No live statistics.** Nothing that answers the question appears before the user presses
   Analyze: no P values, stars, "Significant?", confidence intervals of differences or effects,
   r, slopes, EC50s, "Preferred model". The sketch shows data and structure only (§5.8).
2. **Never auto-choose a test from a pre-test.** Normality and equal-SD tests never pick a
   method, in the chooser, the dialog or the results. The data's shape may be shown as
   information (a QQ plot, the ratio of the largest to the smallest SD) next to a question about
   the experiment; the user answers.
3. **Facts may answer counting questions, never design questions.** The chooser reads the table
   (number of groups, raw or summary values, 2×2 or larger, censoring codes) and skips questions
   those facts answer. Whether values are matched, scores or measurements, or whether scatter can
   differ, is always asked; the facts only add a hint ("every row has a value in each group:
   matching is possible").
4. **Saved analyses keep their stored options.** Every default change bumps the analysis'
   params `version` with a `migrateParams` that writes the old default into older nodes (§6.1):
   a saved Student's t test stays Student's, a saved bracket stays what it was, its numbers
   unchanged.
5. **Every number still comes from `@ps/stats` with R oracle fixtures.** New statistics (exact
   Kruskal-Wallis, pairwise log-rank, Dunn with Holm or Šidák, main-effect comparisons of a
   repeated factor without sphericity, FDR across rows and across correlation pairs) ship with
   oracle cases at rtol ≈ 1e-10 (§6.4). Summary sentences and the sketch only reuse numbers
   computed by oracle-checked functions.
6. **One source of words.** The chooser, the form, the results' "How to read this" and Help ›
   Choosing an analysis show the same text from the same place (§2), checked by tests.
7. **Decisions from the design, before the data.** Questions are phrased about the experiment
   ("were the same animals measured in every group?"), and results never suggest switching
   methods because of a P value ("Consider Welch's t test" goes, S2, S3, U15).
8. **The full list stays.** "All analyses" is always one click away; the chooser is a way in,
   not a gate.

---

## 2. The explanation content model

### 2.1 Where the text lives

All text lives in `@ps/analyses`, beside the definitions, typed by `@ps/model`'s plugin contract
(`model/src/analysis.ts`), so the UI, Help and tests read one source. Three levels:

| Level | Type | Where | Shown in |
| --- | --- | --- | --- |
| Method card | `MethodCard` | `analyses/src/explain/cards/*.ts` (one file per family), registry `METHOD_CARDS` | the dialog's side panel, the chooser's recommendation, results › How to read this, Help › Choosing an analysis |
| Field text | `FieldExplain` on `FormField.explain` | inline in each def's `form` | one line under the question; ⓘ opens the longer card |
| Option text | `OptionExplain` on each option | inline | one line under the option; tags with their reason |

Contract additions (`model/src/analysis.ts`; code, not the document):

```ts
/** A method's plain-language card (80–150 words in the first layer). */
export interface MethodCard {
  id: string                      // 'welchT', 'tukey', 'kruskalWallis'
  name: string                    // "Welch's t test": also used in result sentences and names
  shortName: string               // "Welch's t": graph labels
  question: string                // what it asks, one sentence
  nullHypothesis: string          // the null in words, and what P is
  useWhen: string                 // the situations it fits
  instead: { card: string; when: string }[]   // neighbours and when to prefer them
  assumptions: string[]           // in experiment terms; what the sketch can show
  reading: string                 // how to read the result
  more: { formula: string; r: string; notes?: string }   // behind "More": formula, R call
  references: { text: string; doi?: string }[]           // one to three
}

export interface FieldExplain {
  line: string                    // ≤ 90 characters, always visible under the question
  card?: string                   // ≤ 500 characters, in the side panel on ⓘ
}

export interface OptionExplain {
  line: string                    // ≤ 90 characters, under the option
  card?: string                   // ≤ 400 characters
  tag?: { kind: 'recommended' | 'notRecommended'; why: string }   // why ≤ 160 characters
  /** The method card this option selects (a test or a correction), if any. */
  method?: string
}
```

`FormField` gains `explain?: FieldExplain` and each option `explain?: OptionExplain`;
`AnalysisDef` gains `cards(params): string[]` (the cards of the method the params choose: the
test first, then its comparisons, e.g. `['oneWayAnova', 'tukey']`). The existing `help` strings
(nine of them) become `explain.line`. The tiers, conditions and sketch of §4–§5 add further
fields; §10.1 lists them all.

Explanations are code, not document data: they never enter a project file, and changing them
never changes results, `ANALYSES_VERSION` or the example fingerprints.

### 2.2 How the places share it

- **Chooser** (§3): a recommendation shows the card's `name`, a reason written for the answers
  given (the leaf's `reason`), "You will get" from the card's `reading`, and each alternative's
  `when` (from the leaf, defaulting to the card's `instead` entry for it).
- **Form** (§4): each Essentials question shows `explain.line` and each option its line; ⓘ puts
  the field's or option's `card` in the side panel; "About this method" puts the method cards of
  `def.cards(params)` there, updating as the options change (a pure function of params).
- **Results** (§8): "How to read this" (collapsed) is the cards' `reading` and `nullHypothesis`
  with the user's group names filled in (`{A}`, `{B}`, `{control}` placeholders), plus the
  comparisons header of §8.4.
- **Help › Choosing an analysis**: a page generated from the chooser trees (§3) and the cards,
  each leaf linking to its card; no hand-written copy to drift.
- **Search**: card names, the chooser's question texts and their keywords feed the dialog search
  (U3, §3.6).

### 2.3 Tests

`analyses/test/explain.test.ts`:

- Every analysis: `cards(params)` returns known card ids for every combination of its select and
  radio options reachable through `showIf` (enumerated from the form), so every reachable method
  has a card.
- Every form field has `explain.line`; every option of a radio or select has `explain.line`
  (checkboxes: the field's line); every `tag` has a non-empty `why`.
- Every card: all fields present; `instead[].card` resolve; `more.r` non-empty; one to three
  references.
- Length limits (characters): question 160, nullHypothesis 220, useWhen 320, each assumption
  160, reading 600, first layer (question … reading) 150 words; field line 90, option line 90,
  field card 500, option card 400, tag reason 160, chooser reason 200.
- Style lint (§2.4) as regular expressions: no Greek letters or formulas in first layers (allowed
  in `more`), no "column A"/"column B", no "not different"/"the same" after a P (must be "no
  evidence of"), "recommended" only with a reason, the spellings of §2.4.
- No product names: the repository's brand guard test (`ui/test/noBrand.test.ts`) reads every
  tracked file, so card text is covered without a new test.

### 2.4 Writing style

1. Second person, present tense, sentences of at most about 25 words. One idea per sentence.
2. Describe the experiment, not the table: "the same animals in every group", not "each row is
   matched"; "different animals in each group", not "unpaired columns".
3. Name groups by their titles (`{A}`, `{B}`, `{control}` in templates); never "column A".
4. P is "the chance of a difference at least this large if [the null in words]"; never "the
   probability that the null is true" or "the chance the result is due to chance".
5. A large P is "no evidence of a difference", never "no difference" or "the groups are the
   same"; point to the CI's width.
6. Rank tests ask whether values "tend to be larger"; "median" only for medians.
7. Every "recommended" carries its reason in the same line or card.
8. Plain words first, names second: "Each group with a control (Dunnett's test)".
9. Spellings: Šidák, Holm-Šidák, Geisser-Greenhouse, Kruskal-Wallis, Mann-Whitney,
   Hodges-Lehmann, Games-Howell, Dunnett's T3, Tamhane's T2, Benjamini, Krieger and Yekutieli,
   Kaplan-Meier, Gehan-Breslow-Wilcoxon, Bland-Altman (S33). The app's spelling otherwise
   (Analyze, colour).
10. No other program's name, and no "as other apps do": a convention is described by what it is
    ("the usual default for all pairs"), as roadmap 48b did for comments.

### 2.5 The compare-groups cards, as they ship

The shape of one card in code; the others below are given in the same fields as prose.

```ts
export const welchT: MethodCard = {
  id: 'welchT',
  name: 'Welch’s t test',
  shortName: 'Welch’s t',
  question: 'Do the two groups have the same mean?',
  nullHypothesis:
    'The two groups have the same mean. P is the chance of a difference at least this large if they did.',
  useWhen:
    'Two independent groups of measurements (different animals, wells or patients). The recommended default: it doesn’t assume both groups vary by the same amount, and loses almost nothing when they do.',
  instead: [
    { card: 'pairedT', when: 'each value in one group has a partner in the other (same animal, same plate)' },
    { card: 'studentT', when: 'equal scatter is known from the method, e.g. a validated assay' },
    { card: 'mannWhitney', when: 'the values are scores or ranks' },
  ],
  assumptions: [
    'Each value comes from a different subject.',
    'Each group is roughly symmetric around its mean; this matters less as groups grow.',
  ],
  reading:
    'The result is the difference between the means ({B} − {A}) with its 95% CI: the range of true differences compatible with your data. P < 0.05 and a CI that excludes 0 say the same thing. A large P is no evidence of a difference, not proof the groups are alike: look at the width of the CI. The df is usually not a whole number; that is expected.',
  more: {
    formula: 't = (mean B − mean A) / √(s_A²/n_A + s_B²/n_B); df by the Welch-Satterthwaite equation.',
    r: 't.test(B, A)   # Welch is R’s default',
  },
  references: [
    { text: 'Welch BL (1947) Biometrika 34:28–35' },
    { text: 'Ruxton GD (2006) Behavioral Ecology 17:688–690', doi: '10.1093/beheco/ark016' },
    { text: 'Delacre M, Lakens D, Leys C (2017) Int Rev Soc Psychol 30:92–101', doi: '10.5334/irsp.82' },
  ],
}
```

**Student's t test** (`studentT`)
- Question: Do the two groups have the same mean, assuming they vary by the same amount?
- Null: the two groups have the same mean; P is the chance of a difference at least this large if
  they did.
- Use it when: two independent groups and you have a reason to expect equal scatter, such as a
  validated assay whose variability doesn't depend on the treatment.
- Instead: Welch's t test when the scatter may differ (the safer default, especially with unequal
  group sizes); paired t test for matched values; Mann-Whitney for scores.
- Assumptions: independent values; each group roughly symmetric; equal SDs. With unequal SDs and
  unequal group sizes its P can be far too small or too large.
- Reading: as Welch's: the difference {B} − {A} and its CI first; df = n_A + n_B − 2.
- More: t = (mean B − mean A) / (s_pooled · √(1/n_A + 1/n_B)). R: `t.test(B, A, var.equal = TRUE)`.
- Reference: Student (1908) Biometrika 6:1–25.

**Paired t test** (`pairedT`, and **ratio paired t test**, `ratioPairedT`)
- Question: Is the average difference within pairs zero? (Ratio paired: is the average ratio
  within pairs 1?)
- Null: the mean of the differences {B} − {A} is 0 (ratio: the geometric mean of {B}/{A} is 1);
  P is the chance of an average difference at least this large if it were.
- Use it when: each value in one group has a partner in the same row: the same animal before and
  after, two treatments on the same culture, littermates, paired wells on one plate. Use the ratio
  version when the effect is proportional (each subject's value roughly doubles), as with
  concentrations and fold changes.
- Instead: Welch's t test if the rows are not linked; Wilcoxon matched pairs for scores or very
  skewed differences.
- Assumptions: the pairs are independent of each other; the differences (or their logarithms) are
  roughly symmetric. The two groups themselves need not be normal or equally variable. Ratio: all
  values positive.
- Reading: the mean difference with its CI (ratio: the geometric mean ratio with its CI). Pairing
  removes subject-to-subject variation, so the CI is usually narrower than unpaired. The design,
  not a test of the data, decides whether to pair. Rows with one value missing are left out.
- More: t = mean(d) / (SD(d)/√n), df = n − 1; ratio: the same on log10(B/A), CI back-transformed.
  R: `t.test(B, A, paired = TRUE)`; `t.test(log10(B), log10(A), paired = TRUE)`.
- Reference: Student (1908) Biometrika 6:1–25.

**Mann-Whitney test** (`mannWhitney`)
- Question: Do values in one group tend to be larger than in the other?
- Null: a value from {A} is as likely to be larger as smaller than a value from {B}; P is the
  chance of a rank difference at least this large if so.
- Use it when: two independent groups of scores or ranks (a 0–4 histology score), or values where
  the order matters more than the size.
- Instead: Welch's t test for measurements that are roughly symmetric (more power, and a
  difference in your units); a t test on log values for skewed concentrations.
- Assumptions: independent values. It compares medians only when both groups have the same shape.
- Reading: P, and the shift between groups (Hodges-Lehmann: the median of all differences
  {B} − {A}) with its CI. With very small groups the smallest possible P is large: 3 against 3
  can't reach a two-tailed P below 0.10, however different the groups are.
- More: U from the rank sums; exact P from all rearrangements when the groups are small (exact
  with ties too), else the normal approximation with continuity correction. R:
  `wilcox.test(B, A, conf.int = TRUE)`; exact with ties
  `coin::wilcox_test(y ~ g, distribution = "exact", conf.int = TRUE)`.
- References: Mann HB, Whitney DR (1947) Ann Math Stat 18:50–60; Hodges JL, Lehmann EL (1963)
  Ann Math Stat 34:598–611.

**Wilcoxon matched-pairs signed-rank test** (`wilcoxon`)
- Question: Are the differences within pairs centred on zero?
- Null: the differences {B} − {A} are symmetric around 0; P is the chance of signed ranks at least
  this unbalanced if they were.
- Use it when: paired data as for the paired t test, but the differences are scores or very
  skewed.
- Instead: paired t test for measurements with roughly symmetric differences; ratio paired t test
  for proportional effects.
- Assumptions: pairs independent of each other; differences symmetric around their median.
- Reading: P and the median of the differences (Hodges-Lehmann) with its CI. Pairs with a
  difference of exactly zero are dropped (Wilcoxon) or ranked (Pratt); with many zeros, prefer
  Pratt. With 5 pairs the smallest two-tailed P is 0.0625.
- More: W = the sum of the signed ranks of |differences|. R:
  `wilcox.test(B, A, paired = TRUE, conf.int = TRUE)`; Pratt
  `coin::wilcoxsign_test(B ~ A, zero.method = "Pratt")`.
- References: Wilcoxon F (1945) Biometrics Bulletin 1:80–83; Pratt JW (1959) JASA 54:655–667.

**One-way ANOVA** (`oneWayAnova`)
- Question: Do all the groups have the same mean? A small P says at least one differs, not which.
- Null: every group has the same mean; P is the chance of means at least this spread out if they
  did.
- Use it when: three or more independent groups of measurements, one factor (drug A, B, C,
  vehicle), similar scatter expected in each group.
- Instead: Welch ANOVA when a treatment can change how much values vary or group sizes differ a
  lot; repeated-measures ANOVA when the same subjects appear in every group; Kruskal-Wallis for
  scores; two-way ANOVA for two factors; nested ANOVA for several wells per animal.
- Assumptions: independent values; each group roughly symmetric; similar SDs.
- Reading: the overall F test answers "any difference?". The comparisons you chose (every pair:
  Tukey; each with a control: Dunnett) say which groups differ, adjusted for their number. They
  don't need the overall P below 0.05 first, and can disagree with it. R² is the share of all
  variation explained by the groups.
- More: F = between-group mean square / within-group mean square. R: `anova(lm(y ~ group))`.
- Reference: Fisher RA (1925) Statistical Methods for Research Workers.

**Welch ANOVA** (`welchAnova`; Brown-Forsythe ANOVA as its variant)
- Question: as one-way ANOVA: do all the groups have the same mean? Without assuming equal
  scatter.
- Null: every group has the same mean.
- Use it when: three or more independent groups whose scatter can differ (a treatment that makes
  some animals respond and others not), or whose sizes differ a lot.
- Instead: ordinary one-way ANOVA for balanced groups with similar scatter (comparisons by Tukey
  or Dunnett); Kruskal-Wallis for scores.
- Assumptions: independent values; each group roughly symmetric. At least two values and some
  variation in every group.
- Reading: as one-way ANOVA. Its comparisons don't assume equal scatter either: Dunnett's T3
  (recommended for fewer than about 50 values per group) or Games-Howell (larger groups).
  Brown-Forsythe ANOVA is a close alternative that is less affected by one very spread group.
- More: F* weights each group by n/s², df by Welch's approximation. R:
  `oneway.test(y ~ group, var.equal = FALSE)`.
- References: Welch BL (1951) Biometrika 38:330–336; Brown MB, Forsythe AB (1974) Technometrics
  16:129–132.

**Kruskal-Wallis test** (`kruskalWallis`)
- Question: Do values tend to be larger in some groups than in others?
- Null: all groups come from the same distribution; P is the chance of mean ranks at least this
  spread out if they did.
- Use it when: three or more independent groups of scores or ranks, or values you can't make
  symmetric (by taking logs, for instance).
- Instead: one-way or Welch ANOVA for measurements; ANOVA on log values for skewed
  concentrations; Friedman when subjects are matched.
- Assumptions: independent values. It compares medians only if the groups have the same shape.
- Reading: P; the mean rank of each group; Dunn's comparisons, which use the ranks of all groups
  together and are adjusted for their number. P is exact for small groups and approximate
  (chi-square) for larger ones; the result says which.
- More: H from the rank sums (tie-corrected); exact P by enumerating the arrangements of the
  ranks. R: `kruskal.test(y ~ group)` (approximate P); Dunn
  `dunn.test::dunn.test(y, group, method = "holm")`.
- References: Kruskal WH, Wallis WA (1952) JASA 47:583–621; Dunn OJ (1964) Technometrics
  6:241–252.

**Repeated-measures one-way ANOVA** (`rmOneWay`, with the mixed-effects model)
- Question: Does the mean change across conditions measured in the same subjects?
- Null: the condition means are equal; P is the chance of differences at least this large if
  they were.
- Use it when: every subject (animal, donor, culture, experiment day) has a value in every
  condition or at every time.
- Instead: ordinary ANOVA if each value is from a different subject; Friedman for scores; nested
  ANOVA for several technical replicates per subject in one condition; two-way repeated measures
  when there is also a between-subject factor.
- Assumptions: subjects independent of each other; roughly symmetric values; sphericity (the
  differences between any two conditions vary about equally). Time courses usually break
  sphericity (nearby times are more alike), so the Geisser-Greenhouse correction is the
  recommended default: it lowers the df to keep P honest.
- Reading: P for the conditions; ε near 1 means sphericity holds, near its minimum 1/(k − 1) it
  is badly broken. When values are missing, a mixed-effects model is fit instead: it uses every
  value (instead of dropping the subject) but assumes equal correlation between all conditions,
  and the Geisser-Greenhouse correction doesn't apply; the result says so.
- More: F = condition mean square / (condition × subject) mean square, df × ε. Mixed: REML with a
  random subject intercept, Satterthwaite df. R: `afex::aov_ez("subject", "y", d, within =
  "condition")`; `anova(lmerTest::lmer(y ~ condition + (1 | subject)), ddf = "Satterthwaite")`.
- References: Geisser S, Greenhouse SW (1958) Ann Math Stat 29:885–891; Satterthwaite FE (1946)
  Biometrics Bulletin 2:110–114.

**Friedman test** (`friedman`)
- Question: Within subjects, do values tend to be larger in some conditions than in others?
- Null: within each subject, every ordering of the conditions is equally likely.
- Use it when: matched subjects (as repeated measures) with scores or ranks.
- Instead: repeated-measures ANOVA for measurements.
- Assumptions: subjects independent of each other; values ranked within each subject.
- Reading: P (exact for small designs); the rank sum of each condition; Dunn's comparisons
  adjusted for their number.
- More: ranks 1…k within each subject, a chi-square statistic from the rank sums. R:
  `friedman.test(y ~ condition | subject)`.
- Reference: Friedman M (1937) JASA 32:675–701.

**Multiple comparisons** (cards `tukey`, `dunnett`, `sidak`, `holmSidak`, `bonferroni`, `fdr`,
`gamesHowell`, `dunnettT3`, `dunn`, `fisherLsd`, `newmanKeuls`). Every one opens with the same
sentence: "Each extra comparison is another chance of a false positive. These methods keep the
chance of any false positive among the family (or the share of false discoveries) at the level
you choose." The family sentence: "A family is the set of comparisons adjusted together."

| Card | Question / plain description | Use it when | Reading | R |
| --- | --- | --- | --- | --- |
| Tukey | Every pair of group means, with P values and CIs adjusted for all pairs. | You want every pairwise comparison (the usual default for all pairs). | Adjusted P and simultaneous 95% CIs: together they cover all true differences 95% of the time. | `TukeyHSD(aov(y ~ group))` |
| Dunnett | Each group against one control; more power than Tukey for that question, because it makes fewer comparisons. | One control, and only comparisons with it matter. | Adjusted P and CIs of each group − control. | `summary(multcomp::glht(aov(y ~ group), multcomp::mcp(group = "Dunnett")))` |
| Šidák | Splits the error rate among the comparisons you planned; slightly more power than Bonferroni. | A few planned comparisons, not all pairs (two-way ANOVA within rows with few columns). | Adjusted P = 1 − (1 − p)^m and matching CIs. | `1 - (1 - p)^m` |
| Holm-Šidák | Step-down: tests the smallest P first and relaxes for the rest; more power than Šidák. | You need yes/no decisions, not intervals. | Adjusted P only: step-down methods have no CIs. | step-down Šidák; `p.adjust(p, "holm")` is its Bonferroni form |
| Bonferroni | Multiplies each P by the number of comparisons; simple and conservative. | Few comparisons, or comparisons that share data in ways others don't model (pairs of rows of a contingency table). | Adjusted P = min(1, m·p) and CIs at 1 − α/m. | `p.adjust(p, "bonferroni")` |
| FDR (two-stage Benjamini, Krieger and Yekutieli; Benjamini-Hochberg) | Controls the expected share of false discoveries among the comparisons called discoveries. | Screening many rows (genes, proteins), with follow-up to confirm. | q values: "of the discoveries, about Q% are expected to be false". BH is the most widely used; the two-stage method has more power with the same guarantee. | `p.adjust(p, "BH")`; two-stage as in the oracle's `padjust.R` |
| Games-Howell / Dunnett's T3 / Tamhane's T2 | Pairwise comparisons that don't assume equal scatter (after Welch ANOVA). | Scatter differs between groups; T3 for small groups, Games-Howell for larger ones. | Adjusted P and CIs. | `PMCMRplus::gamesHowellTest`, `PMCMRplus::dunnettT3Test` |
| Dunn | Rank comparisons after Kruskal-Wallis or Friedman, using every group's ranks. | Nonparametric analyses; adjusted by Holm (recommended), Šidák or Bonferroni. | Adjusted P; no CIs. | `dunn.test::dunn.test(y, g, method = "holm")` |
| Fisher's LSD (under "Other") | No adjustment. | One planned comparison, after an overall F test. | Unadjusted P: with several comparisons the chance of a false positive grows. | `pairwise.t.test(y, g, p.adjust.method = "none")` |
| Newman-Keuls (under "Other", not recommended) | A stepwise range test that doesn't control the chance of any false positive. | Reproducing an older analysis. | Significant or not; no P values or CIs. | step-down studentized range (`ptukey`), written out in the oracle's `newman_keuls.R` |

References for the table: Tukey JW (1953, unpublished; Kramer CY 1956 Biometrics 12:307–310);
Dunnett CW (1955) JASA 50:1096–1121; Šidák Z (1967) JASA 62:626–633; Holm S (1979) Scand J Stat
6:65–70; Benjamini Y, Hochberg Y (1995) JRSS B 57:289–300; Benjamini Y, Krieger AM, Yekutieli D
(2006) Biometrika 93:491–507; Games PA, Howell JF (1976) J Educ Stat 1:113–125; Dunnett CW (1980)
JASA 75:796–800.

The other families' cards (two-way, nested, multiple t tests, correlation, regression, nonlinear
fits, contingency, survival, descriptive, normality, outliers, ROC, Bland-Altman, PCA, power) are
written in 51a from the statistics review's drafts and outline table, under the same fields and
tests.

### 2.6 Option text, an example (the t test after 51c)

| Field | Field line | Options (line; tag) |
| --- | --- | --- |
| Same subjects in both groups? (`design`) | "Pairing is decided by how the experiment was done, not by the data." | Different subjects in each group (unpaired). Yes: each row is one subject, plate or day (paired); "Each row's two values are compared with each other." |
| Can the groups vary by different amounts? (`unpaired.assumeEqualSD`) | "A treatment often changes how much values vary, not only their mean." | Yes, or not sure: Welch's t test; recommended: "protects P when scatter differs and costs almost nothing when it doesn't". No, equal scatter is known: Student's t test; "only with a reason, e.g. a validated assay". |
| Is the change a difference or a ratio? (`paired.measure`) | "Concentrations and fold changes usually change by a factor." | A difference (paired t test). A ratio: each subject's value is multiplied (ratio paired t test). |
| P value (`tails`, Advanced) | "Two-tailed asks whether the groups differ in either direction." | Two-tailed; recommended: "the right choice unless you stated a direction before the experiment". One-tailed, in the direction you predicted before the experiment (§6.3). |

---

## 3. The guided chooser

### 3.1 Flow

1. **Facts.** `tableFacts(table, selection)` (`analyses/src/guide/facts.ts`, pure) describes the
   table's shape; nothing inferential:

   ```ts
   interface TableFacts {
     kind: TableKind
     groups: { key: string; title: string; n: number }[]   // selected data sets, values each
     raw: boolean                 // every group holds raw values (not mean/SD/N)
     completeRows: number         // rows with a value in every selected group (pairing possible)
     allPositive: boolean
     spanRatio: number            // max/min of the positive values
     wholeNumbers: boolean        // integers ≥ 0 only
     distinctValues: number       // few (≤ 7) suggests scores
     replicates: number           // grouped/XY: subcolumns per cell
     rows: number
     x?: { min: number; max: number; looksLog: boolean; looksConcentration: boolean; hasZero: boolean }
     contingency?: { rows: number; columns: number; minExpected: number }
     survival?: { codes: number[] }
     variables?: { numbers: string[]; texts: string[]; binary: string[] }   // multiple variables
   }
   ```

2. **Question.** The rail lists questions for the table kind (§3.4); "Not here?" lists the
   questions that need another table kind.
3. **Follow-ups.** One to four questions in experiment language, each with a one-line why and,
   where the facts allow, a hint (never a preselected answer to a design question, §1.3 item 3).
   Counting questions the facts answer are shown as facts ("Your table: 3 groups, 8 values each,
   raw values").
4. **Recommendation.** A card: the method's name, a reason written for these answers, "You will
   get", up to two alternatives each with "choose this when", and the method line ("one-way
   ANOVA · Tukey · 95% CI · two-tailed"). **Use this** fills the form with the leaf's params
   (switching to the options view with the chooser's answers kept); **Show all analyses** opens
   the full list. The chooser writes params; it never runs anything.
5. **Remembered.** Answers are kept per table for the session (view state, not the document); the
   analysis node records that it came from the chooser (`origin`, §10.1), shown under Method in
   its results.

### 3.2 The tree as data

`analyses/src/guide/` holds one file per goal (`compareGroups.ts`, `relationships.ts`,
`curves.ts`, `counts.ts`, `survival.ts`, `describe.ts`, `explore.ts`, `plan.ts`) and an index of
entries by table kind:

```ts
interface GuideEntry {
  id: string                       // 'groupsDiffer'
  question: string                 // "Are the groups different?"
  kinds: TableKind[]               // where it is offered; elsewhere listed under "Not here?"
  keywords: string[]               // search: "compare groups", "anova", "significant difference"
  start: GuideStep
}
type GuideStep = GuideQuestion | GuideLeaf | GuideElsewhere
interface GuideQuestion {
  kind: 'question'
  id: string                       // answers are recorded by question id
  text: string                     // "Were the same animals or samples measured in every group?"
  why: string                      // one line
  hint?: (f: TableFacts) => string | null      // information only
  answeredBy?: (f: TableFacts) => string | null // counting questions only: the answer id, else ask
  answers: { id: string; text: string; explain?: string;
             unavailable?: (f: TableFacts) => string | null   // reason it can't apply
             next: GuideStep }[]
}
interface GuideLeaf {
  kind: 'leaf'
  analysisId: string
  params: (f: TableFacts, a: Answers) => Record<string, unknown>   // parsed by def.params
  selection?: (f: TableFacts, a: Answers) => string[]              // data set order (control first)
  reason: string                   // ≤ 200 chars, placeholders {groups}, {control}, {k}
  alternatives: { analysisId: string; params: …; when: string }[]  // at most two
}
interface GuideElsewhere {
  kind: 'elsewhere'
  needs: TableKind
  text: string                     // "Curve fits need an XY table (X = concentration)."
  action: 'newTable' | 'variablesToSurvival' | 'transformThen'     // what the button does
}
```

Unit-tested (`analyses/test/guide.test.ts`): every path through every tree ends in a leaf or an
elsewhere step; every leaf's params parse with its def's schema and pass its `check` (§4.6) on a
fixture table of each offered kind; every leaf's analysis accepts the kinds of its entry; every
answer reachable; reasons within length; `hint` and `answeredBy` see `TableFacts` only (the type
admits no results). A snapshot lists every leaf with its params, so a change to the tree is a
reviewed diff.

### 3.3 Entry points

- **Analyze dialog**, tab **Guide me** beside **All analyses**; the dialog opens on the tab last
  used in this project (first time: Guide me), and All analyses opens on the last analysis used
  for this table kind (U2). Each analysis is listed once; Common is a pinned marker, not a
  duplicate row.
- **Empty results**: a new table's first visit to the navigator's Results, and a table with no
  analyses, show "What do you want to know about “Dose response”?" with the kind's top three
  questions as buttons opening the chooser there.
- **From a selection**: selected columns on a table, right-click › Compare these columns…; on a
  graph, two or more data sets selected › Compare…: the chooser opens with those groups chosen
  and in that order.
- **Menu**: Analyze › Guide me…, All analyses…, the recent analyses, then categories as submenus
  (the three quick lists agree, U5). The getting-started checklist's "run an analysis" step opens
  Guide me.
- **Search** in the dialog and the command palette (§3.6).

### 3.4 The rail, by table kind

| Kind | Questions (in this order) |
| --- | --- |
| Column | Are the groups different? · Is each group different from a control? · Is there a trend across ordered groups? · Is the average different from a set value? · Describe each group · Is it normal, and are there odd values? · Do two columns go up and down together? · Do two methods agree? · Can this measurement tell patients from controls? · Do the whole distributions differ? |
| Grouped | How do two factors affect the response (and do they interact)? · A time course in the same subjects · Compare two groups at each row (many genes) · Compare three or more groups at each row · Three factors (2 × 2 × k) · Describe each row |
| XY | Fit a dose-response curve (EC50 / IC50) · Read unknowns off a standard curve · Fit another curve (binding, kinetics, decay) · Is there a straight-line relation? · Compare slopes or curves · Do X and Y go up together? · Yes/no outcome against X · Area under the curve · Smooth the points |
| Contingency | Is the outcome related to the group? · Is there a trend across ordered groups? · How good is a diagnostic test? |
| Survival | Do the survival curves differ? · Median survival in each group |
| Parts of whole | Do the counts match expected proportions? · What fraction is each part? |
| Multiple variables | Predict an outcome from several variables · Which factors affect the response? · Summarize many variables (PCA) · Time to event with covariates · Kaplan-Meier from one row per subject · Fit a curve per group |
| Nested | Are the groups different (several measurements per subject)? |
| Every kind, "Not here?" | the questions of the other kinds that this table can't answer, each with what it needs and a button (§3.7) |

### 3.5 The trees

Notation: `Q` a question (answers indented), `→` a leaf: analysis id {params}; "reason"; Also: the
alternatives. Params are written in full where they matter; the leaf's function also sets the
selection order (control first) and the confidence level the dialog last used. `n̄` is the mean
group size, `ratio` = largest n / smallest n.

#### Compare groups (column and nested tables)

```
Are the groups different?            (Is each group different from a control? = the same tree,
                                      with "Which comparisons?" answered "each with a control")
Q How many groups?                   answeredBy facts (selected data sets; 1 → "Is the average
  │                                  different from a set value?")
  ├─ 2
  │  Q Were the same subjects measured in both groups?
  │    hint: "Every row has a value in both groups: pairing is possible" (completeRows = n)
  │    ├─ No, different subjects in each group
  │    │  Q What kind of values?   hint: "Values are whole numbers from 0 to 4: they look like scores"
  │    │    ├─ Measurements (activity, area, concentration of one analyte)
  │    │    │  Q Can the groups vary by different amounts?
  │    │    │    ├─ Yes, or not sure
  │    │    │    │  → ttest {design:'unpaired', unpaired:{assumeEqualSD:false}}
  │    │    │    │    "Welch's t test compares two means without assuming the groups vary
  │    │    │    │     equally; it loses almost nothing when they do."
  │    │    │    │    Also: Mann-Whitney (scores or clear outliers you can't explain)
  │    │    │    └─ No, equal scatter is known from the method
  │    │    │       → ttest {design:'unpaired', unpaired:{assumeEqualSD:true}}
  │    │    │         "Student's t test pools the two SDs, as your method's scatter is known
  │    │    │          to be constant."   Also: Welch's t test
  │    │    ├─ Measurements that change by a factor (concentrations spanning orders of
  │    │    │  magnitude, fold changes, cell counts)   hint when spanRatio ≥ 100
  │    │    │  → elsewhere (transformThen): Transform › Y = log10(Y), then
  │    │    │    ttest {design:'unpaired', unpaired:{assumeEqualSD:false}} on its result
  │    │    │    "On a log scale the difference becomes a ratio you can report (B is 2.3 times
  │    │    │     A)."   Also: Mann-Whitney
  │    │    │    (one click makes both analyses; S44's lognormal option replaces this later)
  │    │    ├─ Scores or ranks (0–4 histology score, a rating)
  │    │    │  → mannWhitney {pMethod:'exactWhenPossible'}
  │    │    │    "Compares whether values in one group tend to be larger, using only their
  │    │    │     order."
  │    │    └─ I want to know whether the whole distributions differ (shape, not only level)
  │    │       → kolmogorovSmirnov {}
  │    │         "Tests any difference between the two distributions; it has little power for
  │    │          a simple shift."   Also: Mann-Whitney
  │    └─ Yes, each row is one subject, plate or day
  │       unavailable unless raw: "Pairing needs the raw values, not mean/SD/N."
  │       Q What kind of values?
  │         ├─ Measurements → ttest {design:'paired', paired:{measure:'difference'}}
  │         │    "Each pair's difference removes subject-to-subject variation."
  │         │    Also: ratio paired t test; Wilcoxon matched pairs
  │         ├─ Measurements that change by a factor
  │         │    unavailable unless allPositive: "Ratios need positive values."
  │         │  → ttest {design:'paired', paired:{measure:'ratio'}}
  │         │    "When each subject's value is multiplied (×2), compare ratios, not differences."
  │         └─ Scores or ranks → wilcoxon {pMethod:'exactWhenPossible', zeros:'wilcoxon'}
  │              "Uses the signs and ranks of each pair's difference."
  │              Also: paired t test (measurements)
  └─ 3 or more
     Q Were the same subjects measured in every group?
       ├─ No
       │  Q What kind of values?
       │    ├─ Measurements
       │    │  Q Could a treatment change how much values vary, or do group sizes differ a lot?
       │    │    hint: "Group sizes: 8, 8, 5" (sizes are design, not a test of the data)
       │    │    ├─ Yes → oneWayAnova {matched:false, gaussian:true, equalSD:'welch',
       │    │    │          welchMethod: n̄ < 50 ? 'dunnett-t3' : 'games-howell', …comparisons}
       │    │    │   "Welch ANOVA and its comparisons don't assume equal scatter."
       │    │    │   Also: ordinary ANOVA
       │    │    ├─ No, similar scatter expected → oneWayAnova {matched:false, gaussian:true,
       │    │    │          equalSD:'yes', allPairsMethod:'tukey', controlMethod:'dunnett', …}
       │    │    │   "One test for all groups, then comparisons adjusted for their number."
       │    │    │   Also: Welch ANOVA
       │    │    └─ Not sure → as Yes when ratio ≥ 1.5, else as No; the reason says which and why
       │    ├─ Measurements that change by a factor → Transform log10, then as Measurements
       │    └─ Scores or ranks → oneWayAnova {gaussian:false, kwPMethod:'exactWhenPossible',
       │                          dunnMethod:'holm', …comparisons}
       │         "Rank comparison of several groups; Dunn's test says which pairs differ."
       └─ Yes, each row is one subject (unavailable unless raw)
          Q What kind of values?
            ├─ Measurements → oneWayAnova {matched:true, gaussian:true, sphericity:'gg',
            │                  rmMethod:'auto', ddf:'satterthwaite', …comparisons}
            │    "Each subject is its own control; the Geisser-Greenhouse correction keeps P
            │     honest when conditions correlate unequally (time courses)."
            │    Also: Friedman (scores)
            └─ Scores or ranks → oneWayAnova {matched:true, gaussian:false, …comparisons}
                 "Friedman's test ranks each subject's values." (runs `friedman`)
     Q Which comparisons answer your question?        (3 or more groups only)
       ├─ Every pair of groups ({m} comparisons) → comparisons:'allPairs'
       ├─ Each group with a control [chips: pick the control] → comparisons:'vsControl',
       │    control: chosen key (selection reordered control first)
       ├─ A steady rise or fall across the groups in their order
       │    unavailable when matched, scores or Welch: "The trend test follows ordinary ANOVA."
       │    → comparisons:'trend'
       └─ Only whether any group differs → comparisons:'none'

Several measurements per subject? (nested tables: the entry "Are the groups different
(several measurements per subject)?")
Q How many groups? answeredBy facts
  ├─ 2 → nestedT {ddf:'satterthwaite'}
  │    "Your independent units are the subjects, not the wells; this test counts them
  │     correctly."   Also: average each subject's replicates, then Welch's t test
  └─ 3+ → nestedOneWay {comparisons as above}

Is the average different from a set value?
Q What value do you compare with? [number box; hint "100 for % of control, 1 for a ratio"]
Q What kind of values? Measurements → oneSample {test:'t', hypothetical}
                       Scores → oneSample {test:'wilcoxon', hypothetical}
  "Tests whether the mean differs from the value you expect."
  When one group was normalized to exactly 100 (or 1): "Compare the other groups with 100 here,
  rather than testing the control, which has no variation" (S20).

Do the whole distributions differ? → kolmogorovSmirnov (as above)
```

Grouped tables:

```
How do two factors affect the response (and do they interact)?
  facts name the factors: rows = {rowFactor} (row titles), columns = {colFactor} (data sets)
Q Were the same subjects measured across one of the factors?
  ├─ No, a different subject in every cell → repeated:'none'
  ├─ Yes, across {colFactor}: subject i is replicate i of every column → repeated:'columns'
  ├─ Yes, across {rowFactor} (a time course down the rows) → repeated:'rows'
  └─ Both → repeated:'both'
Q Which comparisons answer your question?
  ├─ Within each {rowFactor}, compare {colFactor}s (simple effects) → comparisons:'withinRows'
  ├─ Within each {colFactor}, compare {rowFactor}s → comparisons:'withinColumns'
  ├─ Every cell with every other (unavailable with repeated measures) → 'allCells'
  ├─ {colFactor} overall, averaged over {rowFactor} (only if you expect no interaction) →
  │    'mainColumns'
  └─ Only the overall effects → 'none'
Q (for within/main) Every pair, or each with a control? → kind
→ twoWayAnova {repeated, comparisons, kind, family:'perBlock', allPairsMethod:'sidak',
               controlMethod:'dunnett', interaction:true, rmMethod:'auto', ddf:'satterthwaite'}
  "Tests each factor and whether one changes the effect of the other; comparisons within each
   {rowFactor} are adjusted for that row's {m} comparisons (Šidák)."
  Also: multifactor ANOVA (a variables table, more factors)

A time course in the same subjects
Q Which factor is time?  hint: "Row titles are numbers (0, 1, 2, 4 h): rows look like time"
Q Is there a second factor (treatment groups)? → as above with repeated on the time factor
  "Each subject's values over time are linked; Geisser-Greenhouse protects P because nearby
   times are more alike."

Compare two groups at each row (genes, proteins)
Q Same subjects in both groups? → design
Q What kind of values? Measurements / change by a factor / scores
  → multipleT {design, distribution:'gaussian'|'lognormal'|'nonparametric', variance:'welch',
               approach:'fdr', fdrMethod:'bky', q:5}
  "One test per row, with a false discovery rate so that most discoveries are real."
  Also: two-way ANOVA (when the rows are levels of a factor you care about)
Compare three or more groups at each row
  → multipleOneWay {…, approach:'fdr', fdrMethod:'bky', q:5} (FDR across rows, S9)
Three factors (2 × 2 × k) → threeWayAnova (4 data sets; else elsewhere: multifactor ANOVA)
```

#### Relationships and regression

```
Is there a straight-line relation? (XY)       Do X and Y go up together? (XY, column)
Q Did you set X (dose, time, concentration of a standard), or measure both?
  ├─ I set X
  │  Q Are the replicates at each X independent experiments, or repeated measurements of one
  │    sample (technical replicates)?     (asked only when replicates > 1)
  │    ├─ Independent → linearRegression {replicates:'each'}
  │    └─ Technical   → linearRegression {replicates:'mean'}
  │    "The line that best predicts Y from X, and whether its slope differs from zero."
  │    Also: nonlinear regression (a curve), correlation (association only)
  └─ Both measured
     Q What do you want to know?
       ├─ How strongly they are associated
       │  Q What kind of relation? Straight, roughly symmetric scatter → correlation
       │    {method:'pearson'}; Rising or falling but curved, ranks, or outliers → {method:'spearman'}
       │    "r measures how closely the points follow a line (Spearman: a monotone trend)."
       │    Also: Bland-Altman (agreement is not correlation)
       └─ Whether two methods agree → blandAltman {difference:'bMinusA'}
            "Bias and limits of agreement in your units."   Also: Deming regression (the line)
Compare slopes or curves (XY, ≥ 2 data sets)
Q Straight lines or curves?
  ├─ Lines → linearRegression {compare:true}
  │    "Tests whether the slopes differ; intercepts are compared only if the slopes don't."
  └─ Curves → curve fitting tree with "compare a parameter between data sets"
Yes/no outcome against X → simpleLogistic {ciMethod:'profile'}
Smooth the points → fitSpline (no statistics)
Area under the curve → areaUnderCurve
Predict an outcome from several variables (multiple variables)
Q What is the outcome? [role: one variable]
Q What kind of outcome? (answeredBy the variable's type where clear: 0/1 → yes/no)
  ├─ A measurement → multipleRegression
  ├─ Yes/no → logisticRegression {ciMethod:'profile'}
  ├─ A count (colonies, events) → poissonRegression
  └─ Time to an event → coxRegression {ties:'efron', ciMethod:'profile'}
Q Which variables predict it? [role: predictors; categorical ones marked]
```

#### Curves (XY)

```
Fit a dose-response curve (EC50 / IC50)
Q Does the response rise or fall with dose?
  hint: "The response falls from 98 to 4 as X increases" (descriptive)
  ├─ Rises (agonist, EC50) │ Falls (inhibitor, IC50)
Q Is X the dose (concentration) or log(dose)?
  hint (S8): "X runs from −10 to −5: it looks like log molar" / "X runs from 1e-10 to 1e-5,
  spanning 5 orders of magnitude: it looks like concentrations"
  ├─ log(dose) → log(agonist|inhibitor) vs. response models
  └─ dose → the "X is concentration" forms of the same models (not a transform)
     (X = 0 rows: kept by the concentration form; the log form says it leaves them out)
Q Were the responses normalized to 0–100% with defined controls?
  ├─ Yes → the normalized form (Top = 100, Bottom = 0 fixed)
  └─ No → four parameters (Top, Bottom fitted)
Q Do you expect the standard slope (Hill slope 1)?
  ├─ Not necessarily → variable slope (recommended: "four parameters: top, bottom, EC50 and
  │    steepness")
  └─ Yes, a reason to fix it → standard slope (three parameters)
Q Compare EC50s between data sets?   (≥ 2 data sets)
  ├─ Yes → compareParams:['LogEC50'] (or LogIC50) and Q How will you decide? F test (the models
  │    are nested; recommended) | AICc → compareBy
  └─ No
Q Replicates at each X: independent experiments or technical repeats? → replicates
→ nonlinearFit {equation:<that model's id>, replicates, compareParams, compareBy,
                ciMethod:'profile', outliers:'none'}
  e.g. "log(inhibitor) vs. response, variable slope (four parameters): your X is log
  concentration and the response falls; the parameters are top, bottom, IC50 and steepness.
  If the curve doesn't reach the bottom, fix Bottom = 0."
  Also: the standard-slope model; the normalized model

Read unknowns off a standard curve
Q Is the standard curve straight?
  ├─ Yes → linearRegression {interpolate:true}
  └─ No, it flattens at the ends → nonlinearFit {equation:<sigmoidal 4PL, X is concentration>,
       interpolate:true}   Also: the 5PL (asymmetric), a second-order polynomial
Fit another curve
Q What kind of experiment?
  Binding (saturation) → one site, specific binding | total and nonspecific
  Binding (competition) → one site, fit log IC50 | fit Ki
  Binding kinetics → association | dissociation
  Enzyme kinetics → Michaelis-Menten | substrate inhibition | an inhibitor's mode
  Decay or growth → one-phase decay | exponential growth | logistic growth
  Peaks → Gaussian | sine
  Other → my own equation | all equations
→ nonlinearFit {equation} (§9.1 lists each goal's models)
```

#### Counts and proportions (contingency, parts of whole)

```
Is the outcome related to the group?
Q Were the same subjects counted twice (before and after, paired yes/no)?
  └─ Yes → elsewhere: "Paired yes/no data need McNemar's test, which isn't available yet."
Q (2 × 2 tables, answeredBy facts) What do you want to report?
  ├─ The risk in each group (a trial or cohort) → relative risk and difference
  └─ The odds (a case-control study) → odds ratio
  then the roles: [chips] Which row is the treated or exposed group? Which column is the
  outcome? ("Relative risk = risk of Died in Treated ÷ risk of Died in Control", S22)
  → contingency {test:'fisher', trend:false, riskEstimates, oddsRatio, exposedRow,
                 outcomeColumn}
    "Fisher's exact test is exact for any sample size; report the relative risk with its CI."
    Also: logistic regression (to adjust for other factors)
Q (larger tables) Are the rows in a meaningful order (doses, ages)?
  ├─ Yes, and the outcome has two columns → contingency {test:'chiSquare', trend:true}
  │    "Tests a steady change in the proportion across ordered groups."
  └─ No
     → contingency {test: minExpected ≥ 5 ? 'chiSquare' : 'fisher', trend:false}
       "Chi-square works when every expected count is at least 5; otherwise Fisher's exact."
       (minExpected is a count of the design, not a test of association)
Q Do you want to know which groups differ? → pairwise:'all'|'control',
  pairwiseMethod:'bonferroni' ("the pairs share rows; Bonferroni is safe")
How good is a diagnostic test?
Q Is the test a yes/no result or a measurement?
  ├─ Yes/no (a 2 × 2 of test against truth) → contingency {diagnostic:true}
  └─ A measurement → elsewhere: ROC on a column table (patients, controls)
Do the counts match expected proportions? (parts of whole, column)
→ goodnessOfFit {expected as percentages; two categories: binomial}
  "Compares your counts with the proportions you expect, e.g. 3 : 1."
Counts per sample (colonies, events) → elsewhere: Poisson regression (multiple variables)
```

#### Survival

```
Do the survival curves differ?
Q How many groups? answeredBy facts
Q (≥ 3) Are the groups ordered (doses)?
  ├─ Yes → trend:true ("tests a steady change with dose")
  └─ No → Q Do you want to know which groups differ? → pairwise:'all'|'control',
           pairwiseMethod:'holm'
Q Which matters most?
  ├─ The whole follow-up (recommended) → test:'logRank'
  └─ Early differences → test:'gehanBreslowWilcoxon' ("gives more weight to early deaths")
Q Which group is the reference for the hazard ratio? [chips] → control
→ survival {test, trend, pairwise, pairwiseMethod, control, hazardRatio:'mantelHaenszel'}
  "Kaplan-Meier shows the curves; the log-rank test compares them over the whole follow-up."
  Also: Cox regression (adjusting for covariates; a variables table)
Median survival in each group → survival (same params; the summary leads with the medians)
Time to event with covariates (multiple variables) → coxRegression
Kaplan-Meier from one row per subject → survivalFromVariables (same questions)
```

#### Describe, check, explore, plan (outline)

| Question | Leaf | Reason |
| --- | --- | --- |
| Describe each group | `descriptive` (quartiles, CI of the mean) | "Mean, SD, SEM, median and the CI of the mean for each group." |
| Is it normal, and are there odd values? | `normality` {shapiroWilk only, qqPlot:true}; `identifyOutliers` {ROUT, Q = 1%} | "The QQ plot shows how values depart from normal; with few values the test has little power. Remove a value only with a known cause." |
| Histogram | `frequencyDistribution` | — |
| Summarize many variables | `pca` {standardize, parallel analysis}; roles: variables, group by | "Finds the combinations of variables that explain most variation." |
| Do two methods agree? | `blandAltman` (+ `deming`) | "Bias and limits of agreement in your units." |
| Can this measurement tell patients from controls? | `roc` {direction asked: higher or lower in patients} | "How well the value separates the groups at every cutoff." |
| Plan an experiment | `powerAnalysis` | "Uses the smallest difference that matters biologically, not a pilot's estimate." |

### 3.6 Search by question

The dialog search matches, across **every** table kind (U3): analysis titles, the existing
keywords (`analysisSearch.ts`), card names, the chooser's questions and their keywords
("compare groups", "before and after", "same animals", "time course", "dose response", "ic50",
"survival", "significant difference"). Words match in any order and by prefix ("surv",
"dose resp"). Results are grouped: **Questions** (open the chooser there), **Analyses for this
table**, **Need another table kind** (greyed, each with what it needs and the button of §3.7).
"No analysis matches" appears only when all three are empty, with a link to Guide me.

### 3.7 Table kinds that don't fit

A question of another kind is listed under "Not here?" with one line and an action:

| Wanted | On | Line | Action |
| --- | --- | --- | --- |
| Curve fit, regression, correlation of X with Y | column | "Curve fits need an XY table: X is the concentration or time." | New XY table… (the New table dialog at XY, its Y data sets titled as the selected columns; the user enters X, which a column table doesn't have) |
| Two-way ANOVA | column | "Two factors need a grouped table: one factor in rows, the other in columns." | New grouped table… |
| Survival | multiple variables | "Kaplan-Meier from one row per subject." | opens `survivalFromVariables` (no new table needed) |
| Survival | column, XY | "Survival needs a survival table (time, event or censored)." | New survival table… |
| Chi-square | column | "Counts of subjects by group and outcome need a contingency table." | New contingency table… |
| Multiple regression, PCA | other kinds | "Several variables per subject need a multiple-variables table." | New multiple-variables table… / Import… |

Each action is an existing command (New table with a preset kind); the chooser stays open on the
question so the user returns to it after making the table.

---

## 4. The Analyze dialog

### 4.1 Layout

```
Dialog: width min(1200 px, 94vw), height min(820 px, 90vh)
+--------------------------------------------------------------------------------------------+
| Analyze “Dose response (3 groups)”                          [Guide me] [All analyses]    × |
+------------------+--------------------------------------+-----------------------------------+
| RAIL 232 px      | OPTIONS (flex ≥ 420 px; scrolls)     | SIDE 360 px (own scroll)          |
| Guide me:        | One-way ANOVA: are the averages of 3 | Your data, as it will be analyzed |
|  questions       |   or more independent groups         | [sketch 340 × 220]                |
| All analyses:    |   different?   About this method     | 3 groups · 8 values each · not    |
|  search,         | Groups  [Vehicle•ctl][1 mg][10 mg] ⇄ |  matched · 2 comparisons          |
|  Common,         |   Comparing: each group − Vehicle    | Checks                            |
|  categories      | ESSENTIALS                           |  ✓ every group has ≥ 2 values     |
|  (fixed)         |  Same subjects in every group? ⓘ     |  ! 1 mg/kg has 5 values, others 8 |
|                  |   (•) No  ( ) Yes, each row is one…  | ───────────────────────────────── |
|                  |  What kind of values? ⓘ              | About one-way ANOVA (card)        |
|                  |  Which comparisons? ⓘ                |  or the ⓘ card of the focused     |
|                  | ▸ REPORTING  95% CI · effect sizes   |  option                           |
|                  | ▸ ADVANCED   Dunnett · 1 changed     |                                   |
+------------------+--------------------------------------+-----------------------------------+
| Method: one-way ANOVA · Dunnett · 95% CI · two-tailed        [Cancel] [Analyze]             |
+--------------------------------------------------------------------------------------------+
```

Responsive, by the dialog's own width W (a container query, so the desktop window and the web
behave alike):

| W | Layout |
| --- | --- |
| ≥ 1100 px (windows from about 1180 px) | Three columns as drawn. |
| 860–1099 px (a 1024 × 768 window gives W ≈ 963) | The rail collapses to a 48 px strip showing the current method's name; clicking it (or ⌘K in the dialog) opens the list as an overlay. Side panel 300 px. |
| < 860 px | Two rows: the sketch as a 160 px strip above the options with [Hide sketch]; the cards open as a sheet over the options. |

Only the options column scrolls (U9); the rail, the sketch and the footer stay. The footer's
method line updates as options change (text only). OK becomes **Analyze** (create) or **Apply**
(edit). Edit mode opens with the rail collapsed to the current method and a **Change method…**
button (U28); the title is "Edit “Welch's t test: Treated vs Control”" (§8.6).

### 4.2 Options in the experiment's words

Each def's form is rewritten in 51b: same params, new labels, explain lines, tiers. The mapping
for the compare-groups analyses (other analyses follow the same rules in 51b; their mappings are
part of that phase's review):

| Analysis | Essentials question (options) | Param |
| --- | --- | --- |
| t test | Same subjects in both groups? (Different subjects / Yes, each row is one subject, plate or day) | `design` |
| | Can the groups vary by different amounts? (Yes or not sure: Welch / No, equal scatter is known: Student) | `unpaired.assumeEqualSD` |
| | Is the change a difference or a ratio? | `paired.measure` |
| Mann-Whitney, Wilcoxon | (none: groups and order only) | — |
| One-way | Same subjects in every group? | `matched` |
| | What kind of values? (Measurements / Scores or ranks) | `gaussian` |
| | Could a treatment change how much values vary? (No, similar scatter: ordinary / Yes: Welch) | `equalSD` ('yes' / 'welch'; Brown-Forsythe in Advanced) |
| | Which comparisons? (Every pair / Each with a control [chip] / Steady trend in order / None) | `comparisons`, `control` |
| Two-way | Were the same subjects measured across a factor? (No / across {colFactor} / across {rowFactor} / both) (S26) | `repeated` |
| | Which comparisons? (in factor names, §3.5) | `comparisons`, `kind` |
| Multiple t tests | Same subjects in both groups? · What kind of values? (Measurements / change by a factor (lognormal) / scores) | `design`, `distribution` |
| | How should the many rows be corrected? (False discovery rate / chance of any false positive / not at all) | `approach` |
| Nested | (none) | — |

Tiers (`FormField.tier`, required on every field, tested):

| Tier | What | Shown |
| --- | --- | --- |
| Essentials | the design questions above, the groups and their order | open |
| Reporting | confidence level, effect sizes and optional output, "Show on graph" (one section, also in edit mode, U14), report the F test of variances (off) | collapsed, with a summary line of current values ("95% CI · effect sizes") |
| Advanced | the correction method (with NK and LSD under "Other", S36), sphericity and the RM method, df method, exact or approximate P, one-tailed with its direction, Brown-Forsythe, Wilcoxon's zero rule | collapsed, with a badge counting values that differ from the defaults ("Dunnett · 1 changed") |

### 4.3 Groups: chips, order and sign (U6)

- The data-set checkboxes become **chips** in the analysis' order: click to include or leave
  out; drag, or Alt + ←/→ on a focused chip, to reorder; **⇄** swaps two groups. The order is
  `input.dataSets`' order (no schema change: the engine already reads them in order).
- A sentence under the chips states what is compared, in the sign convention of §8.3:
  "Comparing: Treated − Control" (two groups), "each group − Vehicle" (with a control), "every
  pair (3 comparisons)". The control is chosen on the chips (a "control" toggle on the chip's
  menu, or clicking a group in the sketch); it moves first.
- Too many or too few: the Checks list says "Choose 2 groups (3 chosen)", not a small line under
  checkboxes; Analyze is disabled with that reason.
- The sketch draws exactly the chosen groups in this order.

### 4.4 Disabled with a reason, never refused after OK (S10, U8)

Fields and options gain conditions on params **and** on table facts:

```ts
type Condition =
  | { path: readonly string[]; in: readonly unknown[] }          // as ShowIf today
  | { fact: 'raw' | 'twoByTwo' | 'missingInMatched' | …; is: boolean }
  | { fact: 'groups' | 'dataSets' | 'maxPerCell' | …; atLeast?: number; atMost?: number }
FormField.appliesTo?: Condition[]          // never applies to this table: hidden
option.unavailable?: { when: Condition[]; reason: string }[]   // greyed, reason shown inline
```

Hidden when it never applies to this table; greyed with the reason when another choice excludes
it; never a suggestion to change an assumption to unlock a feature. If a stored value becomes
unavailable (the user changed another option), the field shows the reason in place and Analyze is
disabled until it's changed (no silent switching). Every combination the reviews found, and how
it is prevented:

| # | Combination (today) | Prevention |
| --- | --- | --- |
| 1 | One-way: linear trend with matched rows (refused at run) | "Steady trend" greyed when matched: "Not with matched rows: the trend test uses the ordinary ANOVA's error term." |
| 2 | One-way: trend with scores (Kruskal-Wallis) | greyed: "Not with ranks." |
| 3 | One-way: trend with Welch or Brown-Forsythe | greyed: "Needs similar scatter (ordinary ANOVA)." |
| 4 | One-way: Newman-Keuls with matched rows (refused) | NK greyed under Other: "Not with repeated measures." |
| 5 | One-way: the sphericity question when values are missing (mixed model, GG silently not applied, S5) | greyed with "Some values are missing: a mixed-effects model will be fit; the Geisser-Greenhouse correction doesn't apply to it." (fact `missingInMatched`) |
| 6 | One-way: Welch's comparison methods labelled for all pairs under "each with a control" | the Welch method list reads "each with the control" and its explain lines say so |
| 7 | Two-way RM: compare every cell (refused) | greyed: "Not with repeated measures: needs a pooled error term." |
| 8 | Two-way RM: Newman-Keuls (refused) | greyed under Other |
| 9 | Two-way RM: main-effect comparisons of a repeated factor with Geisser-Greenhouse (info: "choose Yes — no correction") | **fixed in 51c**: computed with per-contrast error terms (§6.2), so no refusal and no prompt to assume sphericity |
| 10 | Two-way: Tukey or Dunnett with "one family for all comparisons" (silently kept per row) | "One family for all" greyed for Tukey and Dunnett: "Tukey and Dunnett adjust within one row; choose Šidák, Bonferroni or Holm-Šidák to adjust across rows." |
| 11 | Two-way: full model with one value per cell (refused) | "Full model" greyed (fact `maxPerCell` = 1): "One value per cell: the interaction can't be estimated." |
| 12 | Three-way: "Analyze repeated measures with" shown when nothing is repeated | hidden unless a factor is repeated |
| 13 | Three-way: comparisons with repeated measures (none computed) | comparisons greyed: "Not yet available with repeated measures." |
| 14 | Multifactor: simple effects or cell comparisons with one factor (refused) | greyed (fact: factors < 2): "Needs two factors." |
| 15 | Contingency: one-tailed, RR, NNT, OR, sensitivity on larger tables ("applies to 2×2") | hidden unless 2 × 2 (fact `twoByTwo`) |
| 16 | Contingency: trend on a 2 × 2, or with more than two outcome columns | hidden: needs ≥ 3 rows and 2 columns |
| 17 | Linear regression: compare slopes with one data set (ticked) | hidden with one data set |
| 18 | Linear regression: through origin and through a point | "Through a point" greyed when through origin is on |
| 19 | Paired t, Wilcoxon, Mann-Whitney, Kruskal-Wallis, Friedman, RM, lognormal multiple t on mean/SD/N data (refused at run, S31) | greyed: "Needs the raw values, not mean/SD/N." (fact `raw`) |
| 20 | Ratio paired t with zero or negative values (refused) | a blocking check (§4.6) naming the values; the option stays (the data may be edited) |
| 21 | Nonlinear: model comparison or comparing parameters with robust regression (refused in results) | greyed: "Robust fits give best-fit values only." |
| 22 | Nonlinear: F test between models that aren't nested (51e) | F test greyed: "These models aren't nested; compare them by AICc." |
| 23 | Survival: trend with two groups | hidden unless ≥ 3 groups |
| 24 | Survival: pairwise comparisons with two groups | hidden unless ≥ 3 groups |
| 25 | Multiple t tests: Kolmogorov-Smirnov offered as the equal of Mann-Whitney (S32) | moved to Advanced with its sentence ("tests any difference in shape; little power for a shift") |
| 26 | Multiple one-way: Kruskal-Wallis on summary data | greyed (fact `raw`) |
| 27 | One-tailed P with no stated direction (51c) | blocking check: "Say which direction you predicted." |
| 28 | ROC with no stated direction (51c) | blocking check: "Say whether patients have higher or lower values." |

A test (`ui/test/analysisConditions.test.ts`) walks this table: for each row, a fixture table and
params where the condition holds, asserting the option is hidden or greyed with the reason, and
that `run` with the excluded value still returns a failure (the guard stays for files and
scripts).

### 4.5 Switching methods keeps shared choices (U13)

`pickDef` no longer resets everything. Each def declares `shared?: Partial<Record<SharedKey,
path>>`, with `SharedKey` = `'confidence' | 'tails' | 'direction' | 'control' | 'comparisons' |
'design'` (matched/paired); switching copies the values the new def shares (control as the data
set key; `comparisons` only when the target has the same value). The selection keeps the chips
in order, trimmed to the new def's maximum (the rest stay as unticked chips). Within the dialog
session, returning to a def restores what it had.

### 4.6 Checks before OK (U16)

`AnalysisDef.check?(input, params, context): Check[]`, pure and fast, run in the dialog on the
normalized chosen data sets (`normalizeColumn`, main thread, debounced 120 ms):

```ts
interface Check {
  level: 'ok' | 'note' | 'block'
  message: string                  // "Treated has 1 value: a t test needs at least 2 per group."
  fix?: { label: string; params?: Record<string, unknown> } | { label: string; goTo: 'table' }
}
```

Each analysis' early failures in `run` move into one `validate(input, params)` used by both `run`
(returns the failure) and `check` (returns the block), so the messages can't drift
(`analyses/test/check.test.ts`: for every def and the degenerate fixtures of
`degenerate.test.ts`, `check` blocks exactly when `run` fails before computing, with the same
message). Checks are about counts and shapes (values per group, empty groups, unpaired rows,
non-positive values for ratios and logs, 2 × 2-only options, too few rows for the model's
parameters, a group normalized to a constant (S20), a stated direction missing); never about a
test's P. They appear in the side panel under the sketch: ✓ ok lines, ! notes, ✗ blocks; Analyze
is disabled with the first block as its reason (`aria-describedby`).

After OK, a failing result shows **Error** in the results toolbar instead of "Up to date", and the
error's link is the right one: **Change parameters…** when the failure is about the options, **Go
to table** when it's about the values (`Diagnostic.where?: 'params' | 'table'`, set by
`validate`).

### 4.7 Roles for multiple-variables analyses (U12)

Analyses of variables declare `roles` instead of a flat data-set list:

```ts
roles?: { id: 'outcome' | 'predictors' | 'factors' | 'variables' | 'groupBy' | 'time' | 'event'
          label: string; accepts: 'number' | 'text' | 'binary' | 'any'
          min: number; max: number; param?: readonly string[] }[]
```

The options column opens with **role boxes** (as in JASP and jamovi): Outcome, Predictors (and
Factors for categorical ones), Group by; variables are dragged or added with a menu; the outcome
starts empty (Analyze disabled: "Choose the outcome") and is never also a predictor. PCA's
Variables box starts with the continuous number variables only: variables with two distinct
values (0/1 codes) and text variables are left out with a note "3 coded variables left out:
Male, Responder, Died (add them if they belong)". Roles write the existing params (`y`, the
categorical lists) and `input.dataSets` (the roles' members in role order), so stored nodes are
unchanged in shape. The sketch shows the outcome against each predictor (§5.6).

### 4.8 Accessibility and keyboard

- The dialog is a modal `dialog` labelled by its title; tabs Guide me / All analyses are a
  `tablist` (⌘1 / ⌘2 inside the dialog).
- Rail: the existing combobox + listbox pattern (type to filter, ↑ ↓, Home, End, Enter); chooser
  answers are radio groups; recommendation cards are regions with headings; **Use this** is a
  button.
- Options: each Essentials question is a `fieldset` with its legend; the explain line is in the
  legend's `aria-describedby`; ⓘ is a button with `aria-controls` the side panel and
  `aria-expanded`; Reporting and Advanced are disclosure buttons whose summaries are read.
- Greyed options are `aria-disabled` (still focusable, so the reason is read), with the reason
  in `aria-describedby`.
- Chips: a `listbox` with `aria-orientation="horizontal"`, Space toggles inclusion, Alt + ←/→
  moves, ⇄ is a button; the comparison sentence is `aria-live="polite"`.
- The sketch: §5.7. Checks: a list; a block is prefixed "Error:" and carries an icon, not colour
  alone (U29).
- ⌘Enter = Analyze / Apply; Escape closes; focus returns to the opener.
- `prefers-reduced-motion`: no sketch transitions.

---

## 5. The live data sketch

### 5.1 Decision: a transient graph, chosen by the analysis, drawn by `@ps/graph`

The sketch is an **ordinary v2 graph of a transient table**, never stored: the analysis declares
*what* to show as data (a small derived table, a native preset, annotations), and `@ps/graph`
draws it with no knowledge of analyses.

```ts
// @ps/analyses: what an analysis shows while it is being set up
AnalysisDef.sketch?: (input: readonly NormalizedDataSet[], params: P, ctx: SketchContext)
  => SketchSpec

interface SketchSpec {
  panels: SketchPanel[]            // 1–3 small graphs, e.g. data + differences + QQ
  caption: string                  // one line from the cards ("Each line links a subject's two values")
  description: string              // the text alternative (§5.7)
  counts: string                   // "3 groups · 8 values each · not matched · 2 comparisons"
  sampled?: { shown: number; total: number }
}
interface SketchPanel {
  id: string
  table: DataTable                 // transient: ranks, differences, quantiles, a curve's points…
  preset: string                   // a native preset id (graph/src/presets.ts): 'points',
                                   // 'meanSd', 'beforeAfter', 'spaghetti', 'connected',
                                   // 'survival', 'stackedPercent'…
  annotations?: Annotation[]       // @ps/model's: brackets with typed labels, reference lines
  axes?: { yLog?: boolean; xTitle?: string; yTitle?: string }
  highlight?: string[]             // data set keys drawn emphasized (the control)
}
```

`@ps/ui` turns each panel into a graph with the graph builder's own function (`builtGraph`, the
one the builder's preview and Create share, decision 1274) and draws it with `SceneSvg`. A ui
test checks that every `preset` id a sketch uses exists in `graph/src/presets.ts` (`@ps/analyses`
can't import `@ps/graph`).

Why this and not the alternatives:

- **Against CLAUDE.md's rule** ("drawing code never branches on a table kind, preset or look"): a
  sketch module in `@ps/graph` would have to branch on the analysis family, which the rule
  forbids; a hand-drawn React SVG in `@ps/ui` would be drawing code outside the graph engine,
  with text measured by the browser (also against the rules) and no goldens. Here the branching
  happens where branching on the method belongs, in `@ps/analyses`, and it produces *data* (like
  a preset choice); `@ps/graph` stays branch-free.
- **No new geoms or stats.** Everything the reviews ask for is a native preset over a derived
  table: ranks are a table of ranks (computed by `@ps/stats`' oracle-checked ranking), paired
  differences a column of B − A, the pooled-SD band a summary-format column (mean, pooled SD,
  N), the QQ plot an XY table from `@ps/stats` `qqPlot` (oracle `qq`), KM curves the survival
  preset of the chosen groups, an interaction plot the `connected` preset of cell means, a
  model's starting shape an extra XY data set evaluated from the equation's initial values.
  Comparisons are brackets with typed labels; a control is a highlighted data set. If a sketch
  later needs a mark no preset has, it is added as a geom or stat with its matrix entry, legend
  glyph, extent, skyline, golden and z-order case, like any other.
- **Fonts, dark mode, goldens for free.** Text is measured with fontkit; the sketch uses the same
  look as the builder preview in light and dark mode; sketches get scene snapshots like graphs.
- **No result can leak in.** `sketch` receives the normalized input and params only; it doesn't
  import `run` or any test function (an import-boundary test on `analyses/src/sketch/`).

### 5.2 Two groups (t tests, Mann-Whitney, Wilcoxon, Kolmogorov-Smirnov, one sample)

| Option | Panels and marks | What changes |
| --- | --- | --- |
| Unpaired | `points` of the two groups with mean lines; a bracket labelled "{B} − {A}" | — |
| Paired | `beforeAfter` (a line per row); beside it a `points` panel of the differences B − A with a reference line at 0; rows missing a partner drawn hollow with "2 rows without a pair are left out" | pair lines and the difference panel appear; group means fade |
| Ratio paired | as paired with a log Y axis; the difference panel shows B/A on a log axis with a line at 1 | axis turns log, panel relabels "B/A" |
| Welch | `meanSd`: each group's own SD as its band | bands take two widths |
| Student | each group's band at the pooled SD (a summary column), its own SD faint behind | bands equalize; the mismatch shows |
| Mann-Whitney | `points` of ranks 1…N on a shared axis (ties side by side), each group's rank sum in the caption | points move to rank positions |
| Wilcoxon | the differences ranked by size, coloured by sign; zero differences greyed "dropped" (Wilcoxon) or ranked (Pratt) | zeros change state with the zero rule |
| Kolmogorov-Smirnov | the two cumulative step curves (an XY table of the empirical CDFs, drawn as steps); the widest gap marked with a reference line | — |
| One sample | one group with a reference line at the hypothetical value and a bracket from the mean to it | the line moves as the value is typed |
| One- or two-tailed | the difference axis shaded on both sides of 0, or on the predicted side, labelled "Predicted: Treated higher" | shading moves; no P |
| Assumption panel | SD ratio "Treated's SD is 3.1 × Control's" (unpaired) and a small QQ plot of each group or of the differences (paired) | changes with the data, not with the options |

### 5.3 Three or more groups, one factor (one-way, Kruskal-Wallis, Friedman, nested)

| Option | Panels and marks | What changes |
| --- | --- | --- |
| Ordinary ANOVA | `points` with means and a dashed grand-mean reference line; caption "ANOVA compares how far apart the group means are with the scatter inside the groups" | — |
| Welch / Brown-Forsythe | each group's own SD band | bands unequal; Brown-Forsythe centres on medians |
| Matched (RM) | `beforeAfter` across the groups: a line per row; caption "Each line is one subject: its own differences are what count" | lines appear |
| Sphericity | (matched only) a small table of the SD of each pair's differences, "similar = sphericity holds", ε as text without a test | shown when matched |
| Mixed model | missing values marked "missing: a mixed-effects model will use the rest" | appears when a subject misses a value |
| Kruskal-Wallis | ranks across all groups, mean rank per group | values move to ranks |
| Friedman | ranks within each row (1…k) with the row lines | ranks are within rows |
| All pairs | a bracket for every pair (≤ 10; above, the count only) and "6 comparisons, one family" | brackets added or removed |
| Each with a control | brackets from the control only, the control highlighted; changing the control moves them | brackets re-root |
| Trend | the means joined by a straight line across the order, caption "assumes the groups are ordered and equally spaced" | the line appears |
| Correction method | text under the family: the method's one-line description; no P | text only |
| Nested | each subject's replicates as a small cluster with the subject mean as a large point; the group comparison drawn on the subject means; caption "Subjects are the independent units" | — |

### 5.4 Two-way, three-way and multifactor

| Option | Panels and marks | What changes |
| --- | --- | --- |
| Factor grid | `connected` of cell means (an interaction plot): one line per {colFactor} across the {rowFactor}s, with the points behind; factor names on the axis and legend; empty cells noted | — |
| By rows / by columns | a toggle in the sketch: which factor is on the axis | lines swap |
| Main effects only | the additive model's parallel lines next to the observed ones | lines become parallel |
| RM across columns / rows / both | faint lines joining each subject's values (`spaghetti`); caption "Independent units: 6 subjects (not 24 values)" | links appear; the count changes |
| Within rows / within columns | brackets inside each row's cluster, with "family 1 of 4" per row | brackets regroup |
| Every cell | the count only ("28 comparisons") | the count shows the cost |
| Main effects | marginal means beside the plot; when the lines cross, the caption "Main effects average over rows where the effect differs" (descriptive: from the means, not from a test) | — |
| Family: per row / all | "4 families of 3" vs "1 family of 12" | text changes |

### 5.5 Many rows (multiple t tests, multiple one-way ANOVAs, P stack)

The first 20 rows as small strips of the groups' points, "40 tests, one per row"; FDR: "about Q%
of the discoveries are expected to be false"; family-wise: "chance of any false positive ≤ α".
Lognormal: log axes; nonparametric: ranks per row. The volcano preview shows its axes and the
difference's direction ("Treated − Control"), without points (their Y is −log10 P).

### 5.6 Regression, curves, multiple variables

| Option | Panels and marks | What changes |
| --- | --- | --- |
| Linear regression | XY points with the least-squares line (descriptive) and residual segments | — |
| Through origin / a point | the line pivots through (0, 0) or the entered point, which is marked | the line pivots |
| Replicates: each / mean | each: every replicate as a point; mean: replicates faint, means solid; caption from S19 | points collapse to means |
| Bands | the band's shape drawn from the data (it doesn't depend on a test choice) | width changes |
| Compare slopes | one line per data set | — |
| Deming | perpendicular (or ratio-scaled) residual segments | segments rotate |
| Correlation | scatter; Spearman: ranks on both axes | points move to ranks |
| Logistic | 0/1 points jittered on two rows | — |
| Nonlinear | §9.5: the model's starting shape over the data, labelled "starting shape, not the fit"; constraints as dashed lines; weights as point sizes | the shape changes with the model |
| Multiple regression / logistic / Poisson / Cox | the outcome against each predictor (up to 6 small scatter or strip panels), the predictors' role chips | roles |
| PCA | a correlation heat strip of the chosen variables; "standardized" rescales | variables |

### 5.7 Contingency, survival, and the text alternative

- **Contingency**: `stackedPercent` of the outcome in each row, with row n; a 2 × 2 shows the cells
  labelled a–d with "Group 1 = Treated (row 1), outcome = Died (column 1)" and a swap control
  (S22); expected counts under each cell, those below 5 outlined; trend draws the rows in order
  with the proportion joined; pairwise draws brackets between rows; goodness of fit draws observed
  against expected bars, the expected following the typed values.
- **Survival**: the `survival` preset (KM steps with censor ticks; descriptive) and the number at
  risk; codes other than event and censored drawn as grey crosses "ignored"; the CI method
  changes the band shape; GBW draws event markers sized by the number at risk ("weights early
  events more"); trend shows the groups' order with scores 1…k; the hazard ratio's reference group
  is highlighted.
- **Text alternative** (U29): the panel group is `role="img"` with `aria-describedby` the
  `description`, generated from the same spec: "3 groups (Vehicle, 1 mg/kg, 10 mg/kg), 8 values
  each, not matched; comparing each group with Vehicle: 2 comparisons." The counts line is
  `aria-live="polite"` and changes only when the design changes (groups, matching, comparisons),
  not on every keystroke. The sketch is never needed to complete a task: clicking a group to set
  the control is a shortcut for the chip menu.

### 5.8 Performance, and what never updates live

- The sketch is built on the main thread from the normalized input (grouping, means, ranks:
  milliseconds), debounced 120 ms, then drawn as a scene. Large tables are sampled by **rows**
  (so pairs and subjects stay whole): at most 2,000 rows per group, every k-th row in table order
  (deterministic), with "Showing 2,000 of 30,000 rows" in the counts. Cells tables (34f) use the
  point-cloud drawing the graphs already use.
- A timing guard (`growthRatio`, CPU time at two sizes) keeps sketch building linear in the rows
  shown.

Never shown live, in the sketch, the chooser, the checks or the footer:

| Never live | Why |
| --- | --- |
| P values, stars, "Significant?" | watching P while flipping Student / Welch / ranks / one-tailed turns a planned analysis into a search for P < 0.05 (S7) |
| CIs of differences, effect sizes and their CIs | they carry the same information as P ("CI excludes 0") |
| r, R², slopes' tests, fitted parameter values (EC50, Kd), "Preferred model", F test or AICc verdicts | the same for regression and curve fitting |
| normality or equal-SD test P values | pre-tests (shown instead: the QQ plot and the SD ratio, as information) |
| bracket labels from the analysis being edited | brackets relabel after Apply, not while options change |

Allowed: values, means, SDs and their ratio, medians, ranks, pairing lines, cell means, counts
and expected counts, KM steps, the least-squares line and residuals, a model's starting shape,
numbers of comparisons, families, which values are left out and why. When an analysis with
results is edited, the dialog shows the sketch, not the old P.

---

## 6. Defaults and statistics changes (51c)

### 6.1 How saved analyses keep their options

Today (checked at e363961):

- Every one of the 54 definitions is at params `version` 1. The engine parses a node's params
  with the def's zod schema, filling missing fields from the **current** defaults, and calls
  `migrateParams` only when `node.pluginVersion < def.version` (`engine/src/compute.ts`). Only
  one-way ANOVA declares a `migrateParams`, the identity.
- The Analyze dialog stores complete parsed params. **Not every creator does**: graph brackets
  store partial params (`{ design: 'unpaired' }` for a Student bracket, `{}` for Mann-Whitney,
  `ui/src/graph/results/resultActions.ts` `testNode`), and Monte Carlo stores its inner analysis'
  params partially (default `{ analysisId: 'ttest', params: {} }`) with no version of its own.
- The edit dialog parses stored params **without** `migrateParams` (`AnalyzeDialog.tsx`
  `initialParams`): after a version bump, editing would show (and re-save) the new defaults.

So flipping a default alone would silently turn every saved bracket t test and every Monte Carlo
t test into Welch. The rules for 51c:

1. **A default change bumps the def's `version` and adds `migrateParams(raw, from)` that writes
   the previous default explicitly into older params** ("pinning"), before the zod parse. New
   fields that change behaviour get the value that reproduces the old behaviour for older nodes
   and the new default for new ones.
2. **One helper** `paramsOf(def, node)` (`@ps/engine`, migrate then parse) is used by the engine,
   the edit dialog, Duplicate family, Apply to other tables, method files and Monte Carlo; a test
   asserts no other code calls `def.params.parse` on stored params.
3. **Creators store complete params**: brackets build theirs with `def.params.parse(…)`; Monte
   Carlo stores `analysis.pluginVersion` (its own version 2 pins the inner params of older nodes
   to the inner def's version-1 defaults).
4. **Fixtures**: `analyses/test/fixtures/params-v1/` holds version-1 params of every def whose
   version moves (partial and complete forms); `migrateParams.test.ts` runs each through the
   migration and asserts the result equals running the version-1 code (results hashed at
   e363961 and committed).
5. `ui/test/v1Examples.test.ts` keeps proving the examples hold; the example **fingerprints change
   once**, because every example's analysis nodes gain the new fields and version numbers (the
   documents differ; their results don't). Each example that relied on a changed default pins the
   old choice in its source, so what it shows is unchanged.
6. `ANALYSES_VERSION` 1.4.1 → **1.5.0** (new outputs, notes and wording; saved analyses' numbers
   unchanged, new defaults only for new analyses).

### 6.2 The changes, finding by finding

"Pins" means the def's version moves and older params get the stated value.

| Finding | Change | Saved analyses | Oracle |
| --- | --- | --- | --- |
| S1 one-tailed | §6.3 | §6.3 | new cases (§6.4) |
| S2 Welch | `ttest`: `unpaired.assumeEqualSD` default **false** (Welch); `reportFTestVariances` default **false**, the F test moved to Reporting with the SD ratio and a sentence; the warning "Consider Welch's t test" removed. Brackets offer Welch first and by default; multiple t tests already Welch (decision 51). | pins `assumeEqualSD: true`, `reportFTestVariances: true` when absent | none (no new statistic) |
| S3 equal-SD prompt | one-way and multiple one-way: Bartlett's test dropped from the default output (kept under Details when asked: `reportEqualSdTests`, default false); the "Consider Welch or Brown-Forsythe" warning removed; the SD ratio (largest / smallest) shown with a sentence. The question about scatter moves before the result (§4.2). | pins `reportEqualSdTests: true` | none |
| S4 brackets | §7.3 | bracket analyses keep their tests; only new brackets change | input modifier `byX` (§7.3) checked against the grouped-table result |
| S5, S28 RM with missing values | one-, two-way: `rmMethod: 'auto' \| 'anova' \| 'mixed'` (three-way has it), `ddf: 'satterthwaite' \| 'containment'` default **satterthwaite** for mixed fits (already in `@ps/stats` and oracle-checked: `rmanova.R`, `rmthreeway.R`, `nested.R`); the result says, as a warning, "Some values are missing, so a mixed-effects model was fit. It assumes equal correlation between all pairs of conditions (sphericity); the Geisser-Greenhouse correction does not apply. Denominator df: Satterthwaite." `anova` with missing values analyzes complete subjects only and says how many were left out. Nested t and nested one-way also gain `ddf` (default Satterthwaite). | pins `rmMethod: 'auto'`, `ddf: 'containment'` | cases for the analyses' paths (one- and two-way with missing values, both df) |
| S7 test shopping | §7 | — | — |
| S9 multiple one-way | `multipleOneWay` gains the family params of multiple t tests (`approach` default **fdr**, BKY, Q 5%), applied to the per-row P values; the result says which correction applies to which P ("rows: FDR across 20 rows; comparisons within a row: Tukey, each row its own family") | pins `approach: 'none'` | `multiple_oneway.R`: q values and discoveries across rows (`p.adjust`, two-stage as `padjust.R`) |
| S10 invalid combinations | §4.4; and main-effect comparisons of a repeated factor without sphericity computed with per-contrast error terms (each subject's mean over the other factor, paired differences, Šidák or the chosen method), so the refusal goes | none (newly computed only where it was refused) | new suite `rm_main_effects`: `afex::aov_ez` + `emmeans(…, model = "multivariate")` |
| S11 Kruskal-Wallis | `oneWayAnova` and `multipleOneWay`: `kwPMethod: 'exactWhenPossible' \| 'approximate'` default **exactWhenPossible**: exact P by enumerating the arrangements of the ranks (mid-ranks for ties) while their number stays below a limit set by the timing guard (about 10⁸), else the chi-square approximation, said in the result. Dunn's comparisons: `dunnMethod: 'holm' \| 'sidak' \| 'bonferroni' \| 'none'`, default **holm**, the same list in one-way's Friedman path and the standalone Friedman (whose `correction: 'dunn'` becomes Bonferroni by name). | pins `kwPMethod: 'approximate'`, `dunnMethod: 'bonferroni'` | new suite `kw_exact` (R enumeration with `combn` for small designs, cross-checked against `coin::kruskal_test(distribution = approximate(nresample = 1e6))` within its Monte Carlo error, documented in the case); Dunn Holm and Šidák in `oneway.R` and `friedman.R` (`dunn.test(method = …)`) |
| S12 medians wording | 51d (results text) | — | — |
| S13 outliers then tests | analyses of a table produced by Identify outliers (or a curve fit's ROUT-cleaned output) carry a note "3 values were removed as outliers (ROUT, Q = 1%) before this test", in results and the methods text. `RunContext` gains `source?: { analysisId: string; note?: string }` (the producing analysis' own one-line description). The outliers form says: "Remove only values with a known cause (pipetting error, failed well). Report the analysis with and without them." | none | none |
| S14 normality | defaults: Shapiro-Wilk only, QQ plot **on**; rows reworded "Evidence against a normal distribution (P < 0.05)?" Yes / "No evidence (doesn't show the data are normal)"; D'Agostino-Pearson keeps its n ≥ 8 note, no "recommended" | pins the four tests on, QQ off | none |
| S15 two-way main effects | a note when the interaction P < 0.05 and main-effect comparisons were chosen (51d text); the chooser asks the comparisons first (51a) | — | — |
| S16 survival | `survival` and `survivalFromVariables`: `test: 'logRank' \| 'gehanBreslowWilcoxon'` (default log-rank; only the chosen test reported); `trend` default **false**, offered with ≥ 3 groups "if the groups are ordered"; `pairwise: 'none' \| 'all' \| 'control'` with `pairwiseMethod: 'holm' \| 'bonferroni' \| 'sidak' \| 'none'` (default holm); `hazardRatio: 'mantelHaenszel' \| 'logRank'` (one method) and `control` (one direction: group vs control); the ratio of medians' CI labelled "(assumes exponential survival)" | pins `test: 'all'` (a legacy value reporting all three, not offered), `trend: true`, `hazardRatio: 'both'` | new suite `survival_pairwise`: `survdiff` per pair + `p.adjust` |
| S18 model comparison | 51e (§9.4) | — | — |
| S19 replicates | the question in Essentials in both regressions, worded as §3.5; default unchanged (`each`) | — | — |
| S20 normalized data | a check and a result note when a group is constant at 100 (or 1) after normalization: "This group was normalized to itself and has no variation; compare the others with 100 by a one-sample t test, or test the raw values with the experiment as the matching factor" | none | none |
| S21 trend in contingency | `trend` default **false**, offered only with ≥ 3 rows and two outcome columns, labelled "The rows are in a meaningful order (doses, ages): test for a trend" | pins `trend: true` | none |
| S22 orientation | `contingency` gains `exposedRow` (default 0) and `outcomeColumn` (default 0): RR, OR and NNT computed for that orientation; the labelled 2 × 2 editor in 51b; the diagnostic block's checkbox reads "This table is a test result against the truth (sensitivity, specificity)" | defaults reproduce today | existing `contingency.R` cases with rows / columns swapped |
| S23, S24 | 51d headers; 51a reasons beside tags | — | — |
| S25 sign | 51d (§8.3) | pins in 51d | — |
| S26 two-way labels | 51b wording | — | — |
| S29 power from pilot data | with pilot data and "power of a given n": "Power computed from the observed effect adds nothing to the P value; use it only to plan the next experiment." Solving for n from pilot data: "Pilot effects are usually overestimates; n for the lower CI bound of the effect is …", and the power curve over a range of effects | none | `power.R` case for the lower-bound n |
| S30 correlation of many pairs | `correlation` gains `correction: 'none' \| 'holm' \| 'fdr'`, default **fdr** (Benjamini-Hochberg) whenever more than one pair is tested; one pair: nothing to correct. A sentence: "r describes association, not agreement (Bland-Altman checks agreement)." | pins `correction: 'none'` | `correlation.R`: `p.adjust` over the pairs |
| S31 summary data | §4.4 row 19; the chooser checks `raw` (51a) | — | — |
| S32 KS | 51a chooser placement, 51b Advanced in multiple t tests | — | — |
| S33 spelling | "Šídák" → "Šidák" in every label and result text (multiple t tests, P stack, contingency); "Bonferroni-Dunn" → "Bonferroni"; the Friedman post-test named "Dunn's test (Siegel-Castellan form)" as the oracle computes it | none (labels; result text through §8.2's keys) | none |
| S34 units of α and Q | the form shows α and Q both as percentages (stored values unchanged: Q in %, α as a fraction, converted by the field); Q default **5%** for new analyses (decision 51 amended), BH listed first as "the most widely used", the two-stage method kept as the default for its power, with a sentence | pins `q: 1` | none |
| S35 stars | `pSummary` uses `<` like "Significant?" (`model/src/format.ts`): P = 0.05 exactly is "ns" | — (display) | — |
| S36 NK and LSD | under "Other (not recommended for most uses)" with one sentence each (51b form) | — | — |
| S38 transform label | "Y = log10(Y)" (51a, text) | — | — |
| S39 ROC direction | `direction` default **`unset`**: a blocking check "Say whether patients have higher or lower values"; 'auto' kept as a legacy value for saved analyses, flagged in their results ("direction chosen from the data: the AUC is at least 0.5 by construction") | pins `auto` | none |
| S41 compare lines | 51d text | — | — |
| S42 Fisher fallback | the fallback to chi-square for large tables (main test or pairs) becomes a warning, and the block title names the test used | none | none |
| S43 effect sizes | 51d labels | — | — |

### 6.3 One-tailed P with a stated direction (S1; reverses decision 18)

Decision 18 made one-tailed P follow the observed direction (two-tailed P / 2). 51c records a new
decision superseding it: **a one-tailed P is computed for the direction the user predicted**, and
when the data go the other way the result reports the large P and says so.

- Params, in every analysis with `tails` (t test, Mann-Whitney, Wilcoxon, one sample, nested t,
  correlation, contingency 2 × 2): `predicted: 'unset' | 'increase' | 'decrease' | 'observed'`,
  default `'unset'`. `increase` means the analysis' effect is positive in its sign convention:
  {B} − {A} > 0 (or, with a control, group − control > 0), the one-sample mean above the
  hypothetical value, r > 0, a higher risk of the outcome in the exposed row. The form words it
  with the user's names: "Treated higher than Control" / "Treated lower than Control", "positive
  correlation" / "negative", "higher risk of Died in Treated".
- One-tailed lives in Advanced: "Use one-tailed only if, before the experiment, you predicted the
  direction and would have treated a difference the other way as no effect." Choosing it with
  `predicted: 'unset'` is a blocking check; `run` fails with the same message.
- Computation: the alternative is fixed by `predicted` (`alternativeFor` becomes
  `alternativeFor(tails, predicted)`, no effect argument). Fisher's 2 × 2 uses `pGreater` or
  `pLess` by the prediction; chi-square one-tailed is the signed z test (P = Φ(−z) in the
  predicted direction, i.e. P/2 or 1 − P/2), as `prop.test(…, alternative =, correct = FALSE)`
  gives. CIs stay two-sided at the chosen level (as today).
- Result: "One-tailed P, predicted: Treated higher than Control"; when the effect went the other
  way, a warning: "The difference went the opposite way to your prediction; one-tailed P = 0.96."
  The methods text names the prediction.
- `'observed'` is the legacy value for saved analyses: `migrateParams` sets it when `tails` is
  `'one'`, so their P is unchanged, and their results carry a warning: "Direction not stated
  (saved before 0.3.9): this one-tailed P assumes the observed direction was predicted. State the
  predicted direction in Edit…". It is not offered in the form.
- Power analysis keeps its tails (planning, no data direction).
- Brackets never offer one-tailed tests.

### 6.4 New R oracle cases

| Suite (`tools/oracle/cases/<suite>/`, `r/<suite>.R`) | Cases | R |
| --- | --- | --- |
| `onetailed` (new) | t (Student, Welch, paired, ratio), Mann-Whitney (exact, with ties, normal), Wilcoxon (exact, Pratt), one sample t and Wilcoxon, nested t, Pearson and Spearman, Fisher and chi-square 2 × 2: each predicted **with** and **against** the observed effect | `t.test`, `wilcox.test`, `coin::wilcox_test`, `coin::wilcoxsign_test`, `cor.test`, `fisher.test`, `prop.test(correct = FALSE)`, `lmerTest` contrast |
| `kw_exact` (new) | 3 × 3, 3 × 4, 2 × 3 × 5, with ties, at the limit | R enumeration (`combn`), `coin::kruskal_test(distribution = approximate())` cross-check |
| `oneway`, `friedman` (more cases) | Dunn with Holm, Šidák, none | `dunn.test::dunn.test(method = …)` |
| `rm_main_effects` (new) | two-way RM, main-effect comparisons of the repeated factor with Geisser-Greenhouse, all pairs and vs control | `afex::aov_ez`, `emmeans(…, model = "multivariate")` |
| `rmanova` (more cases) | one- and two-way with missing values, Satterthwaite and containment, through the analyses' paths; `anova` on complete subjects | `lmerTest::lmer`, `anova(ddf = …)` |
| `multiple_oneway` (more cases) | FDR (BKY, BH, BY) and family-wise across rows | `p.adjust`, `padjust.R` two-stage |
| `survival_pairwise` (new) | 3 and 4 groups, all pairs and vs control, Holm / Bonferroni / Šidák / none; GBW pairs | `survival::survdiff(rho = 0 / 1)` per pair, `p.adjust` |
| `correlation` (more cases) | Holm and BH over a 5-column matrix | `cor.test`, `p.adjust` |
| `contingency` (more cases) | RR / OR / NNT with `exposedRow` and `outcomeColumn` swapped | `contingencytables`, `exact2x2`, `PropCIs` |
| `power` (one case) | n at the lower CI bound of a pilot effect | `power.t.test` |

No tolerance is loosened; the Kruskal-Wallis Monte Carlo cross-check is a second, documented check
beside the exact enumeration compared at rtol 1e-10.

### 6.5 `ANALYSES_VERSION`

In the recommended merge order (§10.2):

| Phase | Version | Why |
| --- | --- | --- |
| 51a | unchanged (1.4.1) | text in the UI only |
| 51c | 1.5.0 | new outputs, notes, warnings and result wording; saved analyses' numbers unchanged |
| 51b | 1.5.1 | `Diagnostic.where`; checks share `validate` with `run` (messages unchanged) |
| 51d | 1.6.0 | summary blocks, row keys, user names, sheet order, the sign convention for new analyses |
| 51e | 1.6.1 | dose-response warnings, one model-comparison verdict |

---

## 7. Test-switching safeguards

### 7.1 Method history in the analysis node

Additive, optional fields on `AnalysisNode` (§10.1):

```ts
history?: MethodChange[]          // oldest first; at most 50 (older ones folded into a count)
interface MethodChange {
  at: string                      // ISO date-time
  from: { analysisId: string; pluginVersion: number; params: unknown;
          dataSets: DataSetKey[] }            // the method before
  changes: string[]               // "Equal SDs: not assumed → assumed (Student)", from the forms'
                                  // labels; "Data sets: removed Mouse 3"
  afterResults: boolean           // the analysis had results when it changed
  reason?: string                 // typed in the notice, ≤ 500 characters
}
```

What counts: a change of `analysisId`, of a field the def marks `method: true` (the test-defining
fields: design, equal SDs, distribution, tails and direction, comparisons and their method,
sphericity, the RM method, df, P method, survival test…), or of the data sets. Reporting fields
(confidence level, effect sizes, show on graph) don't. The dialog writes the entry with a new
command `analysis.recordChange` dispatched in the same undo step as `analysis.setParams`; undo
removes both. The data set keys inside `from` are remapped by Duplicate family and Apply to other
tables through the same remap as `input.dataSets`, and `graphRefs` is unaffected (the history
holds no graph references).

### 7.2 The notice

When Apply would record a change with `afterResults: true`, the dialog shows, above the footer:

> **You are changing the method after seeing results.** Changing the test after seeing P values
> makes them less trustworthy. Both methods will be listed in the method history and the methods
> text. Reason (optional): [ ____ ]   [Apply] [Add as a new analysis] [Cancel]

- Never blocking: re-analysis for a good reason (the wrong design was picked) stays one click.
- **Add as a new analysis** creates a second node with the new method beside the first (both
  honest, both listed).
- Edit opens on the current method; Change method… is a deliberate step (U28).

The results show the history under **Method** (§8.1), and the methods text names it: "Treated and
Control were compared by Welch's t test (two-tailed). The analysis was first run as Student's t
test and changed after its results were seen (12 Oct 2026; reason: “unequal group sizes”)."
Exports and the results copy include the method section.

(There is no methods text today: roadmap 31's "methods" are method files, `.psmethod`. 51c adds
the history and shows it as a note above the results; 51d adds the generated methods paragraph,
§8.1.)

### 7.3 Brackets

- The bracket dialog's tests: **Welch's t test (recommended)**, Student's t test (equal SDs),
  Mann-Whitney; Welch selected. Bracket analyses are created with complete params (§6.1).
- On a column graph with three or more groups shown, or when a bracket already exists among the
  same groups, the dialog's first choice is **"All groups: one-way ANOVA with Tukey's comparisons
  (Dunnett's if a control is chosen)"**: one `oneWayAnova` of the graphed groups (reused if it
  exists), and every bracket among those groups labelled from its comparisons (`label.source:
  'analysis'`, the comparison keys it already produces). The single-test choice stays below it.
- Existing bracket analyses: the bracket's Format panel offers **"Label these 3 brackets from one
  ANOVA"**, which creates the ANOVA, points the brackets at its comparisons and removes the
  bracket analyses no longer used, in one undo step.
- XY graphs, brackets at several X: the first choice is **"Two-way ANOVA with comparisons at each
  X (Šidák)"** through a new input modifier `input.byX: true` (each X value a row, the data sets
  as a grouped table's columns, the replicates as subcolumns; the run context's `tableKind`
  becomes `grouped`), so `twoWayAnova` runs unchanged; brackets label from its within-row
  comparisons (`row{r}:{a}|{b}`). Checked by comparing with the same data entered as a grouped
  table (identical results).
- Grouped graphs: a bracket within a row offers two-way ANOVA (within each row) first; multiple
  t tests made by brackets correct across rows (Holm-Šidák) by default.
- **Uncorrected marking**: an analysis made by a bracket records `origin: { bracket: true }`; when
  a graph holds two or more bracket analyses among the same groups, their names end
  "(uncorrected)" and the methods text says "not corrected for multiple comparisons".

### 7.4 Graph P labels name their test

- Every analysis that reports a P puts its test's name in `values.test` (a text value: "Welch's t
  test", "Tukey's multiple comparisons"), so a result label can show `{test}`.
- The ready results (`graphResults`) of new labels include it: "P = 0.0014, Welch's t".
- Brackets gain an optional `label.test?: boolean` (absent = no name, so existing graphs and
  goldens are unchanged): new brackets showing a P or "both" set it ("P = 0.0014 (Welch's t)");
  for stars, the first starred bracket adds a key label in a corner ("Welch's t test: * P < 0.05,
  ** P < 0.01…", a result label with the project's star thresholds), removable.

### 7.5 The duplicate-comparison warning

`duplicateComparisons(graph, project)` (ui, through `graphRefs`) finds P values on one graph from
two or more analyses comparing the same two data sets (same source, same rows or X, pooled or
not). The format bar shows a warning badge "2 tests of Control vs Treated shown", whose menu lists
them with their tests (Go to analysis, Remove this label). The analyses' results show the same
note. Derived, not stored.

---

## 8. Results that explain themselves (51d)

### 8.1 Order of the results

1. **Summary**: one or two sentences generated by the analysis from its own values, then a small
   effect plot (§8.5).
2. **The question's main table**: the comparisons when comparisons were asked for, the best-fit
   values for a fit, the medians and the test for survival.
3. **Details** (later sheets, and collapsed blocks): the omnibus table, assumption checks (SD
   ratio, QQ plot, ε), effect sizes, data summary, the optional extra tests.
4. **Method**: the method line, why it was chosen (the chooser's answers, when it came from
   there), the method history, the methods paragraph (copyable).

Each analysis orders its sheets by the question (comparisons first when asked, U21); sheet keys
are unchanged, so references keep working. Derived data tables (a KM survival table, predictions)
come last. The results open on the first sheet.

### 8.2 Summary sentences and the user's names

`summarize` runs inside the analysis (worker) and stores a new result block:

```ts
| { type: 'summary'; parts: (string | { value: ResultValue; role?: 'p' | 'estimate' | 'ci' })[] }
```

so P values follow the project's P style at display, like every result value. Rules: data set and
factor names, never "column A"; the direction in words (higher / lower, rose / fell); the size
with its CI in the units of the data when the table states them (an X or Y title's trailing
"(nM)" or "(U/mg)": `RunContext` gains `yTitle`); "no evidence of a difference" for P ≥ 0.05;
always the test's name next to its P; n per group; 3 significant digits.

| Family | Template (P ≥ 0.05 variant after the slash) | Example |
| --- | --- | --- |
| Two groups, t | "{B} is {higher\|lower} than {A} by {d} (95% CI {lo} to {hi}); P = {p}, {test}. n = {nA} and {nB}." / "{B} and {A} differ by {d} (95% CI …); no evidence of a difference (P = {p}, {test})." | "Treated is higher than Control by 11.8 U/mg (95% CI 5.2 to 18.4); P = 0.0014, Welch's t test. n = 10 and 10." (illustrative) |
| Paired | "{B} is {higher\|lower} than {A} by {d} on average across {n} pairs (95% CI …); P = {p}, paired t test." | "After is lower than Before by 3.1 mmHg on average across 12 pairs (95% CI 1.2 to 5.0); P = 0.004, paired t test." (illustrative) |
| Ratio paired | "{B} is {r} times {A} on average (geometric mean ratio, 95% CI …) across {n} pairs; P = {p}." | — |
| Mann-Whitney | "Values in {B} tend to be {higher\|lower} than in {A} (shift {hl}, 95% CI …); P = {p}, Mann-Whitney test. Medians {mA} and {mB}." | — |
| Wilcoxon | "Within pairs, {B} tends to be {higher\|lower} than {A} (median difference {hl}, 95% CI …); P = {p}, Wilcoxon matched-pairs test, {n} pairs." | — |
| One sample | "The mean of {A}, {m}, is {d} {above\|below} {value} (95% CI of the difference …); P = {p}, one-sample t test." | — |
| One-way + Dunnett | "Compared with {control}, {list: '{g} is higher by {d} (95% CI …, adjusted P = {p})'}; Dunnett's test for {m} comparisons. Overall: {the groups differ \| no evidence the means differ} (one-way ANOVA, P = {p})." | "Compared with Vehicle, 10 mg/kg is higher by 12.0 (95% CI 7.7 to 16.3, adjusted P < 0.0001) and 1 mg/kg by 5.8 (95% CI 1.5 to 10.1, adjusted P = 0.007); Dunnett's test for 2 comparisons." (illustrative) |
| One-way + Tukey | "{j} of {m} pairs differ after Tukey's adjustment: {up to 3, largest first}{; and {k} more in the table}. Overall … (one-way ANOVA, P = {p})." | — |
| Kruskal-Wallis | "Values tend to differ between groups (Kruskal-Wallis, {exact\|approximate} P = {p}); Dunn's test (Holm) finds {j} of {m} pairs differ: …" | — |
| RM one-way | "Within subjects, the mean {changes \| shows no evidence of change} across {conditions} (repeated-measures ANOVA, Geisser-Greenhouse corrected, P = {p}; {n} subjects)." | — |
| Two-way | interaction P < 0.05: "The effect of {colFactor} depends on {rowFactor} (interaction P = {p}, two-way ANOVA); the comparisons within each {rowFactor} describe it." Else: "{colFactor}: P = {p}; {rowFactor}: P = {p}; no evidence that one changes the effect of the other (interaction P = {p})." | — |
| Multiple t | "{d} of {n} rows are discoveries at FDR {Q}% ({method}), comparing {B} with {A} by {test} in each row." | — |
| Correlation | "{X} and {Y} {rise together \| move in opposite directions}: r = {r} (95% CI …), {n} pairs; P = {p}, {Pearson\|Spearman} correlation." | — |
| Linear regression | "Y {rises\|falls} by {slope} per unit of X (95% CI …); R² = {r2}; the slope differs from zero (P = {p})." Comparing lines: "The slopes {differ (P = …) \| show no evidence of differing (P = …); the intercepts, compared assuming a common slope, …}" (S41) | — |
| Nonlinear fit | "{Param} = {v} {unit} (95% CI …) for {A}{, … for B}; Hill slope {h}." + the warnings of §9.3 | "EC50 = 8.0 nM (95% CI 6.1 to 10.4) for Agonist A, 135 nM (…) for Agonist B; Hill slope 1.43 shared." (illustrative) |
| Survival | "Median survival {m1} days on {A}, {m2} on {B}, not reached on {C}; the curves {differ \| show no evidence of differing} (log-rank P = {p}). Hazard ratio {B} vs {control}: {hr} (95% CI …)." | — |
| Contingency | "{Outcome}: {p1}% in {row1}, {p2}% in {row2}; relative risk {rr} (95% CI …); P = {p}, Fisher's exact test." / trend: "rises with {rows} (chi-square for trend, P = {p})" | — |
| Descriptive, normality, PCA… | one line per group or a one-line status ("No evidence against a normal distribution in A (Shapiro-Wilk P = 0.42); see the QQ plot.") | — |

Tests: a snapshot of every family's sentence for fixtures covering both P branches, both
directions, missing CIs, and long group lists; the accessible text is the sentence itself (U29).

**Names in labels** (U19): every "column A / B" label becomes the data set's title ("Mean of
Control", "Sample size, Treated"). Grouped tables gain factor names (`factorNames?: { rows?:
string; columns?: string }` on the table, edited in the grid's header: the row-title column's
header names the row factor, a header line above the data sets the column factor); results and
graphs use them, "Row factor" and "Column factor" only when unnamed.

**Keeping references working.** Result labels on graphs can point at a sheet cell by block title
and row label (roadmap 35); renaming rows would break them. So:

- Rows and table columns gain stable keys (`keyValue` rows: `key?: string`; tables:
  `columnKeys?: string[]`, `rowKeys?: string[]`), e.g. `meanA`, `nB`, `diff`, `ci`.
- `ResultRef` `cell` gains optional `rowKey`, `blockKey`, `columnKey`; resolution tries keys
  first, then labels as today, then a per-analysis table of former labels
  (`analyses/src/legacyLabels.ts`: "Mean of column A" → `meanA`, "Difference between medians" →
  `shift`, the "Šídák" titles → their keys…).
- New ready results use keys. Nothing in a document is rewritten (no migration);
  `graphResults.test.ts` resolves every ready result against new results, and a fixture document
  with pre-51d label references resolves to the same values.

### 8.3 One sign convention (S25, U20)

**Later minus earlier, or group minus control**, everywhere, spelled out: "Treated − Control" in
headers and sentences.

- Two groups: {B} − {A} in chip order (unchanged for t tests, Mann-Whitney, Wilcoxon).
- One-way and two-way comparisons: today "A vs. B" = mean(A) − mean(B); new analyses compute
  later − earlier (each group − the control); the row label reads "1 mg/kg − Vehicle".
  `differenceAs: 'laterMinusEarlier' | 'earlierMinusLater'` (new param), pinned to
  `earlierMinusLater` for saved analyses.
- Multiple t tests: `difference` default becomes `bMinusA` (pinned `aMinusB` for saved; decision
  51 amended); the volcano's X title follows.
- Bland-Altman: default B − A (pinned A − B for saved).
- The P values, and the brackets they label, don't change; only the signs of estimates in new
  analyses.

### 8.4 Comparisons-table headers (S23, S24)

A note block above every comparisons table, from the method and family:

| Method | Header |
| --- | --- |
| Tukey | "Tukey: all 6 pairs as one family. P values and 95% CIs are adjusted so that the chance of any false positive among the 6 is 5%." |
| Dunnett | "Dunnett: each of 3 groups − Vehicle, one family; adjusted P values and simultaneous 95% CIs." |
| Šidák / Bonferroni | "Šidák: the 4 planned comparisons as one family; adjusted P values and CIs." |
| Holm-Šidák | "Holm-Šidák: adjusted P values for the 4 comparisons; no CIs (step-down methods have none)." |
| FDR | "q values: of the comparisons called discoveries, about 5% are expected to be false." |
| Two-way per row | "Each Genotype is its own family of 3 comparisons (Šidák)." |
| Uncorrected | "Fisher's LSD: no adjustment; with 6 comparisons the chance of at least one false positive is about 26%." |
| Games-Howell / T3 | "Dunnett's T3: all 3 pairs, without assuming equal SDs; adjusted P values and CIs." |
| Dunn | "Dunn's test (Holm): adjusted P values for the 3 pairs, from the ranks of all groups." |

The method's reason ("Tukey: for all pairs of means with CIs", S24) is in the card linked from the
header. Under the overall test, one line answers the common puzzle: "Comparisons and the overall
F test answer different questions; one can be significant without the other."

### 8.5 The effect plot (U25)

A small plot under the sentence, drawn as the sketch is (a transient table and a native preset,
§5.1), from the result (after Analyze, so CIs are allowed):

| Family | Plot |
| --- | --- |
| Two groups, one-way, two-way comparisons | each difference ({g} − {control} or {B} − {A}) as a point with its CI bar, a reference line at 0 (ratio: at 1, log axis) |
| Mann-Whitney, Wilcoxon | the Hodges-Lehmann shift with its CI |
| Correlation, linear regression | the scatter with the line |
| Nonlinear fit | the data with the fitted curves and drop lines at the EC50s (the existing result layers) |
| Survival | the KM curves with the medians marked |
| Contingency | the outcome's percentage per row (stacked percent) |

Clicking it opens it as a graph (Add to graph ▾ › New graph of the effects), made with the
presets.

### 8.6 One answer per question, readable numbers, names that follow the method

- **One answer** (U22): the test chosen leads; extra tests (the F test of variances, Brown-Forsythe
  and Bartlett, the second survival test, other normality tests) are opt-in and go to Details
  with a line on what each answers. Effect sizes lead with the raw difference and its CI;
  standardized ones are labelled "Cohen's d (pooled SD)" even under Welch (S43, decision 54).
- **Rank-test wording** (S12): "Do the values tend to be larger in some groups?"; "Shift between
  groups (Hodges-Lehmann: median of all differences B − A)"; medians kept as descriptive rows.
- **Readable numbers** (U26): units from titles ("8.0 nM", not "7.999e-9"); "not reached" for an
  undefined median and its open upper limit; NNT as "number needed to treat (benefit)" or "to
  harm" with a positive number; "four stars, P < 0.0001" as the accessible name of a star summary
  (U29); errors prefixed "Error:" with an icon.
- **Two-way main effects** (S15): with interaction P < 0.05 and main-effect comparisons, a note:
  "The effect of {colFactor} depends on the {rowFactor} (interaction P = …); comparisons within
  each {rowFactor} describe it better."
- **Names follow the method** (U23): `AnalysisDef.methodName(params, titles)`, e.g. "Welch's t
  test: Treated vs Control", "One-way ANOVA + Tukey: Dose response", "Kruskal-Wallis + Dunn: Cell
  area", "Two-way RM ANOVA: Genotype × Time". New nodes carry `autoName: true` and are renamed when
  their method or groups change; renaming by hand clears it. Existing nodes have no flag and keep
  their names (they may have been typed). The edit dialog is titled with the name.

---

## 9. Curve fitting (51e)

### 9.1 Models by goal

The 127-entry Model select (U10) becomes a picker: **goals** on the left, each goal's **models**
as cards with a shape thumbnail, the parameters in words, and the X scale it expects; "All
equations" (the full searchable list) and "My own equation" stay.

| Goal | Models (equation categories) | X expected |
| --- | --- | --- |
| Dose-response: stimulation (EC50) | log(agonist) vs. response: variable slope, standard slope, normalized forms; agonist vs. response (X is concentration) forms; biphasic, bell-shaped (Dose-response — Stimulation, Special) | log or concentration, per model |
| Dose-response: inhibition (IC50) | log(inhibitor) vs. response: variable slope, standard slope, normalized; inhibitor vs. response (X is concentration) | as above |
| Binding: saturation | one site total, specific, total and nonspecific; two sites (Binding) | concentration |
| Binding: competition | one site fit log IC50, fit Ki, two sites (Binding — Competitive) | log |
| Binding: kinetics | association, dissociation (Binding — Kinetics) | time |
| Enzyme kinetics | Michaelis-Menten, substrate inhibition, allosteric; inhibitor modes (Enzyme kinetics, — Inhibition) | concentration |
| Decay and growth | one- and two-phase decay, exponential growth, plateau followed by decay (Exponential) | time |
| Growth curves | logistic, Gompertz, Richards (Growth and sigmoidal) | time |
| Standard curve | line, second-order polynomial, sigmoidal 4PL and 5PL with X as concentration, "Interpolate unknowns" ticked (Lines and polynomials, Classic) | concentration |
| Peaks and waves | Gaussian, Lorentzian, sine (Gaussian, Sine waves and peaks) | any |
| Radiation | linear-quadratic (Linear-quadratic) | dose |

Each equation gets metadata in `@ps/analyses` (`analyses/src/explain/equations.ts`, not in
`@ps/stats`): `goal`, `xScale: 'log' | 'linear' | 'time'`, a plain description of each parameter
("IC50: the concentration giving a response halfway between Top and Bottom"), and its nested
relatives (the standard-slope model is nested in the variable-slope one). A test asserts every
equation of `EQUATIONS` has a goal (or is listed as "All equations" only) and an `xScale`.

**Thumbnails**: each model's curve at typical parameter values, drawn as a tiny transient graph
(§5.1) with the parameters labelled (Top, Bottom, EC50 at the midpoint); snapshot-tested.

### 9.2 Log-X detection (S8)

From `TableFacts.x` (descriptive, before any fit):

| Rule | Condition | Message (check level `note`, with fixes) |
| --- | --- | --- |
| Concentrations under a log model | model `xScale = 'log'`, every X > 0, max X / min X ≥ 100 | "X looks like concentrations (1e-10 to 1e-5), but this model expects log(concentration). [Transform X to log10] [Use the concentration form of this model]" |
| Log values under a concentration model | model `xScale = 'linear'`, some X < 0, X within −15 … 0 spanning 2–8 units | "X looks like log molar (−10 to −5), but this model expects concentrations. [Use the log form of this model]" |
| Zero dose | log model, some X = 0 | "1 row has X = 0, which has no logarithm and is left out. Fit on the concentration scale, or enter the vehicle as a very low dose." |

"Transform X to log10" adds a Transform analysis (X = log10(X)) and fits its result. The chooser
asks "Is X the dose or log(dose)?" with the same hint (§3.5).

### 9.3 EC50 and plateau warnings (after the fit, in results)

| Warning | Rule |
| --- | --- |
| EC50 (IC50, Kd…) outside the tested range | the fitted midpoint parameter (on X's scale) is below min X or above max X: "The EC50 lies outside the doses tested; it is an extrapolation." |
| Plateau not reached | Top or Bottom lies beyond the range of the observed Y by more than that range: "The top plateau isn't reached by the data: Top = 412 is far above the highest response (180). Fix Top (e.g. 100 for normalized data) or test higher doses." |
| EC50 poorly determined | the CI of logEC50 is wider than the X range: "The data don't determine the EC50 well (its 95% CI spans more than the doses tested)." |

Each names a constraint fix ("Fix Bottom = 0") that opens Edit on the constraint. They are rules
on fitted numbers, not new statistics; tested on fixtures. The profile-likelihood CI becomes the
default for new fits (`ciMethod: 'profile'`, pinned `symmetric` for saved ones).

### 9.4 One model comparison, chosen in advance (S18)

`nonlinearFit` and `nonlinearFitMV` gain `compareBy: 'fTest' | 'aicc' | 'both'`, default
**fTest**; `both` is the legacy value for saved analyses (pinned), not offered.

- Chosen in the form (and asked by the chooser) before results; one verdict reported ("Preferred
  model: the variable-slope model, extra sum-of-squares F test P = 0.003"); the other method's
  numbers only under Details if asked.
- The F test is greyed when the two models aren't nested ("These models aren't nested; compare
  them by AICc"): nesting is structural (comparing a parameter between data sets is always
  nested; two built-in equations by their declared relatives; a user equation against anything:
  AICc only).
- The sketch shows both models' starting shapes; no verdict live.

### 9.5 The curve-fit sketch

The data with the chosen model's **starting shape** (from the equation's automatic initial values,
no fit), labelled "starting shape, not the fit"; constraints as dashed lines (Bottom = 0); a
shared parameter shown as one handle across data sets; weighting as point sizes; replicates as
points or means. Detected-X notes (§9.2) sit under it. No parameter value is shown.

---

## 10. Data model changes, phase plan, risks and open questions

### 10.1 Data model changes

**Document (schema v3; every change additive and optional, so no schema bump and no migration;
DATA_MODEL.md updated in the phase that adds each):**

| Where | Field | Phase | Absent means |
| --- | --- | --- | --- |
| `AnalysisNode` | `history?: MethodChange[]` (§7.1) | 51c | no recorded changes |
| `AnalysisNode` | `origin?: { guide?: { entry: string; answers: Record<string, string>; followed: boolean }; bracket?: true }` | 51a (guide), 51c (bracket) | made by hand |
| `AnalysisNode` | `autoName?: true` | 51d | the name is the user's |
| `AnalysisNode.input` | `byX?: true` (each X a row of a grouped table) | 51c | as today |
| `DataTable` | `factorNames?: { rows?: string; columns?: string }` (grouped) | 51d | "Row factor", "Column factor" |
| bracket annotation | `label.test?: boolean` | 51c | no test name |
| `ResultRef` (`cell`) | `rowKey?`, `blockKey?`, `columnKey?` | 51d | labels, then legacy labels |

New command: `analysis.recordChange` (51c), in DATA_MODEL §8.1's table.

**Analysis params** (per plugin, versioned by `pluginVersion` with `migrateParams`, §6.1): the
fields of §6.2, §6.3, §8.3 and §9.4. The plugin versions that move: `ttest`, `mannWhitney`,
`wilcoxon`, `oneSample`, `nestedT`, `nestedOneWay`, `correlation`, `contingency`, `oneWayAnova`,
`multipleOneWay`, `twoWayAnova`, `threeWayAnova`, `friedman`, `multipleT`, `pStack`, `normality`,
`survival`, `survivalFromVariables`, `roc`, `blandAltman`, `monteCarlo` (51c, 51d),
`nonlinearFit`, `nonlinearFitMV` (51e).

**Results (derived cache)**: `ResultBlock` `summary` member, row and column keys,
`Diagnostic.where`, `values.test` (behind the `ANALYSES_VERSION` bumps of §6.5).

**Plugin contract (code)**: `FormField.explain`, `tier`, `appliesTo`, `method`; option `explain`,
`unavailable`; `AnalysisDef.cards`, `shared`, `check`, `sketch`, `roles`, `methodName`,
`summarize` (inside `run`); `RunContext.source`, `yTitle`; the `MethodCard` and `GuideEntry`
types.

**Not in the document**: the chooser's answers per table and the dialog's last tab (view state),
the sketch, checks, explanations.

Why no schema v4: the existing practice (roadmap 35 and the 34 series) adds optional fields
without a bump; no field changes meaning, and every reader of a v3 file without them behaves as
today. A migration would only be needed if an existing field changed meaning; the one candidate,
the sign of one-way comparisons, is a params change handled per plugin.

### 10.2 Phase plan

Recommended **merge order: 51a → 51c → 51b → 51d → 51e** (letters kept as proposed; versions
follow the merge order, as 27 after 28b did). Why 51c before 51b:

- The statistical changes are the highest-risk and highest-value part (S1–S5 are four of the
  top five), independent of the new dialog, and need the R work.
- The new dialog then builds its tiers, conditions and sketches once, against the final params
  (one-tailed direction, RM method, survival test, Kruskal-Wallis P method, family across rows),
  instead of twice.
- 51a's recommendations and tags otherwise disagree with the defaults until 51c lands; with 51c
  next, that window is one phase.

| Phase | Version | Scope | Tests | Size |
| --- | --- | --- | --- | --- |
| **51a Explanations and the chooser** | 0.3.8 | §2 content model and every card, field and option text (54 analyses, about 300 fields, 600 options), reasons beside every tag (S6, S24, U15, U27); Help › Choosing an analysis; the chooser data (§3) and its UI as the **Guide me** tab of the current dialog (widened to `min(1200px, 94vw)`; cards shown under the form until 51b's side panel); entry points (empty results, Compare these columns…, Analyze menu, U5); search across kinds and by question (U3); opening on the chooser or the last analysis, no duplicate rows (U2); S38's label; `origin.guide` | `explain.test.ts`, `guide.test.ts` (paths, params, snapshot of leaves), search and dialog (happy-dom); e2e **`analysisGuide.spec.ts`** (new: column table → "Is each group different from a control?" → Dunnett preset → Analyze → results; a fit question on a column table → "needs an XY table"; keyboard-only path) with its rule in `tools/e2e-affected.mjs`; `analyses`, `accessibility` specs | L (mostly writing) |
| **51c Safer defaults and multiplicity** | 0.3.9 | §6 (every finding marked 51c, decision 18 superseded), §7 (history, notice, brackets with `byX`, test names on labels, duplicate warning), `paramsOf`, complete bracket and Monte Carlo params; option text updated for the new defaults | oracle suites of §6.4; `migrateParams.test.ts` with v1 fixtures; v1 examples hold; example fingerprints re-recorded once (params gained fields) with the reason; engine tests for `analysis.recordChange` and `byX`; bracket and label tests; goldens: new ones for test-named brackets and the star key, every earlier golden byte-identical; e2e `analyses.spec.ts` (Welch default, one-tailed needs a direction), `resultsOnGraphs.spec.ts` (a second bracket offers one ANOVA, labels name the test, duplicate badge), new **`methodHistory.spec.ts`** (change after results → notice → history in results, undo) | XL (split point if needed: §7 as 51c-2 after the statistics) |
| **51b The new Analyze dialog** | 0.3.10 | §4 (three panels, responsive, experiment-language options for every analysis, tiers, the conditions of §4.4, checks before OK sharing `validate`, Error status and the right link, chips, carry-over, roles, keyboard and screen readers) and §5 (the sketch for every family but curve fitting) | `analysisConditions.test.ts` (§4.4's table), `check.test.ts` (check ⇔ run), tier and explain coverage, sketch specs per family on fixtures and scene snapshots, the import boundary of `sketch/`, preset ids exist, sampling and the timing guard; e2e new **`analyzeDialog.spec.ts`** (1440 and 1024 layouts, paired lines appear, Analyze disabled with the reason on an empty table, roles for a regression, keyboard-only) and visual snapshots; `accessibility.spec.ts` (axe on the dialog) | XL (split point: the sketch as 51b-2) |
| **51d Results that explain themselves** | 0.3.11 | §8: summary blocks and sentences for every family, sheet order, the Method section and methods paragraph, names in labels and factor names, row keys and legacy labels, one sign convention (pinned for saved), comparisons headers, the effect plot, one answer per question, readable numbers, names that follow the method (S12, S15, S23, S25, S41, S43, U18–U23, U25, U26, U29) | sentence snapshots, reference resolution (new keys, labels, a legacy fixture document), sign pins, names; result-label goldens byte-identical (their values unchanged); e2e new **`analysisResults.spec.ts`** (the summary first, user names, the effect plot opens as a graph, renaming stops auto-naming), `examples.spec.ts` | L |
| **51e Curve fitting** | 0.3.12 | §9: the model picker by goal with thumbnails, equation metadata, log-X checks and fixes, EC50 and plateau warnings, profile CIs by default, one model comparison chosen in advance, the curve-fit sketch (S8, S18, U10) | metadata coverage, detection rules, warning fixtures, `compareBy` pins, thumbnail snapshots; e2e new **`curveFitting.spec.ts`** (IC50 from a log-X table through the picker; concentration X triggers the note and Transform fixes it; compare EC50s by F test) | M |

Every phase: `pnpm check`, its own specs in Chromium, WebKit and Firefox, `pnpm e2e:affected`;
the full `pnpm e2e` on the merged main before pushing; each mergeable alone (51b and 51d don't
need each other; 51e uses 51b's dialog for its picker's placement, and would otherwise put the
picker in the current form).

### 10.3 Risks

- **Text volume and drift.** About 1,000 pieces of text; the coverage and length tests catch
  gaps, not wrong statements. Mitigation: the statistics reviewer checks the cards and the
  compare-groups options before 51a merges; later analyses' text is reviewed in their phases.
- **Example fingerprints change in 51c** (params gain fields), which the repo rules allow only for
  intended changes: the phase states it, pins every changed default in the examples' sources,
  and `v1Examples.test.ts` proves the results unchanged.
- **Result references.** Renamed labels could break result labels on users' graphs; §8.2's keys
  and legacy labels exist for this, tested with a pre-51d document.
- **Exact Kruskal-Wallis cost.** Enumeration grows fast; the limit is set by the CPU-time guard,
  with the approximation said in the result beyond it.
- **The dialog at 1024 × 768.** Three panels don't fit; the collapsed rail and 300 px sketch are
  tested at that size in e2e and visual snapshots.
- **Two-way within X via `byX`.** A new input modifier touches the engine's input path; it is
  checked against the same data as a grouped table, result for result.

### 10.4 Open questions for you

1. **Merge order**: 51a → 51c → 51b → 51d → 51e (statistics before the new dialog), as
   recommended in §10.2, or your proposed 51a → 51b → 51c?
2. **Saved one-tailed analyses**: keep their P (computed in the observed direction) with a
   warning asking to state the direction (proposed), or convert them to two-tailed?
3. **Curve-fit sketch**: the model's starting shape only (proposed: fast, and no "fit until the
   EC50 looks right"), or the fitted curve live without any numbers (the statistics review
   allows it)?
4. **New multiplicity defaults**: FDR (Benjamini-Hochberg) across correlation pairs and FDR
   across the rows of multiple one-way ANOVAs by default, and Q = 5% instead of 1% for new
   analyses (amending decision 51). Agree?
5. **Sign convention for new one-way and two-way comparisons**: later − earlier (each group −
   control), flipping the sign of today's "A vs. B" rows for new analyses only. Agree?

---

**Answers (2026-10-12).**
1. Merge order: **51a → 51c → 51b → 51d → 51e** (0.3.8 … 0.3.12).
2. Saved one-tailed analyses: **kept, with a warning** asking for the predicted direction; nothing
   changes silently.
3. Curve-fit sketch: **the model's starting shape** (no live fitted curve), as proposed.
4. New multiplicity defaults: **yes, all three**: FDR (Benjamini-Hochberg) across correlation
   pairs and across the rows of multiple one-way ANOVAs, and Q = 5 % for new analyses (amends
   decision 51); saved analyses keep theirs.
5. Sign convention: **later − earlier (group − control)** for new analyses; saved ones keep their
   direction.

## 11. Appendix: every finding and where it is handled

Later (not in 51): S17 (Cox proportional-hazards check), S27 (pairing-effectiveness wording),
S37 (one "Compare two groups" analysis), S40 (Poisson extras), S44 (lognormal option in the t
test and one-way ANOVA).

| Finding | Phase | Section |
| --- | --- | --- |
| S1 one-tailed direction | 51c | §6.3 |
| S2 Welch default, F test off | 51c | §6.2 |
| S3 equal-SD prompts, Bartlett | 51c (statistics), 51b (question first) | §6.2, §4.2 |
| S4 brackets | 51c | §7.3 |
| S5 RM with missing values | 51c | §6.2 |
| S6 explanations | 51a | §2 |
| S7 test shopping | 51c, 51b (no live P) | §7, §5.8 |
| S8 log-dose, EC50 and plateau | 51e (chooser question in 51a) | §9.2, §9.3, §3.5 |
| S9 FDR across rows | 51c | §6.2 |
| S10 invalid combinations | 51b (form), 51c (RM main effects) | §4.4, §6.2 |
| S11 Kruskal-Wallis exact, Dunn | 51c | §6.2 |
| S12 medians wording | 51d (cards in 51a) | §8.6, §2.5 |
| S13 outliers before tests | 51c (form text in 51a) | §6.2 |
| S14 normality | 51c | §6.2 |
| S15 two-way main effects | 51d note, 51a chooser | §8.6, §3.5 |
| S16 survival | 51c | §6.2 |
| S18 one model comparison | 51e | §9.4 |
| S19 replicates | 51b (question), 51a (chooser) | §4.2, §3.5 |
| S20 normalized data | 51c | §6.2 |
| S21 contingency trend | 51c | §6.2 |
| S22 contingency orientation | 51c (params), 51b (editor, sketch) | §6.2, §5.7 |
| S23 comparisons headers | 51d | §8.4 |
| S24 reasons for defaults | 51a | §2.6, §8.4 |
| S25 sign convention | 51d | §8.3 |
| S26 two-way RM labels | 51b | §4.2 |
| S28 mixed-model df | 51c | §6.2 |
| S29 power from pilot data | 51c | §6.2 |
| S30 correlation pairs | 51c | §6.2 |
| S31 summary data | 51b (form), 51a (chooser) | §4.4, §3.5 |
| S32 Kolmogorov-Smirnov | 51a (chooser), 51b (form) | §3.5, §4.4 |
| S33 spelling | 51c | §6.2, §2.4 |
| S34 α and Q units | 51c | §6.2 |
| S35 stars | 51c | §6.2 |
| S36 NK and LSD | 51b | §4.2, §2.5 |
| S38 transform label | 51a | §6.2 |
| S39 ROC direction | 51c | §6.2 |
| S41 compare lines wording | 51d | §8.2 |
| S42 Fisher fallback | 51c | §6.2 |
| S43 effect sizes | 51d | §8.6 |
| U1 question-first way in | 51a | §3 |
| U2 dialog opens on the wrong row | 51a | §3.3 |
| U3 search | 51a | §3.6 |
| U4 alternatives in different places | 51a (the chooser hides it) | §3.5 |
| U5 quick lists | 51a | §3.3 |
| U6 which data, which order | 51b | §4.3 |
| U7 statistics words | 51b | §4.2 |
| U8 invalid options | 51b | §4.4 |
| U9 long flat forms | 51b | §4.1, §4.2 |
| U10 127-entry model select | 51e | §9.1 |
| U11 fixed 720 px dialog | 51b (widened in 51a) | §4.1 |
| U12 roles | 51b | §4.7 |
| U13 switching resets | 51b | §4.5 |
| U14 layout glitches | 51b | §4.2 |
| U15 defaults unexplained, nudges | 51a (reasons), 51c (nudges removed) | §2.6, §6.2 |
| U16 problems after OK | 51b | §4.6 |
| U17 pairing never shown | 51b | §5.2 |
| U18 no summary | 51d | §8.2 |
| U19 generic labels | 51d | §8.2 |
| U20 direction changes | 51d | §8.3 |
| U21 answer not on the first tab | 51d | §8.1 |
| U22 several tests at once | 51c (choices), 51d (layout) | §6.2, §8.6 |
| U23 names don't follow the method | 51d | §8.6 |
| U24 test shopping on graphs | 51c | §7 |
| U25 no picture of the effect | 51d | §8.5 |
| U26 unusable numbers | 51d | §8.6 |
| U27 no explanations | 51a | §2 |
| U28 editing re-opens the chooser | 51c (history), 51b (Change method…) | §7.2, §4.1 |
| U29 accessibility | 51b (dialog, sketch), 51d (results) | §4.8, §5.7, §8.6 |
