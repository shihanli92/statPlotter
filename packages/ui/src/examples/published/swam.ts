import type { FontRegistry } from '@ps/graph'
import type { Project } from '@ps/model'
import { type AnalysisSpec, type BuiltPaper, buildPaper, type PaperSpec } from './paper.ts'
import { SWAM_FILES } from './swamData.ts'

/*
 * Figures of Swaminathan, Gil, Bhattad et al., “Pyoderma gangrenosum caused by the molecular
 * uncoupling of OTULIN catalytic activity and LUBAC binding”, Nature Immunology 27, 1619–1632
 * (2026), https://doi.org/10.1038/s41590-026-02568-6, rebuilt from the paper's source data
 * (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). The data are embedded
 * (`swamData.ts`: each workbook's sheet as CSV, named after the workbook), so the example is
 * part of every build, loaded when first opened (audit 3; it read a local source_data folder
 * before). It is built as the other papers are (`buildPaper`).
 */

const BLUE = '#1f3fe0'
const RED = '#f03a17'
const ORANGE = '#f7941d'
const GREY = '#8c8c8c'

/** A two-tailed unpaired Student's t test of two data sets, with its printed P value. */
const t = (a: string, b: string, p: string, differs?: string): AnalysisSpec => ({
  analysis: 'ttest',
  test: 'Unpaired t test',
  dataSets: [a, b],
  printed: [{ a, b, p, ...(differs ? { differs } : {}) }],
})

const MW_WHY =
  'the legend names Student’s t test, which gives P = 0.00035 for WT vs R57C and 0.034 for WT vs L272P (which the figure marks NS); the exact Mann-Whitney test reproduces both (0.0079 is the smallest P possible with 5 vs 5 values).'

export const SWAM: PaperSpec = {
  id: 'swaminathan',
  title: 'Swaminathan et al. 2026 (Nature Immunology)',
  description:
    'OTULIN R57C in pyoderma gangrenosum (CC BY 4.0, data embedded): Fig. 2c, 2e, 3f, 4b and 5b rebuilt from the source data — unpaired t tests (single and per cytokine), a Mann-Whitney test where the legend’s t test doesn’t match the figure, and two printed values the data don’t reproduce.',
  citation:
    'Swaminathan, Gil, Bhattad et al., “Pyoderma gangrenosum caused by the molecular uncoupling of OTULIN catalytic activity and LUBAC binding”, Nature Immunology 27, 1619–1632 (2026), https://doi.org/10.1038/s41590-026-02568-6 (CC BY 4.0).',
  folder: 'swaminathan',
  panels: [
    {
      label: '2c',
      name: 'Fig. 2c – NF-κB luciferase activity',
      file: '41590_2026_2568_MOESM20_ESM.csv',
      sheet: '41590_2026_2568_MOESM20_ESM',
      legend: 'two-tailed unpaired Student’s t test against WT OTULIN (***P < 0.0001; NS).',
      analyses: [
        t('WT', 'D54A', 'ns'),
        t('WT', 'Y56F', 'ns'),
        t('WT', 'R57C', 'ns'),
        t(
          'WT',
          'L272P',
          '<0.0001',
          'With four experiments per group no test of these values reaches P < 0.0001 (Welch 0.15, Mann-Whitney 0.029, t test of log10 RLU 0.0023); the source data file also says “<0.0001”.',
        ),
      ],
      graph: {
        preset: 'boxPoints',
        logY: true,
        yTitle: 'RLU (arbitrary units)',
        colors: [GREY, GREY, BLUE, GREY, GREY, RED, ORANGE],
        rotate: 45,
      },
    },
    {
      label: '2e',
      name: 'Fig. 2e – HOIP/OTULIN binding ratio',
      file: '41590_2026_2568_MOESM21_ESM.csv',
      sheet: '41590_2026_2568_MOESM21_ESM',
      legend: 'two-tailed unpaired Student’s t test (P = 0.0079; NS).',
      analyses: (
        [
          ['R57C', '0.0079'],
          ['L272P', 'ns'],
        ] as const
      ).map(([mutant, p]) => ({
        analysis: 'mannWhitney',
        test: 'Mann-Whitney test',
        dataSets: ['WT', mutant],
        why: MW_WHY,
        printed: [{ a: 'WT', b: mutant, p }],
      })),
      graph: {
        preset: 'boxPoints',
        yTitle: 'HOIP/OTULIN ratio',
        colors: [BLUE, GREY, GREY, RED, ORANGE],
      },
    },
    {
      label: '3f',
      name: 'Fig. 3f – Plasma cytokines',
      file: '41590_2026_2568_MOESM24_ESM.csv',
      sheet: '41590_2026_2568_MOESM24_ESM',
      legend:
        'two-tailed unpaired Student’s t test per cytokine (IL-1β P = 0.0031, IL-8 P = 0.0001, TNF P = 0.0168).',
      analyses: [
        {
          analysis: 'multipleT',
          test: 'Unpaired t test per cytokine',
          params: { variance: 'individual', approach: 'none' },
          printed: [
            { a: 'WT/WT', b: 'R57C/R57C', row: 'IL-1B', p: '0.0031' },
            { a: 'WT/WT', b: 'R57C/R57C', row: 'IL-8', p: '0.0001' },
            { a: 'WT/WT', b: 'R57C/R57C', row: 'TNF', p: '0.0168' },
          ],
        },
      ],
      graph: {
        preset: 'barsPoints',
        error: 'SEM',
        logY: true,
        yTitle: 'pg ml^{−1}',
        colors: [BLUE, RED],
      },
    },
    {
      label: '4b',
      name: 'Fig. 4b – ASC specks',
      file: '41590_2026_2568_MOESM25_ESM.csv',
      sheet: '41590_2026_2568_MOESM25_ESM',
      legend: 'two-tailed unpaired Student’s t test (P = 0.039, 0.0008 and 0.019).',
      analyses: [
        t('WT NLRP3', 'WT NLRP3 + WT OTULIN', '0.039'),
        t('WT NLRP3 + WT OTULIN', 'WT NLRP3 + R57C OTULIN', '0.0008'),
        t(
          'WT NLRP3 + WT OTULIN',
          'WT NLRP3 + L272P OTULIN',
          '0.019',
          'The source data file itself lists P = 0.0124 for this comparison, as the app computes.',
        ),
      ],
      graph: {
        preset: 'boxPoints',
        yTitle: 'ASC specks/nuclei (%)',
        colors: [GREY, GREY, BLUE, RED, ORANGE, GREY],
        rotate: 45,
      },
    },
    {
      label: '5b',
      name: 'Fig. 5b – PI uptake at 72 h',
      file: '41590_2026_2568_MOESM28_ESM.csv',
      sheet: '41590_2026_2568_MOESM28_ESM',
      legend:
        'two-tailed unpaired Student’s t test; * P < 0.018 against WT + TNF, # P < 0.025 against WT-complemented cells + TNF.',
      analyses: [
        t('WT+TNF', 'KO+TNF', '<0.018'),
        t('WT+TNF', 'WT complementation+TNF', '<0.018'),
        t(
          'WT complementation+TNF',
          'R57C complementation+TNF',
          '<0.025',
          'P = 0.02508, also in the source data file: the legend’s threshold looks like this P value truncated to three decimals.',
        ),
        t('WT complementation+TNF', 'L272P complementation+TNF', '<0.025'),
      ],
      graph: {
        preset: 'barsPoints',
        error: 'SEM',
        yTitle: 'Mean RFI',
        rotate: 45,
      },
    },
  ],
}

/** Reads the embedded files (the paper's folder is `swaminathan/`). */
export const swamSourceFile = async (path: string): Promise<Uint8Array | null> => {
  const text = SWAM_FILES[path.replace(/^swaminathan\//, '')]
  return text === undefined ? null : new TextEncoder().encode(text)
}

/** The paper built from the embedded data, with its P value checks. */
export const buildSwam = (fonts: FontRegistry): Promise<BuiltPaper> =>
  buildPaper(SWAM, { fonts, sourceFile: swamSourceFile })

/** The example's project, from the embedded data. */
export async function createSwamExample(fonts: FontRegistry): Promise<Project> {
  return (await buildSwam(fonts)).project
}
