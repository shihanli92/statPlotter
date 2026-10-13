import {
  type AnalysisDef,
  type AnalysisNode,
  type AnalysisResult,
  type MethodNames,
  paramsOf,
} from '@ps/model'
import { methodNameOf } from './naming.ts'
import { listed } from './summary/read.ts'

// Roadmap 51d (design §8.1, §7.2): the methods paragraph of an analysis — the method and its
// options, the comparisons and their correction, how it was set up, the method's history when it
// changed after results were seen, and the software — generated from the analysis node, its
// definition and its result, to copy into a paper's methods.

export interface MethodsInput {
  node: Pick<AnalysisNode, 'analysisId' | 'pluginVersion' | 'params' | 'history' | 'origin'>
  def: AnalysisDef<unknown>
  /** Names of the analyzed data sets (in order), the table, the factors. */
  names: MethodNames
  /** The definition of another analysis (for the method history). */
  defOf: (id: string) => AnalysisDef<unknown> | undefined
  /** Titles of data sets by key (for the history's former data sets). */
  titleOf?: (key: string) => string | undefined
  result?: AnalysisResult
  appVersion: string
  /** The chooser's question, when Guide me set it up. */
  guideQuestion?: string
}

const textValue = (r: AnalysisResult | undefined, key: string): string | null => {
  const v = r?.values[key]
  return v?.kind === 'text' ? v.v : null
}

/** "12 Oct 2026". */
const day = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** The method part of an automatic name ("Welch’s t test: A vs B" → "Welch’s t test"). */
const methodOf = (name: string) => name.replace(/:.*$/, '').replace(/ of .*$/, '')

/** The methods paragraph of an analysis. */
export function methodsParagraph(m: MethodsInput): string {
  const parsed = paramsOf(m.def, m.node)
  const params = (parsed.ok ? parsed.params : {}) as Record<string, unknown>
  const out: string[] = []
  const test = textValue(m.result, 'test') ?? methodOf(methodNameOf(m.def, params, m.names))
  const sets = m.names.dataSets.filter(Boolean)
  const what =
    sets.length >= 2 && sets.length <= 6
      ? `${listed(sets)} were compared by ${test}`
      : `“${m.names.table}” was analyzed by ${test}`
  const tails =
    params.tails === 'one'
      ? params.predicted === 'increase' || params.predicted === 'decrease'
        ? ' (one-tailed, in the direction predicted before the experiment)'
        : ' (one-tailed)'
      : params.tails === 'two'
        ? ' (two-tailed)'
        : ''
  out.push(`${what}${tails}.`)
  const comparison = textValue(m.result, 'comparisonTest')
  const caption = m.result?.sheets
    .find((s) => s.key === 'comparisons')
    ?.blocks.find((b) => b.type === 'table' && b.caption)
  if (comparison)
    out.push(
      `Multiple comparisons: ${comparison}${caption?.type === 'table' && caption.caption ? ` (${caption.caption.replace(/\.$/, '')})` : ''}.`,
    )
  if (typeof params.confidenceLevel === 'number')
    out.push(`Confidence intervals are ${+(params.confidenceLevel * 100).toFixed(2)}%.`)
  if (m.node.origin?.bracket)
    out.push(
      'The test was added from a bracket on a graph and is not corrected for other comparisons.',
    )
  if (m.guideQuestion)
    out.push(`The method was chosen from the question “${m.guideQuestion}” (Guide me).`)
  for (const h of m.node.history ?? []) {
    const was = m.defOf(h.from.analysisId)
    if (!was) continue
    const before = paramsOf(was, { params: h.from.params, pluginVersion: h.from.pluginVersion })
    const names = {
      ...m.names,
      dataSets: h.from.dataSets.map((k) => m.titleOf?.(k) ?? k),
    }
    const name = methodOf(methodNameOf(was, before.ok ? before.params : {}, names))
    const changes = h.changes.length ? ` (${h.changes.join('; ')})` : ''
    out.push(
      `The analysis was first run as ${name} and changed ${h.afterResults ? 'after' : 'before'} its results were seen${changes}, ${day(h.at)}${h.reason ? `; reason: “${h.reason}”` : ''}.`,
    )
  }
  out.push(`Analyzed with statPlotter ${m.appVersion}.`)
  return out.join(' ')
}
