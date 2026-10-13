import { type AnalysisDef, type SharedKey, type SharedPath, valueAt } from '@ps/model'

// Roadmap 51b (design §4.5, U13): switching methods keeps the choices analyses share — the
// confidence level, tails and predicted direction, the control, the comparisons (when the new
// method has the same choice), and whether values are matched — instead of resetting everything.

type Params = Record<string, unknown>

const paired = (v: unknown) => v === 'paired'
const pairedBack = (m: unknown) => (m ? 'paired' : 'unpaired')

/** Where each analysis says whether values are matched, when not at `matched`. */
const DESIGN: Readonly<Record<string, SharedPath>> = {
  ttest: { path: ['design'], read: paired, write: pairedBack },
  multipleT: { path: ['design'], read: paired, write: pairedBack },
  oneWayAnova: { path: ['matched'] },
  // Methods that are matched (or not) by what they are: read only.
  wilcoxon: { path: [], read: () => true },
  friedman: { path: [], read: () => true },
  mannWhitney: { path: [], read: () => false },
  kolmogorovSmirnov: { path: [], read: () => false },
}

/** The shared choices of a definition: its own `shared`, else the paths its form uses. */
export function sharedPaths(def: AnalysisDef<unknown>): Partial<Record<SharedKey, SharedPath>> {
  if (def.shared) return def.shared
  const has = (path: string) => def.form.some((f) => f.path.join('.') === path)
  const out: Partial<Record<SharedKey, SharedPath>> = {}
  if (has('confidenceLevel')) out.confidence = { path: ['confidenceLevel'] }
  if (has('tails')) out.tails = { path: ['tails'] }
  if (has('predicted')) out.direction = { path: ['predicted'] }
  if (has('control')) out.control = { path: ['control'] }
  if (has('comparisons')) out.comparisons = { path: ['comparisons'] }
  const design = DESIGN[def.id]
  if (design) out.design = design
  return out
}

/** The shared choices `params` of `def` hold, by key (absent: not set or not shared). */
export function sharedValues(
  def: AnalysisDef<unknown>,
  params: Params,
): Partial<Record<SharedKey, unknown>> {
  const out: Partial<Record<SharedKey, unknown>> = {}
  for (const [k, s] of Object.entries(sharedPaths(def)) as [SharedKey, SharedPath][]) {
    const raw = s.path.length ? valueAt(params, s.path) : undefined
    const v = s.read ? s.read(raw) : raw
    if (v !== undefined) out[k] = v
  }
  return out
}

function setAt(obj: Params, path: readonly string[], value: unknown): Params {
  const [head, ...rest] = path
  if (head === undefined) return obj
  return {
    ...obj,
    [head]: rest.length ? setAt((obj[head] as Params | undefined) ?? {}, rest, value) : value,
  }
}

/**
 * The params of `to` with the shared choices of the method left (`from`) carried over: each one
 * `to` shares and accepts (its schema parses it; `comparisons` only when `to` offers the same
 * choice). `toParams`: where to start (its defaults, or what it had earlier in the dialog).
 */
export function carryOver(
  from: { def: AnalysisDef<unknown>; params: Params },
  to: { def: AnalysisDef<unknown>; params: Params },
): Params {
  const values = sharedValues(from.def, from.params)
  const target = sharedPaths(to.def)
  let out = to.params
  for (const [k, s] of Object.entries(target) as [SharedKey, SharedPath][]) {
    if (!(k in values) || !s.path.length) continue
    const v = s.write ? s.write(values[k]) : values[k]
    if (k === 'comparisons') {
      const field = to.def.form.find((f) => f.path.join('.') === 'comparisons')
      if (!field || !('options' in field) || !field.options.some((o) => o.value === v)) continue
    }
    const next = setAt(out, s.path, v)
    if (to.def.params.safeParse(next).success) out = next
  }
  return out
}
