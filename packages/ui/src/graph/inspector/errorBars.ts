import type { ErrorSpec } from '@ps/model'

export type ErrorStat = ErrorSpec['stat']
type CenterStat = 'mean' | 'median' | 'geomean' | 'none'

export const ERROR_STATS: readonly { value: ErrorStat; label: string }[] = [
  { value: 'SD', label: 'SD' },
  { value: 'SEM', label: 'SEM' },
  { value: 'CI', label: '95% CI' },
  { value: 'range', label: 'Range (min to max)' },
  { value: 'IQR', label: 'Interquartile range' },
  { value: 'MAD', label: 'MAD (median absolute deviation)' },
  { value: 'MADn', label: 'MAD × 1.4826 (≈ SD for normal data)' },
  { value: 'geoSD', label: 'Geometric mean ×/÷ geometric SD factor' },
  { value: 'geoCI', label: '95% CI of the geometric mean' },
  { value: 'none', label: 'None' },
]

/** Spreads that belong with the mean, the median and the geometric mean. */
const MEAN_SPREAD: readonly ErrorStat[] = ['SD', 'SEM', 'CI']
const MEDIAN_SPREAD: readonly ErrorStat[] = ['IQR', 'MAD', 'MADn']
const GEO_SPREAD: readonly ErrorStat[] = ['geoSD', 'geoCI']

/**
 * The error bar to use after the centre changes: switching to the median turns SD / SEM / CI into
 * the interquartile range, to the geometric mean into its SD factor, and back to the mean into
 * SD; anything else (range, none, or an already matching choice) is kept.
 */
export function pairedError(center: CenterStat, error: ErrorStat): ErrorStat {
  if (center === 'median' && [...MEAN_SPREAD, ...GEO_SPREAD].includes(error)) return 'IQR'
  if (center === 'geomean' && [...MEAN_SPREAD, ...MEDIAN_SPREAD].includes(error)) return 'geoSD'
  if (center === 'mean' && [...MEDIAN_SPREAD, ...GEO_SPREAD].includes(error)) return 'SD'
  return error
}

/** The centre a spread goes with (range and none: the current one). */
export function pairedCenter(error: ErrorStat, center: CenterStat): CenterStat {
  if (MEDIAN_SPREAD.includes(error)) return 'median'
  if (GEO_SPREAD.includes(error)) return 'geomean'
  if (MEAN_SPREAD.includes(error)) return 'mean'
  return center
}
