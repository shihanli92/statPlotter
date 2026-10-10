import { type GraphNode, type Project, type ResultLookup, survivalData } from '@ps/model'
import { type KaplanMeier, kaplanMeier, type SurvivalSubject } from '@ps/stats'
import { type GraphSeries, resolveSeries } from '../../data.ts'
import { Extent } from '../../layout/common.ts'

// The `km` stat: Kaplan-Meier estimates per group (`@ps/stats`, oracle suite `survival`). It
// fixes the axes: linear, time from zero, percent survival from 0 to 100.

export interface KmSeries {
  s: GraphSeries
  km: KaplanMeier | null
  /** Its subjects (roadmap 35: counted at risk under the graph). */
  subjects: readonly SurvivalSubject[]
  /** Rows whose code is neither event nor censored. */
  invalidCode: number
}

/** Each data set's Kaplan-Meier estimate (null without subjects). */
export function kmSeries(
  project: Project,
  graph: Pick<GraphNode, 'seriesSource'>,
  result?: ResultLookup,
): KmSeries[] {
  const conf = project.settings.defaultConfidenceLevel
  return resolveSeries(project, graph, result).map((s) => {
    const d = survivalData(s.ds)
    const km = d.subjects.length ? kaplanMeier(d.subjects, { confLevel: conf }) : null
    return { s, km, subjects: d.subjects, invalidCode: d.invalidCode }
  })
}

/** Survival axes are linear: time from zero (X), percent survival 0–100 (Y). */
export function survivalExtent(
  series: readonly Pick<KmSeries, 'km'>[],
  axis: 'x' | 'y',
  log = false,
): Extent {
  const e = new Extent(log)
  e.add(0)
  if (axis === 'y') e.add(100)
  else for (const p of series) for (const st of p.km?.steps ?? []) e.add(st.time)
  return e
}

/** Staircase through (time, value) steps, starting at the first step. */
export function staircase(
  km: KaplanMeier,
  value: (i: number) => number,
): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = []
  km.steps.forEach((s, i) => {
    const v = value(i)
    if (i > 0) out.push({ t: s.time, v: out[out.length - 1]!.v })
    out.push({ t: s.time, v })
  })
  return out
}
