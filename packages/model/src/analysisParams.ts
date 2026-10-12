import type { AnalysisDef } from './analysis.ts'

// Roadmap 51c (design §6.1): stored params are read in one way. A node's params were saved under
// its `pluginVersion`; an analysis whose defaults changed since writes the old defaults back into
// older params (`migrateParams`, "pinning") before its schema fills what is missing from the
// current defaults. So a saved analysis keeps what it computed, and only new ones get new
// defaults. Every reader of stored params (the engine, the edit dialog, results, brackets, Monte
// Carlo's inner analysis, Duplicate family, Apply, method files) goes through `paramsOf`.

/** Params as saved (a node, or an analysis embedded in another's params). */
export interface StoredParams {
  params: unknown
  /** The plugin's params version they were saved with (absent: the current one). */
  pluginVersion?: number
}

/** `raw` brought up to the definition's current version (unchanged if already there). */
export function migratedParams(
  def: Pick<AnalysisDef<unknown>, 'version' | 'migrateParams'>,
  raw: unknown,
  fromVersion: number,
): unknown {
  return fromVersion < def.version && def.migrateParams ? def.migrateParams(raw, fromVersion) : raw
}

export type ParamsOutcome<P> = { ok: true; params: P } | { ok: false; message: string }

/** The complete params of a stored analysis: migrated from its version, then parsed. */
export function paramsOf<P>(def: AnalysisDef<P>, stored: StoredParams): ParamsOutcome<P> {
  const raw = migratedParams(
    def as AnalysisDef<unknown>,
    stored.params,
    stored.pluginVersion ?? def.version,
  )
  const parsed = def.params.safeParse(raw)
  return parsed.success
    ? { ok: true, params: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? '' }
}

/** `paramsOf`'s params, or the definition's defaults when they don't parse. */
export function paramsOrDefaults<P>(def: AnalysisDef<P>, stored: StoredParams): P {
  const r = paramsOf(def, stored)
  return r.ok ? r.params : def.params.parse({})
}

// ---- writing migrations ---------------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The value at `path` in `raw` (undefined when absent). */
export function valueAt(raw: unknown, path: readonly string[]): unknown {
  let v: unknown = raw
  for (const k of path) {
    if (!isObj(v)) return undefined
    v = v[k]
  }
  return v
}

/**
 * A copy of `raw` with each `[path, value]` written where `raw` has nothing (absent or
 * undefined): the previous version's default, kept for an analysis saved before it changed.
 * Values already stored are never touched. A non-object `raw` is treated as `{}`.
 */
export function pinDefaults(
  raw: unknown,
  pins: readonly (readonly [readonly string[], unknown])[],
) {
  const out: Obj = isObj(raw) ? structuredClone(raw) : {}
  for (const [path, value] of pins) {
    let o = out
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i]!
      if (!isObj(o[k])) o[k] = {}
      o = o[k] as Obj
    }
    const last = path[path.length - 1]!
    if (o[last] === undefined) o[last] = value
  }
  return out
}

/**
 * Params written against `version` of a definition (an example's spec written before its
 * defaults changed), brought up to the current version and parsed: they keep meaning what they
 * meant. Throws when they don't parse (a spec is code, so that is a bug).
 */
export function paramsWrittenFor<P>(def: AnalysisDef<P>, raw: unknown, version: number): P {
  const r = paramsOf(def, { params: raw, pluginVersion: version })
  if (!r.ok) throw new Error(`Invalid parameters for ${def.id}: ${r.message}`)
  return r.params
}
