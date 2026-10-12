import { topQuestions } from '@ps/analyses'
import type { DataTable, NodeId, Project } from '@ps/model'

// Roadmap 51a (design §3.3): while the open data table has no analyses, the navigator's Results
// say what the chooser can answer: "What do you want to know about “Dose response”?" with the
// table kind's first three questions, each opening Guide me there.

/** The open data table when no analysis reads it (null otherwise). */
export function tableWithoutResults(project: Project, selected: NodeId | null): DataTable | null {
  const node = selected ? project.nodes[selected] : undefined
  if (node?.kind !== 'table') return null
  const analyzed = Object.values(project.nodes).some(
    (n) => n.kind === 'analysis' && n.input.source === node.id,
  )
  return analyzed ? null : node
}

export function ResultsPrompt({
  table,
  onAsk,
}: {
  table: DataTable
  onAsk: (tableId: NodeId, entry: string) => void
}) {
  const questions = topQuestions(table.tableKind)
  if (!questions.length) return null
  return (
    // Not a section of sheets (no `nav-section`): a section heading shows with its first sheet.
    <section className="results-prompt" aria-label="Results">
      <h4>Results</h4>
      <p>What do you want to know about “{table.name}”?</p>
      <ul>
        {questions.map((q) => (
          <li key={q.id}>
            <button type="button" className="link" onClick={() => onAsk(table.id, q.id)}>
              {q.question}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
