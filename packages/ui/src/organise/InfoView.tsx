import {
  constantList,
  INFO_TEMPLATES,
  type InfoNode,
  infoSheets,
  isFormatted,
  mergeRuns,
  type NodeId,
  numberFromText,
  plainText,
  type RichText,
  richPlain,
} from '@ps/model'
import { useRef, useState } from 'react'
import { type Command, GROUPS, useCommands } from '../commands/index.ts'
import { TextInput } from '../components/fields.tsx'
import { useDoc, useServices } from '../context.tsx'
import { type DataFormat, exportSheets } from '../export/dataExport.tsx'
import { fileBaseOf } from '../graph/viewCommands.ts'
import { RichTextEditor } from '../richText/RichTextEditor.tsx'
import { errorMessage } from '../util.ts'
import { useFocusRequest } from './context.tsx'
import { type ExportSheet, tableRowsOfInfo } from './infoExport.ts'

/**
 * An info sheet (roadmap 40): label/value fields about the experiment — numbers among them are
 * formulas' constants (`[Info: label]`) — and notes, formatted as rich text. Each edit is one
 * undo step when a field loses focus.
 */
export function InfoView({ id, onError }: { id: NodeId; onError: (msg: string) => void }) {
  const { store, platform } = useServices()
  const sheet = useDoc((d) => d.nodes[id]) as InfoNode
  const project = useDoc((d) => d)
  const body = useRef<HTMLDivElement>(null)
  const [template, setTemplate] = useState('experiment')

  useFocusRequest(id, (t) => {
    const sel =
      t.kind === 'field'
        ? `[data-field="${t.index}"][data-part="${t.part}"]`
        : t.kind === 'notes'
          ? '[role="textbox"]'
          : null
    if (!sel) return
    requestAnimationFrame(() => {
      const el = body.current?.querySelector<HTMLElement>(sel)
      el?.focus()
      el?.scrollIntoView({ block: 'nearest' })
    })
  })

  const setField = (index: number, part: 'label' | 'value', value: string) => {
    const f = sheet.fields[index]
    if (!f || f[part] === value) return
    store.dispatch({ type: 'info.setField', id, index, [part]: value }, 'Edit info')
  }
  const setFields = (fields: InfoNode['fields'], label: string) =>
    store.dispatch({ type: 'info.setFields', id, fields }, label)

  const addTemplate = () => {
    const t = INFO_TEMPLATES.find((x) => x.id === template)
    if (!t) return
    const have = new Set(sheet.fields.map((f) => f.label.trim().toLowerCase()))
    const more = t.labels.filter((l) => !have.has(l.toLowerCase()))
    if (more.length)
      setFields([...sheet.fields, ...more.map((label) => ({ label, value: '' }))], 'Add fields')
  }

  const notesRuns: RichText = sheet.notesRich ?? (sheet.notes ? plainText(sheet.notes) : [])
  const commitNotes = (rt: RichText) => {
    const notes = richPlain(rt)
    const merged = mergeRuns(rt)
    const rich = isFormatted(merged) ? merged : undefined
    if (notes === sheet.notes && JSON.stringify(rich) === JSON.stringify(sheet.notesRich)) return
    store.dispatch({ type: 'info.setNotes', id, notes, ...(rich ? { rich } : {}) }, 'Edit notes')
  }

  // Data export of the sheet: its fields (and notes) as CSV, TSV or Excel.
  const exportAs = (format: DataFormat) =>
    exportSheets(platform, infoSheetExport(sheet), fileBaseOf(sheet.name, 'info'), format).catch(
      (e: unknown) => onError(`Export failed: ${errorMessage(e)}`),
    )
  const exportCommand = (format: DataFormat, order: number, label: string): Command => ({
    id: `file.export.${format}`,
    label,
    menu: { menu: 'file', group: GROUPS.file.export, order, submenu: 'Export' },
    keywords: [`export ${format}`, 'info sheet'],
    hint: 'Export the info sheet’s fields and notes',
    run: () => exportAs(format),
  })
  useCommands('view', [
    exportCommand('csv', 10, 'CSV…'),
    exportCommand('tsv', 20, 'TSV…'),
    exportCommand('xlsx', 30, 'Excel (.xlsx)…'),
  ])

  const constants = constantList(infoSheets(project)).filter((c) => c.sheet === sheet.name)

  return (
    <div className="info-view" ref={body}>
      <div className="view-toolbar">
        <span className="hint">
          Info sheet — numbers here can be used in formulas, e.g.{' '}
          <code>
            [Info: {sheet.fields.find((f) => numberFromText(f.value) !== null)?.label || 'dilution'}
            ]
          </code>
        </span>
      </div>
      <table className="info-fields" aria-label="Info fields">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.fields.map((f, i) => (
            // Keyed by position (audit 2, U8): a row stays the same element while it is edited,
            // so Tab from one field to the next keeps the focus; the inputs show the fields'
            // values whatever row they are in.
            // biome-ignore lint/suspicious/noArrayIndexKey: fields are addressed by position
            <tr key={i}>
              <td>
                <TextInput
                  hideLabel
                  label={`Field ${i + 1} label`}
                  attrs={{ 'data-field': i, 'data-part': 'label' }}
                  value={f.label}
                  placeholder="Label"
                  onChange={(v) => setField(i, 'label', v)}
                />
              </td>
              <td>
                <TextInput
                  hideLabel
                  label={f.label ? `${f.label} value` : `Field ${i + 1} value`}
                  attrs={{ 'data-field': i, 'data-part': 'value' }}
                  value={f.value}
                  placeholder="Value"
                  onChange={(v) => setField(i, 'value', v)}
                />
              </td>
              <td className="info-actions">
                <button
                  type="button"
                  title="Move up"
                  aria-label={`Move ${f.label || `field ${i + 1}`} up`}
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...sheet.fields]
                    ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
                    setFields(next, 'Move field')
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Remove"
                  aria-label={`Remove ${f.label || `field ${i + 1}`}`}
                  onClick={() =>
                    setFields(
                      sheet.fields.filter((_, k) => k !== i),
                      'Remove field',
                    )
                  }
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="info-add">
        <button
          type="button"
          onClick={() => setFields([...sheet.fields, { label: '', value: '' }], 'Add field')}
        >
          Add field
        </button>
        <label>
          Fields from a template{' '}
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {INFO_TEMPLATES.filter((t) => t.labels.length).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={addTemplate}>
          Add these fields
        </button>
      </div>
      {constants.some((c) => c.number) && (
        <p className="hint info-constants">
          Formula constants:{' '}
          {constants
            .filter((c) => c.number)
            .map((c) => `${c.reference} = ${c.value.trim()}`)
            .join(', ')}
        </p>
      )}
      <section className="info-notes">
        <h3 id={`info-notes-${id}`}>Notes</h3>
        <RichTextEditor
          key={`${sheet.notes}`}
          value={notesRuns}
          labelledBy={`info-notes-${id}`}
          multiline
          placeholder="Notes about the experiment (methods, sources, what to check)…"
          onCommit={commitNotes}
        />
      </section>
    </div>
  )
}

/** An info sheet as an exported worksheet: Field, Value rows, then its notes. */
function infoSheetExport(sheet: InfoNode): ExportSheet[] {
  return [{ name: sheet.name, rows: tableRowsOfInfo(sheet) }]
}
