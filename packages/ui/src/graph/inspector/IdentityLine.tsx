import type { Command } from '@ps/engine'
import { freshLayerId, lineEquation, newLayerIndex, slopedValues } from '@ps/graph'
import {
  type GraphNode,
  type GraphPathSegment,
  type Layer,
  labelPlain,
  type ResultStat,
  type StrokeStyle,
  type TextStyle,
} from '@ps/model'
import { NumberInput, Section, Select, TextInput } from '../../components/fields.tsx'
import { StrokeFields, TextStyleFields } from '../../components/formatFields.tsx'
import { effectiveText, type PanelContext } from './context.ts'
import { layerPath, setLayerStat } from './layers.ts'

// Roadmap 46b: identity and reference lines y = a·x + b — Insert › Identity line (y = x) adds
// one (typed values: a refline with a slope), and its Format panel edits the slope, the
// intercept, its label and its line.

/** Whether a graph has two continuous axes (where a sloped line is drawn). */
export const hasContinuousAxes = (graph: Pick<GraphNode, 'frame' | 'axes'>): boolean =>
  graph.frame === 'xy' && graph.axes.x.type === 'continuous' && graph.axes.y.type === 'continuous'

const num = (v: number) => ({ ref: { from: 'number' as const, v } })

/**
 * A new identity line y = x (or y = `slope`·x + `intercept`): its label the equation (shown once
 * placed), its legend entry hidden.
 */
export function identityLayer(graph: Pick<GraphNode, 'layers'>, slope = 1, intercept = 0): Layer {
  return {
    id: freshLayerId('identity', graph.layers),
    geom: 'refline',
    stat: {
      kind: 'result',
      fields: { slope: num(slope), intercept: num(intercept) },
      slope: 'slope',
      intercept: 'intercept',
      template: lineEquation(slope, intercept),
    },
    data: { from: 'values' },
    legend: 'hide',
  } as Layer
}

/** The command adding a sloped line where lines go (behind the data's marks). */
export const addIdentityLayer = (graph: GraphNode, layer: Layer): Command => ({
  type: 'graph.addLayer',
  id: graph.id,
  layer,
  at: newLayerIndex(graph.layers, layer),
})

type SlopedLayer = Layer & { stat: ResultStat; data: { from: 'values' } }

/** Whether a layer is a sloped line of typed values (this panel's). */
export const isTypedSloped = (layer: Layer): layer is SlopedLayer =>
  layer.geom === 'refline' &&
  layer.stat.kind === 'result' &&
  layer.stat.slope !== undefined &&
  layer.data?.from === 'values'

/** The Format panel of an identity or reference line: slope, intercept, label, line. */
export function IdentityLinePanel({ ctx, layer }: { ctx: PanelContext; layer: SlopedLayer }) {
  const stat = layer.stat
  const style = (layer.style ?? {}) as { line?: Partial<StrokeStyle>; text?: Partial<TextStyle> }
  const ab = slopedValues(stat) ?? { a: 1, b: 0 }
  const setStat = (patch: Partial<ResultStat>, label: string) =>
    setLayerStat(ctx, layer, patch, label)
  // A new slope or intercept, its own field (each field its own undo step); a label that was the
  // old equation follows it.
  const setValue = (which: 'slope' | 'intercept', v: number, label: string) => {
    const field = stat[which] ?? which
    const set = (path: GraphPathSegment[], value: unknown): Command => ({
      type: 'node.set',
      id: ctx.graph.id,
      path: layerPath(layer.id, 'stat', ...path),
      value,
    })
    const cmds = [set(['fields', field], num(v))]
    if (stat[which] === undefined) cmds.push(set([which], field))
    const [a, b] = which === 'slope' ? [v, ab.b] : [ab.a, v]
    if (labelPlain(stat.template) === lineEquation(ab.a, ab.b))
      cmds.push(set(['template'], lineEquation(a, b)))
    ctx.dispatch(cmds, label)
  }
  const shown = stat.lineLabel !== undefined
  return (
    <>
      <Section title="Line">
        <div className="field-row">
          <NumberInput
            label="Slope"
            value={ab.a}
            onChange={(a) => setValue('slope', a, 'Line slope')}
          />
          <NumberInput
            label="Intercept"
            value={ab.b}
            onChange={(b) => setValue('intercept', b, 'Line intercept')}
          />
        </div>
        <p className="muted">{lineEquation(ab.a, ab.b)}</p>
        <StrokeFields
          label="Line"
          value={{ ...ctx.theme.refline, ...style.line } as StrokeStyle}
          palette={ctx.palette}
          onChange={(v) => ctx.set(layerPath(layer.id, 'style', 'line'), v, 'Format line')}
        />
      </Section>
      <Section title="Label">
        <TextInput
          label="Text"
          value={labelPlain(stat.template)}
          onChange={(t) =>
            setStat(
              {
                template: t.trim() ? t : undefined,
                lineLabel: t.trim() ? stat.lineLabel : undefined,
              },
              'Line label',
            )
          }
        />
        <Select
          label="Where"
          value={stat.lineLabel ?? 'none'}
          options={[
            { value: 'none', label: 'Not shown' },
            { value: 'start', label: 'At its start' },
            { value: 'end', label: 'At its end' },
          ]}
          onChange={(v) =>
            setStat(
              v === 'none'
                ? { lineLabel: undefined }
                : {
                    lineLabel: v,
                    // Shown without text: the equation ("y = x").
                    ...(stat.template ? {} : { template: lineEquation(ab.a, ab.b) }),
                  },
              'Line label place',
            )
          }
        />
        {shown && (
          <TextStyleFields
            value={style.text}
            inherited={effectiveText(ctx, ctx.theme.pointLabel)}
            palette={ctx.palette}
            onChange={(t) => ctx.set(layerPath(layer.id, 'style', 'text'), t, 'Label text style')}
          />
        )}
      </Section>
    </>
  )
}
