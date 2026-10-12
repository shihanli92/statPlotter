import type { AnalysisNode, GraphNode, NodeId, ResultTemplate } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../../components/Dialog.tsx'
import { Select } from '../../components/fields.tsx'
import { useDoc, useResultLookup, useServices, useSourceTable } from '../../context.tsx'
import { errorMessage } from '../../util.ts'
import {
  addLayerCommand,
  BRACKET_TESTS,
  type BracketTest,
  groupBracketCommands,
  newInsetTable,
  offersOneAnalysis,
  oneAnalysisBracketCommands,
  type ResultKind,
  resultAnalyses,
  resultLayer,
  rowsOf,
  templateLayer,
  templatesFor,
  xBracketCommands,
  xValuesOf,
} from './resultActions.ts'

// Results on graphs (roadmap 35): the dialogs of the graph's Add › Result menu — a result label,
// line or band (an analysis, then a ready one or values of your own), an inset results table, a
// bracket at one X of an XY graph, a bracket from a group of data sets to one — each adding its
// layer, table or bracket (with the analysis labelling it) in one undo step.

/** What the dialog adds. */
export type ResultDialogMode =
  | { kind: ResultKind }
  | { kind: 'table' }
  | { kind: 'xBracket' }
  | { kind: 'groupBracket' }

const SHOW = [
  { value: 'stars', label: 'Asterisks (ns, *, **…)' },
  { value: 'p', label: 'P value (P = 0.017)' },
  { value: 'number', label: 'P value only (0.017)' },
  { value: 'both', label: 'Both' },
] as const
type Show = (typeof SHOW)[number]['value']

const TITLES: Record<ResultDialogMode['kind'], string> = {
  label: 'Add result label',
  line: 'Add reference line from a result',
  band: 'Add shaded band from results',
  table: 'Add inset results table',
  xBracket: 'Add bracket at one X',
  groupBracket: 'Add bracket from a group to one',
}

/** The dialog adding a result to a graph; `onAdded` gets the layer's id or annotation's index. */
export function ResultDialog({
  graphId,
  mode,
  onClose,
  onAdded,
  onError,
}: {
  graphId: NodeId
  mode: ResultDialogMode
  onClose: () => void
  onAdded: (added: { layer: string } | { annotation: number }) => void
  onError: (message: string) => void
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const { lookup } = useResultLookup()
  const graph = project.nodes[graphId] as GraphNode
  const table = useSourceTable(graph.seriesSource.table)
  const analyses = resultAnalyses(project, graph)
  const [analysisId, setAnalysisId] = useState<string>(analyses[0]?.id ?? '')
  const analysis = analyses.find((a) => a.id === analysisId)
  const kind = mode.kind
  const templates: ResultTemplate[] =
    analysis && (kind === 'label' || kind === 'line' || kind === 'band')
      ? templatesFor(project, analysis, graph, kind)
      : []
  const [templateId, setTemplateId] = useState<string>('')
  const chosen =
    templateId === 'custom'
      ? undefined
      : (templates.find((t) => t.id === templateId) ?? templates[0])
  const result = analysis ? lookup(analysis.id) : undefined
  const [sheet, setSheet] = useState<string>('')
  // Brackets.
  const keys = table?.dataSets.map((d) => d.id) ?? []
  const title = (k: string) => table?.dataSets.find((d) => d.id === k)?.title || k
  const xs = table ? xValuesOf(table) : []
  const [x, setX] = useState<number | undefined>(xs.at(-1))
  const [a, setA] = useState<string>(keys[0] ?? '')
  const [b, setB] = useState<string>(keys[1] ?? '')
  const [group, setGroup] = useState<string[]>(keys.slice(0, Math.max(0, keys.length - 1)))
  const [one, setOne] = useState<string>(keys.at(-1) ?? '')
  const [row, setRow] = useState<number>(0)
  // Roadmap 51c (S2, S4): Welch's t test by default; one analysis of all the groups first when
  // the graph shows three or more groups or already has a bracket.
  const [test, setTest] = useState<BracketTest>('welch')
  const [show, setShow] = useState<Show>('p')
  const [scope, setScope] = useState<'all' | 'one'>(() =>
    table && offersOneAnalysis(graph, table) ? 'all' : 'one',
  )
  const [withControl, setWithControl] = useState(false)

  const dispatch = (cmds: Parameters<typeof store.dispatch>[0], label: string) => {
    try {
      store.dispatch(cmds, label)
      return true
    } catch (e) {
      onError(errorMessage(e))
      return false
    }
  }

  const ok = () => {
    if (kind === 'label' || kind === 'line' || kind === 'band') {
      if (!analysis) return
      const layer = chosen
        ? templateLayer(graph, analysis, chosen)
        : resultLayer(
            graph,
            analysis,
            kind,
            kind === 'label'
              ? { fields: {}, template: '', place: { at: 'corner', corner: 'topLeft' } }
              : { fields: {} },
            analysis.name,
          )
      if (dispatch(addLayerCommand(graph, layer), TITLES[kind])) onAdded({ layer: layer.id })
    } else if (kind === 'table') {
      if (!analysis) return
      const key = sheet || result?.sheets[0]?.key
      if (!key) return onError('The analysis has no results yet.')
      const t = newInsetTable(analysis, key)
      if (
        dispatch(
          {
            type: 'node.set',
            id: graph.id,
            path: ['annotations'],
            value: [...graph.annotations, t],
          },
          TITLES.table,
        )
      )
        onAdded({ annotation: graph.annotations.length })
    } else if (kind === 'xBracket') {
      if (!table || x === undefined || !a || !b || a === b)
        return onError('Choose an X value and two different data sets.')
      if (scope === 'all') {
        const r = oneAnalysisBracketCommands(project, graph, table, { show, x, a, b })
        if ('error' in r) return onError(r.error)
        if (dispatch(r.commands, TITLES.xBracket)) onAdded({ annotation: graph.annotations.length })
      } else {
        const { commands } = xBracketCommands(graph, table, { x, a, b, test, show }, project)
        if (dispatch(commands, TITLES.xBracket)) onAdded({ annotation: graph.annotations.length })
      }
    } else {
      if (!table) return
      if (scope === 'all') {
        const r = oneAnalysisBracketCommands(project, graph, table, {
          show,
          row,
          ...(withControl ? { control: one } : {}),
        })
        if ('error' in r) return onError(r.error)
        if (dispatch(r.commands, 'Add brackets from one analysis'))
          onAdded({ annotation: graph.annotations.length })
      } else {
        const r = groupBracketCommands(graph, table, { group, one, row, test, show }, project)
        if ('error' in r) return onError(r.error)
        if (dispatch(r.commands, TITLES.groupBracket))
          onAdded({ annotation: graph.annotations.length })
      }
    }
    onClose()
  }

  const needsAnalysis = kind === 'label' || kind === 'line' || kind === 'band' || kind === 'table'
  const analysisPicker = (
    <Select
      label="Analysis"
      value={analysisId}
      options={analyses.map((x: AnalysisNode) => ({ value: x.id as string, label: x.name }))}
      onChange={(id) => {
        setAnalysisId(id)
        setTemplateId('')
        setSheet('')
      }}
    />
  )
  return (
    <Dialog
      title={TITLES[kind]}
      onClose={onClose}
      okLabel="Add"
      onOk={ok}
      okDisabled={needsAnalysis && !analysis}
    >
      {needsAnalysis && !analyses.length && (
        <p className="muted">
          No analysis of this graph’s table yet: analyze the table first (Analyze › …).
        </p>
      )}
      {needsAnalysis && analyses.length > 0 && analysisPicker}
      {(kind === 'label' || kind === 'line' || kind === 'band') && analysis && (
        <fieldset className="field">
          <legend>{kind === 'label' ? 'Label' : kind === 'line' ? 'Line' : 'Band'}</legend>
          {templates.map((t) => (
            <label key={t.id} className="check">
              <input
                type="radio"
                name="result-template"
                checked={chosen?.id === t.id}
                onChange={() => setTemplateId(t.id)}
              />
              {t.title}
            </label>
          ))}
          <label className="check">
            <input
              type="radio"
              name="result-template"
              checked={!chosen}
              onChange={() => setTemplateId('custom')}
            />
            Values of my own (pick them from the results next)
          </label>
        </fieldset>
      )}
      {kind === 'table' && analysis && (
        <Select
          label="Results sheet"
          value={sheet || result?.sheets[0]?.key || ''}
          options={(result?.sheets ?? []).map((s) => ({ value: s.key, label: s.title }))}
          onChange={setSheet}
        />
      )}
      {kind === 'xBracket' && (
        <>
          {!xs.length && <p className="muted">The graph’s table has no X values.</p>}
          {xs.length > 0 && (
            <Select
              label="At X ="
              value={String(x ?? xs.at(-1))}
              options={xs.map((v) => ({ value: String(v), label: String(v) }))}
              onChange={(v) => setX(Number(v))}
            />
          )}
          <div className="field-row">
            <Select
              label="Data set"
              value={a}
              options={keys.map((k) => ({ value: k, label: title(k) }))}
              onChange={setA}
            />
            <Select
              label="Against"
              value={b}
              options={keys.map((k) => ({ value: k, label: title(k) }))}
              onChange={setB}
            />
          </div>
        </>
      )}
      {kind === 'groupBracket' && (
        <>
          <fieldset className="field">
            <legend>The group (pooled)</legend>
            {keys.map((k) => (
              <label key={k} className="check">
                <input
                  type="checkbox"
                  checked={group.includes(k)}
                  onChange={(e) =>
                    setGroup(
                      e.target.checked
                        ? keys.filter((x) => x === k || group.includes(x))
                        : group.filter((x) => x !== k),
                    )
                  }
                />
                {title(k)}
              </label>
            ))}
          </fieldset>
          <Select
            label="Against"
            value={one}
            options={keys.map((k) => ({ value: k, label: title(k) }))}
            onChange={setOne}
          />
          {table?.tableKind === 'grouped' && (
            <Select
              label="In the row"
              value={String(row)}
              options={rowsOf(table).map((r) => ({ value: String(r.index), label: r.title }))}
              onChange={(v) => setRow(Number(v))}
            />
          )}
          <p className="muted">
            The group’s values are pooled into one data set (every value of each, or each row’s on
            grouped tables) and compared with the other.
          </p>
        </>
      )}
      {(kind === 'xBracket' || kind === 'groupBracket') && (
        <fieldset className="field bracket-scope">
          <legend>Analysis</legend>
          <label className="check">
            <input
              type="radio"
              name="bracket-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            {kind === 'xBracket'
              ? 'All data sets: two-way ANOVA with comparisons at each X (Šidák) (recommended)'
              : table?.tableKind === 'grouped'
                ? 'All data sets: two-way ANOVA comparing them within each row (Šidák) (recommended)'
                : 'All groups: one-way ANOVA with Tukey’s comparisons (Dunnett’s with a control) (recommended)'}
          </label>
          <label className="check">
            <input
              type="radio"
              name="bracket-scope"
              checked={scope === 'one'}
              onChange={() => setScope('one')}
            />
            {kind === 'xBracket' ? 'One test at this X only' : 'One test of the group against one'}
          </label>
          <div className="help">
            Each bracket with a test of its own is another chance of a false positive; one analysis
            of all the groups adjusts the comparisons for their number. Brackets of separate tests
            are marked “(uncorrected)”.
          </div>
          {scope === 'all' && kind === 'groupBracket' && table?.tableKind === 'column' && (
            <label className="check">
              <input
                type="checkbox"
                checked={withControl}
                onChange={(e) => setWithControl(e.target.checked)}
              />
              Compare each group with “{title(one)}” only (Dunnett’s test)
            </label>
          )}
        </fieldset>
      )}
      {(kind === 'xBracket' || kind === 'groupBracket') && (
        <>
          {scope === 'one' && (
            <Select label="Test" value={test} options={BRACKET_TESTS} onChange={setTest} />
          )}
          <Select label="Label" value={show} options={SHOW} onChange={setShow} />
          <p className="muted">
            A new analysis computes the P value; the bracket follows it when the data change.
          </p>
        </>
      )}
    </Dialog>
  )
}
