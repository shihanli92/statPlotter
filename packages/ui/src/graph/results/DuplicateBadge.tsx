import type { GraphNode, NodeId, Project } from '@ps/model'
import { useMemo } from 'react'
import { useServices } from '../../context.tsx'
import { type DuplicateComparison, duplicateComparisons, duplicateText } from './duplicates.ts'

// Roadmap 51c (design §7.5): a warning beside the format bar when a graph shows two or more
// tests of the same comparison, with each test: go to its analysis, or remove its label.

export function DuplicateTestsBadge({
  graph,
  project,
  onOpen,
}: {
  graph: GraphNode
  project: Project
  onOpen?: (id: NodeId) => void
}) {
  const { store } = useServices()
  const found = useMemo(() => duplicateComparisons(graph, project), [graph, project])
  if (!found.length) return null
  const remove = (t: DuplicateComparison['tests'][number]) => {
    if (t.on.bracket)
      store.dispatch(
        {
          type: 'node.set',
          id: graph.id,
          path: ['annotations'],
          value: graph.annotations.filter((a) => a.id !== t.on.bracket),
        },
        'Delete bracket',
      )
    else if (t.on.layer)
      store.dispatch({ type: 'graph.removeLayer', id: graph.id, layer: t.on.layer }, 'Delete label')
  }
  return (
    <details className="duplicate-badge" data-testid="duplicate-tests">
      <summary className="banner warning" title="One comparison tested more than once">
        ⚠{' '}
        {found.length === 1 ? duplicateText(found[0]!) : `${found.length} comparisons tested twice`}
      </summary>
      <div className="duplicate-menu">
        {found.map((d) => (
          <section key={d.key}>
            <p>
              {duplicateText(d)}. Showing several tests of one comparison and keeping the smallest P
              inflates false positives: keep the test planned before the experiment.
            </p>
            <ul>
              {d.tests.map((t) => (
                <li key={`${t.analysis}:${t.on.bracket ?? t.on.layer}`}>
                  <span>{t.name}</span>
                  {onOpen && (
                    <button type="button" className="link" onClick={() => onOpen(t.analysis)}>
                      Go to analysis
                    </button>
                  )}
                  <button type="button" className="link" onClick={() => remove(t)}>
                    Remove this label
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  )
}
