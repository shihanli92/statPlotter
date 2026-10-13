import type { SchematicBox, SchematicSpec } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { sceneToSvg } from '../src/render/svg.ts'
import type { Box, Prim, SceneNode } from '../src/scene.ts'
import { SCHEMATIC_THEMES, SCHEMATIC_WIDTH, schematicScene } from '../src/schematic.ts'
import { fonts } from './helpers.ts'

// Roadmap 51f: "What will be tested" laid out — boxes on their grid places, arcs over a row
// (beside a column), lines under a row, straight arrows, links joining the same subjects, a
// grid's headings and the links' legend. The spec is plain data; the drawing knows boxes, arrows
// and links only.

const box = (
  id: string,
  row: number,
  column: number,
  extra: Partial<SchematicBox> = {},
): SchematicBox => ({
  id,
  label: id,
  measure: 'mean',
  glyph: 'mean',
  role: 'group',
  row,
  column,
  ...extra,
})

const spec = (s: Partial<SchematicSpec>): SchematicSpec => ({
  question: 'Q?',
  noEffect: null,
  boxes: [],
  arrows: [],
  links: [],
  notes: [],
  description: 'Q?',
  ...s,
})

function find(n: SceneNode, id: string): SceneNode | undefined {
  if (n.id === id) return n
  for (const c of n.children ?? []) {
    const f = find(c, id)
    if (f) return f
  }
  return undefined
}
const prims = (n: SceneNode | undefined): Prim[] =>
  n ? [...(n.prim ? [n.prim] : []), ...(n.children ?? []).flatMap(prims)] : []
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('the schematic’s layout', () => {
  it('places boxes on their grid, apart and inside the drawing', () => {
    const s = spec({
      boxes: [box('a', 0, 0), box('b', 0, 1), box('c', 0, 2), box('d', 1, 0), box('e', 1, 1)],
    })
    const scene = schematicScene(s, fonts)
    expect(scene.width).toBe(SCHEMATIC_WIDTH)
    const boxes = s.boxes.map((b) => find(scene.root, `box/${b.id}`)!.bbox!)
    for (const [i, a] of boxes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.x + a.w).toBeLessThanOrEqual(scene.width)
      expect(a.y + a.h).toBeLessThanOrEqual(scene.height)
      for (const b of boxes.slice(i + 1)) expect(overlap(a, b)).toBe(false)
    }
    // Same row, same top; next row below; same column, same left.
    expect(boxes[1]!.y).toBe(boxes[0]!.y)
    expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.h)
    expect(boxes[3]!.x).toBe(boxes[0]!.x)
    expect(sceneToSvg(scene)).not.toContain('NaN')
  })

  it('grows wider than the panel when its columns need it', () => {
    const s = spec({ boxes: Array.from({ length: 9 }, (_, k) => box(`g${k}`, 0, k)) })
    expect(schematicScene(s, fonts).width).toBeGreaterThan(SCHEMATIC_WIDTH)
  })

  it('draws heads as the arrows say: both ends, the end only, none', () => {
    const boxes = [box('a', 0, 0), box('b', 0, 1), box('c', 0, 2)]
    const heads = (h: 'both' | 'end' | 'none') => {
      const scene = schematicScene(
        spec({ boxes, arrows: [{ from: 'a', to: 'b', heads: h, route: 'arc' }] }),
        fonts,
      )
      return prims(find(scene.root, 'arrow/0')).filter((p) => p.type === 'polygon')
    }
    expect(heads('both')).toHaveLength(2)
    expect(heads('none')).toHaveLength(0)
    const end = heads('end')
    expect(end).toHaveLength(1)
    // The head is at b (to the right of a).
    const scene = schematicScene(spec({ boxes }), fonts)
    const b = find(scene.root, 'box/b')!.bbox!
    const tip = (end[0] as Extract<Prim, { type: 'polygon' }>).points[0]!
    expect(tip[0]).toBeGreaterThan(b.x)
    expect(tip[0]).toBeLessThan(b.x + b.w)
  })

  it('stacks arcs over a row so none crosses another on one level; labels with a halo', () => {
    const boxes = [box('a', 0, 0), box('b', 0, 1), box('c', 0, 2)]
    const scene = schematicScene(
      spec({
        boxes,
        arrows: [
          { from: 'a', to: 'b', heads: 'both', route: 'arc' },
          { from: 'a', to: 'c', heads: 'both', route: 'arc', label: 'wide?' },
          { from: 'b', to: 'c', heads: 'both', route: 'arc' },
        ],
      }),
      fonts,
    )
    const apex = (i: number) => {
      const p = prims(find(scene.root, `arrow/${i}/line`))[0] as Extract<Prim, { type: 'path' }>
      return p.d[1]![2] as number
    }
    expect(apex(0)).toBe(apex(2))
    expect(apex(1)).toBeLessThan(apex(0))
    const label = find(scene.root, 'arrow/1/label')!.prim as Extract<Prim, { type: 'text' }>
    expect(label.halo?.color).toBe(SCHEMATIC_THEMES.light.paper)
    // Every arc sits above the boxes.
    expect(apex(1)).toBeGreaterThanOrEqual(0)
  })

  it('draws a line under a row, straight arrows between columns, arcs beside a column', () => {
    const scene = schematicScene(
      spec({
        boxes: [box('a', 0, 0), box('b', 0, 1), box('p', 1, 0), box('o', 1, 1), box('q', 2, 0)],
        arrows: [
          { from: 'a', to: 'b', heads: 'end', route: 'below', label: 'trend?' },
          { from: 'p', to: 'o', heads: 'end', route: 'straight' },
          { from: 'p', to: 'q', heads: 'both', route: 'arc' },
        ],
      }),
      fonts,
    )
    const a = find(scene.root, 'box/a')!.bbox!
    const under = prims(find(scene.root, 'arrow/0/line'))[0] as Extract<Prim, { type: 'line' }>
    expect(under.y1).toBe(under.y2)
    expect(under.y1).toBeGreaterThan(a.y + a.h)
    const straight = prims(find(scene.root, 'arrow/1/line'))[0] as Extract<Prim, { type: 'line' }>
    const p = find(scene.root, 'box/p')!.bbox!
    expect(straight.x1).toBeCloseTo(p.x + p.w)
    const side = prims(find(scene.root, 'arrow/2/line'))[0] as Extract<Prim, { type: 'path' }>
    expect(side.d[0]![1]).toBeCloseTo(p.x + p.w)
  })

  it('links the same subjects under a row or beside a column, with a legend', () => {
    const scene = schematicScene(
      spec({
        boxes: [box('a', 0, 0), box('b', 0, 1), box('c', 1, 0)],
        links: [
          { boxes: ['a', 'b'], label: 'same subjects' },
          { boxes: ['a', 'c'], label: 'same subjects' },
        ],
      }),
      fonts,
    )
    const row = prims(find(scene.root, 'link/0/line'))[0] as Extract<Prim, { type: 'line' }>
    const col = prims(find(scene.root, 'link/1/line'))[0] as Extract<Prim, { type: 'line' }>
    expect(row.y1).toBe(row.y2)
    expect(col.x1).toBe(col.x2)
    expect(row.stroke.color).toBe(SCHEMATIC_THEMES.light.link)
    const legend = find(scene.root, 'legend/link/label')!.prim as Extract<Prim, { type: 'text' }>
    expect(legend.layout.runs.map((r) => r.text).join('')).toBe('same subjects')
  })

  it('a grid: factor names and level headings; roles drawn by their kind', () => {
    const scene = schematicScene(
      spec({
        boxes: [
          box('c00', 0, 0, { label: '', role: 'control' }),
          box('c01', 0, 1, { label: '' }),
          box('ref', 0, 2, { label: '100', role: 'reference', glyph: 'none' }),
        ],
        grid: { columns: 'Genotype', rows: 'Time', columnLevels: ['WT', 'KO'], rowLevels: ['0 h'] },
      }),
      fonts,
    )
    const text = (id: string) =>
      (find(scene.root, id)!.prim as Extract<Prim, { type: 'text' }>).layout.runs
        .map((r) => r.text)
        .join('')
    expect(text('factor/columns')).toBe('Genotype')
    expect(text('factor/rows')).toBe('Time')
    expect(text('heading/column/1')).toBe('KO')
    expect(text('heading/row/0')).toBe('0 h')
    const frame = (id: string) =>
      find(scene.root, `box/${id}/frame`)!.prim as Extract<Prim, { type: 'rect' }>
    expect(frame('c00').stroke?.color).toBe(SCHEMATIC_THEMES.light.controlEdge)
    expect(text('box/c00/tag')).toBe('control')
    expect(frame('ref').stroke?.dash).toBe('dash')
    expect(frame('ref').fill).toBeNull()
  })

  it('takes the dark theme’s colours', () => {
    const s = spec({
      boxes: [box('a', 0, 0), box('b', 0, 1)],
      arrows: [{ from: 'a', to: 'b', heads: 'both', route: 'arc' }],
    })
    const dark = sceneToSvg(schematicScene(s, fonts, { theme: 'dark' }))
    expect(dark).toContain(SCHEMATIC_THEMES.dark.arrow)
    expect(dark).toContain(SCHEMATIC_THEMES.dark.box)
    expect(dark).not.toContain(SCHEMATIC_THEMES.light.arrow)
  })

  it('long factor names and link labels fit, apart from headings and boxes (audit 4 G4)', () => {
    const all = (n: SceneNode): SceneNode[] => [n, ...(n.children ?? []).flatMap(all)]
    const grid = (rows: string, columns: string, link?: string) =>
      schematicScene(
        spec({
          boxes: [box('a', 0, 0), box('b', 0, 1), box('c', 1, 0), box('d', 1, 1)],
          grid: { rows, columns, rowLevels: ['Male', 'Female'], columnLevels: ['Ctrl', 'Drug'] },
          ...(link ? { links: [{ boxes: ['a', 'b'], label: link }] } : {}),
        }),
        fonts,
      )
    for (const scene of [
      grid('Time', 'Drug'),
      grid('Hours after injection', 'Treatment group'),
      grid(
        'Time point after the injection (hours)',
        'Treatment condition given to every one of the animals in the study',
        'the same subjects measured before and after the treatment was given to them all',
      ),
    ]) {
      const nodes = all(scene.root).filter((n) => n.bbox)
      for (const n of nodes) {
        const b = n.bbox!
        expect(b.x, n.id).toBeGreaterThanOrEqual(-0.01)
        expect(b.y, n.id).toBeGreaterThanOrEqual(-0.01)
        expect(b.x + b.w, n.id).toBeLessThanOrEqual(scene.width + 0.01)
        expect(b.y + b.h, n.id).toBeLessThanOrEqual(scene.height + 0.01)
      }
      const rowsName = find(scene.root, 'factor/rows')!.bbox!
      for (const other of nodes.filter((n) => /^(heading\/|box\/[^/]+$)/.test(n.id)))
        expect(overlap(rowsName, other.bbox!), other.id).toBe(false)
    }
  })

  it('names of astral characters are cut whole: the SVG encodes (audit 4 G5)', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (let n = 20; n <= 40; n++)
      for (const ch of ['😀', '𠮷']) {
        const svg = sceneToSvg(
          schematicScene(
            spec({
              boxes: [box('a', 0, 0, { label: ch.repeat(n) }), box('b', 0, 1)],
              links: [{ boxes: ['a', 'b'], label: ch.repeat(n * 3) }],
            }),
            fonts,
          ),
          { portableFonts: true },
        )
        expect(lone.test(svg), `${ch} × ${n}`).toBe(false)
        expect(() => encodeURIComponent(svg)).not.toThrow()
      }
  })

  it('cuts long names to two lines, ending “…”', () => {
    const scene = schematicScene(
      spec({
        boxes: [
          box('a', 0, 0, {
            label: 'A very long group name that goes on and on past any box width at all',
          }),
          box('b', 0, 1),
          box('c', 0, 2),
        ],
      }),
      fonts,
    )
    const label = find(scene.root, 'box/a/label')!.prim as Extract<Prim, { type: 'text' }>
    const text = label.layout.runs.map((r) => r.text).join('|')
    expect(text.split('\n').length).toBeLessThanOrEqual(2)
    expect(label.layout.width).toBeLessThanOrEqual(find(scene.root, 'box/a')!.bbox!.w)
    expect(text.endsWith('…')).toBe(true)
  })
})
