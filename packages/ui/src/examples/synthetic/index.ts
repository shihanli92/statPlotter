import type { FontRegistry } from '@ps/graph'
import type { Project } from '@ps/model'
import type { ExampleContext, ExampleDef } from '../registry.ts'

type Builds = typeof import('./builds.ts')

/** The builders' module (audit 2 P6: loaded when first needed, not with the app). */
export const loadSyntheticBuilds = (): Promise<Builds> => import('./builds.ts')

/** A build by one of the builders, once their module is loaded. */
const lazy =
  (make: (b: Builds, fonts: FontRegistry) => Project) =>
  async ({ fonts }: ExampleContext): Promise<Project> =>
    make(await loadSyntheticBuilds(), fonts)

/** Examples built from synthetic data (part of the app), in the order they are listed. */
export const SYNTHETIC_EXAMPLES: ExampleDef[] = [
  {
    id: 'getting-started',
    title: 'Getting started: column data',
    summary: 'Column data compared with t tests and ANOVA, with live brackets',
    badge: 'Column',
    thumbnail: 'Dose response (bars)',
    description:
      'Two and three groups: unpaired, Welch and Mann-Whitney tests, one-way ANOVA with Tukey, Kruskal-Wallis; scatter, bar (with labels), swarm and violin graphs with live significance brackets, an estimation plot, and a figure page.',
    section: 'examples',
    build: lazy((b, fonts) => b.createGettingStarted(fonts)),
  },
  {
    id: 'grouped',
    title: 'Grouped data',
    summary: 'Two-way ANOVA, multiple t tests and a volcano plot',
    badge: 'Grouped',
    description:
      'Two-way ANOVA (ordinary and repeated measures), multiple t tests with a volcano plot, multiple one-way ANOVAs, three-way ANOVA, row statistics and fraction of total; grouped bars and a time course.',
    section: 'examples',
    build: lazy((b, fonts) => b.createGroupedExample(fonts)),
  },
  {
    id: 'curve-fitting',
    title: 'Curve fitting and standard curves',
    summary: 'Dose-response fits, standard curves and interpolation',
    badge: 'XY',
    description:
      'A global dose-response fit with a shared Hill slope and a model comparison; ELISA (4PL) and BCA (linear) standard curves with unknowns interpolated; enzyme inhibition with data set constants; a user-defined equation; ROUT with a residual plot.',
    section: 'examples',
    build: lazy((b, fonts) => b.createCurveFitting(fonts)),
  },
  {
    id: 'data-processing',
    title: 'Data processing and nested data',
    summary: 'Analyses whose tables feed other analyses and graphs',
    badge: 'Column · XY',
    thumbnail: 'Normalized response',
    description:
      'Analyses that make tables feeding other analyses and graphs: Transform then a t test, Normalize then a curve fit, Remove baseline then area under the curve, Frequency distribution, outliers removed before an ANOVA; nested t test and one-way ANOVA.',
    section: 'examples',
    build: lazy((b, fonts) => b.createDataProcessing(fonts)),
  },
  {
    id: 'clinical',
    title: 'Survival, contingency and multiple variables',
    summary: 'Kaplan-Meier curves, contingency tests and regression',
    badge: 'Survival',
    description:
      'Kaplan-Meier curves with the log-rank test; Fisher’s exact and chi-square tests; a patient cohort with multiple linear, logistic and Cox regression and PCA; a ROC curve and a Bland-Altman plot.',
    section: 'examples',
    build: lazy((b, fonts) => b.createClinicalExample(fonts)),
  },
  {
    id: 'formatting',
    title: 'Formatting and figure layout',
    summary: 'Two Y axes, custom colours and a four-panel figure',
    badge: 'XY · Layout',
    description:
      'A right Y axis, error bars drawn behind points, one bar formatted on its own, annotations behind the data, custom colours and fonts, a four-panel figure with panel labels and a title; a bubble plot, and functions plotted with data and on their own.',
    section: 'examples',
    build: lazy((b, fonts) => b.createFormattingExample(fonts)),
  },
  {
    id: 'more-graphs',
    title: 'More graph types',
    summary: 'Forest plots, stacked bars, bands and a heat map',
    badge: 'Mixed',
    thumbnail: 'Gene expression (heat map)',
    description:
      'Horizontal bars from a baseline of 1 and a forest-style plot with brackets beside it; stacked and 100% stacked bars; a time course with a line through each mouse, a shaded SEM band and a gap at a missing day; geometric means with their SD factor and a grand mean line; a heat map of gene expression, clustered with dendrograms.',
    section: 'examples',
    build: lazy((b, fonts) => b.createMoreGraphsExample(fonts)),
  },
  {
    id: 'parts-of-whole',
    title: 'Parts of whole',
    summary: 'Pies, donuts and 100% stacked bars',
    badge: 'Parts of whole',
    thumbnail: 'Spleen (donut)',
    description:
      'Parts-of-whole tables graphed as pies (one per data set), 100% stacked bars and a donut with a slice pulled out; labels as percentages, values or categories.',
    section: 'examples',
    build: lazy((b, fonts) => b.createPartsOfWholeExample(fonts)),
  },
  {
    id: 'multiple-variables',
    title: 'Multiple variables: text and calculated variables',
    summary: 'Text and calculated variables that update live',
    badge: 'Multiple variables',
    description:
      'A trial table with text (categorical) variables and calculated variables (BMI, change from baseline, IF flags) that update live; a bubble plot coloured by category; a variable extracted by category into a column table for a one-way ANOVA; a regression on calculated predictors.',
    section: 'examples',
    build: lazy((b, fonts) => b.createVariablesExample(fonts)),
  },
  {
    id: 'single-cell',
    title: 'Single-cell T cells',
    summary: '30,000 simulated cells: UMAPs and per-sample graphs',
    badge: 'Multiple variables',
    description:
      '30,000 simulated cells from four donors, laid out as a Seurat export: the UMAP by cluster with the clusters named at their centres, a marker gene’s feature plot drawn highest on top, the UMAP by sample and one graph per sample on a linked page, a gene by cluster, and a figure page. Many points are drawn as an image on screen and as vectors in exports.',
    section: 'examples',
    build: lazy((b, fonts) => b.createSingleCellExample(fonts)),
  },
]
