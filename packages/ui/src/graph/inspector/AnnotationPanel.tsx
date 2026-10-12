import { resolveBracketStyle } from '@ps/graph'
import { type Annotation, annotationEnds, labelRuns, lineEndsOf, toLabel } from '@ps/model'
import { ArrowheadFields } from '../../components/arrowFields.tsx'
import { NumberInput, Section, Select } from '../../components/fields.tsx'
import {
  FillFields,
  RichTextField,
  StrokeFields,
  TEXT_ALIGNS,
  TextStyleFields,
  THIN_BORDER,
} from '../../components/formatFields.tsx'
import { InsetTablePanel } from '../results/ResultPanels.tsx'
import { bracketTests, oneAnalysisBracketCommands } from '../results/resultActions.ts'
import { effectiveText, type PanelContext } from './context.ts'

type BracketShow = Extract<
  Extract<Annotation, { type: 'bracket' }>['label'],
  { source: 'analysis' }
>['show']

/** How an analysis bracket's label reads. */
export const BRACKET_LABELS: { value: BracketShow; label: string }[] = [
  { value: 'stars', label: 'Asterisks (ns, *, **…)' },
  { value: 'p', label: 'P value (P = 0.017)' },
  { value: 'number', label: 'P value only (0.017)' },
  { value: 'both', label: 'Both' },
]

const SPACE_OPTIONS = [
  { value: 'plot', label: 'Fixed on the plot (fractions 0–1)' },
  { value: 'data', label: 'Tied to data values (moves with the axes)' },
] as const

export function AnnotationPanel({ ctx, index }: { ctx: PanelContext; index: number }) {
  const { graph, theme, palette } = ctx
  const a = graph.annotations[index]
  if (!a) return <p className="muted">This item no longer exists.</p>
  const set = (path: (string | number)[], v: unknown, label?: string) =>
    ctx.set(['annotations', index, ...path], v, label)
  const remove = (label: string) => {
    ctx.set(
      ['annotations'],
      graph.annotations.filter((_, i) => i !== index),
      label,
    )
    ctx.onSelect(null)
  }
  const layer = (
    <Select
      label="Drawn"
      value={a.behind ? 'behind' : 'front'}
      options={[
        { value: 'front', label: 'In front of the data' },
        { value: 'behind', label: 'Behind the data' },
      ]}
      onChange={(v) =>
        set(
          ['behind'],
          v === 'behind' || undefined,
          v === 'behind' ? 'Send to back' : 'Bring to front',
        )
      }
    />
  )
  const coord = (label: string, value: number, path: (string | number)[], what: string) => (
    <NumberInput label={label} value={+value.toPrecision(6)} onChange={(v) => set(path, v, what)} />
  )

  // Roadmap 35: a table of an analysis' results.
  if (a.type === 'table') return <InsetTablePanel ctx={ctx} index={index} />

  if (a.type === 'bracket') {
    // Roadmap 51c (§7.3): brackets each labelled by a test of their own, relabelled from one
    // analysis of all the groups in one step.
    const tests = bracketTests(ctx.project, graph)
    const source = ctx.project.nodes[graph.seriesSource.table]
    const own = graph.annotations.filter(
      (x) =>
        x.type === 'bracket' &&
        x.label.source === 'analysis' &&
        tests.some((t) => t.id === (x.label as { analysis: string }).analysis),
    ).length
    const oneAnalysis =
      source?.kind === 'table' && own >= 2 && a.label.source === 'analysis' && !a.group?.length
        ? () => {
            const r = oneAnalysisBracketCommands(ctx.project, graph, source, {
              show: (a.label as { show: BracketShow }).show,
              ...(a.x !== undefined ? { x: a.x, a: a.a, b: a.b } : {}),
              ...(a.rowA !== undefined ? { row: a.rowA } : {}),
            })
            if ('error' in r) ctx.onError(r.error)
            else ctx.dispatch(r.commands, 'Label brackets from one analysis')
          }
        : null
    return (
      <Section title="Significance bracket">
        {oneAnalysis && (
          <div className="banner warning bracket-uncorrected">
            <span>
              {own} brackets here are each labelled by a test of their own, not corrected for each
              other.
            </span>
            <button type="button" onClick={oneAnalysis}>
              Label these {own} brackets from one{' '}
              {source?.kind === 'table' && source.tableKind === 'column'
                ? 'ANOVA'
                : 'two-way ANOVA'}
            </button>
          </div>
        )}
        {a.label.source === 'analysis' ? (
          <>
            <Select
              label="Label"
              value={a.label.show}
              options={BRACKET_LABELS}
              onChange={(v) => set(['label', 'show'], v, 'Bracket label')}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={!!a.label.test}
                onChange={(e) =>
                  set(['label', 'test'], e.target.checked || undefined, 'Bracket label')
                }
              />
              Name the test after the P value
            </label>
          </>
        ) : (
          <RichTextField
            label="Label"
            value={labelRuns(a.label.text)}
            textStyle={resolveBracketStyle(theme, graph).label}
            palette={palette}
            onChange={(rt) => set(['label', 'text'], rt ? toLabel(rt) : '', 'Bracket label')}
          />
        )}
        {layer}
        <p className="muted">
          Line and label styles shared by all brackets are on the All brackets tab.
        </p>
        <button type="button" className="danger" onClick={() => remove('Delete bracket')}>
          Delete bracket
        </button>
      </Section>
    )
  }

  if (a.type === 'text') {
    return (
      <>
        <Section title="Text">
          <RichTextField
            label="Text"
            value={a.content.content}
            multiline
            textStyle={effectiveText(ctx, theme.text, a.content.style)}
            palette={palette}
            align={a.content.align ?? 'left'}
            onAlign={(v) => set(['content', 'align'], v === 'left' ? undefined : v, 'Align text')}
            onChange={(rt) => set(['content', 'content'], rt ?? [{ text: '' }], 'Edit text')}
          />
          <Select
            label="Lines"
            value={a.content.align ?? 'left'}
            options={TEXT_ALIGNS}
            onChange={(v) => set(['content', 'align'], v === 'left' ? undefined : v, 'Align text')}
          />
          <TextStyleFields
            value={a.content.style}
            inherited={effectiveText(ctx, theme.text)}
            palette={palette}
            onChange={(s) => set(['content', 'style'], s, 'Format text')}
          />
        </Section>
        <Section title="Position">
          <Select
            label="Anchored"
            value={a.anchor.space}
            options={SPACE_OPTIONS}
            onChange={(space) => set(['anchor', 'space'], space, 'Text position')}
          />
          <div className="field-row">
            {coord(
              a.anchor.space === 'plot' ? 'Left (0–1)' : 'X',
              a.anchor.x,
              ['anchor', 'x'],
              'Move text',
            )}
            {coord(
              a.anchor.space === 'plot' ? 'Top (0–1)' : 'Y',
              a.anchor.y,
              ['anchor', 'y'],
              'Move text',
            )}
          </div>
          <p className="muted">Or, after closing this dialog, drag the text on the graph.</p>
          {layer}
        </Section>
        <Section title="Box" collapsed>
          <StrokeFields
            label="Border"
            value={a.border}
            palette={palette}
            optional={{ defaults: THIN_BORDER }}
            onChange={(s) => set(['border'], s, 'Text box')}
          />
          <FillFields
            label="Background"
            value={a.background}
            palette={palette}
            onChange={(f) => set(['background'], f, 'Text box')}
          />
        </Section>
        <button type="button" className="danger" onClick={() => remove('Delete text')}>
          Delete text
        </button>
      </>
    )
  }

  // Line or arrow.
  return (
    <>
      <Section title="Line">
        <ArrowheadFields
          value={lineEndsOf(a)}
          onChange={(ends) => {
            // `arrow` and `heads` in one step (`heads` absent when `arrow` says it all).
            const { heads, ...rest } = a
            const next = { ...rest, ...annotationEnds(ends) }
            if (next.heads === undefined) delete next.heads
            ctx.set(['annotations', index], next, 'Arrowheads')
          }}
        />
        <StrokeFields
          label="Line"
          value={a.stroke}
          palette={palette}
          onChange={(s) => set(['stroke'], s, 'Format line')}
        />
      </Section>
      <Section title="Position">
        <Select
          label="Anchored"
          value={a.space}
          options={SPACE_OPTIONS}
          onChange={(space) => set(['space'], space, 'Line position')}
        />
        <div className="field-row">
          {coord('Start X', a.from.x, ['from', 'x'], 'Move line')}
          {coord('Start Y', a.from.y, ['from', 'y'], 'Move line')}
        </div>
        <div className="field-row">
          {coord('End X', a.to.x, ['to', 'x'], 'Move line')}
          {coord('End Y', a.to.y, ['to', 'y'], 'Move line')}
        </div>
        <p className="muted">
          {a.space === 'plot' ? 'Fractions of the plot area from its top left.' : 'Axis values.'} Or
          drag the line on the graph (outside this dialog).
        </p>
        {layer}
      </Section>
      <button
        type="button"
        className="danger"
        onClick={() => remove(a.arrow === 'none' ? 'Delete line' : 'Delete arrow')}
      >
        Delete {a.arrow === 'none' ? 'line' : 'arrow'}
      </button>
    </>
  )
}
