import type { Command } from '@ps/engine'
import { DEFAULT_MATCH_OPTIONS, type MatchFormatOptions, matchGraphFormat } from '@ps/graph'
import type { AnalysisResult, GraphNode, NodeId, Project } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Checkbox, Section, Select } from '../components/fields.tsx'
import { useDoc, useResultLookup, useServices } from '../context.tsx'
import { graphsAmong, useNavigatorSelection } from '../organise/useNavSelection.ts'
import { graphsOf } from '../util.ts'
import { graphChangeCommands } from './graphActions.ts'

const OPTION_LABELS: [keyof MatchFormatOptions, string][] = [
  ['size', 'Graph size'],
  ['dataSets', 'Data set formats (1st to 1st, 2nd to 2nd…)'],
  ['layers', 'Layers (when this table offers them)'],
  ['axisRanges', 'Axis ranges, ticks and scales'],
  ['axisTitles', 'Axis title text'],
]

/**
 * Roadmap 47: the commands making each of `targets` look like `source` (the source itself left
 * out), dispatched together as one step.
 */
export function matchFormatCommands(
  project: Project,
  targets: readonly NodeId[],
  source: GraphNode,
  opts: MatchFormatOptions,
  lookup?: (id: NodeId) => AnalysisResult | undefined,
): Command[] {
  return targets.flatMap((id) => {
    const g = project.nodes[id]
    if (g?.kind !== 'graph' || g.id === source.id) return []
    return graphChangeCommands(g, matchGraphFormat(project, g, source, opts, lookup))
  })
}

/** "Match format of 3 graphs", "Match format". */
const matchLabel = (n: number) => (n > 1 ? `Match format of ${n} graphs` : 'Match format')

/**
 * Prism's "Magic": make this graph look like another one, or make every other graph (or those
 * selected in the navigator, roadmap 47) look like this one.
 */
export function MatchFormatSection({
  project,
  graph,
  dispatch,
}: {
  project: Project
  graph: GraphNode
  dispatch: (cmds: Command[], label: string) => void
}) {
  const others = graphsOf(project).filter((n) => n.id !== graph.id)
  const [source, setSource] = useState<string>('')
  const { lookup } = useResultLookup()
  const [opts, setOpts] = useState<MatchFormatOptions>(DEFAULT_MATCH_OPTIONS)
  const selected = graphsAmong(project, useNavigatorSelection()).filter((id) => id !== graph.id)
  if (!others.length) return null

  const fromSource = () => {
    const src = project.nodes[source as NodeId]
    if (src?.kind !== 'graph') return
    dispatch(
      graphChangeCommands(graph, matchGraphFormat(project, graph, src, opts, lookup)),
      'Match format',
    )
  }
  const toOthers = () =>
    dispatch(
      others.flatMap((g) =>
        graphChangeCommands(g, matchGraphFormat(project, g, graph, opts, lookup)),
      ),
      'Apply format to all graphs',
    )
  const toSelected = () =>
    dispatch(
      matchFormatCommands(project, selected, graph, opts, lookup),
      matchLabel(selected.length),
    )

  return (
    <Section title="Match format">
      <Select
        label="Make this graph look like"
        value={source}
        options={[
          { value: '', label: 'Choose a graph…' },
          ...others.map((g) => ({ value: g.id as string, label: g.name })),
        ]}
        onChange={setSource}
      />
      {OPTION_LABELS.map(([key, label]) => (
        <Checkbox
          key={key}
          label={label}
          checked={!!opts[key]}
          onChange={(v) => setOpts({ ...opts, [key]: v })}
        />
      ))}
      <button type="button" disabled={!source} onClick={fromSource}>
        Apply format
      </button>
      <button type="button" onClick={toOthers}>
        Apply this graph’s format to all other graphs
      </button>
      {/* Roadmap 47: only while other graphs are selected in the navigator. */}
      {selected.length > 0 && (
        <button type="button" onClick={toSelected}>
          Apply this graph’s format to the graphs selected in the navigator ({selected.length})
        </button>
      )}
    </Section>
  )
}

/**
 * Roadmap 47: the navigator's Match format… for several selected graphs: "Make the selected
 * graphs look like [graph]", with Match format's options. One step.
 */
export function MatchFormatDialog({
  graphs,
  initial,
  onClose,
}: {
  /** The selected graphs, in navigator order. */
  graphs: readonly NodeId[]
  /** The graph offered as the model first (the open graph, when it is one). */
  initial?: NodeId
  onClose: () => void
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const { lookup } = useResultLookup()
  const all = graphsOf(project)
  const [source, setSource] = useState<string>(
    initial && project.nodes[initial]?.kind === 'graph' ? initial : (graphs[0] ?? ''),
  )
  const [opts, setOpts] = useState<MatchFormatOptions>(DEFAULT_MATCH_OPTIONS)
  const targets = graphs.filter((id) => id !== source && project.nodes[id]?.kind === 'graph')
  const ok = () => {
    const src = project.nodes[source as NodeId]
    if (src?.kind !== 'graph') return
    const cmds = matchFormatCommands(project, targets, src, opts, lookup)
    if (cmds.length) store.dispatch(cmds, matchLabel(targets.length))
    onClose()
  }
  return (
    <Dialog
      title="Match format"
      onClose={onClose}
      okLabel="Apply"
      okDisabled={!targets.length}
      onOk={ok}
    >
      <Select
        label="Make the selected graphs look like"
        value={source}
        options={all.map((g) => ({ value: g.id as string, label: g.name }))}
        onChange={setSource}
      />
      <p className="hint">
        {targets.length
          ? `${targets.length} ${targets.length === 1 ? 'graph changes' : 'graphs change'}.`
          : 'Select other graphs in the navigator to change.'}
      </p>
      {OPTION_LABELS.map(([key, label]) => (
        <Checkbox
          key={key}
          label={label}
          checked={!!opts[key]}
          onChange={(v) => setOpts({ ...opts, [key]: v })}
        />
      ))}
    </Dialog>
  )
}
