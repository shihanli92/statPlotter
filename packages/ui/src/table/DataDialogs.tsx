import type { Command } from '@ps/engine'
import { swapXYProblem } from '@ps/engine'
import {
  type DataSetColumn,
  type DataTable,
  evaluateFormula,
  type FormulaColumn,
  levelsInTable,
  newColumnId,
  normalizeTable,
  resolvedTable,
} from '@ps/model'
import { useId, useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field, NumberBox, RadioGroup } from '../components/fields.tsx'
import {
  type BinSpec,
  binFormula,
  parseBreaks,
  parseLabels,
  parseRecode,
  recodeFormula,
  transformFormula,
  transformTitle,
  VARIABLE_TRANSFORMS,
  type VariableTransform,
} from './variableFormulas.ts'

/*
 * Roadmap 38's dialogs on a table: transform variables, recode text levels and bin a number
 * variable (each writes calculated variables into the multiple-variables table, one undo step),
 * and swap X and Y of an XY table.
 */

type Dispatch = (commands: Command | Command[], label: string) => void

/** A title not yet taken in the table (adds " 2", " 3"… when it is). */
function freeTitle(table: DataTable, title: string, taken: Set<string>): string {
  const used = (t: string) =>
    taken.has(t.toLowerCase()) ||
    table.dataSets.some((d) => d.title.trim().toLowerCase() === t.toLowerCase())
  let t = title
  for (let k = 2; used(t); k++) t = `${title} ${k}`
  taken.add(t.toLowerCase())
  return t
}

/** Commands adding calculated variables after the last one (titles made unique). */
function addCalculated(
  table: DataTable,
  vars: readonly { title: string; formula: string }[],
): Command[] {
  const taken = new Set<string>()
  return vars.flatMap(({ title, formula }) => {
    const id = newColumnId()
    return [
      {
        type: 'table.addDataSet' as const,
        table: table.id,
        id,
        title: freeTitle(table, title, taken),
      },
      { type: 'table.setFormula' as const, table: table.id, id, formula },
    ]
  })
}

const numberVars = (t: DataTable) => resolvedTable(t).dataSets.filter((d) => !d.text)
const textVars = (t: DataTable) => resolvedTable(t).dataSets.filter((d) => d.text)

/** The table's columns for previewing a formula (calculated ones with their values). */
function previewColumns(table: DataTable): FormulaColumn[] {
  return normalizeTable(table).map((d) => ({
    id: d.ref.key,
    title: d.title,
    ...(d.text
      ? { text: d.text }
      : { values: d.data.shape === 'replicates' ? d.data.reps[0]! : d.data.mean }),
  }))
}

/** The levels a text formula gives (with counts), or its error. */
function levelPreview(
  table: DataTable,
  formula: string,
): { levels: [string, number][]; error: string | null } {
  const r = evaluateFormula(formula, previewColumns(table), table.rowCount)
  if (r.error) return { levels: [], error: r.error }
  const counts = new Map<string, number>()
  for (const t of r.text ?? []) if (t !== null) counts.set(t, (counts.get(t) ?? 0) + 1)
  return { levels: [...counts], error: null }
}

function LevelList({ levels, error }: { levels: [string, number][]; error: string | null }) {
  if (error) return <div className="help error">{error}</div>
  return (
    <div className="help" role="status" aria-label="Levels">
      {levels.length
        ? `Levels: ${levels
            .slice(0, 12)
            .map(([l, n]) => `${l} (${n})`)
            .join(', ')}${levels.length > 12 ? `, … (${levels.length})` : ''}`
        : 'No levels yet.'}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Transform variables
// ---------------------------------------------------------------------------------------------

export function TransformVariablesDialog({
  table,
  dispatch,
  onClose,
  initial,
}: {
  table: DataTable
  dispatch: Dispatch
  onClose: () => void
  initial?: string
}) {
  const numbers = numberVars(table)
  const texts = textVars(table)
  const [chosen, setChosen] = useState<string[]>(
    initial && numbers.some((d) => d.id === initial)
      ? [initial]
      : numbers[0]
        ? [numbers[0].id]
        : [],
  )
  const [fn, setFn] = useState<VariableTransform>('log10')
  const c = VARIABLE_TRANSFORMS.find((x) => x.id === fn)!
  const [k, setK] = useState<Record<string, number>>({})
  const kValue = c.k ? (k[fn] ?? c.k.value) : 1
  const [group, setGroup] = useState('')
  const groupTitle = c.grouped && group ? (texts.find((d) => d.id === group)?.title ?? null) : null
  const vars = numbers
    .filter((d) => chosen.includes(d.id))
    .map((d) => ({
      title: transformTitle(fn, d.title, kValue, groupTitle),
      formula: transformFormula(fn, d.title, kValue, groupTitle),
    }))
  const create = () => {
    if (!vars.length) return
    dispatch(
      addCalculated(table, vars),
      vars.length > 1 ? 'Transform variables' : 'Transform variable',
    )
    onClose()
  }
  return (
    <Dialog
      title="Transform variables"
      onClose={onClose}
      okLabel="Add variables"
      onOk={create}
      okDisabled={!vars.length}
    >
      <p className="muted">
        Adds a calculated variable for each variable chosen. It follows its variable as the table
        changes; “Convert to values” in the formula bar fixes it.
      </p>
      <fieldset className="field radio">
        <legend>Variables</legend>
        {numbers.map((d) => (
          <label key={d.id} className="check">
            <input
              type="checkbox"
              checked={chosen.includes(d.id)}
              onChange={(e) =>
                setChosen((v) => (e.target.checked ? [...v, d.id] : v.filter((x) => x !== d.id)))
              }
            />
            {d.title || '(untitled)'}
          </label>
        ))}
      </fieldset>
      <Field label="Transform">
        {(id) => (
          <select id={id} value={fn} onChange={(e) => setFn(e.target.value as VariableTransform)}>
            {VARIABLE_TRANSFORMS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {c.k && (
        <Field label={c.k.label}>
          {(id) => <NumberBox id={id} value={kValue} onChange={(v) => setK({ ...k, [fn]: v })} />}
        </Field>
      )}
      {c.grouped && (
        <Field label="Within each group of">
          {(id) => (
            <select id={id} value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">No groups (the whole column)</option>
              {texts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="help">
        {vars.slice(0, 3).map((v) => (
          <div key={v.title}>
            {v.title}: <code>{v.formula}</code>
          </div>
        ))}
        {vars.length > 3 && <div>… and {vars.length - 3} more</div>}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Recode
// ---------------------------------------------------------------------------------------------

export function RecodeDialog({
  table,
  dispatch,
  onClose,
  initial,
}: {
  table: DataTable
  dispatch: Dispatch
  onClose: () => void
  /** A text variable to recode, or a recode to edit again. */
  initial?: string
}) {
  const id = useId()
  const resolved = resolvedTable(table)
  const editing = table.dataSets.find((d) => d.id === initial && d.formula !== undefined)
  const spec = editing ? parseRecode(editing.formula!) : null
  const texts = textVars(table).filter((d) => d.id !== editing?.id)
  const fromSpec = spec
    ? texts.find(
        (d) =>
          d.title.toLowerCase() === spec.source.toLowerCase().replace(/_/g, ' ') ||
          d.title.toLowerCase() === spec.source.toLowerCase(),
      )
    : undefined
  const [source, setSource] = useState(
    fromSpec?.id ?? (texts.some((d) => d.id === initial) ? initial! : (texts[0]?.id ?? '')),
  )
  const src = resolved.dataSets.find((d) => d.id === source)
  const levels = useMemo(() => (src ? levelsInTable(src) : []), [src])
  const [map, setMap] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec?.pairs ?? []).map(([a, b]) => [a, b])),
  )
  const [unmapped, setUnmapped] = useState<'keep' | 'blank'>(spec?.unmapped ?? 'keep')
  const [name, setName] = useState(editing?.title ?? '')
  const pairs = levels.map((l) => [l, (map[l] ?? l).trim()] as [string, string])
  const formula = src ? recodeFormula(src.title, pairs, unmapped) : ''
  const preview = src ? levelPreview(table, formula) : { levels: [], error: null }
  const create = () => {
    if (!src) return
    if (editing)
      dispatch({ type: 'table.setFormula', table: table.id, id: editing.id, formula }, 'Recode')
    else
      dispatch(
        addCalculated(table, [{ title: name.trim() || `${src.title} (recoded)`, formula }]),
        'Recode',
      )
    onClose()
  }
  return (
    <Dialog
      title="Recode levels"
      onClose={onClose}
      okLabel={editing ? 'Apply' : 'Add variable'}
      onOk={create}
      okDisabled={!src}
    >
      <p className="muted">
        Renames or merges the levels of a text variable into a new calculated text variable, usable
        as groups, colours and splits. It follows its variable as the table changes.
      </p>
      <Field label="Text variable">
        {(id) => (
          <select
            id={id}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={!!editing}
          >
            {texts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <table className="recode-table">
        <thead>
          <tr>
            <th>Level</th>
            <th>New level</th>
          </tr>
        </thead>
        <tbody>
          {levels.slice(0, 500).map((l) => (
            <tr key={l}>
              <td>{l}</td>
              <td>
                <input
                  aria-label={`New level for ${l}`}
                  value={map[l] ?? l}
                  onChange={(e) => setMap({ ...map, [l]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {levels.length > 500 && (
        <div className="help">Showing the first 500 of {levels.length} levels.</div>
      )}
      <RadioGroup
        legend="Levels not listed (added later)"
        name={`${id}-un`}
        value={unmapped}
        options={[
          { value: 'keep', label: 'Keep them as they are' },
          { value: 'blank', label: 'Leave them blank' },
        ]}
        onChange={setUnmapped}
      />
      {!editing && (
        <Field label="New variable">
          {(id) => (
            <input
              id={id}
              value={name}
              placeholder={src ? `${src.title} (recoded)` : ''}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      )}
      <LevelList {...preview} />
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Bin
// ---------------------------------------------------------------------------------------------

export function BinDialog({
  table,
  dispatch,
  onClose,
  initial,
}: {
  table: DataTable
  dispatch: Dispatch
  onClose: () => void
  initial?: string
}) {
  const id = useId()
  const numbers = numberVars(table)
  const [source, setSource] = useState(
    numbers.some((d) => d.id === initial) ? initial! : (numbers[0]?.id ?? ''),
  )
  const src = numbers.find((d) => d.id === source)
  const [method, setMethod] = useState<BinSpec['method']>('quantile')
  const [breaksText, setBreaksText] = useState('')
  const [n, setN] = useState(4)
  const [closure, setClosure] = useState<BinSpec['closure']>('right')
  const [labelsText, setLabelsText] = useState('')
  const [name, setName] = useState('')
  const breaks = method === 'breaks' ? parseBreaks(breaksText) : null
  const labels = parseLabels(labelsText)
  const spec: BinSpec = {
    method,
    closure,
    ...(method === 'breaks' ? { breaks: breaks ?? [] } : { n }),
    ...(labels.length ? { labels } : {}),
  }
  const valid =
    !!src &&
    (method !== 'breaks' || breaks !== null) &&
    (method === 'breaks' || (Number.isInteger(n) && n >= 1))
  const formula = src && valid ? binFormula(src.title, spec) : ''
  const preview = formula
    ? levelPreview(table, formula)
    : {
        levels: [],
        error:
          method === 'breaks' && breaksText && !breaks
            ? 'Type two or more different numbers.'
            : null,
      }
  const create = () => {
    if (!src || !valid || preview.error) return
    dispatch(addCalculated(table, [{ title: name.trim() || `${src.title} bins`, formula }]), 'Bin')
    onClose()
  }
  return (
    <Dialog
      title="Bin a variable"
      onClose={onClose}
      okLabel="Add variable"
      onOk={create}
      okDisabled={!valid || !!preview.error}
    >
      <p className="muted">
        Cuts a number variable into intervals: a new calculated text variable (one level per
        interval), as R’s cut() does. It follows its variable as the table changes.
      </p>
      <Field label="Number variable">
        {(id) => (
          <select id={id} value={source} onChange={(e) => setSource(e.target.value)}>
            {numbers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <RadioGroup
        legend="Intervals"
        name={`${id}-m`}
        value={method}
        options={[
          { value: 'quantile', label: 'Quantiles: equal numbers of values' },
          { value: 'width', label: 'Equal widths over the range' },
          { value: 'breaks', label: 'At cut points' },
        ]}
        onChange={setMethod}
      />
      {method === 'breaks' ? (
        <Field label="Cut points">
          {(id) => (
            <input
              id={id}
              value={breaksText}
              placeholder="0, 10, 100, 1000"
              onChange={(e) => setBreaksText(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <Field label="Number of intervals">
          {(id) => (
            <NumberBox id={id} value={n} min={1} max={100} onChange={(v) => setN(Math.trunc(v))} />
          )}
        </Field>
      )}
      <RadioGroup
        legend="Each interval"
        name={`${id}-c`}
        value={closure}
        options={[
          { value: 'right', label: 'Includes its upper end, (a, b] (as R)' },
          { value: 'left', label: 'Includes its lower end, [a, b)' },
        ]}
        onChange={setClosure}
      />
      <Field label="Labels (comma-separated; blank: “(a, b]”)">
        {(id) => (
          <input
            id={id}
            value={labelsText}
            placeholder="low, mid, high"
            onChange={(e) => setLabelsText(e.target.value)}
          />
        )}
      </Field>
      <Field label="New variable">
        {(id) => (
          <input
            id={id}
            value={name}
            placeholder={src ? `${src.title} bins` : ''}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <LevelList {...preview} />
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Swap X and Y (XY tables)
// ---------------------------------------------------------------------------------------------

export function SwapXYDialog({
  table,
  dispatch,
  onClose,
  initial,
}: {
  table: DataTable
  dispatch: Dispatch
  onClose: () => void
  initial?: string
}) {
  const [dataSet, setDataSet] = useState(
    table.dataSets.some((d) => d.id === initial) ? initial! : (table.dataSets[0]?.id ?? ''),
  )
  const problem = swapXYProblem(table, dataSet)
  const ds: DataSetColumn | undefined = table.dataSets.find((d) => d.id === dataSet)
  const swap = () => {
    if (problem) return
    dispatch(
      {
        type: 'table.swapXY',
        table: table.id,
        dataSet: dataSet as DataSetColumn['id'],
        id: newColumnId(),
      },
      'Swap X and Y',
    )
    onClose()
  }
  return (
    <Dialog
      title="Swap X and Y"
      onClose={onClose}
      okLabel="Swap"
      onOk={swap}
      okDisabled={!!problem}
    >
      <Field label="Data set to become X">
        {(id) => (
          <select id={id} value={dataSet} onChange={(e) => setDataSet(e.target.value)}>
            {table.dataSets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || '(untitled)'}
              </option>
            ))}
          </select>
        )}
      </Field>
      {problem ? (
        <div className="help error" role="alert">
          {problem}
        </div>
      ) : (
        <p className="muted">
          “{ds?.title}” becomes X and “{table.x?.title}” a data set in its place. Graphs and
          analyses of “{ds?.title}” show “{table.x?.title}” instead, against the new X: the same
          pairs with X and Y swapped. Undo puts them back.
        </p>
      )}
    </Dialog>
  )
}
