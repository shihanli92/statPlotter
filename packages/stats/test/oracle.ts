import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'

const FIXTURES = join(import.meta.dirname, 'fixtures')

export interface Tolerance {
  rtol: number
  atol: number
}

export interface Fixture<I = Record<string, unknown>, E = Record<string, unknown>> {
  name: string
  input: I
  params: Record<string, unknown>
  expected: E
  tol?: Partial<Tolerance>
  source: Record<string, unknown>
}

/** R writes non-finite numbers as strings (jsonlite na = "string"). */
function decode(v: unknown): unknown {
  if (v === 'NaN' || v === 'NA') return Number.NaN
  if (v === 'Inf') return Number.POSITIVE_INFINITY
  if (v === '-Inf') return Number.NEGATIVE_INFINITY
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

/** Deep-frozen, so that a test (or the code under test) cannot change a shared fixture. */
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) freeze(x)
    Object.freeze(v)
  }
  return v
}

const cache = new Map<string, Fixture[]>()

/**
 * Every fixture in fixtures/<suite>/ (e.g. 'descriptive', 'nist/univariate'), sorted by file
 * name. Parsed once per suite (per test file) and frozen.
 */
export function loadFixtures<I = Record<string, unknown>, E = Record<string, unknown>>(
  suite: string,
): Fixture<I, E>[] {
  let fixtures = cache.get(suite)
  if (!fixtures) {
    const dir = join(FIXTURES, suite)
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
    if (files.length === 0) throw new Error(`no fixtures in ${dir}; run pnpm oracle / pnpm nist`)
    fixtures = files.map(
      (f) => freeze(decode(JSON.parse(readFileSync(join(dir, f), 'utf8')))) as Fixture,
    )
    cache.set(suite, fixtures)
  }
  return fixtures as Fixture<I, E>[]
}

/** The fixture of a suite with this name. */
export function loadFixture<I = Record<string, unknown>, E = Record<string, unknown>>(
  suite: string,
  name: string,
): Fixture<I, E> {
  const f = loadFixtures<I, E>(suite).find((x) => x.name === name)
  if (!f) throw new Error(`no fixture ${name} in ${suite}`)
  return f
}

type ArrayItems<T> = T extends readonly (infer U)[] ? U[] : T[]
type Items<T> = unknown extends T ? number[] : ArrayItems<T>

/**
 * jsonlite writes length-1 vectors as scalars: the value as an array (an untyped field is taken
 * to hold numbers).
 */
export function arr<T>(v: T): Items<T> {
  return (Array.isArray(v) ? v : [v]) as Items<T>
}

export const DEFAULT_TOL: Tolerance = { rtol: 1e-10, atol: 0 }

export function isClose(actual: number, expected: number, tol: Partial<Tolerance> = {}): boolean {
  const { rtol, atol } = { ...DEFAULT_TOL, ...tol }
  if (Number.isNaN(expected)) return Number.isNaN(actual)
  if (!Number.isFinite(expected)) return actual === expected
  return Math.abs(actual - expected) <= atol + rtol * Math.abs(expected)
}

export function expectClose(
  actual: number,
  expected: number,
  tol: Partial<Tolerance> = {},
  label = '',
): void {
  const ok = isClose(actual, expected, tol)
  expect(
    ok,
    `${label}: got ${actual}, expected ${expected} (rtol ${tol.rtol ?? DEFAULT_TOL.rtol})`,
  ).toBe(true)
}

/**
 * Log relative error: the number of correct significant digits, as NIST StRD reports it.
 * Capped at 15.
 */
export function lre(actual: number, certified: number): number {
  if (actual === certified) return 15
  const err =
    certified === 0 ? Math.abs(actual) : Math.abs(actual - certified) / Math.abs(certified)
  return Math.min(15, -Math.log10(err))
}
