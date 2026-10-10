import { INSET_TABLE_SIZE, RESULT_THEME, RISK_TABLE_TITLE } from '@ps/graph'
import {
  type AnalysisResult,
  type Annotation,
  type FieldFormat,
  type GraphNode,
  type Layer,
  labelRuns,
  type PFormat,
  type ResultField,
  type ResultRef,
  type ResultStat,
  type StrokeStyle,
  type TextStyle,
  templateFields,
  toLabel,
} from '@ps/model'
import { useState } from 'react'
import {
  Checkbox,
  NumberInput,
  OptionalNumber,
  Section,
  Select,
  TextInput,
} from '../../components/fields.tsx'
import {
  ColorRefField,
  FillFields,
  RichTextField,
  StrokeFields,
  TextStyleFields,
} from '../../components/formatFields.tsx'
import { effectiveText, type PanelContext } from '../inspector/context.ts'
import { layerPath, setLayerStat } from '../inspector/layers.ts'
import {
  fieldNameOf,
  isSurvivalGraph,
  type PickableValue,
  perDataSetRef,
  type ResultKind,
  resultAnalyses,
  sheetValues,
  templatesFor,
} from './resultActions.ts'

// Results on graphs (roadmap 35): the Format panels of a result layer (its analysis, ready values,
// text with fields and their formats, a picker of any value of the results, placement), of an
// inset results table, and of the number at risk under a survival graph.

type ResultLayer = Layer & { stat: ResultStat; data: { from: 'analysis'; analysis: string } }

const kindOf = (geom: Layer['geom']): ResultKind =>
  geom === 'refline' ? 'line' : geom === 'band' ? 'band' : 'label'

const P_FORMATS: { value: PFormat; label: string }[] = [
  { value: 'below', label: 'Exact, “< 0.0001” below a threshold' },
  { value: 'exact', label: 'Exact' },
  { value: 'scientific', label: 'Scientific (1.2 × 10⁻⁵)' },
  { value: 'stars', label: 'Stars (ns, *, **…)' },
  { value: 'project', label: 'The project’s P value style' },
]

/** Where a reference points, in words. */
function describeRef(ref: ResultRef, result: AnalysisResult | undefined): string {
  switch (ref.from) {
    case 'value':
      return `Value “${ref.key}”`
    case 'comparison':
      return `Comparison “${ref.key}” (${ref.what === 'estimate' ? 'estimate' : 'P'})`
    case 'cell': {
      const sheet = result?.sheets.find((s) => s.key === ref.sheet)?.title ?? ref.sheet
      const end = ref.end === 'lo' ? ' (lower end)' : ref.end === 'hi' ? ' (upper end)' : ''
      return [sheet, ref.block, ref.row || '(row)', ref.column].filter(Boolean).join(' › ') + end
    }
    case 'number':
      return `The number ${ref.v}`
    case 'cutoff':
      return ref.which === 'fold' ? 'The fold change cut-off' : 'The significance cut-off'
  }
}

/** A value picked from an analysis' results: every cell of every sheet as a button. */
function ValuePicker({
  result,
  ctx,
  onPick,
}: {
  result: AnalysisResult | undefined
  ctx: Pick<PanelContext, 'project'>
  onPick: (v: PickableValue) => void
}) {
  if (!result) return <p className="muted">The analysis hasn’t computed yet.</p>
  const sheets = sheetValues(result, ctx.project.settings)
  return (
    <fieldset className="value-picker">
      <legend>Values of the results</legend>
      {sheets.map((sh) => (
        <div key={sh.sheet}>
          <h4>{sh.title}</h4>
          {sh.blocks.map((b) => (
            <div
              key={`${sh.sheet}/${b.rows[0]?.[0]?.where ?? b.title}`}
              className="value-picker-block"
            >
              {b.title && <div className="muted">{b.title}</div>}
              {b.rows.map((row) => (
                <div key={row[0]?.where ?? ''} className="value-picker-row">
                  {row.map((v) => (
                    <button
                      key={v.where}
                      type="button"
                      className="value-picker-cell"
                      aria-label={`${v.where}: ${v.shown}`}
                      title={v.where}
                      onClick={() => onPick(v)}
                    >
                      {v.shown || '—'}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </fieldset>
  )
}

/** A field's number format: digits or decimals, P values' style, a unit. */
function FormatFields({
  format,
  onChange,
}: {
  format: FieldFormat | undefined
  onChange: (f: FieldFormat | undefined) => void
}) {
  const f = format ?? {}
  const set = (patch: Partial<FieldFormat>) => {
    const next: Record<string, unknown> = { ...f, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    onChange(Object.keys(next).length ? (next as FieldFormat) : undefined)
  }
  return (
    <div className="field-row">
      <div className="field">
        <span>Significant digits</span>
        <OptionalNumber
          label="Significant digits"
          value={f.digits}
          placeholder="3"
          onChange={(digits) =>
            set({
              digits:
                digits === undefined ? undefined : Math.max(1, Math.min(15, Math.round(digits))),
            })
          }
        />
      </div>
      <div className="field">
        <span>Decimals</span>
        <OptionalNumber
          label="Decimals"
          value={f.decimals}
          placeholder="—"
          onChange={(decimals) =>
            set({
              decimals:
                decimals === undefined
                  ? undefined
                  : Math.max(0, Math.min(15, Math.round(decimals))),
            })
          }
        />
      </div>
      <Select
        label="P values"
        value={f.p ?? 'below'}
        options={P_FORMATS}
        onChange={(p) => set({ p: p === 'below' ? undefined : p })}
      />
      {(f.p ?? 'below') === 'below' && (
        <div className="field">
          <span>Below</span>
          <OptionalNumber
            label="P threshold"
            value={f.below}
            placeholder="0.0001"
            onChange={(below) =>
              set({ below: below !== undefined && below > 0 && below < 1 ? below : undefined })
            }
          />
        </div>
      )}
      <TextInput
        label="Unit"
        value={f.unit ?? ''}
        placeholder="none"
        onChange={(u) => set({ unit: u.trim() ? u.trim().slice(0, 40) : undefined })}
      />
      <Select
        label="Unit from"
        value={f.axisUnit ?? 'none'}
        options={[
          { value: 'none', label: 'None' },
          { value: 'x', label: 'The X axis title' },
          { value: 'y', label: 'The Y axis title' },
        ]}
        onChange={(a) => set({ axisUnit: a === 'none' ? undefined : a })}
      />
    </div>
  )
}

/**
 * Format graph › Appearance for a layer of an analysis' results: its analysis, ready values, and
 * the label's text (fields in braces) or the line's and band's values, with any value of the
 * results picked by hand; where it sits and how it looks.
 */
export function ResultLayerPanel({ ctx, layer }: { ctx: PanelContext; layer: ResultLayer }) {
  const { graph, project } = ctx
  const stat = layer.stat
  const kind = kindOf(layer.geom)
  const analyses = resultAnalyses(project, graph)
  const analysis = analyses.find((a) => a.id === layer.data.analysis)
  const result = ctx.lookup(layer.data.analysis as never)
  const templates = analysis ? templatesFor(project, analysis, graph, kind) : []
  const [picking, setPicking] = useState<string | null>(null)
  const setStat = (patch: Partial<ResultStat>, label: string) =>
    setLayerStat(ctx, layer, patch, label)
  const setStyle = (name: string, v: unknown, label: string) =>
    ctx.set(layerPath(layer.id, 'style', name), v, label)
  const style = (layer.style ?? {}) as Record<string, unknown>
  const titles = graph.seriesSource
    ? ((
        project.nodes[graph.seriesSource.table] as { dataSets?: { title: string }[] } | undefined
      )?.dataSets?.map((d) => d.title) ?? [])
    : []

  /** A picked value as a new field (per data set: its title in the reference a placeholder). */
  const addField = (v: PickableValue, use: 'template' | 'at' | 'lo' | 'hi') => {
    const ref = stat.per === 'dataSet' ? perDataSetRef(v.ref, titles) : v.ref
    const label = v.ref.from === 'cell' ? v.ref.row || v.ref.column || 'value' : 'value'
    const name = fieldNameOf(label, Object.keys(stat.fields))
    const fields = { ...stat.fields, [name]: { ref } as ResultField }
    if (use === 'template') {
      const runs = labelRuns(stat.template)
      setStat(
        { fields, template: toLabel([...runs, { text: `${runs.length ? ' ' : ''}{${name}}` }]) },
        'Add a value',
      )
    } else setStat({ fields, [use]: name }, 'Choose a value')
    setPicking(null)
  }
  const used = new Set([
    ...templateFields(stat.template),
    stat.at,
    stat.lo,
    stat.hi,
    stat.slope,
    stat.intercept,
  ])
  const fieldNames = Object.keys(stat.fields)

  return (
    <>
      <Section title="Values from an analysis">
        <Select
          label="Analysis"
          value={layer.data.analysis}
          options={[
            ...analyses.map((a) => ({ value: a.id as string, label: a.name })),
            ...(analysis ? [] : [{ value: layer.data.analysis, label: '(missing analysis)' }]),
          ]}
          onChange={(id) => ctx.set(layerPath(layer.id, 'data', 'analysis'), id, 'Change analysis')}
        />
        {templates.length > 0 && (
          <Select
            label={kind === 'label' ? 'Ready label' : kind === 'line' ? 'Ready line' : 'Ready band'}
            value=""
            options={[
              { value: '', label: 'Choose one to use…' },
              ...templates.map((t) => ({ value: t.id, label: t.title })),
            ]}
            onChange={(id) => {
              const t = templates.find((x) => x.id === id)
              if (!t) return
              const { place: _, ...rest } = t.stat
              setStat(
                {
                  fields: rest.fields,
                  template: rest.template,
                  at: rest.at,
                  lo: rest.lo,
                  hi: rest.hi,
                  axis: rest.axis,
                  drop: rest.drop,
                  per: rest.per,
                },
                'Use a ready label',
              )
            }}
          />
        )}
        <Checkbox
          label="One for each data set (in its colour)"
          checked={stat.per === 'dataSet'}
          onChange={(v) => setStat({ per: v ? 'dataSet' : undefined }, 'Each data set')}
        />
      </Section>

      {kind === 'label' && (
        <Section title="Text">
          <RichTextField
            label="Label (values in braces: {r})"
            value={labelRuns(stat.template)}
            textStyle={effectiveText(ctx, ctx.theme.pointLabel, style.text as Partial<TextStyle>)}
            palette={ctx.palette}
            onChange={(rt) => setStat({ template: rt ? toLabel(rt) : '' }, 'Label text')}
          />
          <button
            type="button"
            onClick={() => setPicking(picking === 'template' ? null : 'template')}
          >
            Insert a value of the results…
          </button>
          {picking === 'template' && (
            <ValuePicker result={result} ctx={ctx} onPick={(v) => addField(v, 'template')} />
          )}
        </Section>
      )}
      {kind === 'line' && (
        <Section title="Line">
          <Select
            label="At the value"
            value={stat.at ?? ''}
            options={[
              { value: '', label: '(none)' },
              ...fieldNames.map((n) => ({ value: n, label: `{${n}}` })),
            ]}
            onChange={(at) => setStat({ at: at || undefined }, 'Line value')}
          />
          <button type="button" onClick={() => setPicking(picking === 'at' ? null : 'at')}>
            Pick the value from the results…
          </button>
          {picking === 'at' && (
            <ValuePicker result={result} ctx={ctx} onPick={(v) => addField(v, 'at')} />
          )}
          <Select
            label="Drawn"
            value={stat.drop ? `drop-${stat.drop}` : (stat.axis ?? 'y')}
            options={[
              { value: 'y', label: 'Across the plot at a Y value' },
              { value: 'x', label: 'Up the plot at an X value' },
              { value: 'drop-both', label: 'Drop lines from the curve to both axes' },
              { value: 'drop-x', label: 'Drop line from the curve to the X axis' },
              { value: 'drop-y', label: 'Drop line from the curve to the Y axis' },
            ]}
            onChange={(v) =>
              v.startsWith('drop-')
                ? setStat({ axis: 'x', drop: v.slice(5) as 'x' | 'y' | 'both' }, 'Drop lines')
                : setStat({ axis: v === 'x' ? 'x' : undefined, drop: undefined }, 'Line across')
            }
          />
          <StrokeFields
            label="Line"
            value={{ ...RESULT_THEME.line, ...(style.line as Partial<StrokeStyle>) } as StrokeStyle}
            palette={ctx.palette}
            allowSeries
            onChange={(v) => setStyle('line', v, 'Format line')}
          />
        </Section>
      )}
      {kind === 'band' && (
        <Section title="Band">
          {(['lo', 'hi'] as const).map((end) => (
            <div key={end}>
              <Select
                label={end === 'lo' ? 'From the value' : 'To the value'}
                value={stat[end] ?? ''}
                options={[
                  { value: '', label: '(none)' },
                  ...fieldNames.map((n) => ({ value: n, label: `{${n}}` })),
                ]}
                onChange={(v) => setStat({ [end]: v || undefined }, 'Band values')}
              />
              <button type="button" onClick={() => setPicking(picking === end ? null : end)}>
                Pick {end === 'lo' ? 'the lower' : 'the upper'} value…
              </button>
              {picking === end && (
                <ValuePicker result={result} ctx={ctx} onPick={(v) => addField(v, end)} />
              )}
            </div>
          ))}
          <Select
            label="Drawn"
            value={stat.axis ?? 'y'}
            options={[
              { value: 'y', label: 'Across the plot between Y values' },
              { value: 'x', label: 'Up the plot between X values' },
            ]}
            onChange={(v) => setStat({ axis: v === 'x' ? 'x' : undefined }, 'Band direction')}
          />
          <ColorRefField
            label="Colour"
            value={style.color as never}
            palette={ctx.palette}
            fallback={RESULT_THEME.grey}
            allowSeries
            onChange={(c) => setStyle('color', 'series' in c ? undefined : c, 'Band colour')}
          />
          <NumberInput
            label="Opacity"
            value={(style.opacity as number | undefined) ?? RESULT_THEME.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(o) => setStyle('opacity', o, 'Band opacity')}
          />
        </Section>
      )}

      {fieldNames.length > 0 && (
        <Section title="Values and their formats">
          {fieldNames.map((name) => {
            const field = stat.fields[name]!
            return (
              <fieldset key={name} className="field result-field">
                <legend>
                  {`{${name}}`} <span className="muted">{describeRef(field.ref, result)}</span>
                </legend>
                <FormatFields
                  format={field.format}
                  onChange={(format) =>
                    setStat(
                      {
                        fields: {
                          ...stat.fields,
                          [name]: format ? { ...field, format } : { ref: field.ref },
                        },
                      },
                      'Value format',
                    )
                  }
                />
                {!used.has(name) && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      const { [name]: _, ...rest } = stat.fields
                      setStat({ fields: rest }, 'Remove a value')
                    }}
                  >
                    Remove {`{${name}}`}
                  </button>
                )}
              </fieldset>
            )
          })}
        </Section>
      )}

      {kind === 'label' && (
        <Section title="Place and look">
          <Select
            label="Where"
            value={
              stat.place?.at === 'corner'
                ? stat.place.corner
                : stat.place?.at === 'data'
                  ? 'data'
                  : stat.place?.at === 'curve'
                    ? 'curve'
                    : 'topLeft'
            }
            options={[
              { value: 'topLeft', label: 'Top left of the plot' },
              { value: 'topRight', label: 'Top right of the plot' },
              { value: 'bottomLeft', label: 'Bottom left of the plot' },
              { value: 'bottomRight', label: 'Bottom right of the plot' },
              { value: 'data', label: 'At a data position' },
              { value: 'curve', label: 'Beside the end of its fitted curve' },
            ]}
            onChange={(v) =>
              setStat(
                {
                  place:
                    v === 'data'
                      ? { at: 'data', x: 0, y: 0 }
                      : v === 'curve'
                        ? { at: 'curve' }
                        : { at: 'corner', corner: v as 'topLeft' },
                },
                'Move label',
              )
            }
          />
          {stat.place?.at === 'data' && (
            <div className="field-row">
              <NumberInput
                label={graph.frame === 'xy' ? 'X' : 'Category (0 = first)'}
                value={stat.place.x}
                onChange={(x) =>
                  setStat(
                    { place: { ...(stat.place as { at: 'data'; x: number; y: number }), x } },
                    'Move label',
                  )
                }
              />
              <NumberInput
                label="Y"
                value={stat.place.y}
                onChange={(y) =>
                  setStat(
                    { place: { ...(stat.place as { at: 'data'; x: number; y: number }), y } },
                    'Move label',
                  )
                }
              />
            </div>
          )}
          <Select
            label="Shown"
            value={stat.show ?? 'plot'}
            options={[
              { value: 'plot', label: 'In the plot' },
              { value: 'legend', label: 'Appended to the legend entry' },
              { value: 'both', label: 'Both' },
            ]}
            onChange={(v) => setStat({ show: v === 'plot' ? undefined : v }, 'Label in legend')}
          />
          <Select
            label="Behind the text"
            value={(style.background as string | undefined) ?? 'none'}
            options={[
              { value: 'none', label: 'Nothing' },
              { value: 'halo', label: 'A white halo' },
              { value: 'box', label: 'A box' },
            ]}
            onChange={(v) =>
              setStyle('background', v === 'none' ? undefined : v, 'Label background')
            }
          />
          <TextStyleFields
            value={style.text as Partial<TextStyle> | undefined}
            inherited={effectiveText(ctx, ctx.theme.pointLabel)}
            palette={ctx.palette}
            onChange={(t) => setStyle('text', t, 'Label text style')}
          />
        </Section>
      )}
      {!analysis && (
        <p className="error">The analysis this layer reads is gone: its values show as “—”.</p>
      )}
      {analysis && result && result.status === 'error' && (
        <p className="error">“{analysis.name}” could not be computed.</p>
      )}
      <p className="muted">
        Values follow “{analysis?.name ?? '?'}”: they update when its data change. A value no longer
        in its results shows as “—”.
      </p>
    </>
  )
}

/** Format › an inset table of an analysis' results. */
export function InsetTablePanel({ ctx, index }: { ctx: PanelContext; index: number }) {
  const { graph, project } = ctx
  const a = graph.annotations[index] as Extract<Annotation, { type: 'table' }> | undefined
  if (!a) return null
  const set = (path: (string | number)[], v: unknown, label: string) =>
    ctx.set(['annotations', index, ...path], v, label)
  const analyses = resultAnalyses(project, graph)
  const result = ctx.lookup(a.analysis)
  const sheets = result?.sheets ?? []
  const range = (r: { from: number; to?: number } | undefined) =>
    r ? { from: r.from + 1, to: r.to === undefined ? undefined : r.to + 1 } : undefined
  const setRange = (
    which: 'rows' | 'columns',
    from: number | undefined,
    to: number | undefined,
  ) => {
    const f = from === undefined ? undefined : Math.max(0, Math.round(from) - 1)
    const t = to === undefined ? undefined : Math.max(0, Math.round(to) - 1)
    set(
      [which],
      f === undefined ? undefined : { from: f, ...(t !== undefined ? { to: Math.max(f, t) } : {}) },
      'Table rows and columns',
    )
  }
  const rows = range(a.rows)
  const cols = range(a.columns)
  return (
    <>
      <Section title="Results table">
        <Select
          label="Analysis"
          value={a.analysis as string}
          options={analyses.map((x) => ({ value: x.id as string, label: x.name }))}
          onChange={(id) => set(['analysis'], id, 'Table of results')}
        />
        <Select
          label="Results sheet"
          value={a.sheet}
          options={[
            ...sheets.map((s) => ({ value: s.key, label: s.title })),
            ...(sheets.some((s) => s.key === a.sheet) ? [] : [{ value: a.sheet, label: a.sheet }]),
          ]}
          onChange={(sheet) => set(['sheet'], sheet, 'Table of results')}
        />
        <div className="field-row">
          <div className="field">
            <span>First row</span>
            <OptionalNumber
              label="First row"
              value={rows?.from}
              placeholder="all"
              onChange={(v) => setRange('rows', v, rows?.to)}
            />
          </div>
          <div className="field">
            <span>Last row</span>
            <OptionalNumber
              label="Last row"
              value={rows?.to}
              placeholder="end"
              onChange={(v) => setRange('rows', rows?.from ?? 1, v)}
            />
          </div>
          <div className="field">
            <span>First column</span>
            <OptionalNumber
              label="First column"
              value={cols?.from}
              placeholder="all"
              onChange={(v) => setRange('columns', v, cols?.to)}
            />
          </div>
          <div className="field">
            <span>Last column</span>
            <OptionalNumber
              label="Last column"
              value={cols?.to}
              placeholder="end"
              onChange={(v) => setRange('columns', cols?.from ?? 1, v)}
            />
          </div>
        </div>
      </Section>
      <Section title="Place and look">
        <Select
          label="Where"
          value={a.place ?? 'topRight'}
          options={[
            { value: 'topLeft', label: 'Top left of the plot' },
            { value: 'topRight', label: 'Top right of the plot' },
            { value: 'bottomLeft', label: 'Bottom left of the plot' },
            { value: 'bottomRight', label: 'Bottom right of the plot' },
            { value: 'right', label: 'Right of the plot' },
            { value: 'anchor', label: 'At a position' },
          ]}
          onChange={(place) => {
            set(['place'], place, 'Move table')
            if (place === 'anchor' && !a.anchor)
              set(['anchor'], { space: 'plot', x: 0.05, y: 0.05 }, 'Move table')
          }}
        />
        {a.place === 'anchor' && a.anchor && (
          <div className="field-row">
            <NumberInput
              label="X (0–1 across the plot)"
              value={a.anchor.x}
              step={0.05}
              onChange={(x) => set(['anchor', 'x'], x, 'Move table')}
            />
            <NumberInput
              label="Y (0–1 down the plot)"
              value={a.anchor.y}
              step={0.05}
              onChange={(y) => set(['anchor', 'y'], y, 'Move table')}
            />
          </div>
        )}
        <div className="field">
          <span>Significant digits</span>
          <OptionalNumber
            label="Significant digits"
            value={a.digits}
            placeholder="as in the results"
            onChange={(d) =>
              set(
                ['digits'],
                d === undefined ? undefined : Math.max(1, Math.min(15, Math.round(d))),
                'Table digits',
              )
            }
          />
        </div>
        <Select
          label="Lines"
          value={a.grid ?? 'rows'}
          options={[
            { value: 'rows', label: 'Between rows' },
            { value: 'all', label: 'Between all cells' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(grid) => set(['grid'], grid === 'rows' ? undefined : grid, 'Table lines')}
        />
        <Checkbox
          label="Titles in bold"
          checked={a.headerBold ?? true}
          onChange={(v) => set(['headerBold'], v ? undefined : false, 'Table titles')}
        />
        <TextStyleFields
          value={a.text}
          inherited={{ ...effectiveText(ctx, ctx.theme.text), size: INSET_TABLE_SIZE }}
          palette={ctx.palette}
          onChange={(t) => set(['text'], t, 'Table text')}
        />
        <FillFields
          label="Background"
          value={a.background ?? { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 }}
          palette={ctx.palette}
          onChange={(f) => set(['background'], f, 'Table background')}
        />
      </Section>
      <button
        type="button"
        className="danger"
        onClick={() => {
          ctx.set(
            ['annotations'],
            graph.annotations.filter((_, i) => i !== index),
            'Delete results table',
          )
          ctx.onSelect(null)
        }}
      >
        Delete table
      </button>
    </>
  )
}

/** Format graph › Labels & annotations: the number at risk under a survival graph. */
export function RiskTableSection({ ctx }: { ctx: PanelContext }) {
  const { graph } = ctx
  if (!isSurvivalGraph(graph)) return null
  const r = graph.riskTable
  const set = (patch: Partial<NonNullable<GraphNode['riskTable']>>, label: string) => {
    const next: Record<string, unknown> = { show: false, ...r, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    ctx.set(['riskTable'], next, label)
  }
  const times = r?.times?.join(', ') ?? ''
  return (
    <Section title="Number at risk">
      <Checkbox
        label="Number at risk under the graph"
        checked={!!r?.show}
        onChange={(show) => set({ show }, show ? 'Show number at risk' : 'Hide number at risk')}
      />
      {r?.show && (
        <>
          <TextInput
            label="At times (blank: the X axis’ ticks)"
            value={times}
            placeholder="0, 10, 20"
            onChange={(t) => {
              const list = t
                .split(/[,\s;]+/)
                .filter(Boolean)
                .map(Number)
                .filter((v) => Number.isFinite(v) && v >= 0)
              set({ times: list.length ? list.slice(0, 50) : undefined }, 'Number at risk times')
            }}
          />
          <TextInput
            label="Heading"
            value={r.title ?? RISK_TABLE_TITLE}
            onChange={(title) =>
              set(
                { title: title === RISK_TABLE_TITLE ? undefined : title },
                'Number at risk heading',
              )
            }
          />
          <Checkbox
            label="Groups’ names before their rows"
            checked={r.names !== false}
            onChange={(v) => set({ names: v ? undefined : false }, 'Number at risk names')}
          />
          <TextStyleFields
            value={r.text}
            inherited={effectiveText(ctx, ctx.theme.text)}
            palette={ctx.palette}
            onChange={(t) => set({ text: t }, 'Number at risk text')}
          />
        </>
      )}
    </Section>
  )
}
