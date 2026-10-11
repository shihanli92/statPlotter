import { EQUATIONS } from '@ps/analyses'
import { defaultFunctionParams, functionModel } from '@ps/graph'
import { type FunctionDef, labelRuns, toLabel } from '@ps/model'
import { Checkbox, Field, NumberInput, Section, Select } from '../../components/fields.tsx'
import { RichTextField } from '../../components/formatFields.tsx'
import { effectiveText, type PanelContext } from './context.ts'
import { layerPath } from './layers.ts'

/** Built-in equations for the equation list, by category, then a user-defined one. */
const EQUATION_OPTIONS = [
  ...EQUATIONS.map((e) => ({ value: e.id, label: `${e.category}: ${e.name}` })),
  { value: 'user', label: 'User-defined equation…' },
]

/** The function without its own X range (it then spans the X axis). */
function withoutRange(fc: FunctionDef): FunctionDef {
  const { from: _from, to: _to, ...rest } = fc
  return rest
}

/** A user equation to start from (Y = …, one statement per line). */
const USER_TEMPLATE = 'Y = Bottom + (Top - Bottom)*exp(-K*X)'

/** A function of the graph: its layer and definition. */
function functionOf(graph: PanelContext['graph'], id: string) {
  for (const l of graph.layers)
    if (l.data?.from === 'functions') {
      const fc = l.data.functions.find((f) => f.id === id)
      if (fc) return { layer: l, fc }
    }
  return null
}

/**
 * A function plotted on the graph ("Plot a function"): the equation (built-in or typed
 * in), its parameter values, the X range, and its name in the legend. Its colour and line are
 * those of any series (the identity, the functions layer's fields). The preview follows every
 * change.
 */
export function FunctionPanel({ ctx, id }: { ctx: PanelContext; id: string }) {
  const { graph, theme, palette } = ctx
  const found = functionOf(graph, id)
  if (!found) return <p className="muted">This function is no longer on the graph.</p>
  const { layer, fc } = found
  const path = layerPath(layer.id, 'data', 'functions', { id })
  const replace = (next: FunctionDef, label: string) => ctx.set(path, next, label)
  const set = (field: keyof FunctionDef, v: unknown, label = 'Format function') =>
    ctx.set([...path, field], v, label)
  const model = functionModel(fc)
  const setEquation = (equation: string) => {
    const next: FunctionDef = {
      ...fc,
      equation,
      ...(equation === 'user' ? { userEquation: fc.userEquation ?? USER_TEMPLATE } : {}),
    }
    // Keep the values of parameters the new equation shares; start the others at defaults.
    const params = { ...defaultFunctionParams(next), ...fc.params }
    const names =
      'error' in functionModel(next)
        ? []
        : (functionModel(next) as { params: readonly string[] }).params
    replace(
      { ...next, params: Object.fromEntries(names.map((n) => [n, params[n] ?? 1])) },
      'Change equation',
    )
  }
  const spanning = fc.from === undefined || fc.to === undefined
  return (
    <>
      <Section title="Equation">
        <Select
          label="Equation"
          value={fc.equation}
          options={EQUATION_OPTIONS}
          onChange={setEquation}
        />
        {fc.equation === 'user' && (
          <Field label="Equation (Y = …, one statement per line)">
            {(textId) => (
              <textarea
                id={textId}
                className="equation-text"
                rows={4}
                spellCheck={false}
                value={fc.userEquation ?? ''}
                onChange={(e) => {
                  const text = e.target.value
                  const next = { ...fc, userEquation: text }
                  const m = functionModel(next)
                  // New parameters start at 1; values of those still used are kept.
                  const params =
                    'error' in m
                      ? fc.params
                      : Object.fromEntries(m.params.map((n) => [n, fc.params[n] ?? 1]))
                  replace({ ...next, params }, 'Edit equation')
                }}
              />
            )}
          </Field>
        )}
        {'error' in model && <p className="format-error">{model.error}</p>}
      </Section>
      {!('error' in model) && model.params.length > 0 && (
        <Section title="Parameter values">
          <div className="param-grid">
            {model.params.map((name) => (
              <NumberInput
                key={name}
                label={name}
                value={fc.params[name] ?? 0}
                step={0.1}
                onChange={(v) => set('params', { ...fc.params, [name]: v }, 'Parameter value')}
              />
            ))}
          </div>
        </Section>
      )}
      <Section title="X range">
        <Checkbox
          label="Across the whole X axis"
          checked={spanning}
          onChange={(v) =>
            replace(
              v ? withoutRange(fc) : { ...fc, from: fc.from ?? 0, to: fc.to ?? 1 },
              'Function range',
            )
          }
        />
        {!spanning && (
          <div className="field-row">
            <NumberInput label="From X" value={fc.from!} onChange={(v) => set('from', v)} />
            <NumberInput label="To X" value={fc.to!} onChange={(v) => set('to', v)} />
          </div>
        )}
        <NumberInput
          label="Points along the curve"
          value={fc.points ?? 200}
          min={2}
          max={5000}
          step={50}
          onChange={(v) => set('points', Math.round(v))}
        />
      </Section>
      <Section title="Legend">
        <RichTextField
          label="Name in the legend"
          value={labelRuns(fc.title)}
          textStyle={effectiveText(ctx, theme.legend, graph.legend.text)}
          palette={palette}
          placeholder={'error' in model ? '' : model.name}
          onChange={(rt) => set('title', rt ? toLabel(rt) : undefined)}
        />
      </Section>
      <button
        type="button"
        className="danger"
        onClick={() => {
          const rest =
            layer.data?.from === 'functions' ? layer.data.functions.filter((f) => f.id !== id) : []
          ctx.dispatch(
            rest.length
              ? [
                  {
                    type: 'node.set',
                    id: graph.id,
                    path: layerPath(layer.id, 'data', 'functions'),
                    value: rest,
                  },
                  {
                    type: 'node.set',
                    id: graph.id,
                    path: layerPath(layer.id, 'series', id),
                    value: undefined,
                  },
                  {
                    type: 'node.set',
                    id: graph.id,
                    path: ['seriesOverrides', id],
                    value: undefined,
                  },
                ]
              : [
                  { type: 'graph.removeLayer', id: graph.id, layer: layer.id },
                  {
                    type: 'node.set',
                    id: graph.id,
                    path: ['seriesOverrides', id],
                    value: undefined,
                  },
                ],
            'Remove function',
          )
          ctx.onSelect(null)
        }}
      >
        Remove function from graph
      </button>
    </>
  )
}
