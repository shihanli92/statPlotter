import {
  type ColorRef,
  type FontId,
  mergeRuns,
  type RichText,
  sameColor,
  type TextRun,
  type TextStyle,
} from '@ps/model'
import { variantOf } from '../fonts/manifest.ts'
import type { FontRegistry } from '../fonts/registry.ts'

/** Superscript/subscript geometry, as fractions of the run's font size. */
export const SCRIPT = {
  scale: 0.7,
  supShift: -0.38,
  subShift: 0.16,
} as const

export interface PositionedRun {
  text: string
  /** Pen x of the run start, in points from the text origin. */
  x: number
  /** Baseline offset in points from the first line's baseline; negative is up (SVG convention). */
  dy: number
  width: number
  font: FontId
  size: number
  bold: boolean
  italic: boolean
  /** The run's own colour (`TextRun.color`); absent = the text's. */
  color?: ColorRef
  /** That colour as CSS, set by `placeText` when it differs from the text's. */
  fill?: string
}

/** A filled rectangle from the text origin (x right, y down from the first baseline). */
export interface TextRect {
  x: number
  y: number
  w: number
  h: number
  /** As a run's `color` and `fill`: an underline takes its run's colour. */
  color?: ColorRef
  fill?: string
}

export interface TextLayout {
  width: number
  /** Distance from the first baseline to the top of the text (positive). */
  ascent: number
  /** Distance from the first baseline to the bottom of the last line (positive). */
  descent: number
  runs: PositionedRun[]
  /** Underlines, drawn as filled rects so every renderer (SVG, canvas, PNG, PDF) draws the same. */
  underlines?: TextRect[]
}

/** How the lines of multi-line text line up within the widest. */
export type LineAlign = 'start' | 'middle' | 'end'

const ALIGN: Record<LineAlign, number> = { start: 0, middle: 0.5, end: 1 }

interface Line {
  runs: PositionedRun[]
  /** Per run: its underline's top and thickness (from the run's size), or null. */
  rules: ({ y: number; h: number } | null)[]
  width: number
  ascent: number
  descent: number
  /** The largest run size on the line (scripts at their run's size), for the line pitch. */
  size: number
}

const emptyLine = (): Line => ({ runs: [], rules: [], width: 0, ascent: 0, descent: 0, size: 0 })

/**
 * Lays out rich text in points: a line per '\n', each aligned within the widest. Every run gets
 * an explicit x and baseline offset so renderers position runs exactly where we measured them;
 * browser shaping can only differ within a run. A run is measured at its own size (`TextRun.size`,
 * else the style's), a script at 0.7 of it and shifted by a fraction of it. Lines of one size sit
 * a line pitch apart (the base font's ascent, descent and line gap); a line with larger runs takes
 * the room of its largest run above and below its baseline, so mixed sizes never overlap.
 * Underlines take the position (the stroke's top) and thickness of the base family's regular face
 * at the run's size (the bold faces' strokes would touch the letters), and run on across a line's
 * adjacent underlined runs of one size and colour (scripts included).
 */
export function layoutText(
  fonts: FontRegistry,
  content: RichText,
  style: TextStyle,
  align: LineAlign = 'start',
): TextLayout {
  const regular = fonts.get(style.font, 'regular')
  const lines: Line[] = [emptyLine()]
  for (const run of content) {
    const parts = run.text.split('\n')
    for (const [k, text] of parts.entries()) {
      if (k > 0) lines.push(emptyLine())
      if (text === '') continue
      const line = lines[lines.length - 1]!
      const script = run.sup || run.sub
      const own = run.size ?? style.size
      const size = script ? own * SCRIPT.scale : own
      const dy = run.sup ? SCRIPT.supShift * own : run.sub ? SCRIPT.subShift * own : 0
      const fontId = run.font ?? style.font
      const bold = run.bold ?? style.bold
      const italic = run.italic ?? style.italic
      const font = fonts.get(fontId, variantOf(bold, italic))
      const scale = size / font.unitsPerEm
      const width = font.layout(text).advanceWidth * scale
      const color = run.color ? { color: run.color } : {}

      line.runs.push({ text, x: line.width, dy, width, font: fontId, size, bold, italic, ...color })
      const rule = own / regular.unitsPerEm
      line.rules.push(
        run.underline
          ? { y: -regular.underlinePosition * rule, h: regular.underlineThickness * rule }
          : null,
      )
      line.width += width
      line.ascent = Math.max(line.ascent, font.ascent * scale - dy)
      line.descent = Math.max(line.descent, -font.descent * scale + dy)
      line.size = Math.max(line.size, own)
    }
  }

  const base = fonts.get(style.font, variantOf(style.bold, style.italic))
  const unit = style.size / base.unitsPerEm
  const pitch = (base.ascent - base.descent + base.lineGap) * unit
  // Baselines: a pitch apart while every line is at the style's size (or empty); else each step
  // is the room below the line above (descent and line gap at its largest size) plus the room
  // above the next (ascent at its largest size).
  const sizeOf = (l: Line) => (l.runs.length ? l.size : style.size)
  const uniform = lines.every((l) => sizeOf(l) === style.size)
  const baselines = [0]
  for (let i = 1; i < lines.length; i++) {
    const [above, below] = [sizeOf(lines[i - 1]!), sizeOf(lines[i]!)]
    baselines.push(
      uniform
        ? i * pitch
        : baselines[i - 1]! +
            ((base.lineGap - base.descent) * above + base.ascent * below) / base.unitsPerEm,
    )
  }
  const width = Math.max(...lines.map((l) => l.width))
  const runs: PositionedRun[] = []
  const underlines: TextRect[] = []
  for (const [i, line] of lines.entries()) {
    const shift = (width - line.width) * ALIGN[align]
    const baseline = baselines[i]!
    let prev: TextRect | null = null
    for (const [j, r] of line.runs.entries()) {
      runs.push(shift || baseline ? { ...r, x: r.x + shift, dy: r.dy + baseline } : r)
      const rule = line.rules[j]
      if (!rule) {
        prev = null
        continue
      }
      const x = r.x + shift
      const y = baseline + rule.y
      if (prev && prev.y === y && prev.h === rule.h && sameColor(prev.color, r.color))
        prev.w = x + r.width - prev.x
      else {
        prev = { x, y, w: r.width, h: rule.h, ...(r.color ? { color: r.color } : {}) }
        underlines.push(prev)
      }
    }
  }

  // One line measures its own runs (zero when empty, as before multi-line text). More lines add
  // the pitch; an empty first or last line is as tall as the base font.
  const n = lines.length
  const first = lines[0]!
  const last = lines[n - 1]!
  if (n === 1) return withUnderlines({ width, ascent: first.ascent, descent: first.descent, runs })
  return withUnderlines({
    width,
    ascent: first.runs.length ? first.ascent : base.ascent * unit,
    descent: baselines[n - 1]! + (last.runs.length ? last.descent : -base.descent * unit),
    runs,
  })

  function withUnderlines(l: TextLayout): TextLayout {
    return underlines.length ? { ...l, underlines } : l
  }
}

/** A piece of a run: its text in the run's format. */
interface Piece {
  run: TextRun
  text: string
}

/**
 * Rich text with line breaks added so that no line is wider than `width` points (a text box of
 * that width, roadmap 32): lines break at spaces (the space dropped), a word wider than the box
 * at the last letter that fits. Typed line breaks stay. Words are measured as `layoutText`
 * measures them (a run's size, scripts at 0.7), without kerning across a word's pieces.
 */
export function wrapText(
  fonts: FontRegistry,
  content: RichText,
  style: TextStyle,
  width: number,
): RichText {
  const measure = (p: Piece) => {
    const own = p.run.size ?? style.size
    const size = p.run.sup || p.run.sub ? own * SCRIPT.scale : own
    const font = fonts.get(
      p.run.font ?? style.font,
      variantOf(p.run.bold ?? style.bold, p.run.italic ?? style.italic),
    )
    return (font.layout(p.text).advanceWidth * size) / font.unitsPerEm
  }
  const out: Piece[] = []
  let line = 0
  /** Spaces waiting after the last word on the line (dropped at a break). */
  let spaces: Piece[] = []
  let spaceWidth = 0
  let word: Piece[] = []
  const breakLine = (run: TextRun) => {
    out.push({ run, text: '\n' })
    line = 0
    spaces = []
    spaceWidth = 0
  }
  const flushWord = () => {
    if (!word.length) return
    const w = word.reduce((s, p) => s + measure(p), 0)
    if (line > 0 && line + spaceWidth + w > width) breakLine(word[0]!.run)
    else {
      out.push(...spaces)
      line += spaceWidth
    }
    spaces = []
    spaceWidth = 0
    if (w <= width - line || line > 0) {
      out.push(...word)
      line += w
    } else {
      // Wider than the box: letter by letter, breaking where the next one would overflow.
      for (const p of word) {
        for (const ch of p.text) {
          const cw = measure({ run: p.run, text: ch })
          if (line > 0 && line + cw > width) breakLine(p.run)
          out.push({ run: p.run, text: ch })
          line += cw
        }
      }
    }
    word = []
  }
  for (const run of content) {
    for (const token of run.text.split(/(\n| +)/)) {
      if (token === '') continue
      if (token === '\n') {
        flushWord()
        breakLine(run)
      } else if (token[0] === ' ') {
        flushWord()
        const p = { run, text: token }
        spaces.push(p)
        spaceWidth += measure(p)
      } else word.push({ run, text: token })
    }
  }
  flushWord()
  // Spaces left at the very end are kept (they were typed); runs of one format merged.
  out.push(...spaces)
  return mergeRuns(out.map((p) => ({ ...p.run, text: p.text })))
}
