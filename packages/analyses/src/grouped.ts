import type { NormalizedDataSet } from '@ps/model'
import type { FamilyMethod, GroupData } from '@ps/stats'
import { z } from 'zod'

/** Helpers shared by the per-row analyses of grouped tables (Phase 11). */

/** A row's title in the data set's table, else "Row n". */
export const rowName = (ds: NormalizedDataSet | undefined, r: number): string =>
  ds?.rowTitles?.[r] || `Row ${r + 1}`

/** A row's title in the analyzed table, else "Row n". */
export const rowTitleOf = (input: readonly NormalizedDataSet[], r: number): string =>
  rowName(input[0], r)

/** A cell's replicate values in subcolumn order (NaN = empty/excluded), or null for summary. */
export function cellReps(ds: NormalizedDataSet, r: number): Float64Array | null {
  if (ds.data.shape !== 'replicates') return null
  return Float64Array.from(ds.data.reps, (rep) => rep[r] ?? Number.NaN)
}

/** The cell's finite values (raw data), or its mean/SD/N (summary data; null if incomplete). */
export function cellGroup(ds: NormalizedDataSet, r: number): GroupData | null {
  if (ds.data.shape === 'replicates') {
    const v = Array.from(cellReps(ds, r)!).filter(Number.isFinite)
    return v.length ? { values: v } : null
  }
  const d = ds.data
  const mean = d.mean[r]!
  const n = d.n[r]!
  const sd = n === 1 && !Number.isFinite(d.sd[r]!) ? 0 : d.sd[r]!
  return Number.isFinite(mean) && Number.isFinite(sd) && Number.isFinite(n) && n >= 1
    ? { mean, sd, n }
    : null
}

/** Whether a cell has anything entered (any value, or a mean). */
export function cellHasData(ds: NormalizedDataSet, r: number): boolean {
  if (ds.data.shape === 'replicates') return ds.data.reps.some((rep) => Number.isFinite(rep[r]!))
  return Number.isFinite(ds.data.mean[r]!)
}

// ---- Family of P values: Prism's multiple-comparisons choices for multiple t tests and stacks of
// P values ---------------------------------------------------------------------------------------

export const familyParams = {
  approach: z.enum(['fdr', 'significance', 'none']).default('fdr'),
  fdrMethod: z.enum(['bky', 'bh', 'by']).default('bky'),
  /** Desired FDR Q, as a percentage (as Prism's dialog). */
  q: z.number().gt(0).lt(100).default(1),
  sigMethod: z.enum(['holm-sidak', 'sidak', 'bonferroni']).default('holm-sidak'),
  alpha: z.number().gt(0).lt(1).default(0.05),
}
interface FamilyParams {
  approach: 'fdr' | 'significance' | 'none'
  fdrMethod: 'bky' | 'bh' | 'by'
  q: number
  sigMethod: 'holm-sidak' | 'sidak' | 'bonferroni'
  alpha: number
}

export const FAMILY_FIELDS = [
  {
    path: ['approach'],
    label: 'Multiple comparisons',
    kind: 'radio',
    options: [
      { value: 'fdr', label: 'Control the false discovery rate (FDR) — recommended' },
      {
        value: 'significance',
        label: 'Control the Type I error rate for the family (significance)',
      },
      { value: 'none', label: 'No correction for multiple comparisons' },
    ],
  },
  {
    path: ['fdrMethod'],
    label: 'Method',
    kind: 'select',
    options: [
      {
        value: 'bky',
        label: 'Two-stage step-up method of Benjamini, Krieger and Yekutieli (recommended)',
      },
      { value: 'bh', label: 'Original FDR method of Benjamini and Hochberg' },
      { value: 'by', label: 'Corrected method of Benjamini and Yekutieli' },
    ],
    showIf: { path: ['approach'], in: ['fdr'] },
  },
  {
    path: ['q'],
    label: 'Desired FDR (Q), %',
    kind: 'number',
    min: 0.001,
    max: 99,
    step: 0.5,
    showIf: { path: ['approach'], in: ['fdr'] },
  },
  {
    path: ['sigMethod'],
    label: 'Method',
    kind: 'select',
    options: [
      { value: 'holm-sidak', label: 'Holm-Šídák method (recommended)' },
      { value: 'sidak', label: 'Šídák-Bonferroni method' },
      { value: 'bonferroni', label: 'Bonferroni-Dunn method' },
    ],
    showIf: { path: ['approach'], in: ['significance'] },
  },
  {
    path: ['alpha'],
    label: 'Alpha (a fraction, e.g. 0.05)',
    kind: 'number',
    min: 0.0001,
    max: 0.5,
    step: 0.01,
    showIf: { path: ['approach'], in: ['significance', 'none'] },
  },
] as const

export function familyMethod(p: FamilyParams): FamilyMethod {
  return p.approach === 'fdr' ? p.fdrMethod : p.approach === 'significance' ? p.sigMethod : 'none'
}

export const FAMILY_TITLE: Record<FamilyMethod, string> = {
  bky: 'False discovery rate: two-stage step-up method of Benjamini, Krieger and Yekutieli',
  bh: 'False discovery rate: original method of Benjamini and Hochberg',
  by: 'False discovery rate: corrected method of Benjamini and Yekutieli',
  'holm-sidak': 'Statistical significance: Holm-Šídák method',
  sidak: 'Statistical significance: Šídák-Bonferroni method',
  bonferroni: 'Statistical significance: Bonferroni-Dunn method',
  none: 'Statistical significance: no correction for multiple comparisons',
}

/** Column headings of the decision and the adjusted value for a family method. */
export function familyColumns(p: FamilyParams): { flag: string; adjusted: string | null } {
  if (p.approach === 'fdr') return { flag: 'Discovery?', adjusted: 'q value' }
  if (p.approach === 'significance')
    return { flag: 'Below threshold?', adjusted: 'Adjusted P value' }
  return { flag: 'Below threshold?', adjusted: null }
}

/** The family's level as a fraction: Q or α. */
export const familyLevel = (p: FamilyParams) => (p.approach === 'fdr' ? p.q / 100 : p.alpha)
