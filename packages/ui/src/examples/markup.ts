import type { RichText, TextRun } from '@ps/model'

/**
 * A compact syntax for writing rich text in the example projects' builders (users format text in
 * the rich text editor, roadmap 28; decision 38's typed markup is retired):
 *   x^2  x^{-1}   superscript (one character, or braces)
 *   H_2O  k_{off}  subscript
 *   *text*        italic      **text**  bold
 *   \alpha \beta \mu \Delta … Greek letters; \pm ± \deg ° \times × \cdot ·
 *   \^ \_ \* \\   the literal character
 */

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  pm: '±',
  deg: '°',
  times: '×',
  cdot: '·',
  le: '≤',
  ge: '≥',
  ne: '≠',
  approx: '≈',
  infty: '∞',
  micro: 'µ',
}

interface Flags {
  sup?: boolean
  sub?: boolean
  italic?: boolean
  bold?: boolean
}

const sameFlags = (a: Flags, b: Flags) =>
  !!a.sup === !!b.sup && !!a.sub === !!b.sub && !!a.italic === !!b.italic && !!a.bold === !!b.bold

function push(out: TextRun[], text: string, f: Flags) {
  if (!text) return
  const last = out[out.length - 1]
  if (last && sameFlags(last, f) && !last.font) {
    last.text += text
    return
  }
  const run: TextRun = { text }
  if (f.sup) run.sup = true
  if (f.sub) run.sub = true
  if (f.italic) run.italic = true
  if (f.bold) run.bold = true
  out.push(run)
}

export function parseRichText(src: string): RichText {
  const out: TextRun[] = []
  const flags: Flags = {}
  let i = 0
  /** One unit after ^ or _: a braced group, an escape, or one character. */
  const unit = (): string => {
    if (src[i] === '{') {
      const end = src.indexOf('}', i + 1)
      const body = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end)
      i = end < 0 ? src.length : end + 1
      return expand(body)
    }
    if (src[i] === '\\') return command()
    return src[i++] ?? ''
  }
  const command = (): string => {
    const m = /^\\([A-Za-z]+)/.exec(src.slice(i))
    if (m && SYMBOLS[m[1]!]) {
      i += m[0].length
      // "{}" or one space ends a command before letters: "\mu{}m" and "\mu m" are both "µm".
      if (src.startsWith('{}', i)) i += 2
      else if (src[i] === ' ' && /[A-Za-z]/.test(src[i + 1] ?? '')) i++
      return SYMBOLS[m[1]!]!
    }
    const ch = src[i + 1] ?? '\\'
    i += 2
    return ch
  }
  let buf = ''
  const flush = () => {
    push(out, buf, flags)
    buf = ''
  }
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\') {
      buf += command()
    } else if (c === '^' || c === '_') {
      flush()
      i++
      const text = unit()
      push(out, text, { ...flags, sup: c === '^', sub: c === '_' })
    } else if (c === '*' && src[i + 1] === '*') {
      flush()
      flags.bold = !flags.bold
      i += 2
    } else if (c === '*') {
      flush()
      flags.italic = !flags.italic
      i++
    } else {
      buf += c
      i++
    }
  }
  flush()
  return out
}

/** Symbols and escapes inside a braced group (no nested scripts). */
function expand(body: string): string {
  return body.replace(
    /\\([A-Za-z]+|.)/g,
    (m, name: string) => SYMBOLS[name] ?? (name.length === 1 ? name : m),
  )
}
