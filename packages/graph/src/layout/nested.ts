import type { SymbolShape } from '@ps/model'
import type { GraphSeries, PlotPoint } from '../data.ts'

// Nested data on column graphs: a data set is a group, its subcolumns the subjects in it, rows
// their replicate measurements. The points layer's position (`dodge by subject`) and `subjects`
// style say how subjects are drawn (`withNested`, presets.ts).

/** A subject of a group: its subcolumn, name, and the values drawn. */
export interface Subject {
  sub: number
  title: string
  points: PlotPoint[]
  mean: number
}

/**
 * The subjects of a series with any value, in subcolumn order (a group with fewer subjects than
 * the widest group leaves its last subcolumns empty; they take no room). Empty for summary data
 * or a single subcolumn.
 */
export function subjectsOf(s: GraphSeries, points: readonly PlotPoint[]): Subject[] {
  if (s.ds.data.shape !== 'replicates' || s.ds.data.reps.length < 2) return []
  const bySub = new Map<number, PlotPoint[]>()
  for (const p of points) {
    const sub = p.sub ?? 0
    const list = bySub.get(sub)
    if (list) list.push(p)
    else bySub.set(sub, [p])
  }
  return [...bySub.keys()]
    .sort((a, b) => a - b)
    .map((sub) => {
      const pts = bySub.get(sub)!
      return {
        sub,
        title: s.subcolumnTitles?.[sub] ?? `Subject ${sub + 1}`,
        points: pts,
        mean: pts.reduce((acc, p) => acc + p.value, 0) / pts.length,
      }
    })
}

const SHAPES: readonly SymbolShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus']

/** The k-th subject's symbol: the data set's shape first, then the others in turn. */
export function subjectShape(base: SymbolShape, k: number): SymbolShape {
  const order = [base, ...SHAPES.filter((s) => s !== base)]
  return order[k % order.length]!
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0')

/**
 * The k-th of m subjects' shade of a group colour: from darker (first) to lighter (last), the
 * middle one the colour itself. Colours that aren't #rrggbb are returned unchanged.
 */
export function subjectShade(color: string, k: number, m: number): string {
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!rgb || m < 2) return color
  // −0.45 (towards black) … +0.45 (towards white).
  const t = (k / (m - 1) - 0.5) * 0.9
  const [r, g, b] = [rgb[1]!, rgb[2]!, rgb[3]!].map((h) => Number.parseInt(h, 16)) as [
    number,
    number,
    number,
  ]
  const mix = (c: number) => (t < 0 ? c * (1 + t) : c + (255 - c) * t)
  return `#${hex2(mix(r))}${hex2(mix(g))}${hex2(mix(b))}`
}
