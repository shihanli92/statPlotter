/**
 * Analysis parameters that name rows of the analyzed table by index (roadmap 29). Row inserts,
 * deletes and reorders (sort, move rows) remap them through `remapRowParams`, as graphs' row
 * slices and brackets are remapped, so a chosen control row stays the same row.
 *
 * Declared here, not on the plugins, because the engine applies commands without the analyses
 * registry; `analyses/test/rowParams.test.ts` checks every entry against its plugin's schema.
 */
export type RowParam =
  /** One row, stored as its index in decimal text ('0'); a deleted row falls back to `fallback`. */
  | { path: readonly string[]; kind: 'rowText'; fallback: string }
  /** A value per row, by index (null = none): entries move with their rows, inserted rows get null. */
  | { path: readonly string[]; kind: 'byRow' }

export const ROW_PARAMS: Readonly<Record<string, readonly RowParam[]>> = {
  // Compare each row with a control row (contingency tables).
  contingency: [{ path: ['pairwiseControl'], kind: 'rowText', fallback: '0' }],
  // Expected count or percentage of each category (parts of whole).
  goodnessOfFit: [{ path: ['expected'], kind: 'byRow' }],
}

/**
 * `params` with the rows named by `analysisId`'s row parameters moved by `map` (a row's new index,
 * or null when it was deleted); undefined when nothing changes. The input is not modified.
 */
export function remapRowParams(
  analysisId: string,
  params: unknown,
  map: (row: number) => number | null,
): unknown | undefined {
  const specs = Object.hasOwn(ROW_PARAMS, analysisId) ? ROW_PARAMS[analysisId]! : []
  let out = params
  for (const spec of specs) {
    const value = getAt(out, spec.path)
    const next =
      spec.kind === 'rowText' ? remapRowText(value, map, spec.fallback) : remapByRow(value, map)
    if (next !== undefined) out = setAt(out, spec.path, next)
  }
  return out === params ? undefined : out
}

function remapRowText(
  value: unknown,
  map: (row: number) => number | null,
  fallback: string,
): string | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined
  const r = map(Number(value))
  const next = r === null ? fallback : String(r)
  return next === value ? undefined : next
}

function remapByRow(
  value: unknown,
  map: (row: number) => number | null,
): (unknown | null)[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out: unknown[] = []
  value.forEach((v, r) => {
    const to = map(r)
    if (to !== null) out[to] = v
  })
  // Holes (inserted rows) hold no value; trailing ones are dropped.
  const filled = Array.from(out, (v) => v ?? null)
  while (filled.length && filled.at(-1) === null) filled.pop()
  const same = filled.length === value.length && filled.every((v, i) => v === (value[i] ?? null))
  return same ? undefined : filled
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function getAt(obj: unknown, path: readonly string[]): unknown {
  let v = obj
  for (const key of path) {
    if (!isRecord(v) || !Object.hasOwn(v, key)) return undefined
    v = v[key]
  }
  return v
}

/** A copy of `obj` with `path` set (objects along the path copied, the rest shared). */
function setAt(obj: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value
  const base = isRecord(obj) ? obj : {}
  const [key, ...rest] = path as [string, ...string[]]
  return { ...base, [key]: setAt(base[key], rest, value) }
}
