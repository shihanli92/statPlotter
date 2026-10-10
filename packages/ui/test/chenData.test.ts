import { existsSync, readFileSync } from 'node:fs'
import { importFile, type Sheet, type SheetCell } from '@ps/io'
import { describe, expect, it } from 'vitest'
import { CHEN } from '../src/examples/published/chen.ts'
import { CHEN_FILES, CHEN_SOURCES } from '../src/examples/published/chenData.ts'

// The Chen et al. example (CC BY 4.0) embeds the columns and rows of the deposited tables its
// panels read, as CSV (`chenData.ts`). Where the deposited files are on file (the local
// source_data folder, never committed) this checks every embedded cell against them: the columns
// named, the rows the source keeps in the file's order, text as written, numbers as deposited or
// rounded to the stated significant digits.

const DIR = new URL('../../../source_data/chen_source_data/', import.meta.url)
const files = [...new Set(Object.values(CHEN_SOURCES).map((s) => s.file))]
const present = files.every((f) => existsSync(new URL(f, DIR)))

const parse = (name: string, text: string): Sheet => {
  const f = importFile(name, new TextEncoder().encode(text))
  if (f.kind !== 'sheets') throw new Error(`${name}: no sheet`)
  return f.sheets[0]!
}

describe('Chen et al. embedded source data', () => {
  it('holds a file for every source, and every file a panel imports', () => {
    expect(Object.keys(CHEN_FILES).sort()).toEqual(Object.keys(CHEN_SOURCES).sort())
    const named = CHEN.panels.flatMap((p) => [p, ...(p.with ?? [])].map((t) => t.file))
    expect([...new Set(named)].sort()).toEqual(Object.keys(CHEN_FILES).sort())
  })

  it('stays small: about 140 kB of CSV, under 150 kB', () => {
    const size = Object.values(CHEN_FILES).reduce((n, t) => n + t.length, 0)
    expect(size).toBeLessThan(150_000)
  })

  it.skipIf(!present)('matches the deposited files cell by cell', () => {
    const sheets = new Map<string, Sheet[]>()
    for (const f of files) {
      const imported = importFile(f, new Uint8Array(readFileSync(new URL(f, DIR))))
      if (imported.kind !== 'sheets') throw new Error(`${f}: no sheets`)
      sheets.set(f, imported.sheets)
    }
    for (const [name, src] of Object.entries(CHEN_SOURCES)) {
      const sheet = sheets.get(src.file)!.find((s) => s.name === src.sheet)!
      const embedded = parse(name, CHEN_FILES[name]!).rows
      let want: SheetCell[][] = sheet.rows
      const digits: (number | undefined)[] = []
      if (src.columns) {
        const header = sheet.rows[0]!
        const col = (h: string) => {
          const c = header.indexOf(h)
          expect(c, `${name}: column ${h}`).toBeGreaterThanOrEqual(0)
          return c
        }
        const cols = src.columns.map(col)
        const kept = sheet.rows
          .slice(1)
          .filter(
            (r) =>
              !src.rows ||
              src.rows.some((alt) =>
                Object.entries(alt).every(([c, values]) => values.includes(String(r[col(c)]))),
              ),
          )
        want = [header, ...kept].map((r) => cols.map((c) => r[c] ?? null))
        digits.push(...src.columns.map((c) => src.rounded?.[c]))
      }
      expect(embedded.length, name).toBe(want.length)
      want.forEach((row, r) => {
        const width = Math.max(row.length, embedded[r]!.length)
        for (let j = 0; j < width; j++) {
          const w = row[j] ?? null
          const got = embedded[r]![j] ?? null
          const where = `${name} row ${r + 1}, column ${j + 1}`
          const d = r > 0 ? digits[j] : undefined
          if (typeof w === 'number' && d) {
            const tol = Math.abs(w) * 0.5 * 10 ** (1 - d) * (1 + 1e-9)
            expect(typeof got, where).toBe('number')
            expect(Math.abs((got as number) - w), where).toBeLessThanOrEqual(tol)
          } else expect(got, where).toBe(w)
        }
      })
    }
  })
})
