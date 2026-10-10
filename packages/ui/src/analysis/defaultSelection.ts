import type { AnalysisDef, DataTable } from '@ps/model'

/**
 * The data sets the Analyze dialog starts with: the table's first, as many as the analysis takes;
 * for an analysis of numbers (`numbersByDefault`, phase 42), its first number variables (text
 * variables are left for the user to tick, for a role such as PCA's grouping).
 */
export function defaultSelection(
  def: Pick<AnalysisDef, 'inputs' | 'numbersByDefault'> | undefined,
  table: Pick<DataTable, 'dataSets'>,
): string[] {
  if (!def) return []
  const offered = def.numbersByDefault ? table.dataSets.filter((d) => !d.text) : table.dataSets
  return offered.slice(0, def.inputs.max).map((d) => d.id as string)
}
