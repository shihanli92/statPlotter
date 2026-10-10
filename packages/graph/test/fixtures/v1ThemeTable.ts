import type { ColorRef, GraphType, StrokeStyle } from '@ps/model'
import type { ResolvedSeriesStyle } from '../../src/index.ts'

// Roadmap 37 (decision 536): a frozen copy of the per-graph-type theme table as roadmaps 7–36
// wrote it by hand (`theme.series[look]` and `curve`, graph/src/theme.ts at v0.1.24). The
// theme's per-geom defaults under its context rules must reproduce it exactly. Never edit.

const SERIES: ColorRef = { series: true }
const BLACK: ColorRef = { rgb: '#000000' }
const WHITE: ColorRef = { rgb: '#ffffff' }

const line = (width: number, color: ColorRef = BLACK): StrokeStyle => ({
  color,
  width,
  dash: 'solid',
})

const base: ResolvedSeriesStyle = {
  color: SERIES,
  points: {
    show: true,
    shape: 'circle',
    size: 6,
    fill: { type: 'solid', color: SERIES, opacity: 1 },
    border: line(0.75, SERIES),
    jitter: 'auto',
    excludedStyle: 'hide',
    replicates: 'mean',
  },
  bar: {
    fill: { type: 'solid', color: SERIES, opacity: 0.35 },
    border: line(1, SERIES),
    width: 0.6,
    show: false,
  },
  box: {
    kind: 'box',
    whiskers: 'minmax',
    fill: { type: 'solid', color: SERIES, opacity: 0.25 },
    border: line(1, SERIES),
    show: false,
  },
  violin: {
    extent: 'truncated',
    smoothing: 1,
    quartiles: true,
    quartileLine: { color: BLACK, width: 1, dash: 'dash' },
  },
  label: { show: false, stat: 'value', position: 'above', format: { mode: 'auto' }, text: {} },
  center: { stat: 'mean', line: line(1.25), width: 0.3 },
  error: { stat: 'SD', direction: 'both', capWidth: 8, line: line(1) },
  line: { show: false, stroke: line(1, SERIES), gaps: false },
  band: { show: false, opacity: 0.15 },
  spaghetti: { show: false, stroke: line(0.75, SERIES), fade: 0.5 },
  envelope: { show: false, opacity: 0.2 },
  area: { show: false, opacity: 0.2 },
  yAxis: 'left',
  markOrder: ['center', 'error', 'points', 'bar', 'line'],
}

const WHOLE: ResolvedSeriesStyle = {
  ...base,
  points: { ...base.points, show: false },
  bar: {
    ...base.bar,
    fill: { type: 'solid', color: SERIES, opacity: 1 },
    border: line(1, WHITE),
    width: 0.6,
  },
  center: { ...base.center, stat: 'none' },
  error: { ...base.error, stat: 'none' },
}

export const V1_SERIES: Record<GraphType, ResolvedSeriesStyle> = {
  'column.scatter': base,
  'column.bar': {
    ...base,
    points: { ...base.points, show: false, size: 5 },
    center: { ...base.center, stat: 'none' },
    error: { ...base.error, direction: 'above' },
  },
  'column.box': {
    ...base,
    points: { ...base.points, show: false, size: 5 },
    center: { stat: 'median', line: line(1.25), width: 1 },
    error: { ...base.error, stat: 'none' },
  },
  'column.beforeAfter': {
    ...base,
    points: { ...base.points, fill: { type: 'solid', color: WHITE, opacity: 1 } },
    center: { ...base.center, stat: 'none' },
    error: { ...base.error, stat: 'none' },
  },
  'grouped.bar': {
    ...base,
    points: { ...base.points, show: false, size: 4, replicates: 'each' },
    center: { ...base.center, stat: 'none' },
    error: { ...base.error, direction: 'above', capWidth: 5 },
    bar: { ...base.bar, width: 0.8 },
  },
  'grouped.scatter': {
    ...base,
    points: { ...base.points, size: 4.5, replicates: 'each' },
    center: { ...base.center, width: 0.45 },
    error: { ...base.error, capWidth: 5 },
  },
  'grouped.box': {
    ...base,
    points: { ...base.points, show: false, size: 4, replicates: 'each' },
    center: { stat: 'median', line: line(1.25), width: 1 },
    error: { ...base.error, stat: 'none', capWidth: 5 },
    bar: { ...base.bar, width: 0.8 },
  },
  'column.estimation': {
    ...base,
    error: { ...base.error, stat: 'none' },
  },
  'xy.scatter': {
    ...base,
    markOrder: ['points', 'error', 'center', 'bar', 'line'],
    points: { ...base.points, size: 6 },
    bar: { ...base.bar, width: 1 },
    center: { ...base.center, stat: 'none' },
    error: { ...base.error, capWidth: 6, line: line(1, SERIES) },
  },
  'survival.step': {
    ...base,
    points: { ...base.points, size: 6, border: line(1, SERIES) },
    center: { ...base.center, stat: 'none' },
    error: { ...base.error, stat: 'none' },
    line: { show: true, stroke: line(1.5, SERIES), gaps: false },
    band: { show: false, opacity: 0.15 },
  },
  'bubble.scatter': {
    ...base,
    points: { ...base.points, size: 10, fill: { type: 'solid', color: SERIES, opacity: 0.55 } },
    center: { ...base.center, stat: 'none' },
    error: { ...base.error, stat: 'none' },
  },
  'whole.pie': WHOLE,
  'whole.donut': WHOLE,
  'whole.bar': { ...WHOLE, bar: { ...WHOLE.bar, width: 0.6 } },
  'heatmap.cells': base,
}

export const V1_CURVE: ResolvedSeriesStyle = {
  ...base,
  points: { ...base.points, show: false },
  center: { ...base.center, stat: 'none' },
  error: { ...base.error, stat: 'none' },
  line: { show: true, stroke: line(1.5, SERIES), gaps: false },
  band: { show: true, opacity: 0.15 },
}
