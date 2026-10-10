import type { Command } from '@ps/engine'
import { resolveColor } from '@ps/graph'
import type {
  ColorRef,
  FillStyle,
  GraphNode,
  NodeId,
  StrokeStyle,
  SymbolShape,
  TextStyle,
} from '@ps/model'
import { styleCommands } from '../graph/inspector/layers.ts'
import {
  fillCommands,
  lineCommands,
  markCommands,
  slotStyle,
  type Target,
  textCommands,
} from './selectionStyles.ts'

// Roadmap 45: the format painter. Copy format records what the primary selected thing draws —
// its text style, its line, its fill, a data set's symbols and its formats in each kind of layer
// with its colour — in the app's memory (one per window, like the graph clipboard); Paste format
// applies each part to every selected thing that has a place for it (text to text, symbols to a
// points layer's data sets, a line to lines), across graphs and pages, as one undo step. A data
// set's colour tells it from the others, so it is pasted only when asked ("Paste format with
// colour").

/** A copied format: the parts the source had. */
export interface CopiedFormat {
  /** Text: every field as drawn (the colour as its own reference, else the colour drawn). */
  text?: TextStyle
  /** A line as drawn. */
  line?: StrokeStyle
  /** A fill (not a data set's colour). */
  fill?: FillStyle | null
  /** Symbols as drawn (a points layer's data set or layer). */
  mark?: { shape: SymbolShape; size: number }
  /** A data set: its own formats in its layers, by geom; its colour. */
  dataSet?: { styles: Partial<Record<string, Record<string, unknown>>>; color: ColorRef }
}

/** What the primary target draws, to paste elsewhere (null: nothing it has can be pasted). */
export function copyFormat(t: Target | null, graphs: (id: NodeId) => GraphNode | undefined) {
  if (!t) return null
  const out: CopiedFormat = {}
  if (t.text) {
    const s = slotStyle(t.text)
    out.text = {
      ...s,
      color: t.text.own.color ?? { rgb: resolveColor(s.color, t.text.palette) },
    }
  }
  if (t.line?.shown) out.line = t.line.shown
  if (t.fill?.kind === 'fill') out.fill = t.fill.value ?? null
  if (t.mark) out.mark = { shape: t.mark.shape, size: t.mark.size }
  if (t.dataSet && t.fill?.kind === 'identity') {
    const g = graphs(t.dataSet.node)
    const key = t.dataSet.key
    const styles: Record<string, Record<string, unknown>> = {}
    // Each layer drawing it (by kind): the layer's style with its own over it.
    for (const l of g?.layers ?? []) {
      const own = l.series?.[key]?.style as Record<string, unknown> | undefined
      const drawn = !l.data || l.data.from === 'table' || !!l.series?.[key]
      if (drawn && !styles[l.geom]) styles[l.geom] = { ...(l.style ?? {}), ...(own ?? {}) }
    }
    if (out.mark) styles.points = { ...styles.points, ...out.mark }
    out.dataSet = { styles, color: t.fill.value ?? { rgb: t.fill.shown } }
  }
  return Object.keys(out).length ? out : null
}

/** What a paste writes on each target, and how many it changes. */
export function pasteCommands(
  copied: CopiedFormat,
  targets: readonly Target[],
  opts: { color?: boolean } = {},
): { commands: Command[]; count: number } {
  const commands: Command[] = []
  let count = 0
  for (const t of targets) {
    if (!pastesOn(copied, t)) continue
    count++
    if (copied.text && t.text) {
      const { font, size, color, bold, italic } = copied.text
      commands.push(...textCommands([t.text], { font, size, color, bold, italic }))
    }
    if (copied.line && t.line) commands.push(...lineCommands([t.line], copied.line))
    if (copied.fill !== undefined && t.fill?.kind === 'fill') {
      const f = copied.fill
      commands.push(...fillCommands([t.fill], f?.type === 'solid' ? f.color : undefined))
    }
    const layer = t.dataSet?.layer
    const own = layer && copied.dataSet?.styles[layer.geom]
    if (t.dataSet && layer && own) {
      // A data set onto a data set: its formats in the target's kind of layer, the target's own
      // fields it lacks removed (colour aside).
      const k = t.dataSet.key
      const had = (layer.series?.[k]?.style ?? {}) as Record<string, unknown>
      const fields = [...new Set([...Object.keys(own), ...Object.keys(had)])]
      const changes = fields.map((f): [string, unknown] => [f, own[f]])
      commands.push(...styleCommands(t.dataSet.graph, layer, k, changes))
    } else if (t.mark && copied.mark) commands.push(...markCommands([t.mark], copied.mark))
    if (opts.color && copied.dataSet && t.fill?.kind === 'identity')
      commands.push(...fillCommands([t.fill], copied.dataSet.color))
  }
  return { commands, count }
}

/** Whether a copied format has something for this target. */
export function pastesOn(copied: CopiedFormat, t: Target): boolean {
  const layer = t.dataSet?.layer
  return !!(
    (copied.text && t.text) ||
    (copied.line && t.line) ||
    (copied.fill !== undefined && t.fill?.kind === 'fill') ||
    (copied.mark && t.mark) ||
    (copied.dataSet && t.fill?.kind === 'identity') ||
    (layer && copied.dataSet?.styles[layer.geom])
  )
}

/** Whether a paste reaches any of these targets (the commands' enabled state). */
export const canPaste = (copied: CopiedFormat | null, targets: readonly Target[]) =>
  !!copied && targets.some((t) => pastesOn(copied, t))

/** The window's copied format, with change notifications for the commands' states. */
export class FormatClipboard {
  private value: CopiedFormat | null = null
  private listeners = new Set<() => void>()

  get = (): CopiedFormat | null => this.value

  set(value: CopiedFormat | null): void {
    this.value = value
    for (const fn of [...this.listeners]) fn()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const formatClipboard = new FormatClipboard()
