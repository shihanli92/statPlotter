import {
  FONT_IDS,
  FONTS,
  type FontRegistry,
  fontFaceCss,
  layoutText,
  loadBrowserFonts,
  type TextLayout,
} from '@ps/graph'
import type { RichText, TextStyle } from '@ps/model'
import { useEffect, useRef, useState } from 'react'

/**
 * Phase 0 diagnostic: text measured by our engine (fontkit) vs. rendered by the browser.
 * The grey box is our measurement; the text should fill it exactly.
 */

interface Sample {
  label: string
  content: RichText
  style: TextStyle
}

const base: TextStyle = {
  font: 'sans',
  size: 18,
  color: { rgb: '#000000' },
  bold: false,
  italic: false,
}

const SAMPLES: Sample[] = [
  { label: 'plain', content: [{ text: 'Concentration (µM)' }], style: base },
  { label: 'bold', content: [{ text: 'Response (% of control)' }], style: { ...base, bold: true } },
  {
    label: 'italic',
    content: [{ text: 'Time after dosing (h)' }],
    style: { ...base, italic: true },
  },
  {
    label: 'superscript',
    content: [
      { text: 'log' },
      { text: '10', sub: true },
      { text: '[Agonist], 10' },
      { text: '-6', sup: true },
      { text: ' M' },
    ],
    style: base,
  },
  {
    label: 'serif',
    content: [{ text: 'Mean ± SEM, n = 6 (α = 0.05)' }],
    style: { ...base, font: 'serif' },
  },
  {
    label: 'serif bold italic',
    content: [{ text: 'IC50 = 3.2 nM' }],
    style: { ...base, font: 'serif', bold: true, italic: true },
  },
  {
    label: 'mono',
    content: [{ text: 'x = 0.125; y = 3.50' }],
    style: { ...base, font: 'mono' },
  },
  {
    label: 'mono bold italic',
    content: [{ text: 'Mean ± SD (µM)' }],
    style: { ...base, font: 'mono', bold: true, italic: true },
  },
  {
    label: 'narrow',
    content: [{ text: 'Concentration of agonist (µM)' }],
    style: { ...base, font: 'narrow' },
  },
  {
    label: 'narrow bold italic',
    content: [{ text: 'Δ Response, % of baseline' }],
    style: { ...base, font: 'narrow', bold: true, italic: true },
  },
  {
    label: 'mixed fonts and sizes',
    content: [
      { text: 'Big', size: 26 },
      { text: ' mono', font: 'mono' },
      { text: ' narrow', font: 'narrow', size: 14 },
      { text: '2', sup: true, size: 26 },
    ],
    style: base,
  },
  {
    label: 'tick labels',
    content: [{ text: '0 25 50 75 100 125 150' }],
    style: { ...base, size: 12 },
  },
]

const PAD = 16
const ROW = 44

function Rendered({ layout, style, y }: { layout: TextLayout; style: TextStyle; y: number }) {
  return (
    <text data-measured={layout.width} fill="#000">
      {layout.runs.map((r, i) => (
        <tspan
          // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional
          key={i}
          x={PAD + r.x}
          y={y + r.dy}
          fontFamily={`'${FONTS[r.font].cssFamily}'`}
          fontSize={r.size}
          fontWeight={r.bold ? 700 : 400}
          fontStyle={r.italic ? 'italic' : 'normal'}
        >
          {r.text}
        </tspan>
      ))}
      <title>{style.font}</title>
    </text>
  )
}

export function FontCheck() {
  const [fonts, setFonts] = useState<FontRegistry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<number[]>([])
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = fontFaceCss()
    document.head.append(style)
    Promise.all([loadBrowserFonts(FONT_IDS), document.fonts.ready])
      .then(async ([registry]) => {
        // Force every face to load before the browser measures.
        await Promise.all(
          Object.values(FONTS).flatMap((f) =>
            ['400 normal', '700 normal', '400 italic', '700 italic'].map((w) => {
              const [weight, s] = w.split(' ')
              return document.fonts.load(`${s} ${weight} 16px '${f.cssFamily}'`)
            }),
          ),
        )
        setFonts(registry)
      })
      .catch((e: unknown) => setError(String(e)))
    return () => style.remove()
  }, [])

  const layouts = fonts ? SAMPLES.map((s) => layoutText(fonts, s.content, s.style)) : []

  useEffect(() => {
    if (!fonts || !svgRef.current) return
    const texts = [...svgRef.current.querySelectorAll('text')]
    setDiffs(
      texts.map((t) => {
        const tspans = [...t.querySelectorAll('tspan')]
        const last = tspans.at(-1)!
        const browserEnd = last.getStartPositionOfChar(0).x + last.getComputedTextLength()
        return browserEnd - PAD - Number(t.dataset.measured)
      }),
    )
  }, [fonts])

  const maxDiff = diffs.length ? Math.max(...diffs.map(Math.abs)) : null

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, color: '#1a1a1a' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Font metrics check</h1>
      <p style={{ margin: '0 0 16px', color: '#555', fontSize: 14 }}>
        Grey boxes are widths measured by the graph engine; text is rendered by the browser. They
        should coincide.
      </p>
      {error && <p style={{ color: '#b00020' }}>Failed to load fonts: {error}</p>}
      {!fonts && !error && <p>Loading fonts…</p>}
      {fonts && (
        <>
          <svg
            ref={svgRef}
            width={720}
            height={PAD * 2 + ROW * SAMPLES.length}
            style={{ border: '1px solid #ddd', background: '#fff' }}
            role="img"
            aria-label="Measured vs rendered text samples"
          >
            {SAMPLES.map((s, i) => {
              const l = layouts[i]!
              const y = PAD + ROW * i + 28
              return (
                <g key={s.label}>
                  <rect
                    x={PAD}
                    y={y - l.ascent}
                    width={l.width}
                    height={l.ascent + l.descent}
                    fill="#e3e6ea"
                  />
                  <Rendered layout={l} style={s.style} y={y} />
                </g>
              )
            })}
          </svg>
          <table style={{ marginTop: 16, fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingRight: 24 }}>Sample</th>
                <th style={{ textAlign: 'right', paddingRight: 24 }}>Measured (pt)</th>
                <th style={{ textAlign: 'right' }}>Browser − measured (pt)</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLES.map((s, i) => (
                <tr key={s.label}>
                  <td style={{ paddingRight: 24 }}>{s.label}</td>
                  <td style={{ textAlign: 'right', paddingRight: 24 }}>
                    {layouts[i]!.width.toFixed(3)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{diffs[i]?.toFixed(3) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {maxDiff !== null && (
            <p data-testid="max-diff" style={{ fontSize: 13 }}>
              Max discrepancy: {maxDiff.toFixed(3)} pt
            </p>
          )}
        </>
      )}
    </main>
  )
}
