import { existsSync, readFileSync } from 'node:fs'
import { importFile, type Sheet } from '@ps/io'
import { describe, expect, it } from 'vitest'
import { TAWK_FILES, TAWK_ROUNDED, TAWK_SOURCES } from '../src/examples/published/tawkData.ts'

// The Tawk et al. example (CC BY 4.0) embeds the cells of its source-data sheets as CSV
// (`tawkData.ts`). Where the workbooks are on file (the local source_data folder, never committed)
// this checks every embedded cell against them: text as in the sheet (non-breaking spaces as
// spaces), numbers as deposited or rounded to the stated significant digits.

const DIR = new URL('../../../source_data/tawk_source_data/', import.meta.url)
const files = [...new Set(Object.values(TAWK_SOURCES).map((s) => s.file))]
const present = files.every((f) => existsSync(new URL(f, DIR)))

/** "A:G" → 0-based column indices. */
function columns(ranges: string[]): number[] {
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return ranges.flatMap((r) => {
    const [a, b] = r.split(':') as [string, string]
    return Array.from({ length: col(b) - col(a) + 1 }, (_, i) => col(a) + i)
  })
}

const text = (v: unknown) =>
  String(v)
    .replace(/[\s ]+/g, ' ')
    .trim()

describe('Tawk et al. embedded source data', () => {
  it('holds a file for every source', () => {
    expect(Object.keys(TAWK_FILES).sort()).toEqual(Object.keys(TAWK_SOURCES).sort())
  })

  it.skipIf(!present)('matches the workbooks cell by cell', () => {
    const sheets = new Map<string, Sheet[]>()
    for (const f of files) {
      const imported = importFile(f, new Uint8Array(readFileSync(new URL(f, DIR))))
      if (imported.kind !== 'sheets') throw new Error(`${f}: no sheets`)
      sheets.set(f, imported.sheets)
    }
    for (const [name, src] of Object.entries(TAWK_SOURCES)) {
      const sheet = sheets.get(src.file)!.find((s) => s.name === src.sheet)!
      const csv = importFile(name, new TextEncoder().encode(TAWK_FILES[name]!))
      if (csv.kind !== 'sheets') throw new Error(`${name}: no sheet`)
      const embedded = csv.sheets[0]!.rows
      const digits = TAWK_ROUNDED[name]
      const cols = columns(src.columns)
      for (let r = 0; r < src.rows; r++) {
        cols.forEach((c, j) => {
          const want = sheet.rows[r]?.[c] ?? null
          const got = embedded[r]?.[j] ?? null
          const where = `${name} row ${r + 1}, column ${j + 1}`
          if (typeof want === 'number') {
            expect(typeof got, where).toBe('number')
            if (digits) {
              const tol = Math.abs(want) * 0.5 * 10 ** (1 - digits) * (1 + 1e-9)
              expect(Math.abs((got as number) - want), where).toBeLessThanOrEqual(tol)
            } else expect(got, where).toBe(want)
          } else if (want === null || text(want) === '') {
            expect(got === null || text(got) === '', where).toBe(true)
          } else expect(text(got), where).toBe(text(want))
        })
      }
    }
  })
})
