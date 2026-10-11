import { type FontRegistry, newFunctionCurve, presetGraph } from '@ps/graph'
import { type ContinuousAxisSpec, newAnnotationId, newSeriesId, type Project } from '@ps/model'
import {
  addLayer,
  axis,
  columnTable,
  draws,
  ExampleBuilder,
  flatTable,
  groupedTable,
  layerStyle,
  rng,
  round,
  stroke,
  title,
  withLayer,
  xyTable,
} from './builder.ts'

/**
 * Formatting and figure layout: a right Y axis, drawing order, single-bar formats, annotations
 * behind the data, custom colours and fonts, and a multi-panel figure with panel labels and a
 * title; a bubble plot and functions plotted on graphs (with data, and on their own). All data are
 * simulated (fixed seed).
 */
export function createFormattingExample(fonts: FontRegistry): Project {
  const b = new ExampleBuilder('Formatting and figure layout', fonts)
  const r = rng(606)

  // A right Y axis: two measures with different units on one time axis.
  const hours = Array.from({ length: 13 }, (_, i) => i * 4)
  const fever = (h: number) => 37 + 1.8 * Math.exp(-((h - 16) ** 2) / 150)
  const vitals = b.table(
    xyTable(
      'Temperature and heart rate',
      'Time (h)',
      hours,
      {
        Temperature: hours.map((h) => [round(fever(h) + r.normal(0, 0.12), 2)]),
        'Heart rate': hours.map((h) => [Math.round(70 + 28 * (fever(h) - 37) + r.normal(0, 4))]),
      },
      'Body temperature (left axis) and heart rate (right axis) during a fever, every 4 hours. Simulated data. Heart rate is moved to a right Y axis with its own range and title (Format graph › data set › “Plot on the right Y axis”).',
    ),
  )
  const hr = b.key(vitals, 'Heart rate')
  const temp = b.key(vitals, 'Temperature')
  const right: ContinuousAxisSpec = {
    type: 'continuous',
    scale: 'linear',
    range: { min: 50, max: 130 },
    ticks: { interval: 20, minor: 0 },
    format: { mode: 'auto' },
    frame: 'plain',
    breaks: [],
    title: title('Heart rate (bpm)', { color: { rgb: '#d55e00' } }),
    tickLabels: { color: { rgb: '#d55e00' } },
    line: { color: { rgb: '#d55e00' } },
  }
  const vitalsGraph = b.graph(vitals, {
    title: 'Two Y axes',
    yTitle: 'Temperature (°C)',
    size: { plotWidth: 220, plotHeight: 160 },
    edit: (g) => ({
      ...g,
      axes: {
        ...g.axes,
        y: {
          ...axis(g.axes.y, {
            range: { min: 36.5, max: 39.5 },
            ticks: { interval: 0.5, minor: 0 },
          }),
          tickLabels: { color: { rgb: '#0072b2' } },
          line: { color: { rgb: '#0072b2' } },
          ...(g.axes.y.title
            ? { title: { ...g.axes.y.title, style: { color: { rgb: '#0072b2' } } } }
            : {}),
        },
        y2: right,
      },
      seriesOverrides: {
        [temp]: { color: { rgb: '#0072b2' } },
        [hr]: { color: { rgb: '#d55e00' }, yAxis: 'right' },
      },
      // Each data set's means joined (heart rate dashed), its symbols open squares.
      layers: [
        {
          id: 'line',
          geom: 'line',
          stat: { kind: 'summary', center: 'mean' },
          series: { [hr]: { style: { stroke: { ...stroke('#d55e00'), dash: 'dash' } } } },
        },
        ...withLayer(g, 'points', (l) => ({
          ...l,
          series: {
            [hr]: {
              style: {
                shape: 'square',
                fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 },
              },
            },
          },
        })).layers,
      ],
      legend: { ...g.legend, position: 'top' },
    }),
  })

  // Drawing order: thick grey error bars and mean line behind large points.
  const order = b.table(
    columnTable(
      'Drawing order',
      {
        Sham: draws(8, () => r.normal(31, 4)),
        Injury: draws(8, () => r.normal(44, 6)),
        'Injury + drug': draws(8, () => r.normal(36, 5)),
      },
      'Grip strength (N) of 8 mice per group. Simulated data. The graph puts the error bars and the mean line behind the points (Format graph › Appearance › drawing order), with large points with a white border and heavy grey error bars.',
    ),
  )
  const orderGraph = b.graph(order, {
    preset: 'points',
    title: 'Error bars behind points',
    yTitle: 'Grip strength (N)',
    size: { plotWidth: 210 },
    // Error bars, then the mean line, behind the points.
    edit: (g) => {
      const styled = layerStyle(
        layerStyle(layerStyle(g, 'points', { size: 9, border: stroke('#ffffff', 1) }), 'center', {
          width: 0.55,
          line: stroke('#9a9a9a', 3),
        }),
        'error',
        { capWidth: 14, line: stroke('#9a9a9a', 3) },
      )
      const by = (id: string) => styled.layers.find((l) => l.id === id)!
      return { ...styled, layers: [by('error'), by('center'), by('points')] }
    },
  })

  // Single-bar formats: one bar of a grouped graph singled out; black and white bars.
  const grouped = b.table(
    groupedTable(
      'Single bar formats',
      ['Day 1', 'Day 3', 'Day 7'],
      {
        Vehicle: [18, 20, 21].map((m) => draws(5, () => r.normal(m, 2.5))),
        Drug: [19, 27, 38].map((m) => draws(5, () => r.normal(m, 3))),
      },
      'Wound closure (%) on three days, 5 mice per cell. Simulated data. White and black bars, with the Day 7 drug bar singled out in its own colour (click a data set, then one of its bars, to format that bar alone).',
    ),
  )
  const drug = b.key(grouped, 'Drug')
  const vehicle = b.key(grouped, 'Vehicle')
  const barGraph = b.graph(grouped, {
    preset: 'barsPoints',
    title: 'One bar highlighted',
    yTitle: 'Wound closure (%)',
    size: { plotWidth: 200 },
    edit: (g) => ({
      ...withLayer(
        withLayer(g, 'bars', (l) => ({
          ...l,
          series: {
            [vehicle]: {
              style: { fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 } },
            },
            [drug]: { style: { fill: { type: 'solid', color: { rgb: '#404040' }, opacity: 1 } } },
          },
        })),
        'points',
        (l) => ({
          ...l,
          series: Object.fromEntries(
            [vehicle, drug].map((k) => [
              k,
              { style: { fill: { type: 'solid', color: { rgb: '#ffffff' }, opacity: 1 } } },
            ]),
          ),
        }),
      ),
      seriesOverrides: {
        [vehicle]: { color: { rgb: '#000000' } },
        [drug]: { color: { rgb: '#000000' } },
      },
      pointOverrides: {
        [drug]: {
          r2: {
            bar: {
              fill: { type: 'solid', color: { rgb: '#cc3311' }, opacity: 1 },
              border: stroke('#000000'),
            },
          },
        },
      },
      legend: { ...g.legend, position: 'inside', inside: { x: 0.03, y: 0.02 } },
    }),
  })
  const twoWay = b.analyze(
    grouped,
    'twoWayAnova',
    { comparisons: 'withinRows' },
    { name: 'Two-way ANOVA' },
  )
  b.brackets(barGraph, twoWay, { show: 'stars' })

  // Annotations behind the data, a serif font, a custom palette, a boxed frame and grid lines.
  const lod = 5
  const viral = b.table(
    xyTable(
      'Viral load',
      'Days after infection',
      [0, 2, 4, 6, 8, 10, 12, 14],
      {
        Untreated: [0, 2, 4, 6, 8, 10, 12, 14].map((d) =>
          draws(
            4,
            () => Math.max(lod, 3 + 5.5 * Math.exp(-((d - 6) ** 2) / 12) + r.normal(0, 0.35)),
            2,
          ),
        ),
        Treated: [0, 2, 4, 6, 8, 10, 12, 14].map((d) =>
          draws(
            4,
            () => Math.max(lod, 3 + 3.2 * Math.exp(-((d - 4) ** 2) / 6) + r.normal(0, 0.35)),
            2,
          ),
        ),
      },
      'log10 viral copies per mL, 4 animals per time point. Simulated; values below the limit of detection (5) are entered at the limit. The dashed limit line and its label are annotations drawn behind the data; the graph uses a serif font, its own colour palette, a boxed frame and grid lines.',
    ),
  )
  const annotationLine = {
    type: 'line' as const,
    id: newAnnotationId(),
    space: 'data' as const,
    from: { x: -0.5, y: lod },
    to: { x: 14.5, y: lod },
    stroke: { color: { rgb: '#888888' }, width: 1.25, dash: 'dash' as const },
    arrow: 'none' as const,
    behind: true,
  }
  const viralGraph = b.graph(viral, {
    preset: 'meanSem',
    title: 'Serif font, custom palette',
    yTitle: 'log_{10} copies/mL',
    size: { plotWidth: 220, plotHeight: 160 },
    edit: (g) => ({
      ...addLayer(
        g,
        {
          id: 'line',
          geom: 'line',
          stat: { kind: 'summary', center: 'mean' },
          style: { stroke: { color: { series: true }, width: 1.5, dash: 'solid' } },
        },
        0,
      ),
      axes: {
        ...g.axes,
        x: {
          ...axis(g.axes.x, { range: { min: -0.5, max: 14.5 }, ticks: { interval: 2, minor: 1 } }),
          grid: { major: stroke('#e6e6e6', 0.75) },
        },
        y: {
          ...axis(g.axes.y, { range: { min: 4, max: 10 }, ticks: { interval: 1, minor: 0 } }),
          grid: { major: stroke('#e6e6e6', 0.75) },
        },
      },
      style: {
        ...g.style,
        text: { font: 'serif' },
        palette: ['#7b3294', '#008837', '#c2a5cf', '#a6dba0'],
        frame: 'box',
      },
      annotations: [
        annotationLine,
        {
          type: 'text',
          id: newAnnotationId(),
          anchor: { space: 'data', x: 8.5, y: lod - 0.45 },
          content: title('Limit of detection', {
            size: 10,
            italic: true,
            color: { rgb: '#666666' },
          }),
          behind: true,
        },
      ],
      legend: { ...g.legend, position: 'inside', inside: { x: 0.62, y: 0.04 } },
    }),
  })

  // A bubble plot: four variables of a cohort in one graph (X, Y, size and colour).
  const n = 30
  const age = draws(n, () => r.normal(58, 9), 0)
  const nodesInvolved = age.map(() => Math.max(0, Math.round(r.exponential(3))))
  const marker = age.map((a) => round(0.5 + 0.03 * (a - 40) + r.normal(0, 0.35), 2))
  const volume = age.map((a, i) =>
    round(Math.max(0.2, 1.5 + 0.04 * (a - 58) + 0.35 * nodesInvolved[i]! + r.normal(0, 0.6)), 2),
  )
  const cohort = b.table(
    flatTable(
      'Tumour cohort',
      'multipleVariables',
      {
        Age: age,
        'Tumour volume (cm³)': volume,
        'Nodes involved': nodesInvolved,
        'Marker (ng/mL)': marker,
      },
      null,
      'Age, tumour volume, number of lymph nodes involved and a serum marker in 30 patients. Simulated data. The bubble plot shows all four variables: X = age, Y = tumour volume, bubble area = nodes involved, colour = marker (Format graph › Graph settings › Bubble plot).',
    ),
  )
  b.add({
    ...presetGraph(cohort, 'bubble', 'Tumour cohort (bubble plot)'),
    title: title('Bubble plot'),
  })

  // Plot a function: the theoretical Michaelis-Menten curve over measured velocities, and a
  // user-defined equation on its own graph.
  const substrate = [0.25, 0.5, 1, 2, 4, 8, 16]
  const mm = (s: number) => (100 * s) / (2 + s)
  const kinetics = b.table(
    xyTable(
      'Enzyme velocity',
      '[Substrate] (mM)',
      substrate,
      {
        Velocity: substrate.map((sv) => [
          round(mm(sv) + r.normal(0, 3), 1),
          round(mm(sv) + r.normal(0, 3), 1),
        ]),
      },
      'Initial velocity at seven substrate concentrations, in duplicate. Simulated data (Vmax = 100, Km = 2 mM). The dashed curve is not a fit: it is the Michaelis-Menten equation plotted at the known Vmax and Km (a function on the graph; double-click it to change the parameters).',
    ),
  )
  b.graph(kinetics, {
    name: 'Enzyme velocity with theory',
    title: 'Data with a function',
    yTitle: 'Velocity (nmol/min)',
    edit: (g) => {
      const { style: _, ...fc } = newFunctionCurve('michaelis-menten', [0, 16])
      return addLayer(
        g,
        {
          id: 'functions',
          geom: 'line',
          stat: { kind: 'identity' },
          data: {
            from: 'functions',
            functions: [
              { ...fc, params: { Vmax: 100, Km: 2 }, title: 'Theory (Vmax 100, Km 2 mM)' },
            ],
          },
          series: {
            [fc.id]: {
              style: { stroke: { color: { rgb: '#555555' }, width: 1.25, dash: 'dash' } },
            },
          },
        },
        0,
      )
    },
  })
  const functionTable = b.table(
    xyTable(
      'Damped oscillation',
      'Time (s)',
      [],
      { Data: [] },
      'No data: the graph plots a user-defined function (“Plot a function”), Y = A·exp(−X/Tau)·cos(2π·X/Period), and its envelope.',
    ),
  )
  b.graph(functionTable, {
    name: 'Damped oscillation (function)',
    title: 'Plot a function',
    yTitle: 'Displacement (mm)',
    edit: (g) => {
      const wave = {
        id: newSeriesId(),
        equation: 'user',
        userEquation: 'Y = A*exp(-X/Tau)*cos(2*pi*X/Period)',
        params: { A: 10, Tau: 4, Period: 1.5 },
        from: 0,
        to: 12,
        points: 400,
        title: 'A·e^(−X/τ)·cos(2πX/P)',
      }
      const envelope = newSeriesId()
      return {
        ...addLayer(
          g,
          {
            id: 'functions',
            geom: 'line',
            stat: { kind: 'identity' },
            data: {
              from: 'functions',
              functions: [
                wave,
                {
                  id: envelope,
                  equation: 'user',
                  userEquation: 'Y = A*exp(-X/Tau)',
                  params: { A: 10, Tau: 4 },
                  from: 0,
                  to: 12,
                  title: 'Envelope',
                },
              ],
            },
            series: {
              [envelope]: {
                style: { stroke: { color: { rgb: '#999999' }, width: 1, dash: 'dot' } },
              },
            },
          },
          0,
        ),
        // The table is empty: only the functions in the legend.
        legend: { ...g.legend, hidden: [b.key(functionTable, 'Data')] },
      }
    },
  })

  // The figure: four panels, (a)–(d), under a title.
  b.layout('Figure (formatting)', [vitalsGraph, orderGraph, barGraph, viralGraph], {
    columns: 2,
    equalize: false,
    labels: '(a)',
    top: 48,
    text: [
      {
        x: 54,
        y: 34,
        content: title('Figure 1. Formatting examples', { size: 16, bold: true }),
      },
      {
        x: 54,
        y: 56,
        content: title(
          '(a) right Y axis; (b) error bars behind points; (c) one bar formatted on its own; (d) annotations behind the data.',
          { size: 10 },
        ),
      },
    ],
  })
  return b.project
}
