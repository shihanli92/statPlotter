import { COLUMN_LABELS, type ColumnWidth, type FitKeep, FONTS, styleFromGraph } from '@ps/graph'
import { parseMissingCodes } from '@ps/io'
import {
  APP_VERSION,
  type AppPreferences,
  BUILTIN_STYLES,
  ColorMapName,
  DEFAULT_STYLE_ID,
  effectiveStyle,
  type FigureStyle,
  type FontId,
  type GraphNode,
  type LayoutNode,
  type NodeId,
  type Project,
  PT_PER_MM,
  STYLE_EXTENSION,
  STYLE_LINE_ROLES,
  STYLE_NAME_MAX,
  STYLE_TEXT_ROLES,
  type StyleChoice,
  type StyleLineRole,
  type StyleTextRole,
  styleName,
  styleNameProblem,
  type UserStyle,
  uniqueStyleName,
  userStyleChoice,
  userStyleId,
} from '@ps/model'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { Dialog, NoticeDialog } from '../components/Dialog.tsx'
import { Checkbox, Field, OptionalNumber, RadioGroup, Select } from '../components/fields.tsx'
import { useConfirm } from '../components/modals.tsx'
import { useDoc, useServices } from '../context.tsx'
import { EXPORT_FORMATS, forgetExportChoice } from '../graph/exportSettings.ts'
import { offerUpdate } from '../updates/UpdatePrompt.tsx'
import { checkForUpdate, checkMessage, UPDATES_NOT_SET_UP } from '../updates/updates.ts'
import { errorMessage } from '../util.ts'
import {
  applyStyleCommands,
  columnWidth,
  fitGraphCommands,
  fitPageCommands,
  pageGraphs,
  projectChoice,
  resetStyleCommands,
  type StyleTarget,
} from './styleActions.ts'
import {
  deleteStyle,
  exportStyle,
  importStyle,
  loadPreferences,
  renameStyle,
  savePreferences,
  saveStyle,
  updateStyle,
  usePreferences,
  useStyleLibrary,
} from './styleStore.ts'
import { UNITS } from './units.ts'

// Roadmap 37's dialogs: Styles (the built-in and the user's styles, the Style editor, applying
// one), Save this graph's look as a style, Reset to style, Fit to column and Preferences.

const TEXT_LABELS: Record<StyleTextRole, string> = {
  title: 'Graph titles',
  axisTitle: 'Axis titles',
  tickLabel: 'Tick labels',
  legend: 'Legends',
  annotation: 'Text on graphs',
  bracket: 'Bracket labels',
  resultLabel: 'Result and point labels',
}

const LINE_LABELS: Record<StyleLineRole, string> = {
  axis: 'Axes',
  tick: 'Ticks',
  errorBar: 'Error bars',
  dataLine: 'Data lines and curves',
  barOutline: 'Bar and box outlines',
  bracket: 'Brackets',
}

/** Fitted plots narrower than this (points) get a warning. */
const MIN_FITTED_PLOT = 36

const mmOf = (pt: number | undefined) =>
  pt === undefined ? undefined : Math.round((pt / PT_PER_MM) * 10) / 10

/** What the graphs a style is applied to are: their names for the Apply choice. */
export interface StyleScope {
  /** The open graph. */
  graph?: GraphNode
  /** The open layout page, and the graphs selected on it. */
  page?: { layout: LayoutNode; selected: NodeId[] }
  /** Roadmap 40: graphs chosen in the Gallery. */
  chosen?: NodeId[]
  /** Roadmap 47: graphs selected in the navigator (several). */
  navigator?: NodeId[]
}

/** A one-line summary of what a style sets. */
function styleSummary(s: FigureStyle): string {
  const parts: string[] = []
  const at = s.text?.axisTitle?.size
  const tick = s.text?.tickLabel?.size
  if (at || tick) parts.push(`text ${[tick, at].filter(Boolean).join('–')} pt`)
  if (s.lines?.axis !== undefined) parts.push(`axes ${s.lines.axis} pt`)
  if (s.symbolSize !== undefined) parts.push(`symbols ${s.symbolSize} pt`)
  const c = s.columns
  if (c?.single)
    parts.push(
      `columns ${[c.single, c.oneAndHalf, c.double]
        .filter(Boolean)
        .map((v) => mmOf(v))
        .join('/')} mm`,
    )
  return parts.length ? parts.join(' · ') : 'The app’s own look'
}

type Entry = { choice: StyleChoice; user?: UserStyle }

/**
 * Styles…: the built-in styles and the user's, each applied to this graph, the graphs selected
 * on the page, the page's graphs or the whole project; the user's renamed, deleted, edited,
 * exported; files imported; a graph's look saved as a new one.
 */
export function StylesDialog({
  scope,
  onClose,
  onMessage,
}: {
  scope: StyleScope
  onClose: () => void
  onMessage: (msg: string) => void
}) {
  const { store, platform } = useServices()
  const project = useDoc((d) => d)
  const { library, styles } = useStyleLibrary()
  // A style just saved shows before the library is read again.
  const [fresh, setFresh] = useState<UserStyle | null>(null)
  const own = fresh && !styles.some((s) => s.name === fresh.name) ? [...styles, fresh] : styles
  const entries: Entry[] = [
    ...BUILTIN_STYLES.map((choice) => ({ choice })),
    ...own.map((user) => ({ choice: userStyleChoice(user), user })),
  ]
  const current = projectChoice(project.settings)
  const graphOwn = scope.graph?.theme
  const [picked, setPicked] = useState<string>(graphOwn?.id ?? current?.id ?? DEFAULT_STYLE_ID)
  const entry = entries.find((e) => e.choice.id === picked) ?? entries[0]!
  const targets = targetOptions(project, scope)
  const [target, setTarget] = useState<string>(targets[0]!.value)
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const confirm = useConfirm()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const id = useId()
  const fail = (what: string) => (e: unknown) =>
    setMessage({ text: `${what}: ${errorMessage(e)}`, error: true })

  const apply = () => {
    const t = targets.find((x) => x.value === target)!
    const cmds = applyStyleCommands(store.getState(), entry.choice, t.target)
    // Roadmap 47: several graphs, the count in the undo step.
    const n = t.target.kind === 'graphs' ? t.target.ids.length : 0
    if (cmds.length) store.dispatch(cmds, n > 1 ? `Apply style to ${n} graphs` : 'Apply style')
    const name = styleName(entry.choice)
    onMessage(
      `Applied “${name}” to ${t.what}. Your own formatting is kept (Reset to style clears it).`,
    )
    onClose()
  }
  const importFile = async () => {
    setMessage(null)
    if (!library) return
    try {
      const file = await platform.openFile('Style', [STYLE_EXTENSION])
      if (!file) return
      const s = await importStyle(library, new TextDecoder().decode(file.bytes))
      setFresh(s)
      setPicked(userStyleId(s.name))
      setMessage({ text: `Imported the style “${s.name}”.`, error: false })
    } catch (e) {
      fail('Couldn’t import the style')(e)
    }
  }
  const exportFile = () => {
    const u: UserStyle = entry.user ?? {
      name: styleName(entry.choice).replace(/[\\/:*?"<>|]/g, '-'),
      created: new Date().toISOString(),
      appVersion: '',
      style: entry.choice.style,
    }
    platform
      .exportFile(exportStyle(u), `${u.name}.${STYLE_EXTENSION}`, 'application/json')
      .catch(fail('Couldn’t export the style'))
  }
  const duplicate = async () => {
    if (!library) return
    try {
      const base = `${styleName(entry.choice)
        .replace(/^Journal: /, '')
        .replace(/[\\/:*?"<>|]/g, '-')} copy`
      const name = uniqueStyleName(
        base.slice(0, STYLE_NAME_MAX),
        styles.map((s) => s.name),
      )
      const s = await saveStyle(library, name, entry.choice.style)
      setFresh(s)
      setPicked(userStyleId(s.name))
      setEditing(true)
    } catch (e) {
      fail('Couldn’t copy the style')(e)
    }
  }

  const item = (e: Entry) => {
    const isProject = (current?.id ?? DEFAULT_STYLE_ID) === e.choice.id
    const isGraph = graphOwn?.id === e.choice.id
    return (
      <li key={e.choice.id}>
        <button
          type="button"
          className={`style-item ${e.choice.id === picked ? 'on' : ''}`}
          aria-pressed={e.choice.id === picked}
          onClick={() => {
            setPicked(e.choice.id)
            setEditing(false)
            setRenaming(null)
          }}
        >
          {styleName(e.choice)}
          {isProject && <span className="muted"> · the project’s</span>}
          {isGraph && <span className="muted"> · this graph’s</span>}
        </button>
      </li>
    )
  }

  return (
    <Dialog
      title="Styles"
      onClose={onClose}
      wide
      footer={
        <>
          {library && (
            <button type="button" onClick={() => void importFile()}>
              Import…
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="styles-dialog">
        <div className="style-list">
          <h4 className="style-group">Built in</h4>
          <ul aria-label="Built-in styles">{entries.slice(0, BUILTIN_STYLES.length).map(item)}</ul>
          <h4 className="style-group">Your styles</h4>
          <ul aria-label="Your styles">{entries.slice(BUILTIN_STYLES.length).map(item)}</ul>
          {library && styles.length === 0 && (
            <p className="muted">
              None yet: Duplicate a built-in style, Save this graph’s look as a style… or Import….
            </p>
          )}
        </div>
        <div className="style-detail">
          {renaming !== null && entry.user ? (
            <RenameRow
              from={entry.user.name}
              value={renaming}
              taken={styles.map((s) => s.name)}
              onChange={setRenaming}
              onCancel={() => setRenaming(null)}
              onSave={async (to) => {
                try {
                  await renameStyle(library!, entry.user!.name, to)
                  setPicked(userStyleId(to.trim()))
                  setRenaming(null)
                } catch (e) {
                  fail('Couldn’t rename the style')(e)
                }
              }}
            />
          ) : (
            <h3>{styleName(entry.choice)}</h3>
          )}
          {entry.choice.style.description && (
            <p className="muted">{entry.choice.style.description}</p>
          )}
          <p>{styleSummary(entry.choice.style)}</p>
          <div className="button-row">
            {entry.user && !editing && (
              <button type="button" onClick={() => setEditing(true)}>
                Edit…
              </button>
            )}
            {entry.user && (
              <button type="button" onClick={() => setRenaming(entry.user!.name)}>
                Rename
              </button>
            )}
            {library && (
              <button type="button" onClick={() => void duplicate()}>
                Duplicate as my style
              </button>
            )}
            <button type="button" onClick={exportFile}>
              Export…
            </button>
            {entry.user && (
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const name = entry.user!.name
                  const yes = await confirm({
                    title: `Delete “${name}” for good?`,
                    message: 'Projects and graphs that use it keep its look.',
                    ok: 'Delete',
                    danger: true,
                  })
                  if (!yes) return
                  deleteStyle(library!, name)
                    .then(() => setPicked(DEFAULT_STYLE_ID))
                    .catch(fail('Couldn’t delete the style'))
                }}
              >
                Delete
              </button>
            )}
          </div>
          {editing && entry.user && (
            <StyleEditor
              key={entry.user.name}
              style={entry.user.style}
              onCancel={() => setEditing(false)}
              onSave={(s) =>
                updateStyle(library!, entry.user!.name, s).then(() => {
                  setEditing(false)
                  setMessage({
                    text: `Saved “${entry.user!.name}”. Apply it again where it is used to show the changes.`,
                    error: false,
                  })
                }, fail('Couldn’t save the style'))
              }
            />
          )}
          {!editing && (
            <RadioGroup
              legend="Apply to"
              name={`${id}-target`}
              value={target}
              options={targets.map((t) => ({ value: t.value, label: t.label }))}
              onChange={setTarget}
            />
          )}
          {!editing && (
            <p className="muted">
              A style changes only what you haven’t set yourself: fonts, sizes and lines you chose
              stay. Format › Reset to style… clears them.
            </p>
          )}
        </div>
      </div>
      {message && (
        <p
          className={message.error ? 'error-text' : 'muted'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </Dialog>
  )
}

function targetOptions(
  project: Project,
  scope: StyleScope,
): { value: string; label: string; what: string; target: StyleTarget }[] {
  const out: { value: string; label: string; what: string; target: StyleTarget }[] = []
  if (scope.navigator?.length) {
    const n = scope.navigator.length
    out.push({
      value: 'navigator',
      label: `The graphs selected in the navigator (${n})`,
      what: `${n} graph${n === 1 ? '' : 's'}`,
      target: { kind: 'graphs', ids: scope.navigator },
    })
  }
  if (scope.chosen?.length) {
    const n = scope.chosen.length
    out.push({
      value: 'chosen',
      label: `The graphs chosen in the Gallery (${n})`,
      what: `${n} graph${n === 1 ? '' : 's'}`,
      target: { kind: 'graphs', ids: scope.chosen },
    })
  }
  if (scope.graph)
    out.push({
      value: 'graph',
      label: `This graph (“${scope.graph.name}”)`,
      what: `“${scope.graph.name}”`,
      target: { kind: 'graphs', ids: [scope.graph.id] },
    })
  if (scope.page) {
    const sel = scope.page.selected
    if (sel.length)
      out.push({
        value: 'selected',
        label: `The selected graphs on the page (${sel.length})`,
        what: `${sel.length} graph${sel.length === 1 ? '' : 's'}`,
        target: { kind: 'graphs', ids: sel },
      })
    const all = pageGraphs(project, scope.page.layout)
    if (all.length)
      out.push({
        value: 'page',
        label: `The graphs on “${scope.page.layout.name}” (${all.length})`,
        what: `the graphs on “${scope.page.layout.name}”`,
        target: { kind: 'graphs', ids: all },
      })
  }
  out.push({
    value: 'project',
    label: 'The whole project (every graph, and new graphs)',
    what: 'the whole project',
    target: { kind: 'project', followAll: true },
  })
  out.push({
    value: 'projectOnly',
    label: 'The project’s style only (graphs with a style of their own keep it)',
    what: 'the project',
    target: { kind: 'project', followAll: false },
  })
  return out
}

function RenameRow({
  from,
  value,
  taken,
  onChange,
  onCancel,
  onSave,
}: {
  from: string
  value: string
  taken: string[]
  onChange: (v: string) => void
  onCancel: () => void
  onSave: (to: string) => void
}) {
  const id = useId()
  const problem =
    value.trim() === from
      ? null
      : styleNameProblem(
          value,
          taken.filter((t) => t !== from),
        )
  return (
    <div className="preset-rename">
      <label htmlFor={id} className="visually-hidden">
        New name for {from}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        aria-invalid={!!problem}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !problem) onSave(value)
          else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        // biome-ignore lint/a11y/noAutofocus: inline rename
        autoFocus
      />
      <button type="button" disabled={!!problem} onClick={() => onSave(value)}>
        Save name
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {problem && (
        <span className="error-text" role="alert">
          {problem}
        </span>
      )}
    </div>
  )
}

// --- The Style editor -----------------------------------------------------------------------------

const ANY = ''

/** A style's values edited: each field blank means "the app's own" (the style says nothing). */
function StyleEditor({
  style,
  onSave,
  onCancel,
}: {
  style: FigureStyle
  onSave: (s: FigureStyle) => void
  onCancel: () => void
}) {
  const [s, setS] = useState<FigureStyle>(style)
  const [paletteText, setPaletteText] = useState((style.palette ?? []).join(', '))
  const palette = paletteText
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean)
  const paletteOk = palette.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))
  const setIn = <K extends keyof FigureStyle>(k: K, v: FigureStyle[K] | undefined) =>
    setS((x) => {
      const out = { ...x }
      if (v === undefined || (typeof v === 'object' && v && Object.keys(v).length === 0))
        delete out[k]
      else out[k] = v
      return out
    })
  const sub = <K extends 'lines' | 'axes' | 'pValue' | 'legend' | 'columns'>(
    k: K,
    field: string,
    v: unknown,
  ) => {
    const cur = { ...(s[k] as Record<string, unknown> | undefined) }
    if (v === undefined || v === ANY) delete cur[field]
    else cur[field] = v
    setIn(k, cur as FigureStyle[K])
  }
  const setText = (role: StyleTextRole, field: 'size' | 'bold', v: unknown) => {
    const text = { ...s.text }
    const t = { ...text[role] }
    if (v === undefined) delete t[field]
    else (t as Record<string, unknown>)[field] = v
    if (Object.keys(t).length) text[role] = t
    else delete text[role]
    setIn('text', text)
  }
  const fonts = [
    { value: ANY, label: 'The app’s (Sans)' },
    ...(Object.keys(FONTS) as FontId[]).map((f) => ({ value: f, label: FONTS[f].label })),
  ]
  const choose = <T extends string>(
    label: string,
    value: T | undefined,
    options: { value: string; label: string }[],
    set: (v: T | undefined) => void,
  ) => (
    <Select
      label={label}
      value={value ?? ANY}
      options={[{ value: ANY, label: 'The app’s' }, ...options]}
      onChange={(v) => set(v === ANY ? undefined : (v as T))}
    />
  )
  const num = (label: string, value: number | undefined, set: (v: number | undefined) => void) => (
    <div className="field style-num" key={label}>
      <span aria-hidden="true">{label}</span>
      <OptionalNumber label={label} value={value} placeholder="app’s" onChange={set} />
    </div>
  )
  const save = () => {
    const out: FigureStyle = { ...s }
    if (palette.length && paletteOk) out.palette = palette
    else delete out.palette
    onSave(out)
  }
  return (
    <fieldset className="style-editor">
      <legend>Style editor</legend>
      <label className="field">
        <span>Description</span>
        <textarea
          rows={2}
          value={s.description ?? ''}
          onChange={(e) => setIn('description', e.target.value || undefined)}
        />
      </label>
      <Select
        label="Font"
        value={s.font ?? ANY}
        options={fonts}
        onChange={(v) => setIn('font', v === ANY ? undefined : (v as FontId))}
      />
      <table className="style-table">
        <thead>
          <tr>
            <th>Text</th>
            <th>Size (pt)</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {STYLE_TEXT_ROLES.map((role) => (
            <tr key={role}>
              <th scope="row">{TEXT_LABELS[role]}</th>
              <td>
                <OptionalNumber
                  label={`${TEXT_LABELS[role]} size`}
                  value={s.text?.[role]?.size}
                  placeholder="app’s"
                  onChange={(v) => setText(role, 'size', v)}
                />
              </td>
              <td>
                <select
                  aria-label={`${TEXT_LABELS[role]} weight`}
                  value={
                    s.text?.[role]?.bold === undefined
                      ? ANY
                      : s.text[role]!.bold
                        ? 'bold'
                        : 'regular'
                  }
                  onChange={(e) =>
                    setText(
                      role,
                      'bold',
                      e.target.value === ANY ? undefined : e.target.value === 'bold',
                    )
                  }
                >
                  <option value={ANY}>The app’s</option>
                  <option value="regular">Regular</option>
                  <option value="bold">Bold</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset className="field">
        <legend>Line widths (pt)</legend>
        <div className="style-grid">
          {STYLE_LINE_ROLES.map((role) =>
            num(LINE_LABELS[role], s.lines?.[role], (v) => sub('lines', role, v)),
          )}
        </div>
      </fieldset>
      <div className="style-grid">
        {num('Symbol size (pt)', s.symbolSize, (v) => setIn('symbolSize', v))}
        {num('Bar fill opacity (0–1)', s.barFillOpacity, (v) => setIn('barFillOpacity', v))}
      </div>
      <label className="field">
        <span>Palette (colours as #rrggbb, in order)</span>
        <input
          type="text"
          value={paletteText}
          aria-invalid={!paletteOk}
          placeholder="The app’s (Okabe–Ito)"
          onChange={(e) => setPaletteText(e.target.value)}
        />
      </label>
      {!paletteOk && (
        <p className="error-text" role="alert">
          Colours are written #rrggbb, e.g. #0072b2.
        </p>
      )}
      {choose(
        'Colour map (continuous colour)',
        s.colorMap,
        ColorMapName.options.map((m) => ({ value: m, label: m })),
        (v) => setIn('colorMap', v as FigureStyle['colorMap']),
      )}
      <fieldset className="field">
        <legend>Axes</legend>
        <div className="style-grid">
          {choose(
            'Axes at the origin',
            s.axes?.frame,
            [
              { value: 'plain', label: 'Touching' },
              { value: 'offset', label: 'Offset' },
            ],
            (v) => sub('axes', 'frame', v),
          )}
          {choose(
            'Tick marks',
            s.axes?.tickDirection,
            [
              { value: 'out', label: 'Outside' },
              { value: 'in', label: 'Inside' },
              { value: 'cross', label: 'Crossing' },
              { value: 'none', label: 'None' },
            ],
            (v) => sub('axes', 'tickDirection', v),
          )}
          {num('Tick length (pt)', s.axes?.tickLength, (v) => sub('axes', 'tickLength', v))}
          {num('Minor tick length (pt)', s.axes?.minorTickLength, (v) =>
            sub('axes', 'minorTickLength', v),
          )}
        </div>
      </fieldset>
      <div className="style-grid">
        {choose(
          'P values',
          s.pValue?.style,
          [
            { value: 'GP', label: 'GraphPad (ns, *, **, ***, ****)' },
            { value: 'APA', label: 'APA (.033)' },
            { value: 'NEJM', label: 'NEJM (0.033)' },
          ],
          (v) => sub('pValue', 'style', v),
        )}
        {num('P value digits', s.pValue?.digits, (v) => sub('pValue', 'digits', v))}
        {choose(
          'Legend of new graphs',
          s.legend?.position,
          [
            { value: 'right', label: 'Right' },
            { value: 'top', label: 'Top' },
            { value: 'inside', label: 'Inside the plot' },
          ],
          (v) => sub('legend', 'position', v),
        )}
      </div>
      <fieldset className="field">
        <legend>Figure widths (mm)</legend>
        <div className="style-grid">
          {(['single', 'oneAndHalf', 'double'] as const).map((k) =>
            num(COLUMN_LABELS[k], mmOf(s.columns?.[k]), (v) =>
              sub(
                'columns',
                k,
                v === undefined ? undefined : Math.round(v * PT_PER_MM * 100) / 100,
              ),
            ),
          )}
        </div>
      </fieldset>
      <div className="button-row">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!paletteOk} onClick={save}>
          Save style
        </button>
      </div>
    </fieldset>
  )
}

// --- Save this graph's look as a style -----------------------------------------------------------

export function SaveStyleDialog({
  graph,
  onClose,
  onMessage,
}: {
  graph: GraphNode
  onClose: () => void
  onMessage: (msg: string) => void
}) {
  const project = useDoc((d) => d)
  const { library, styles } = useStyleLibrary()
  const [name, setName] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!library)
    return (
      <NoticeDialog
        title="Save as style"
        message="Styles can’t be kept on this platform."
        onClose={onClose}
      />
    )
  const problem = styleNameProblem(
    name,
    styles.map((s) => s.name),
  )
  const shown = (tried || name.trim() ? problem : null) ?? error
  const save = async () => {
    setTried(true)
    if (problem) return
    try {
      const s = await saveStyle(library, name, styleFromGraph(graph, project.settings))
      onMessage(`Saved the style “${s.name}”: apply it from Format › Styles….`)
      onClose()
    } catch (e) {
      setError(`Couldn’t save the style: ${errorMessage(e)}`)
    }
  }
  return (
    <Dialog
      title="Save this graph’s look as a style"
      onClose={onClose}
      okLabel="Save"
      onOk={() => void save()}
    >
      <p className="muted">
        Keeps “{graph.name}”’s fonts and sizes, line widths, symbol size, bar fill, palette, axis
        look and legend place as drawn, the project’s P values and its style’s column widths. Not
        kept: titles, ranges, layers or anything about its data.
      </p>
      <Field label="Style name">
        {(id) => (
          <input
            id={id}
            type="text"
            maxLength={STYLE_NAME_MAX + 20}
            value={name}
            aria-invalid={!!shown}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            autoFocus
          />
        )}
      </Field>
      {shown && (
        <p className="error-text" role="alert">
          {shown}
        </p>
      )}
    </Dialog>
  )
}

// --- Reset to style -------------------------------------------------------------------------------

export function ResetStyleDialog({
  ids,
  what,
  onClose,
  onMessage,
}: {
  ids: readonly NodeId[]
  /** "“Graph 1”", "the graphs on “Figure 1”", "every graph". */
  what: string
  onClose: () => void
  onMessage: (msg: string) => void
}) {
  const { store } = useServices()
  const reset = () => {
    const cmds = resetStyleCommands(store.getState(), ids)
    if (cmds.length) store.dispatch(cmds, 'Reset to style')
    onMessage(
      cmds.length
        ? `Reset ${cmds.length} graph${cmds.length === 1 ? '' : 's'} to the style. Undo brings your formatting back.`
        : 'Nothing to reset: the graphs already follow their style.',
    )
    onClose()
  }
  return (
    <Dialog title="Reset to style" onClose={onClose} okLabel="Reset" onOk={reset}>
      <p>
        Clear your own formatting of {what}: the fonts and sizes of titles, tick labels, legends,
        text and brackets; axis, tick and bracket line widths, tick marks; palettes; symbol sizes,
        line widths and bar fills. Axes at the origin and legends go where the style puts them.
      </p>
      <p className="muted">
        Titles’ wording, ranges, sizes, data sets’ colours and everything else stay. You can undo
        this.
      </p>
    </Dialog>
  )
}

// --- Fit to column --------------------------------------------------------------------------------

export function FitColumnDialog({
  graph,
  layout,
  onClose,
  onMessage,
}: {
  graph?: GraphNode
  layout?: LayoutNode
  onClose: () => void
  onMessage: (msg: string) => void
}) {
  const { store, fonts } = useServices()
  const project = useDoc((d) => d)
  const [which, setWhich] = useState<ColumnWidth>('single')
  const [keep, setKeep] = useState<FitKeep>('aspect')
  const id = useId()
  const width = (w: ColumnWidth) => columnWidth(project, w, graph)
  const fit = () => {
    const p = store.getState()
    const cmds = graph
      ? fitGraphCommands(p, fonts, graph, width(which), keep)
      : layout
        ? fitPageCommands(p, fonts, layout, width(which), keep)
        : []
    if (cmds.length) store.dispatch(cmds, 'Fit to column')
    // A plot squeezed to almost nothing: its text is too big for the column.
    const cramped = cmds.some(
      (c) =>
        c.type === 'node.set' &&
        c.path[0] === 'size' &&
        (c.value as GraphNode['size']).plotWidth < MIN_FITTED_PLOT,
    )
    if (cramped)
      onMessage(
        'Some plots are very narrow at this width: their text is too big for the column. A journal style (Format › Styles…) sizes text for print.',
      )
    onClose()
  }
  const plainLook = !effectiveStyle(project.settings, graph)?.columns
  return (
    <Dialog title="Fit to column" onClose={onClose} okLabel="Fit" onOk={fit}>
      <p className="muted">
        {graph
          ? 'The whole graph — axes, labels, legend — made the column’s width at 100% scale, so text, symbols and lines are at the style’s point sizes.'
          : 'The page made the column’s width, everything on it in proportion; each graph drawn at 100% and resized to its place, so text, symbols and lines are at the style’s point sizes.'}
      </p>
      {plainLook && (
        <p className="muted">
          This uses common column widths: the style names none. The app’s own look has 11–14 pt
          text; a journal style (Format › Styles…) sizes text and widths for print.
        </p>
      )}
      <RadioGroup
        legend="Width"
        name={`${id}-width`}
        value={which}
        options={(['single', 'oneAndHalf', 'double'] as const).map((w) => ({
          value: w,
          label: `${COLUMN_LABELS[w]} (${mmOf(width(w))} mm)`,
        }))}
        onChange={setWhich}
      />
      <RadioGroup
        legend="Each plot keeps"
        name={`${id}-keep`}
        value={keep}
        options={[
          { value: 'aspect', label: 'Its proportions' },
          { value: 'height', label: 'Its height' },
        ]}
        onChange={setKeep}
      />
    </Dialog>
  )
}

// --- Preferences ----------------------------------------------------------------------------------

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const { platform } = useServices()
  const saved = usePreferences()
  const { styles } = useStyleLibrary()
  const [p, setP] = useState<AppPreferences>(saved)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof AppPreferences>(k: K, v: AppPreferences[K] | undefined) =>
    setP((x) => {
      const out = { ...x }
      if (v === undefined) delete out[k]
      else out[k] = v
      return out
    })
  const choices: StyleChoice[] = [...BUILTIN_STYLES, ...styles.map(userStyleChoice)]
  const styleId = p.style?.id ?? DEFAULT_STYLE_ID
  const save = async () => {
    try {
      // What the update check wrote meanwhile (when, a skipped version) is kept.
      const now = await loadPreferences(platform.settings)
      const kept: AppPreferences = { ...p }
      for (const k of ['lastUpdateCheck', 'skippedVersion'] as const) {
        if (now[k] === undefined) delete kept[k]
        else (kept as Record<string, unknown>)[k] = now[k]
      }
      await savePreferences(platform.settings, kept)
      // The Export dialog starts from these (PDF and 300 dpi included) from the next export on,
      // over a format chosen in it earlier this session (decision 690).
      if (p.exportFormat !== saved.exportFormat || p.exportDpi !== saved.exportDpi)
        forgetExportChoice()
      onClose()
    } catch (e) {
      setError(`Couldn’t save the preferences: ${errorMessage(e)}`)
    }
  }
  const row = (children: ReactNode) => <div className="field-row">{children}</div>
  return (
    <Dialog title="Preferences" onClose={onClose} okLabel="Save" onOk={() => void save()}>
      <h3 className="pref-heading">New projects</h3>
      <p className="muted">Projects you have keep their own settings.</p>
      <Select
        label="Style"
        value={styleId}
        options={choices.map((c) => ({ value: c.id, label: styleName(c) }))}
        onChange={(v) => {
          const c = choices.find((x) => x.id === v)
          set('style', !c || c.id === DEFAULT_STYLE_ID ? undefined : c)
        }}
      />
      {row(
        <>
          <Select
            label="P values"
            value={p.pValueStyle ?? 'GP'}
            options={[
              { value: 'GP', label: 'GraphPad (ns, *, **, ***, ****)' },
              { value: 'APA', label: 'APA (.033)' },
              { value: 'NEJM', label: 'NEJM (0.033)' },
            ]}
            onChange={(v) => set('pValueStyle', v === 'GP' ? undefined : v)}
          />
          <Select
            label="Digits"
            value={p.pValueDigits ?? 4}
            options={[1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: String(d) }))}
            onChange={(v) => set('pValueDigits', v === 4 ? undefined : v)}
          />
        </>,
      )}
      <Select
        label="Confidence level"
        value={p.confidenceLevel ?? 0.95}
        options={[0.9, 0.95, 0.99].map((c) => ({ value: c, label: `${c * 100}%` }))}
        onChange={(v) => set('confidenceLevel', v === 0.95 ? undefined : v)}
      />
      <h3 className="pref-heading">The app</h3>
      <Select
        label="Colours"
        value={p.colorScheme ?? 'system'}
        options={[
          { value: 'system', label: 'As the system (light or dark)' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        onChange={(v) => set('colorScheme', v === 'system' ? undefined : v)}
      />
      <p className="muted">Graphs and pages stay on white paper, as they are exported.</p>
      {row(
        <>
          <Select
            label="Sizes in"
            value={p.units ?? 'in'}
            options={(Object.keys(UNITS) as (keyof typeof UNITS)[]).map((u) => ({
              value: u,
              label: { in: 'Inches', mm: 'Millimetres', pt: 'Points' }[u],
            }))}
            onChange={(v) => set('units', v === 'in' ? undefined : v)}
          />
          <Select
            label="New pages"
            value={p.pageSize ?? 'letter'}
            options={[
              { value: 'letter', label: 'Letter' },
              { value: 'a4', label: 'A4' },
            ]}
            onChange={(v) => set('pageSize', v === 'letter' ? undefined : v)}
          />
        </>,
      )}
      {row(
        <>
          <Select
            label="Export as"
            value={p.exportFormat ?? 'pdf'}
            options={(Object.keys(EXPORT_FORMATS) as (keyof typeof EXPORT_FORMATS)[]).map((f) => ({
              value: f,
              label: EXPORT_FORMATS[f].label,
            }))}
            onChange={(v) =>
              set('exportFormat', v === 'pdf' ? undefined : (v as AppPreferences['exportFormat']))
            }
          />
          <Select
            label="Resolution (dpi)"
            value={p.exportDpi ?? 300}
            options={[150, 300, 600, 1200].map((d) => ({ value: d, label: String(d) }))}
            onChange={(v) => set('exportDpi', v === 300 ? undefined : v)}
          />
        </>,
      )}
      <h3 className="pref-heading">Importing data</h3>
      <Field label="Missing-value codes">
        {(id) => (
          <>
            <input
              id={id}
              type="text"
              placeholder="e.g. -999, ND, not done"
              defaultValue={(p.missingCodes ?? []).join(', ')}
              onChange={(e) => {
                const codes = parseMissingCodes(e.target.value)
                set('missingCodes', codes.length ? codes : undefined)
              }}
            />
            <p className="muted">
              Imported as empty cells, besides NA, N/A, NaN and “.”; the import dialog starts with
              these and can change them.
            </p>
          </>
        )}
      </Field>
      {platform.updates && (
        <UpdateSettings
          auto={p.checkUpdates !== false}
          onAuto={(on) => set('checkUpdates', on ? undefined : false)}
        />
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}

/** Preferences › Updates (desktop app, roadmap 41): automatic checks and "Check now". */
function UpdateSettings({ auto, onAuto }: { auto: boolean; onAuto: (on: boolean) => void }) {
  const { platform } = useServices()
  const updates = platform.updates
  const [supported, setSupported] = useState<boolean | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let live = true
    updates?.supported().then(
      (s) => live && setSupported(s),
      () => live && setSupported(false),
    )
    return () => {
      live = false
    }
  }, [updates])
  if (!updates) return null
  const checkNow = async () => {
    setChecking(true)
    setStatus('Checking…')
    const check = await checkForUpdate(updates, await loadPreferences(platform.settings), true)
    setChecking(false)
    setStatus(checkMessage(check, APP_VERSION))
    if (check.kind === 'available' || check.kind === 'skipped') offerUpdate(check.update)
  }
  return (
    <>
      <h3 className="pref-heading">Updates</h3>
      {supported === false ? (
        <p className="muted" data-testid="updates-not-set-up">
          {UPDATES_NOT_SET_UP}
        </p>
      ) : (
        <>
          <Checkbox
            label="Check for updates automatically (at most once a day)"
            checked={auto}
            onChange={onAuto}
          />
          <div className="field-row">
            <button type="button" onClick={() => void checkNow()} disabled={checking || !supported}>
              Check now
            </button>
            {status && (
              <span className="muted" role="status">
                {status}
              </span>
            )}
          </div>
        </>
      )}
      <p className="muted">This is version {APP_VERSION}.</p>
    </>
  )
}
