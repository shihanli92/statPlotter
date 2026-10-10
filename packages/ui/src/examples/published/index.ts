import { privateExamples } from '../privateExamples.ts'
import type { ExampleDef } from '../registry.ts'
import { paperExample } from './paper.ts'

/** The CC BY paper's figures (audit 2 P6: loaded when first needed, not with the app). */
export const loadPaperExample = () => import('../../paperExample.ts')

/** The CC BY chemistry paper's figures (Hoffmann et al.), loaded when first needed. */
export const loadHoffmannExample = () => import('./hoffmann.ts')

/** Tawk et al. (CC BY, data embedded): loaded when first needed, not with the app. */
export const loadTawkExample = () => import('./tawk.ts')

/**
 * Chen and Swaminathan et al. (CC BY, data embedded since audit 3; they read the local
 * source_data folder before): each loaded when first needed, not with the app.
 */
export const loadChenExample = () => import('./chen.ts')
export const loadSwamExample = () => import('./swam.ts')

/**
 * The second CC BY paper (Johnston et al.): its spec and the source data it embeds, loaded when
 * the example is first needed (audit 3: ~136 kB of tables, never with the app).
 */
export const loadJohnstonExample = () => import('../../johnstonExample.ts')

/**
 * Figures rebuilt from published papers' source data. The CC BY papers (Stucchi, Johnston,
 * Hoffmann, Tawk, Chen and Swaminathan et al.) embed their data; the others read the local source_data folder through
 * `ExampleContext.sourceFile`, so they are part of development builds only (audit 2 P6: every deployed build is without one).
 */
export const PUBLISHED_EXAMPLES: ExampleDef[] = [
  {
    id: 'stucchi',
    title: 'Stucchi et al. 2026 (Nature Immunology)',
    summary: 'Figures rebuilt from a CC BY paper’s source data',
    badge: 'Grouped',
    description:
      'Figures rebuilt from the paper’s source data (CC BY 4.0): two-way ANOVA comparisons, floating bars, joined means.',
    section: 'published',
    build: async ({ fonts }) => (await loadPaperExample()).createPaperExample(fonts),
  },
  {
    id: 'johnston',
    title: 'Johnston et al. 2026 (Nature Immunology)',
    summary: 'Five figures rebuilt from a CC BY paper’s source data',
    badge: 'Grouped',
    description:
      'Figures 1, 2, 3, 5 and 6 rebuilt from the paper’s source data (CC BY 4.0): paired line charts on log axes, stacked counts of antibodies and lineages, dot plots with median crossbars, a clustered epitope-binning heat map, and rank tests, a Kruskal-Wallis test and a Spearman correlation against the P values the figures print.',
    thumbnail: 'Fig. 2b – IGHV somatic hypermutation',
    section: 'published',
    build: async (ctx) => (await loadJohnstonExample()).createJohnstonExample(ctx),
  },
  {
    id: 'hoffmann',
    title: 'Hoffmann et al. 2026 (Nature Chemistry)',
    summary: 'Kinetics of a phosphate walker rebuilt from a CC BY paper’s source data',
    badge: 'XY',
    description:
      'Figures 2–5 rebuilt from the paper’s source data (CC BY 4.0): NMR kinetics over weeks, fuel cycles and minutes, a global fit of an equilibrium, percentages of row totals, a second Y axis, reversed time, statistics over windows of rows.',
    thumbnail: 'Fig. 3b – Equilibrium from G2P',
    section: 'published',
    build: async ({ fonts }) => (await loadHoffmannExample()).createHoffmannExample(fonts),
  },
  {
    id: 'tawk',
    title: 'Tawk et al. 2026 (Nature Microbiology)',
    summary: 'Gut-community figures rebuilt from a CC BY paper’s source data',
    badge: 'Grouped',
    description:
      'Figures 1–5 of Tawk et al., Nature Microbiology 2026 (https://doi.org/10.1038/s41564-026-02500-6), rebuilt from the paper’s source data (CC BY 4.0): taxonomic bar plots, a heat map, pies, horizontal bars with points, two-way ANOVA against a control row, lognormal multiple t tests with FDR q values.',
    section: 'published',
    thumbnail: 'Fig. 4c – With E. coli MR102',
    build: async ({ fonts }) => (await loadTawkExample()).createTawkExample(fonts),
  },
  {
    id: 'chen',
    title: 'Chen et al. 2026 (Nature Immunology)',
    summary: 'Vaccine-response cytokine figures rebuilt from a CC BY paper’s source data',
    badge: 'Grouped',
    description:
      'Figures 1b, 2, 3b, 4b–e and 6e and Extended Data Figs 2–4 and 5c of Chen et al., Nature Immunology 2026 (https://doi.org/10.1038/s41590-026-02547-x), rebuilt from the paper’s source data (CC BY 4.0): long-format tables imported one value per row or as records and made into means ± SEM, a clustered heat map, two files joined by person, and Mann-Whitney tests per quartile, paired t tests and a one-way ANOVA against the printed P values.',
    thumbnail: 'Fig. 1b – HAI antibody fold change by age',
    section: 'published',
    build: async ({ fonts }) => (await loadChenExample()).createChenExample(fonts),
  },
  {
    id: 'swaminathan',
    title: 'Swaminathan et al. 2026 (Nature Immunology)',
    summary: 'OTULIN R57C figures rebuilt from a CC BY paper’s source data',
    badge: 'Column',
    description:
      'Figures 2c, 2e, 3f, 4b and 5b of Swaminathan et al., Nature Immunology 2026 (https://doi.org/10.1038/s41590-026-02568-6), rebuilt from the paper’s source data (CC BY 4.0): unpaired t tests (single and per cytokine) against the P values the figures print and the source data state, a Mann-Whitney test where the legend’s t test doesn’t match the figure, and two printed values the data don’t reproduce.',
    thumbnail: 'Fig. 3f – Plasma cytokines',
    section: 'published',
    build: async ({ fonts }) => (await loadSwamExample()).createSwamExample(fonts),
  },
  // Papers whose figures are rebuilt from source data read at run time from the local
  // source_data folder (never part of the app; `../private/`, left out of the public repository).
  // (Chen and Swaminathan et al., CC BY, were among them until audit 3 embedded their data.)
  ...(import.meta.env.DEV ? privateExamples().papers.map(paperExample) : []),
]
