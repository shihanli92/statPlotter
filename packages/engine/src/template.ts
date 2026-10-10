import { type DataTable, nodeById, type Project } from '@ps/model'
import { copyData } from './commands.ts'

// Project templates (roadmap 31): the project with every value cleared, so the analyses, graphs
// and layouts are ready for the next experiment's data.

/**
 * A copy of a table without its values: every cell empty and nothing excluded, text variables'
 * text cleared. Kept: kind, entry format, rows (and row titles), data set, X and subcolumn
 * titles, calculated variables' formulas, number formats, column widths and notes.
 */
export function clearTableValues(t: DataTable): DataTable {
  const out = copyData(t)
  const clear = (c: DataTable['dataSets'][number]['subcolumns'][number]) => {
    c.values = c.values.map(() => null)
    delete c.excluded
    delete c.limit
  }
  for (const c of out.x?.subcolumns ?? []) clear(c)
  for (const d of out.dataSets) {
    for (const c of d.subcolumns) clear(c)
    if (d.text) d.text = d.text.map(() => null)
  }
  return out
}

/** The project as a template: every data table cleared (results are not part of it). */
export function templateOf(p: Project): Project {
  const nodes = { ...p.nodes }
  for (const id of p.order) {
    const n = nodeById(nodes, id)
    if (n?.kind === 'table') nodes[id] = clearTableValues(n)
  }
  return { ...p, nodes }
}
