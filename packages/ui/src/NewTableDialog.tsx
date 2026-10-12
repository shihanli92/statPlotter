import { createGraphFor } from '@ps/graph'
import { createTable, type NodeId, type SummaryPreset, type YFormat } from '@ps/model'
import { useState } from 'react'
import { Dialog } from './components/Dialog.tsx'
import { Field, RadioGroup } from './components/fields.tsx'
import { useDoc, useServices } from './context.tsx'
import { type SampleKind, sampleTable } from './samples.ts'
import { nextName, sampleByDefault } from './util.ts'

export const SUMMARY_FORMATS: { id: SummaryPreset; label: string }[] = [
  { id: 'meanSdN', label: 'Mean, SD, N' },
  { id: 'meanSemN', label: 'Mean, SEM, N' },
  { id: 'meanCvN', label: 'Mean, CV, N' },
  { id: 'meanSd', label: 'Mean and SD' },
  { id: 'meanSem', label: 'Mean and SEM' },
  { id: 'meanPlusMinus', label: 'Mean with +/− error values' },
  { id: 'meanUpperLower', label: 'Mean with upper and lower limits' },
]

type Kind = SampleKind

const KINDS: {
  id: Kind
  label: string
  hint: string
}[] = [
  {
    id: 'column',
    label: 'Column',
    hint: 'One grouping variable: compare groups (t tests, nonparametric tests).',
  },
  {
    id: 'xy',
    label: 'XY',
    hint: 'X is a number (dose, time, concentration): regression and curve fitting.',
  },
  {
    id: 'grouped',
    label: 'Grouped',
    hint: 'Two grouping variables (rows × columns): two-way ANOVA.',
  },
  {
    id: 'contingency',
    label: 'Contingency',
    hint: 'Counts of subjects by group (rows) and outcome (columns): chi-square, Fisher’s exact test.',
  },
  {
    id: 'survival',
    label: 'Survival',
    hint: 'Time to an event, one row per subject (1 = event, 0 = censored): Kaplan-Meier, log-rank.',
  },
  {
    id: 'multipleVariables',
    label: 'Multiple variables',
    hint: 'Each column a variable (numbers, text categories, or calculated by a formula), each row an observation: multiple, logistic and Cox regression, PCA, bubble plots.',
  },
  {
    id: 'partsOfWhole',
    label: 'Parts of whole',
    hint: 'Each row a part (category), each column a whole: pie and donut charts, 100% stacked bars, fraction of total.',
  },
  {
    id: 'nested',
    label: 'Nested',
    hint: 'Each column a treatment group, its subcolumns the subjects in it (mice, donors, cultures…), several measurements of each subject down the rows: nested t test, nested one-way ANOVA.',
  },
]

/** Kinds with one count or code per cell: no replicate or summary formats. */
const SINGLE_VALUE: readonly Kind[] = [
  'contingency',
  'survival',
  'multipleVariables',
  'partsOfWhole',
]
/** Kinds entered as raw values only: side-by-side subcolumns, no summary formats. */
const RAW_ONLY: readonly Kind[] = ['nested']

const DEFAULT_ROWS: Record<Kind, number> = {
  column: 10,
  xy: 10,
  grouped: 3,
  contingency: 2,
  survival: 20,
  multipleVariables: 20,
  nested: 5,
  partsOfWhole: 5,
}
const SAMPLE_LABEL: Record<Kind, string> = {
  column: 'Start with sample data (control vs treated)',
  xy: 'Start with sample data (dose-response curves, triplicates)',
  grouped: 'Start with sample data (genotype × treatment, 4 replicates)',
  contingency: 'Start with sample data (outcome by treatment, 2×2)',
  survival: 'Start with sample data (two groups of 12 subjects)',
  multipleVariables: 'Start with sample data (40 patients, 7 variables)',
  nested: 'Start with sample data (two groups of 3 mice, 4 measurements per mouse)',
  partsOfWhole: 'Start with sample data (cell types in blood and spleen)',
}

export function NewTableDialog({
  onClose,
  onCreated,
  onNotice,
  initialKind,
}: {
  /** Roadmap 51a: the kind it opens at (a question another table kind answers). */
  initialKind?: Kind
  onClose: () => void
  onCreated: (id: NodeId) => void
  /** Says what Create made (roadmap 43): the table and the graph it gets. */
  onNotice?: (msg: string) => void
}) {
  const { store } = useServices()
  const defaultName = useDoc((d) => nextName(d, 'table'))
  // Roadmap 43: a first table starts with sample data (something to analyze and graph at once).
  const firstTable = useDoc(sampleByDefault)
  const [name, setName] = useState(defaultName)
  const [kind, setKind] = useState<Kind>(initialKind ?? 'column')
  const [format, setFormat] = useState<'replicates' | SummaryPreset>('replicates')
  const [replicates, setReplicates] = useState(3)
  const [columns, setColumns] = useState(3)
  const [sample, setSample] = useState(firstTable)

  const single = SINGLE_VALUE.includes(kind)
  const raw = RAW_ONLY.includes(kind)
  const create = () => {
    const yFormat: YFormat =
      format === 'replicates' || single || raw
        ? { type: 'replicates', count: kind === 'column' || single ? 1 : replicates }
        : { type: 'summary', preset: format }
    // Sample data comes as replicates: its own format, size and values.
    const table = sample
      ? sampleTable(kind, name)
      : createTable({ name, tableKind: kind, yFormat, columns, rows: DEFAULT_ROWS[kind] })
    // Every new table gets a linked graph, as in other lab graphing tools.
    const graph = createGraphFor(table, name)
    store.dispatch(
      [
        { type: 'node.add', node: table },
        { type: 'node.add', node: graph, fresh: true },
      ],
      'New table',
    )
    onCreated(table.id)
    onClose()
    onNotice?.(`“${table.name}” created, with a graph of it`)
  }

  return (
    <Dialog title="New data table" onClose={onClose} okLabel="Create" onOk={create} wide>
      <div className="new-table">
        <Field label="Name" className="new-table-name">
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <RadioGroup
          legend="Table type"
          name="nt-kind"
          value={kind}
          options={KINDS.map((k) => ({
            value: k.id,
            title: k.hint,
            label: (
              <span>
                <strong>{k.label}</strong> <span className="muted">— {k.hint}</span>
              </span>
            ),
          }))}
          onChange={setKind}
        />
        {/* Roadmap 43: what goes in the table beside the types, in view without scrolling. */}
        <div className="new-table-content">
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={sample}
                onChange={(e) => setSample(e.target.checked)}
              />
              {SAMPLE_LABEL[kind]}
            </label>
            {sample && (
              <div className="help">
                Untick for an empty table, to choose how values are entered and its size.
              </div>
            )}
          </div>
          {!sample && !single && !raw && (
            <RadioGroup
              legend="Y values"
              name="nt-format"
              value={format}
              options={[
                {
                  value: 'replicates',
                  label:
                    kind !== 'column'
                      ? 'Enter replicate values in side-by-side subcolumns'
                      : 'Enter replicate values, stacked into columns',
                },
                ...SUMMARY_FORMATS.map((f) => ({ value: f.id, label: f.label })),
              ]}
              onChange={setFormat}
            />
          )}
          {!sample && kind !== 'column' && !single && (format === 'replicates' || raw) && (
            <Field
              label={
                raw ? 'Subjects per group' : `Replicates per ${kind === 'xy' ? 'X value' : 'cell'}`
              }
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={50}
                  value={replicates}
                  onChange={(e) =>
                    setReplicates(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                  }
                />
              )}
            </Field>
          )}
          {!sample && (
            <Field label={raw ? 'Number of groups' : 'Number of data sets'}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={52}
                  value={columns}
                  onChange={(e) =>
                    setColumns(Math.max(1, Math.min(52, Number(e.target.value) || 1)))
                  }
                />
              )}
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  )
}
