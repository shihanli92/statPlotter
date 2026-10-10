import type { DataTable, GraphNode, Layer, StrokeStyle } from '@ps/model'
import { type AxisCase, withValueAxis } from './axisExtrasCases.ts'
import { graphOf } from './graphs.ts'
import { fixedTable } from './helpers.ts'

// Roadmap 46b: identity and reference lines y = a·x + b (a refline of typed values with a slope),
// for the graph tests and their goldens.

/** A sloped reference line of typed values: y = a·x + b (an identity line by default). */
export function slopedLayer(
  id = 'identity',
  a = 1,
  b = 0,
  extra: {
    template?: string
    lineLabel?: 'start' | 'end'
    line?: Partial<StrokeStyle>
    legend?: 'auto' | 'hide'
  } = {},
): Layer {
  return {
    id,
    geom: 'refline',
    stat: {
      kind: 'result',
      fields: {
        slope: { ref: { from: 'number', v: a } },
        intercept: { ref: { from: 'number', v: b } },
      },
      slope: 'slope',
      intercept: 'intercept',
      ...(extra.template ? { template: extra.template } : {}),
      ...(extra.lineLabel ? { lineLabel: extra.lineLabel } : {}),
    },
    data: { from: 'values' },
    legend: extra.legend ?? 'hide',
    ...(extra.line ? { style: { line: extra.line } } : {}),
  } as Layer
}

/** Paired measurements between −1 and 1 (two methods, one per axis). */
export function pairedTable(): DataTable {
  return fixedTable(
    'xy',
    { type: 'replicates', count: 1 },
    [[[-0.8, -0.55, 0.05, 0.2, 0.7, 0.95]]],
    { titles: ['Method B'], x: [-0.9, -0.5, -0.1, 0.3, 0.6, 0.85] },
  )
}

/** Measurements by two methods from 0 to 10, B reading high at low values. */
export function methodsTable(): DataTable {
  return fixedTable(
    'xy',
    { type: 'replicates', count: 1 },
    [[[1.9, 3.2, 4.1, 5.6, 6.4, 7.9, 9.6]]],
    { titles: ['Method B'], x: [0.5, 2, 3, 5, 6, 8, 10] },
  )
}

/** A scatter of a table with both axes from `min` to `max`, its points in front of `lines`. */
export function scatterWith(
  table: DataTable,
  lines: readonly Layer[],
  min: number,
  max: number,
): GraphNode {
  const range = { min, max }
  const g = withValueAxis(withValueAxis(graphOf(table, 'meanSd'), 'x', { range }), 'y', { range })
  return { ...g, layers: [...lines, ...g.layers] }
}

/** The goldens of roadmap 46b. */
export function identityLineCases(): AxisCase[] {
  const paired = pairedTable()
  const methods = methodsTable()
  const offset: GraphNode = {
    ...scatterWith(
      methods,
      [
        slopedLayer('identity', 1, 0, { legend: 'auto', template: 'y = x' }),
        slopedLayer('fit', 0.8, 1.5, {
          template: 'y = 0.8x + 1.5',
          lineLabel: 'end',
          line: { color: { rgb: '#1f77b4' }, dash: 'solid', width: 1.5 },
          legend: 'auto',
        }),
      ],
      0,
      10,
    ),
  }
  offset.legend = { ...offset.legend, show: true }
  return [
    ['identity-line-scatter', paired, scatterWith(paired, [slopedLayer()], -1, 1)],
    ['identity-line-slope-offset', methods, offset],
  ]
}
