import { DataTable, newNodeId } from '@ps/model'
import { ImportError } from './errors.ts'

/**
 * An imported table from its fields (`kind` and `id` added, `notes` empty unless given),
 * validated; throws ImportError when it doesn't validate.
 */
export function finishTable(fields: Record<string, unknown>): DataTable {
  const parsed = DataTable.safeParse({ kind: 'table', id: newNodeId(), notes: '', ...fields })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ImportError(`Could not build the table: ${issue?.message ?? 'invalid data'}.`)
  }
  return parsed.data
}

/** "3 non-numeric data cells were imported as empty (first: …)." */
export const nonNumericWarning = (n: number, first?: string) =>
  `${n} non-numeric data ${n === 1 ? 'cell was' : 'cells were'} imported as empty${first ? ` (first: ${first})` : ''}.`
