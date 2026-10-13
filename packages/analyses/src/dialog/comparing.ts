import type { AnalysisDef } from '@ps/model'
import { comparisons } from '../sketch/words.ts'

// Roadmap 51b (design §4.3, U6): what is compared, in the sign convention of the analysis — "Comparing:
// Treated − Control" (two groups, B − A), "each group − Vehicle" (with a control), "every pair
// (3 comparisons)" — said under the group chips as they change.

type Params = Record<string, unknown>

/** Analyses of two groups whose effect is B − A (the second chosen group minus the first). */
const TWO_GROUPS = new Set([
  'ttest',
  'mannWhitney',
  'wilcoxon',
  'kolmogorovSmirnov',
  'nestedT',
  'multipleT',
  'roc',
  'blandAltman',
])

/** Analyses whose `comparisons` compare the chosen groups (one factor). */
const ONE_FACTOR = new Set(['oneWayAnova', 'friedman', 'nestedOneWay', 'multipleOneWay'])

const pairs = (k: number) => (k * (k - 1)) / 2
const quote = (s: string) => `“${s || 'untitled'}”`

/**
 * The comparison sentence for the chosen groups (titles in the chips' order), or null when the
 * analysis compares no groups.
 */
export function comparingText(
  def: Pick<AnalysisDef<unknown>, 'id'>,
  params: Params,
  titles: readonly string[],
  controlTitle?: string,
): string | null {
  const k = titles.length
  if (TWO_GROUPS.has(def.id)) {
    if (k < 2) return null
    const [a, b] = titles as [string, string]
    if (def.id === 'roc') return `Controls: ${quote(a)}; patients: ${quote(b)}.`
    if (def.id === 'blandAltman')
      return params.order === 'bMinusA'
        ? `Comparing: ${quote(b)} − ${quote(a)}.`
        : `Comparing: ${quote(a)} − ${quote(b)}.`
    if (def.id === 'multipleT')
      return params.difference === 'bMinusA'
        ? `Comparing in each row: ${quote(b)} − ${quote(a)}.`
        : `Comparing in each row: ${quote(a)} − ${quote(b)}.`
    const matched = params.design === 'paired' || def.id === 'wilcoxon'
    return `Comparing: ${quote(b)} − ${quote(a)}${matched ? ', row by row (each row a pair)' : ''}.`
  }
  if (def.id === 'oneSample') {
    const h = typeof params.hypothetical === 'number' ? params.hypothetical : 0
    return k ? `Comparing ${k === 1 ? quote(titles[0]!) : 'each group'} with ${h}.` : null
  }
  if (ONE_FACTOR.has(def.id)) {
    if (k < 2) return null
    const within = def.id === 'multipleOneWay' ? ' within each row' : ''
    const later = params.differenceAs !== 'earlierMinusLater'
    switch (params.comparisons) {
      case 'allPairs':
        return `Comparing every pair${within} (${comparisons(pairs(k))})${later ? ', later − earlier' : ''}.`
      case 'vsControl': {
        const c = controlTitle ?? titles[0]!
        return `Comparing each group − ${quote(c)}${within} (${comparisons(k - 1)}).`
      }
      case 'trend':
        return `Testing for a steady trend across the ${k} groups, in this order.`
      default:
        return `Asking whether any of the ${k} groups differ${within} (no comparisons).`
    }
  }
  return null
}
