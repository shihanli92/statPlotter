import {
  type ApplyPlan,
  applyMethod,
  applyToTables,
  compatibleTables,
  type DataSetMatch,
  familyOf,
  METHOD_EXTENSION,
  type Method,
  methodContents,
  methodTable,
  readMethod,
  writeMethod,
} from '@ps/engine'
import type { DataTable, NodeId, Project } from '@ps/model'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog, NoticeDialog } from '../components/Dialog.tsx'
import { Field, RadioGroup } from '../components/fields.tsx'
import { useConfirm } from '../components/modals.tsx'
import { useDoc, useServices } from '../context.tsx'
import type { LibraryEntry } from '../services.ts'
import { errorMessage } from '../util.ts'
import { countNodes } from './names.ts'

// Apply analyses and graphs to other tables, and Apply method… (roadmap 31): the same options and
// report of what can't be carried over, from a table of the project or from a saved method.

const KIND_TITLES: Record<DataTable['tableKind'], string> = {
  column: 'column',
  xy: 'XY',
  grouped: 'grouped',
  contingency: 'contingency',
  survival: 'survival',
  partsOfWhole: 'parts-of-whole',
  multipleVariables: 'multiple-variables',
  nested: 'nested',
}

interface Options {
  targets: NodeId[]
  match: DataSetMatch
  find: string
}

/** Target tables, data set matching and the name substitution. */
function ApplyFields({
  tables,
  value,
  onChange,
  findLabel,
}: {
  tables: readonly DataTable[]
  value: Options
  onChange: (o: Options) => void
  findLabel: string
}) {
  const toggle = (id: NodeId, on: boolean) =>
    onChange({
      ...value,
      targets: tables.map((t) => t.id).filter((t) => (t === id ? on : value.targets.includes(t))),
    })
  return (
    <>
      <fieldset className="field">
        <legend>Tables to apply them to</legend>
        {tables.length ? (
          tables.map((t) => (
            <label key={t.id} className="check">
              <input
                type="checkbox"
                checked={value.targets.includes(t.id)}
                onChange={(e) => toggle(t.id, e.target.checked)}
              />
              {t.name}
            </label>
          ))
        ) : (
          <div className="help">No other tables of this kind in the project.</div>
        )}
      </fieldset>
      <RadioGroup<DataSetMatch>
        legend="Match data sets"
        name="apply-match"
        value={value.match}
        options={[
          { value: 'position', label: 'By position (the first with the first, …)' },
          { value: 'title', label: 'By title' },
        ]}
        onChange={(match) => onChange({ ...value, match })}
      />
      <Field label={findLabel} help="…is replaced by the name of each table.">
        {(id, describedBy) => (
          <input
            id={id}
            type="text"
            aria-describedby={describedBy}
            value={value.find}
            onChange={(e) => onChange({ ...value, find: e.target.value })}
          />
        )}
      </Field>
    </>
  )
}

/** What will be made, and what can't be carried over. */
function PlanReport({ plan, project }: { plan: ApplyPlan | null; project: Project }) {
  if (!plan?.created.length) return null
  const count = plan.created.reduce((n, c) => n + c.nodes.length, 0)
  return (
    <div className="field">
      <span className="field-label">
        {count} new sheet{count === 1 ? '' : 's'} for{' '}
        {plan.created.map((c) => `“${project.nodes[c.target]?.name}”`).join(', ')}
      </span>
      {plan.warnings.length > 0 && (
        <div className="apply-warnings" role="status" aria-label="Not carried over">
          <strong>Not carried over:</strong>
          <ul>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The plan for the options shown (cheap: planned on every render); an error if it can't be made. */
function tryPlan(make: () => ApplyPlan | null): { plan: ApplyPlan | null; error: string | null } {
  try {
    return { plan: make(), error: null }
  } catch (e) {
    return { plan: null, error: errorMessage(e) }
  }
}

/** Opens the first graph made (else the first sheet) after applying. */
const firstMade = (project: Project, plan: ApplyPlan): NodeId | undefined => {
  const made = plan.created.flatMap((c) => c.nodes)
  return made.find((id) => project.nodes[id]?.kind === 'graph') ?? made[0]
}

/**
 * Analyze › Apply analyses and graphs to… : copies of a table's analyses and graphs (and layouts)
 * for other tables of the same kind, in one undo step.
 */
export function ApplyToTablesDialog({
  tableId,
  onClose,
  onCreated,
  onError,
}: {
  tableId: NodeId
  onClose: () => void
  onCreated: (id: NodeId) => void
  onError: (msg: string) => void
}) {
  const { store } = useServices()
  const project = useDoc((d) => d)
  const table = project.nodes[tableId] as DataTable
  const tables = compatibleTables(project, table)
  const [options, setOptions] = useState<Options>({
    targets: [],
    match: 'position',
    find: table.name,
  })
  const [layouts, setLayouts] = useState(true)
  const members = familyOf(project, tableId, 'whole').map((id) => project.nodes[id]!)
  const { plan, error } = tryPlan(() =>
    options.targets.length
      ? applyToTables(project, tableId, project, options.targets, { ...options, layouts })
      : null,
  )
  if (!members.some((n) => n.kind !== 'layout'))
    return (
      <NoticeDialog
        title="Apply analyses and graphs"
        message={`“${table.name}” has no analyses or graphs to apply.`}
        onClose={onClose}
      />
    )
  const apply = () => {
    if (!plan) return
    try {
      store.dispatch(plan.commands, 'Apply analyses and graphs')
      const open = firstMade(store.getState(), plan)
      if (open) onCreated(open)
      onClose()
    } catch (e) {
      onError(errorMessage(e))
    }
  }
  return (
    <Dialog
      title={`Apply the analyses and graphs of “${table.name}”`}
      onClose={onClose}
      okLabel="Apply"
      onOk={apply}
      okDisabled={!plan?.created.length}
    >
      <p className="muted">
        Makes {countNodes(members.filter((n) => layouts || n.kind !== 'layout'))} like those of “
        {table.name}” for each table chosen, with the same parameters and formatting.
      </p>
      <ApplyFields
        tables={tables}
        value={options}
        onChange={setOptions}
        findLabel="In the new sheets’ names, the text"
      />
      {members.some((n) => n.kind === 'layout') && (
        <label className="check field">
          <input type="checkbox" checked={layouts} onChange={(e) => setLayouts(e.target.checked)} />
          Layouts too (those showing only graphs of “{table.name}”)
        </label>
      )}
      {error && <p className="help error">{error}</p>}
      <PlanReport plan={plan} project={project} />
    </Dialog>
  )
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** The saved methods (platform library), each read and checked when listed. */
function useMethods(onError: (msg: string) => void) {
  const { platform } = useServices()
  const library = platform.methods
  const [entries, setEntries] = useState<
    (LibraryEntry & { method: Method | null; problem?: string })[]
  >([])
  const refresh = useCallback(async () => {
    if (!library) return
    try {
      const list = await library.list()
      const read = await Promise.all(
        list.map(async (e) => {
          try {
            const bytes = await library.read(e.name)
            return { ...e, method: bytes ? readMethod(decoder.decode(bytes)) : null }
          } catch (err) {
            return { ...e, method: null, problem: errorMessage(err) }
          }
        }),
      )
      setEntries(read)
    } catch (e) {
      onError(`Couldn’t list the saved methods: ${errorMessage(e)}`)
    }
  }, [library, onError])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { entries, refresh, library }
}

/**
 * Analyze › Apply method… : a saved method's analyses, graphs and layouts made for tables of its
 * kind. Methods can be imported from a file (a colleague's), exported and deleted here.
 */
export function ApplyMethodDialog({
  tableId,
  onClose,
  onCreated,
  onError,
}: {
  tableId: NodeId
  onClose: () => void
  onCreated: (id: NodeId) => void
  onError: (msg: string) => void
}) {
  const { store, platform } = useServices()
  const confirm = useConfirm()
  const project = useDoc((d) => d)
  const table = project.nodes[tableId] as DataTable
  const { entries, refresh, library } = useMethods(onError)
  // Imported where there is no library to keep it in.
  const [imported, setImported] = useState<Method | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const listed = imported && !library ? [{ name: imported.name, method: imported }] : entries
  const entry = listed.find((e) => e.name === chosen) ?? null
  const method = entry?.method ?? null
  const kind = method ? methodTable(method).tableKind : null
  const tables = useMemo(
    () =>
      project.order.flatMap((id) => {
        const n = project.nodes[id]
        return n?.kind === 'table' && n.tableKind === kind ? [n] : []
      }),
    [project, kind],
  )
  const [options, setOptions] = useState<Options>({
    targets: [tableId],
    match: 'position',
    find: '',
  })
  useEffect(() => {
    if (method) setOptions((o) => ({ ...o, find: methodTable(method).name }))
  }, [method])
  // Only tables of the method's kind (the current table may be of another).
  const targets = options.targets.filter((id) => tables.some((t) => t.id === id))
  const { plan, error } = tryPlan(() =>
    method && targets.length
      ? applyMethod(method, project, targets, { match: options.match, find: options.find })
      : null,
  )

  const importFile = async () => {
    try {
      const file = await platform.openFile('Method', [METHOD_EXTENSION])
      if (!file) return
      const m = readMethod(decoder.decode(file.bytes))
      if (library) {
        await library.write(m.name, encoder.encode(writeMethod(m)))
        await refresh()
      } else setImported(m)
      setChosen(m.name)
    } catch (e) {
      onError(`Couldn’t import the method: ${errorMessage(e)}`)
    }
  }
  const exportFile = (m: Method) =>
    platform
      .exportFile(writeMethod(m), `${m.name}.${METHOD_EXTENSION}`, 'application/json')
      .catch((e) => onError(`Couldn’t export the method: ${errorMessage(e)}`))
  const remove = async (name: string) => {
    if (
      !library ||
      !(await confirm({ title: `Delete the method “${name}”?`, ok: 'Delete', danger: true }))
    )
      return
    await library.remove(name).catch((e) => onError(errorMessage(e)))
    if (chosen === name) setChosen(null)
    await refresh()
  }
  const apply = () => {
    if (!plan) return
    try {
      store.dispatch(plan.commands, `Apply method “${method!.name}”`)
      const open = firstMade(store.getState(), plan)
      if (open) onCreated(open)
      onClose()
    } catch (e) {
      onError(errorMessage(e))
    }
  }

  let about: ReactNode = null
  if (entry && !method) about = <p className="help error">{entry.problem ?? 'Unreadable.'}</p>
  else if (method) {
    const t = methodTable(method)
    const c = methodContents(method)
    about = (
      <p className="muted">
        {method.description && (
          <>
            {method.description}
            <br />
          </>
        )}
        Makes{' '}
        {countNodes([
          ...Array(c.analysis).fill({ kind: 'analysis' }),
          ...Array(c.graph).fill({ kind: 'graph' }),
          ...Array(c.layout).fill({ kind: 'layout' }),
        ])}{' '}
        for a {KIND_TITLES[t.tableKind]} table (made from “{t.name}”:{' '}
        {t.dataSets.map((d) => d.title || '(untitled)').join(', ')}).
      </p>
    )
  }

  return (
    <Dialog
      title="Apply a method"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={() => void importFile()}>
            Import…
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!plan?.created.length}
            onClick={apply}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="analyze">
        <div className="analyze-list" role="listbox" aria-label="Saved methods">
          <h4>Saved methods</h4>
          {!listed.length && (
            <p className="help">
              None yet: save one from a table (Analyze › Save as method…), or import a method file.
            </p>
          )}
          {listed.map((e) => (
            <button
              type="button"
              role="option"
              aria-selected={e.name === chosen}
              key={e.name}
              className={`list-item ${e.name === chosen ? 'on' : ''}`}
              onClick={() => setChosen(e.name)}
            >
              {e.name}
            </button>
          ))}
        </div>
        <div className="analyze-detail">
          {!method && !entry && (
            <p className="muted">Choose a method to apply to “{table.name}” or other tables.</p>
          )}
          {about}
          {method && (
            <>
              <p className="row-actions">
                <button type="button" onClick={() => void exportFile(method)}>
                  Export…
                </button>
                {library && (
                  <button type="button" onClick={() => void remove(method.name)}>
                    Delete
                  </button>
                )}
              </p>
              {kind !== table.tableKind && (
                <p className="help">
                  “{table.name}” is a {KIND_TITLES[table.tableKind]} table: this method applies to{' '}
                  {KIND_TITLES[kind!]} tables.
                </p>
              )}
              <ApplyFields
                tables={tables}
                value={{ ...options, targets }}
                onChange={setOptions}
                findLabel="In the new sheets’ names, the text"
              />
              {error && <p className="help error">{error}</p>}
              <PlanReport plan={plan} project={project} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}
