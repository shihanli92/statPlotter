import { existsSync, readFileSync } from 'node:fs'
import { importFile } from '@ps/io'
import { describe, expect, it } from 'vitest'
import { SWAM } from '../src/examples/published/swam.ts'
import { SWAM_FILES, SWAM_SOURCES } from '../src/examples/published/swamData.ts'

// The Swaminathan et al. example (CC BY 4.0) embeds each workbook's sheet as CSV
// (`swamData.ts`). Where the workbooks are on file (the local source_data folder, never
// committed) this checks every cell against them: text as written, numbers as deposited.

const DIR = new URL('../../../source_data/swam_source_data/', import.meta.url)
const present = Object.values(SWAM_SOURCES).every((s) => existsSync(new URL(s.file, DIR)))

describe('Swaminathan et al. embedded source data', () => {
  it('holds a file for every source, and every file a panel imports', () => {
    expect(Object.keys(SWAM_FILES).sort()).toEqual(Object.keys(SWAM_SOURCES).sort())
    expect(SWAM.panels.map((p) => p.file).sort()).toEqual(Object.keys(SWAM_FILES).sort())
  })

  it.skipIf(!present)('matches the workbooks cell by cell', () => {
    for (const [name, src] of Object.entries(SWAM_SOURCES)) {
      const book = importFile(src.file, new Uint8Array(readFileSync(new URL(src.file, DIR))))
      const csv = importFile(name, new TextEncoder().encode(SWAM_FILES[name]!))
      if (book.kind !== 'sheets' || csv.kind !== 'sheets') throw new Error(`${name}: no sheets`)
      const want = book.sheets.find((s) => s.name === src.sheet)!.rows
      const got = csv.sheets[0]!.rows
      const rows = Math.max(want.length, got.length)
      for (let r = 0; r < rows; r++) {
        const width = Math.max(want[r]?.length ?? 0, got[r]?.length ?? 0)
        for (let c = 0; c < width; c++)
          expect(got[r]?.[c] ?? null, `${name} row ${r + 1}, column ${c + 1}`).toBe(
            want[r]?.[c] ?? null,
          )
      }
    }
  })
})
