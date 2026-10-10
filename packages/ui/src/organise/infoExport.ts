import type { ExportSheet, Row } from '@ps/io'
import type { InfoNode } from '@ps/model'

export type { ExportSheet }

/** An info sheet's rows for data export (roadmap 40): Field, Value, then its notes by line. */
export function tableRowsOfInfo(sheet: InfoNode): Row[] {
  const rows: Row[] = [
    [
      { v: 'Field', style: 'header' },
      { v: 'Value', style: 'header' },
    ],
    ...sheet.fields.map((f): Row => [f.label, f.value]),
  ]
  if (sheet.notes.trim())
    rows.push(
      [],
      [{ v: 'Notes', style: 'header' }],
      ...sheet.notes.split('\n').map((l): Row => [l]),
    )
  return rows
}
